import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.myiptv.player',
  appName: 'MY IPTV',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
