import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.jamdog.livfantasy',
  appName: 'JAMGOLF',
  webDir: 'dist',
  // Loads the LIVE deployed site remotely rather than bundling the
  // web build into the app itself - this is deliberate. It means
  // every normal update (features, fixes, tweaks) just goes out via
  // the existing git push -> Render auto-deploy pipeline and reaches
  // everyone instantly, with NO app rebuild or APK redistribution
  // needed. Only genuinely native-level changes (push notification
  // setup, app icon/name, new device permissions, Capacitor plugin
  // updates) ever require rebuilding and reinstalling the app itself.
  server: {
    url: 'https://jamgolf.onrender.com',
    cleartext: false,
  },
};

export default config;
