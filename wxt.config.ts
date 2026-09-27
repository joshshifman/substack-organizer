import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  // Visible folder so it shows up in Chrome's "Load unpacked" file picker.
  outDir: 'dist',
  manifest: {
    name: 'Substack Organizer',
    description: 'Sort your Substack subscriptions into folders and pin the ones you read most.',
    // No popup: clicking the toolbar icon opens the reader tab (see background.ts).
    action: {
      default_title: 'Open Substack Organizer',
      default_icon: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 128: 'icon/128.png' },
    },
    // runtime.getContexts (background.ts) needs Chrome 116.
    minimum_chrome_version: '116',
    permissions: ['storage'],
    // Every API call goes to substack.com, using the browser's existing Substack session.
    host_permissions: ['https://substack.com/*'],
  },
});
