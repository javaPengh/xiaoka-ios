import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'local.xiaoka.diary',
  appName: '小卡日记',
  webDir: process.env.XIAOKA_WEB_DIR || 'dist',
  ios: { contentInset: 'never', backgroundColor: '#F7F7FC' },
};
export default config;
