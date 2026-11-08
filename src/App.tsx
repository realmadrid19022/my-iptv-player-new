import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import Hls from 'hls.js';
import './App.css';

type Channel = {
  stream_id: number;
  name: string;
  stream_icon?: string;
  category_id?: string;
  epg_channel_id?: string;
  container_extension?: string;
  stream_url?: string;
};

type Category = {
  category_id: string;
  category_name: string;
};

type EpgProgram = {
  channel: string;
  title: string;
  start: Date;
  stop: Date;
};

type EpgSchedule = {
  current: EpgProgram | null;
  next: EpgProgram | null;
};

function readStorage<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function makeDemoLogo(title: string, color: string) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="320" height="180">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${color}"/>
          <stop offset="100%" stop-color="#101827"/>
        </linearGradient>
      </defs>
      <rect width="320" height="180" rx="18" fill="url(#bg)"/>
      <circle cx="160" cy="65" r="30" fill="white" opacity=".15"/>
      <path d="M148 48 L148 82 L178 65 Z" fill="white"/>
      <text x="160" y="135" text-anchor="middle"
        font-family="Arial" font-size="24" font-weight="bold"
        fill="white">${title}</text>
    </svg>
  `;

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function ChannelLogo({ channel }: { channel: Channel }) {
  const [failed, setFailed] = useState(false);

  if (!channel.stream_icon || failed) {
    return <div className="channel-icon">📺</div>;
  }

  return (
    <img
      src={channel.stream_icon}
      alt={channel.name}
      className="channel-image"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

function parseXmltvDate(value: string): Date | null {
  const match = value.match(
    /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s*([+-])(\d{2})(\d{2}))?/
  );

  if (!match) return null;

  const [
    ,
    year,
    month,
    day,
    hour,
    minute,
    second,
    sign,
    offsetHour,
    offsetMinute,
  ] = match;

  const utc = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  );

  let offset = 0;

  if (sign && offsetHour && offsetMinute) {
    offset = (Number(offsetHour) * 60 + Number(offsetMinute)) * 60_000;
    if (sign === '-') offset *= -1;
  }

  const date = new Date(utc - offset);

  return Number.isNaN(date.getTime()) ? null : date;
}

function formatTime(date: Date) {
  return date.toLocaleTimeString('ar-EG', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getSchedule(
  channel: Channel,
  programs: EpgProgram[],
  now: Date
): EpgSchedule {
  const channelName = channel.name.trim().toLowerCase();
  const channelId = String(channel.epg_channel_id || channel.stream_id).trim();

  const matching = programs
    .filter((program) => {
      const idMatches = program.channel === channelId;
      const nameMatches = program.channel.trim().toLowerCase() === channelName;

      return idMatches || nameMatches;
    })
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const currentIndex = matching.findIndex(
    (program) =>
      program.start.getTime() <= now.getTime() &&
      program.stop.getTime() > now.getTime()
  );

  return {
    current: currentIndex >= 0 ? matching[currentIndex] : null,
    next:
      currentIndex >= 0
        ? matching[currentIndex + 1] || null
        : matching.find((program) => program.start.getTime() > now.getTime()) ||
          null,
  };
}

export default function App() {
  const [server, setServer] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(false);

  const [channels, setChannels] = useState<Channel[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [search, setSearch] = useState('');

  const [playingChannel, setPlayingChannel] = useState<Channel | null>(null);
  const [playerError, setPlayerError] = useState('');
  const [streamFormat, setStreamFormat] = useState<'m3u8' | 'ts'>('m3u8');

  const videoRef = useRef<HTMLVideoElement | null>(null);

  const [favorites, setFavorites] = useState<number[]>(() =>
    readStorage('myiptv_favorites', [])
  );

  const [recentChannels, setRecentChannels] = useState<number[]>(() =>
    readStorage('myiptv_recent', [])
  );

  const [epgUrl, setEpgUrl] = useState(
    () => localStorage.getItem('myiptv_epg_url') || ''
  );

  const [epgPrograms, setEpgPrograms] = useState<EpgProgram[]>([]);
  const [epgLoading, setEpgLoading] = useState(false);
  const [epgError, setEpgError] = useState('');
  const [epgUpdated, setEpgUpdated] = useState('');

  const [showFavorites, setShowFavorites] = useState(false);
  const [showRecent, setShowRecent] = useState(false);
  const [showEpg, setShowEpg] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    localStorage.setItem('myiptv_favorites', JSON.stringify(favorites));
  }, [favorites]);

  useEffect(() => {
    localStorage.setItem('myiptv_recent', JSON.stringify(recentChannels));
  }, [recentChannels]);

  useEffect(() => {
    localStorage.setItem('myiptv_epg_url', epgUrl);
  }, [epgUrl]);

  function toggleFavorite(id: number) {
    setFavorites((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id]
    );
  }

  function addToRecent(id: number) {
    setRecentChannels((current) =>
      [id, ...current.filter((item) => item !== id)].slice(0, 8)
    );
  }

  function resetSections() {
    setShowFavorites(false);
    setShowRecent(false);
    setShowEpg(false);
    setShowSettings(false);
    setSelectedCategory('all');
  }

  function buildStreamUrl(channel: Channel) {
    if (channel.stream_url) return channel.stream_url;

    const base = server.trim().replace(/\/+$/, '');
    const user = encodeURIComponent(username);
    const pass = encodeURIComponent(password);

    return `${base}/live/${user}/${pass}/${channel.stream_id}.${streamFormat}`;
  }

  function demoLogin() {
    setServer('https://demo.example.com');
    setUsername('demo');
    setPassword('demo');

    setCategories([
      { category_id: '1', category_name: 'قنوات رياضية' },
      { category_id: '2', category_name: 'قنوات أفلام' },
      { category_id: '3', category_name: 'قنوات أطفال' },
    ]);

    setChannels([
      {
        stream_id: 101,
        name: 'قناة رياضية تجريبية 1',
        stream_icon: makeDemoLogo('SPORT 1', '#e11d48'),
        category_id: '1',
        stream_url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
      },
      {
        stream_id: 102,
        name: 'قناة رياضية تجريبية 2',
        stream_icon: makeDemoLogo('SPORT 2', '#2563eb'),
        category_id: '1',
        stream_url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
      },
      {
        stream_id: 201,
        name: 'قناة أفلام تجريبية',
        stream_icon: makeDemoLogo('MOVIES', '#7c3aed'),
        category_id: '2',
        stream_url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
      },
      {
        stream_id: 301,
        name: 'قناة أطفال تجريبية',
        stream_icon: makeDemoLogo('KIDS', '#059669'),
        category_id: '3',
        stream_url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
      },
    ]);

    setEpgPrograms([]);
    setError('');
    resetSections();
    setPlayingChannel(null);
    setConnected(true);
  }

  async function connect(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');

    if (!server.trim() || !username.trim() || !password.trim()) {
      setError('من فضلك أدخل جميع البيانات');
      return;
    }

    setLoading(true);

    try {
      const base = server.trim().replace(/\/+$/, '');

      const params = new URLSearchParams({
        username: username.trim(),
        password,
      });

      const api = `${base}/player_api.php?${params.toString()}`;

      const response = await fetch(api);

      if (!response.ok) {
        throw new Error('تعذر الوصول إلى السيرفر');
      }

      const account = await response.json();

      if (!account.user_info || Number(account.user_info.auth) !== 1) {
        throw new Error('بيانات الدخول غير صحيحة أو الاشتراك غير فعال');
      }

      const [categoryResponse, channelResponse] = await Promise.all([
        fetch(`${api}&action=get_live_categories`),
        fetch(`${api}&action=get_live_streams`),
      ]);

      if (!categoryResponse.ok || !channelResponse.ok) {
        throw new Error('تعذر تحميل بيانات القنوات');
      }

      const categoryData = await categoryResponse.json();
      const channelData = await channelResponse.json();

      setCategories(Array.isArray(categoryData) ? categoryData : []);
      setChannels(Array.isArray(channelData) ? channelData : []);

      resetSections();
      setPlayingChannel(null);
      setConnected(true);
    } catch (err) {
      setError(
        err instanceof TypeError
          ? 'تعذر الاتصال. قد يمنع السيرفر الاتصال من المتصفح (CORS).'
          : err instanceof Error
          ? err.message
          : 'حدث خطأ غير معروف'
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadEpg() {
    if (!epgUrl.trim()) {
      setEpgError('أدخل رابط ملف XMLTV أولاً.');
      return;
    }

    setEpgLoading(true);
    setEpgError('');

    try {
      const response = await fetch(epgUrl.trim());

      if (!response.ok) {
        throw new Error(`تعذر تحميل دليل البرامج (HTTP ${response.status})`);
      }

      const xmlText = await response.text();
      const xml = new DOMParser().parseFromString(xmlText, 'application/xml');

      if (xml.querySelector('parsererror')) {
        throw new Error('ملف XMLTV غير صالح أو لا يمكن قراءته.');
      }

      const entries: EpgProgram[] = [];

      xml.querySelectorAll('programme').forEach((node) => {
        const channel = node.getAttribute('channel') || '';
        const startValue = node.getAttribute('start') || '';
        const stopValue = node.getAttribute('stop') || '';
        const title = node.querySelector('title')?.textContent?.trim() || '';

        const start = parseXmltvDate(startValue);
        const stop = parseXmltvDate(stopValue);

        if (channel && title && start && stop && stop > start) {
          entries.push({ channel, title, start, stop });
        }
      });

      if (entries.length === 0) {
        throw new Error('لم يتم العثور على برامج في ملف XMLTV.');
      }

      setEpgPrograms(entries);
      setEpgUpdated(new Date().toLocaleString('ar-EG'));
      setEpgError('');
    } catch (err) {
      setEpgError(
        err instanceof TypeError
          ? 'فشل تحميل الملف. قد يمنع مصدر XMLTV الاتصال من المتصفح بسبب CORS.'
          : err instanceof Error
          ? err.message
          : 'حدث خطأ أثناء تحميل دليل البرامج.'
      );
    } finally {
      setEpgLoading(false);
    }
  }

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (!playingChannel) {
      video.pause();
      video.removeAttribute('src');
      video.load();
      return;
    }

    const videoUrl = buildStreamUrl(playingChannel);
    setPlayerError('');

    if (videoUrl.toLowerCase().includes('.m3u8')) {
      if (Hls.isSupported()) {
        const hls = new Hls();

        hls.loadSource(videoUrl);
        hls.attachMedia(video);

        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) {
            setPlayerError(
              'تعذر تشغيل البث. تحقق من رابط القناة أو صيغة البث.'
            );
          }
        });

        return () => hls.destroy();
      }

      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = videoUrl;

        video.onerror = () => {
          setPlayerError('تعذر تشغيل رابط القناة.');
        };

        return () => {
          video.pause();
          video.removeAttribute('src');
          video.load();
        };
      }
    }

    setPlayerError(
      'المشغل الحالي يدعم بث HLS بصيغة m3u8. جرّب صيغة m3u8 من إعدادات البث.'
    );
  }, [playingChannel, server, username, password, streamFormat]);

  async function toggleFullscreen() {
    const video = videoRef.current;
    if (!video) return;

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await video.requestFullscreen();
      }
    } catch {
      setPlayerError('تعذر تشغيل وضع ملء الشاشة على هذا الجهاز.');
    }
  }

  function closePlayer() {
    setPlayingChannel(null);
    setPlayerError('');
  }

  function playChannel(channel: Channel) {
    setPlayerError('');
    addToRecent(channel.stream_id);
    setPlayingChannel(channel);
  }

  const filteredChannels = useMemo(() => {
    return channels
      .filter((channel) => {
        const matchesCategory =
          selectedCategory === 'all' ||
          String(channel.category_id) === selectedCategory;

        const matchesSearch = channel.name
          .toLowerCase()
          .includes(search.toLowerCase());

        const matchesFavorites =
          !showFavorites || favorites.includes(channel.stream_id);

        const matchesRecent =
          !showRecent || recentChannels.includes(channel.stream_id);

        return (
          matchesCategory && matchesSearch && matchesFavorites && matchesRecent
        );
      })
      .sort((a, b) => {
        if (!showRecent) return 0;

        return (
          recentChannels.indexOf(a.stream_id) -
          recentChannels.indexOf(b.stream_id)
        );
      });
  }, [
    channels,
    selectedCategory,
    search,
    showFavorites,
    showRecent,
    favorites,
    recentChannels,
  ]);

  const visibleEpgChannels = useMemo(
    () =>
      channels.filter((channel) =>
        channel.name.toLowerCase().includes(search.toLowerCase())
      ),
    [channels, search]
  );

  if (!connected) {
    return (
      <div className="login-page" dir="rtl">
        <form className="login-card" onSubmit={connect}>
          <div className="login-logo">▶ MY IPTV</div>
          <div className="login-subtitle">استمتع بعالم الترفيه</div>

          <h2>تسجيل الدخول</h2>
          <p className="login-description">أدخل بيانات اشتراك IPTV الخاص بك</p>

          <label>رابط السيرفر</label>
          <input
            type="url"
            placeholder="http://example.com:8080"
            value={server}
            onChange={(e) => setServer(e.target.value)}
            required
          />

          <label>اسم المستخدم</label>
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />

          <label>كلمة المرور</label>
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          {error && <div className="login-error">{error}</div>}

          <button className="connect-button" disabled={loading}>
            {loading ? 'جاري الاتصال...' : 'اتصال بالسيرفر'}
          </button>

          <button
            type="button"
            className="connect-button demo-button"
            onClick={demoLogin}
          >
            دخول تجريبي بدون اشتراك
          </button>

          <div className="login-footer">MY IPTV PLAYER • Version 2.0</div>
        </form>
      </div>
    );
  }

  return (
    <div className="app" dir="rtl">
      <aside className="sidebar">
        <div className="logo">
          ▶ <span>MY IPTV</span>
        </div>

        <h4>القائمة الرئيسية</h4>

        <button
          className={
            !showFavorites && !showRecent && !showEpg && !showSettings
              ? 'menu-item active'
              : 'menu-item'
          }
          onClick={() => {
            resetSections();
          }}
        >
          📺 القنوات
        </button>

        <button
          className={showFavorites ? 'menu-item active' : 'menu-item'}
          onClick={() => {
            setShowFavorites(true);
            setShowRecent(false);
            setShowEpg(false);
            setShowSettings(false);
            setSelectedCategory('all');
          }}
        >
          ⭐ المفضلة ({favorites.length})
        </button>

        <button
          className={showRecent ? 'menu-item active' : 'menu-item'}
          onClick={() => {
            setShowRecent(true);
            setShowFavorites(false);
            setShowEpg(false);
            setShowSettings(false);
            setSelectedCategory('all');
          }}
        >
          🕘 آخر المشاهدة
        </button>

        <button
          className={showEpg ? 'menu-item active' : 'menu-item'}
          onClick={() => {
            setShowEpg(true);
            setShowFavorites(false);
            setShowRecent(false);
            setShowSettings(false);
          }}
        >
          📅 دليل البرامج
        </button>

        <button
          className={showSettings ? 'menu-item active' : 'menu-item'}
          onClick={() => {
            setShowSettings(true);
            setShowFavorites(false);
            setShowRecent(false);
            setShowEpg(false);
          }}
        >
          ⚙ الإعدادات
        </button>

        <button
          className="menu-item logout-item"
          onClick={() => {
            closePlayer();
            setConnected(false);
            setChannels([]);
            setCategories([]);
            setSearch('');
            resetSections();
          }}
        >
          ↪ تسجيل الخروج
        </button>
      </aside>

      <main className="main">
        {playingChannel && (
          <div className="player-overlay">
            <div className="player-window">
              <div className="player-header">
                <h2>📺 {playingChannel.name}</h2>

                <div className="player-actions">
                  <button type="button" onClick={toggleFullscreen}>
                    ⛶ ملء الشاشة
                  </button>

                  <button type="button" onClick={closePlayer}>
                    ✕ إغلاق
                  </button>
                </div>
              </div>

              <video
                ref={videoRef}
                controls
                autoPlay
                playsInline
                className="video-player"
              />

              {playerError && <p className="player-error">{playerError}</p>}

              <div className="player-footer">
                <span>▶ MY IPTV PLAYER</span>
                <span>مشاهدة مباشرة</span>
              </div>
            </div>
          </div>
        )}

        <header className="topbar">
          <div className="welcome">
            <span className="live-dot"></span>
            متصل بالسيرفر
          </div>

          <input
            className="search"
            placeholder="ابحث عن قناة..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </header>

        <section className="hero">
          <div className="hero-content">
            <div className="tag">✦ MY IPTV PLAYER</div>
            <h1>قنواتك المفضلة في مكان واحد</h1>
            <p>استمتع بمشاهدة قنواتك بسهولة</p>
          </div>

          <div className="hero-icon">📺</div>
        </section>

        <section className="section">
          <div className="section-heading">
            <div>
              <h2>
                {showSettings
                  ? 'إعدادات التطبيق ⚙'
                  : showEpg
                  ? 'دليل البرامج 📅'
                  : showRecent
                  ? 'آخر القنوات مشاهدة 🕘'
                  : showFavorites
                  ? 'قنواتي المفضلة ⭐'
                  : 'القنوات المباشرة'}
              </h2>

              <p>
                {showSettings
                  ? 'تحكم في إعدادات البث ودليل البرامج'
                  : showEpg
                  ? 'البرامج الحالية والقادمة للقنوات'
                  : showRecent
                  ? 'القنوات التي شاهدتها مؤخرًا'
                  : 'اختر القناة التي تريد مشاهدتها'}
              </p>
            </div>

            {!showEpg && !showSettings && (
              <span className="count">{filteredChannels.length} قناة</span>
            )}
          </div>

          {showSettings ? (
            <div className="settings-panel">
              <div className="settings-card">
                <h3>📅 إعداد دليل البرامج EPG</h3>
                <p>
                  أضف رابط ملف XMLTV من مزود الخدمة لعرض مواعيد البرامج
                  الحقيقية.
                </p>

                <label>رابط ملف XMLTV</label>
                <input
                  type="url"
                  className="settings-input"
                  placeholder="https://example.com/epg.xml"
                  value={epgUrl}
                  onChange={(e) => setEpgUrl(e.target.value)}
                />

                <div className="settings-actions">
                  <button
                    className="primary-button"
                    onClick={loadEpg}
                    disabled={epgLoading}
                  >
                    {epgLoading
                      ? 'جاري تحميل الدليل...'
                      : 'تحميل / تحديث الدليل'}
                  </button>

                  <button
                    className="secondary-button"
                    onClick={() => {
                      setEpgPrograms([]);
                      setEpgUpdated('');
                      setEpgError('');
                    }}
                  >
                    مسح بيانات الدليل
                  </button>
                </div>

                {epgError && <div className="settings-error">{epgError}</div>}

                {epgUpdated && (
                  <div className="settings-success">
                    تم تحديث الدليل: {epgUpdated}
                    <br />
                    عدد البرامج: {epgPrograms.length}
                  </div>
                )}
              </div>

              <div className="settings-card">
                <h3>🎬 صيغة البث</h3>
                <p>
                  اختر صيغة HLS المفضلة. أغلب المتصفحات تحتاج صيغة m3u8 لتشغيل
                  البث مباشرة.
                </p>

                <label>صيغة روابط القنوات</label>
                <select
                  className="settings-input"
                  value={streamFormat}
                  onChange={(e) =>
                    setStreamFormat(e.target.value as 'm3u8' | 'ts')
                  }
                >
                  <option value="m3u8">m3u8 - HLS</option>
                  <option value="ts">ts - MPEG-TS</option>
                </select>
              </div>

              <div className="settings-note">
                <strong>معلومة:</strong> إذا لم يكن لديك رابط EPG، يمكنك ترك
                الخانة فارغة وسيستمر التطبيق في عرض القنوات بشكل طبيعي.
              </div>
            </div>
          ) : showEpg ? (
            <div className="epg-list">
              {visibleEpgChannels.map((channel) => {
                const schedule = getSchedule(channel, epgPrograms, new Date());

                const current = schedule.current;
                const next = schedule.next;

                const progress = current
                  ? Math.min(
                      100,
                      Math.max(
                        0,
                        ((Date.now() - current.start.getTime()) /
                          (current.stop.getTime() - current.start.getTime())) *
                          100
                      )
                    )
                  : 0;

                return (
                  <div className="epg-card" key={channel.stream_id}>
                    <div className="epg-channel">
                      <ChannelLogo channel={channel} />
                      <h3>{channel.name}</h3>

                      <button
                        className="epg-watch"
                        onClick={() => playChannel(channel)}
                      >
                        ▶ مشاهدة القناة
                      </button>
                    </div>

                    <div className="epg-programs">
                      <div className="epg-program current">
                        <span className="epg-status">يعرض الآن</span>

                        <h4>
                          {current ? current.title : 'لا توجد بيانات حالية'}
                        </h4>

                        <p>
                          {current
                            ? `${formatTime(current.start)} - ${formatTime(
                                current.stop
                              )}`
                            : 'تحقق من رابط الدليل وربط القناة'}
                        </p>

                        {current && (
                          <>
                            <div className="epg-progress">
                              <div
                                className="epg-progress-fill"
                                style={{ width: `${progress}%` }}
                              />
                            </div>
                            <small>
                              متبقي{' '}
                              {Math.max(
                                0,
                                Math.ceil(
                                  (current.stop.getTime() - Date.now()) / 60000
                                )
                              )}{' '}
                              دقيقة
                            </small>
                          </>
                        )}
                      </div>

                      <div className="epg-program">
                        <span className="epg-status next">التالي</span>

                        <h4>
                          {next ? next.title : 'لا توجد بيانات للبرنامج التالي'}
                        </h4>

                        <p>
                          {next
                            ? `${formatTime(next.start)} - ${formatTime(
                                next.stop
                              )}`
                            : 'سيظهر البرنامج القادم عند توفر بياناته'}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}

              {visibleEpgChannels.length === 0 && (
                <p className="empty-state">لا توجد قنوات مطابقة للبحث.</p>
              )}

              {epgPrograms.length === 0 && (
                <p className="epg-hint">
                  دليل البرامج غير محمّل بعد. أضف رابط XMLTV من صفحة الإعدادات.
                </p>
              )}
            </div>
          ) : (
            <>
              {!showFavorites && !showRecent && (
                <div className="categories">
                  <button
                    className={
                      selectedCategory === 'all' ? 'cat active-cat' : 'cat'
                    }
                    onClick={() => setSelectedCategory('all')}
                  >
                    الكل
                  </button>

                  {categories.map((category) => (
                    <button
                      key={category.category_id}
                      className={
                        selectedCategory === category.category_id
                          ? 'cat active-cat'
                          : 'cat'
                      }
                      onClick={() => setSelectedCategory(category.category_id)}
                    >
                      {category.category_name}
                    </button>
                  ))}
                </div>
              )}

              <div className="channel-grid">
                {filteredChannels.map((channel) => (
                  <div className="channel-card" key={channel.stream_id}>
                    <ChannelLogo channel={channel} />

                    <h3>{channel.name}</h3>

                    <button
                      className="favorite-btn"
                      onClick={() => toggleFavorite(channel.stream_id)}
                      title={
                        favorites.includes(channel.stream_id)
                          ? 'إزالة من المفضلة'
                          : 'إضافة للمفضلة'
                      }
                    >
                      {favorites.includes(channel.stream_id) ? '⭐' : '☆'}
                    </button>

                    <button
                      className="play-btn"
                      onClick={() => playChannel(channel)}
                    >
                      ▶ مشاهدة
                    </button>
                  </div>
                ))}
              </div>

              {filteredChannels.length === 0 && (
                <p className="empty-state">
                  {showRecent
                    ? 'لم تشاهد أي قناة حتى الآن.'
                    : showFavorites
                    ? 'لم تضف أي قناة للمفضلة حتى الآن.'
                    : 'لا توجد قنوات في هذا التصنيف.'}
                </p>
              )}
            </>
          )}
        </section>
      </main>
    </div>
  );
}
