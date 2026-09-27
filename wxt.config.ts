import { defineConfig } from 'wxt';
import { DESCRIPTION, FULL_NAME } from './lib/brand';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  // Visible folder so it shows up in Chrome's "Load unpacked" file picker.
  outDir: 'dist',
  manifest: {
    name: FULL_NAME,
    description: DESCRIPTION,
    homepage_url: 'https://github.com/joshshifman/substack-organizer',
    // No popup: clicking the toolbar icon opens the reader tab (see background.ts).
    action: {
      default_title: `Open ${FULL_NAME}`,
      default_icon: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 128: 'icon/128.png' },
    },
    // runtime.getContexts (background.ts) needs Chrome 116.
    minimum_chrome_version: '116',
    permissions: ['storage'],
    // Every API call goes to substack.com, using the browser's existing Substack session.
    host_permissions: ['https://substack.com/*'],
  },
});
