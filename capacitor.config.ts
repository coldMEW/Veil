import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'com.veil.app',
  appName: 'Veil',
  webDir: 'dist',
  server: { androidScheme: 'https', hostname: 'localhost' },
  android: { backgroundColor: '#141414', allowMixedContent: false },
  plugins: {
    SplashScreen: { launchShowDuration: 500, backgroundColor: '#141414', showSpinner: false },
    StatusBar: { style: 'DARK', backgroundColor: '#141414' },
    CapacitorHttp: { enabled: false },
  },
};
export default config;
