import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'com.veil.app',
  appName: 'Veil',
  webDir: 'dist',
  server: { androidScheme: 'https', hostname: 'localhost' },
  android: { backgroundColor: '#ffffff', allowMixedContent: false },
  plugins: {
    SplashScreen: { launchShowDuration: 500, backgroundColor: '#ffffff', showSpinner: false },
    StatusBar: { style: 'LIGHT', backgroundColor: '#ffffff' },
    CapacitorHttp: { enabled: false },
  },
};
export default config;
