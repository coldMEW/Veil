import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'com.veil.app',
  appName: 'Veil',
  webDir: 'dist',
  server: { androidScheme: 'https', hostname: 'localhost' },
  android: { backgroundColor: '#f5f1eb', allowMixedContent: false },
  plugins: {
    SplashScreen: { launchShowDuration: 500, backgroundColor: '#f5f1eb', showSpinner: false },
    StatusBar: { style: 'LIGHT', backgroundColor: '#f5f1eb' },
    CapacitorHttp: { enabled: false },
  },
};
export default config;
