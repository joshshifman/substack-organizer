// Exports assets/icon.svg to the PNG sizes Chrome uses. WXT adds public/icon/*.png
// to the manifest automatically; the reader page uses the SVG as its favicon.
// Usage: node scripts/make-icons.mjs
import { chromium } from 'playwright';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';

const svg = readFileSync('assets/icon.svg', 'utf8');
mkdirSync('public/icon', { recursive: true });
copyFileSync('assets/icon.svg', 'public/icon.svg');

const browser = await chromium.launch();
const page = await browser.newPage();
for (const size of [16, 32, 48, 128]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
  );
  await page.screenshot({ path: `public/icon/${size}.png`, omitBackground: true });
}
await browser.close();
console.log('wrote public/icon/{16,32,48,128}.png and public/icon.svg');
