import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'space.opencalendar.app',
  appName: 'OpenCalendar',
  webDir: 'dist-mobile',
  backgroundColor: '#f7f6f2',
  loggingBehavior: 'debug',
  server: {
    hostname: 'localhost',
    androidScheme: 'https',
    iosScheme: 'capacitor',
  },
  android: {
    allowMixedContent: false,
    webContentsDebuggingEnabled: false,
  },
  ios: {
    contentInset: 'never',
  },
  plugins: {
    SystemBars: {
      insetsHandling: 'css',
      initialViewportFitValueHint: 'cover',
      style: 'LIGHT',
      hidden: false,
    },
  },
};

export default config;
