// Generates Chrome Web Store images from the built extension, using invented
// publications (no real Substack data). Run `pnpm build` first.
//   store/screenshot-*.png   1280×800
//   store/promo-small.png    440×280  (required small promo tile)
//   store/promo-marquee.png  1400×560 (optional marquee)
// Usage: pnpm store-assets
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { APP_NAME, DESCRIPTION, FULL_NAME } from '../lib/brand.ts';

const out = resolve('store');
mkdirSync(out, { recursive: true });

// ── Invented publications ────────────────────────────────────────────────────
const PUBS = [
  ['The Slow Kitchen', 'Nadia Ferro', 'food', ['Braised beans, three ways', 'The case for a cheap carbon-steel pan', 'What I cook when I’m too tired to cook', 'Stock is a habit, not a recipe']],
  ['Crumb', 'Oliver Tsang', 'food', ['Why your sourdough is flat (it’s the fridge)', 'Laminating dough at home without tears', 'A week of bread for one']],
  ['Market Days', 'Ruth Okafor', 'food', ['September at the farmers market', 'How to buy a good tomato', 'The last peaches']],
  ['Orbital', 'Dev Ramaswamy', 'tech', ['The quiet boom in small satellites', 'What a reusable second stage would change', 'Reading launch schedules like a pro']],
  ['Plain Text', 'Hannah Voss', 'tech', ['I moved my notes to plain text. Here’s a year later', 'The best software is boring', 'On keyboards, again']],
  ['Signal & Noise', 'Marcus Bell', 'tech', ['A field guide to benchmark theater', 'The chips nobody talks about', 'Why every app is becoming a chat app']],
  ['Petri', 'Lena Ahlberg', 'tech', ['The microbiome study everyone misread', 'How a vaccine trial is actually run', 'Three papers worth your weekend']],
  ['Compound Interest', 'Priya Nair', 'money', ['Index funds are boring. Good.', 'What your 401(k) statement is not telling you', 'Rent vs. buy, with real numbers']],
  ['The Ledger Line', 'Sam Whitfield', 'money', ['Small-business taxes, explained with one bakery', 'Inflation is cooling. Your groceries disagree.', 'How to read an earnings call']],
  ['Field Notes', 'Joanna Park', 'essays', ['Walking the old rail line', 'In praise of the second draft', 'What the river remembers']],
  ['Late Edition', 'Theo Marchetti', 'essays', ['The newspaper that raised me', 'On being a regular', 'Letters I never sent']],
  ['Back Roads', 'Carmen Ruiz', 'travel', ['Three days on the Oregon coast in the off-season', 'The train from Lisbon to Porto', 'How I pack for a week in one bag']],
  ['Shortlist', 'Ada Kimura', 'culture', ['Five novels for the first cold week', 'The album I can’t stop playing', 'Films to watch before the Oscars noise']],
  ['The Sideline', 'Jonah Reyes', 'culture', ['The trade deadline, graded', 'Why the pitch clock worked', 'A love letter to minor-league ballparks']],
  ['Grounded', 'Mia Laurent', 'essays', ['Gardening in a rented apartment', 'Composting for skeptics', 'The first frost']],
  ['Weekday Politics', 'Eli Brandt', 'culture', ['What the new budget actually funds', 'A plain-English guide to the ballot', 'City hall, explained']],
];

const SUBTITLES = [
  'Notes from a slow week, and what I learned from it.',
  'A short, practical guide you can use this weekend.',
  'The long version, for people who asked.',
  'Plus a few links I’ve been saving for you.',
  'What changed, what didn’t, and what to watch next.',
  'A reader question that turned into an essay.',
];

const BASE = Date.parse('2026-09-27T14:00:00Z');
const HUES = [12, 28, 44, 150, 175, 200, 220, 245, 265, 290, 320, 340, 90, 110, 190, 355];
const publications = [];
const subscriptions = [];
const postsByAuthor = {};
let postId = 1;
PUBS.forEach(([name, author, , titles], i) => {
  const id = 100 + i;
  const authorId = 900 + i;
  const subdomain = name.toLowerCase().replace(/[^a-z]+/g, '');
  publications.push({
    id, name, subdomain, custom_domain: null,
    logo_url: `https://demo.invalid/logo/${i}.png`,
    author_id: authorId, hero_text: '', author: { id: authorId, name: author },
  });
  subscriptions.push({ id: 5000 + i, publication_id: id, membership_state: i % 5 === 0 ? 'subscribed' : 'free_signup' });
  postsByAuthor[authorId] = {
    posts: titles.map((title, n) => ({
      id: postId++,
      publication_id: id,
      title,
      subtitle: SUBTITLES[(i + n) % SUBTITLES.length],
      canonical_url: `https://${subdomain}.substack.com/p/${n}`,
      post_date: new Date(BASE - ((i * 7 + n * 53) % 240) * 3600_000 - n * 86400_000 * 2).toISOString(),
      cover_image: n === 2 ? null : `https://demo.invalid/cover/${i}-${n}.png`,
      audience: (i + n) % 6 === 0 ? 'only_paid' : 'everyone',
    })),
  };
});


// ── Generated artwork for logos and covers ───────────────────────────────────
const monogram = (i) => {
  const h = HUES[i % HUES.length];
  const initials = PUBS[i][0].replace(/^The /, '').split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).map((w) => w[0]).join('').slice(0, 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect width="80" height="80" fill="hsl(${h} 55% 42%)"/>
    <text x="40" y="52" text-anchor="middle" font-family="Georgia, serif" font-size="34" font-weight="700" fill="hsl(${h} 70% 92%)">${initials}</text></svg>`;
};
const cover = (i, n) => {
  const h = HUES[i % HUES.length];
  const h2 = (h + 40 + n * 25) % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 176">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h} 60% 70%)"/><stop offset="1" stop-color="hsl(${h2} 55% 45%)"/></linearGradient></defs>
    <rect width="256" height="176" fill="url(#g)"/>
    <circle cx="${60 + n * 60}" cy="${120 - n * 20}" r="${48 + n * 8}" fill="hsl(${h} 70% 88% / .55)"/>
    <rect x="${130 - n * 30}" y="30" width="90" height="90" rx="12" transform="rotate(${12 + n * 9} 175 75)" fill="hsl(${h2} 60% 30% / .35)"/></svg>`;
};

// ── Screenshots ──────────────────────────────────────────────────────────────
const extensionPath = resolve('dist/chrome-mv3');
const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'so-store-')), {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1280, height: 800 },
  args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
});
await context.route('https://substackcdn.com/**', (route) => {
  const inner = decodeURIComponent(route.request().url().split('/').slice(6).join('/'));
  const logo = inner.match(/\/logo\/(\d+)/);
  const art = inner.match(/\/cover\/(\d+)-(\d+)/);
  const svg = logo ? monogram(+logo[1]) : art ? cover(+art[1], +art[2]) : '<svg xmlns="http://www.w3.org/2000/svg"/>';
  route.fulfill({ contentType: 'image/svg+xml', body: svg });
});
await context.route('https://substack.com/api/v1/**', (route) => {
  const url = new URL(route.request().url());
  if (url.pathname === '/api/v1/user/profile/self') {
    const byId = new Map(publications.map((p) => [p.id, p]));
    return route.fulfill({ json: { id: 1, subscriptions: subscriptions.map((s) => ({ ...s, publication: byId.get(s.publication_id) })) } });
  }
  if (url.pathname === '/api/v1/profile/posts') return route.fulfill({ json: postsByAuthor[url.searchParams.get('profile_user_id')] ?? { posts: [] } });
  return route.fulfill({ status: 404, json: {} });
});
const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
const page = await context.newPage();
await page.goto(`chrome-extension://${new URL(worker.url()).host}/reader.html`);
await page.getByRole('button', { name: 'Continue' }).waitFor();
await page.screenshot({ path: join(out, 'screenshot-4-privacy.png') });
await page.getByRole('button', { name: 'Continue' }).click();
await page.locator('.nav-item', { hasText: 'All subscriptions' }).waitFor();

// Folders and pins, created the same way the UI does.
const idOf = (name) => publications.find((p) => p.name === name).id;
const folders = [
  ['morning', 'Morning read', ['Field Notes', 'Late Edition', 'Weekday Politics', 'Signal & Noise']],
  ['food', 'Food', ['The Slow Kitchen', 'Crumb', 'Market Days']],
  ['tech', 'Tech & science', ['Orbital', 'Plain Text', 'Signal & Noise', 'Petri']],
  ['money', 'Money', ['Compound Interest', 'The Ledger Line']],
  ['weekend', 'Weekend', ['Back Roads', 'Shortlist', 'The Sideline', 'Grounded']],
];
const ops = [
  ...folders.flatMap(([id, name, pubs]) => [{ kind: 'createFolder', id, name }, ...pubs.map((p) => ({ kind: 'addToFolder', folderId: id, pubId: idOf(p) }))]),
  ...['The Slow Kitchen', 'Plain Text', 'Field Notes', 'Compound Interest'].map((p) => ({ kind: 'setPinned', pubId: idOf(p), pinned: true })),
];
await page.evaluate((ops) => chrome.runtime.sendMessage({ type: 'library/mutate', ops }), ops);
await page.locator('.folder-slot', { hasText: 'Weekend' }).waitFor();

const settle = async () => {
  await page.mouse.move(1270, 790);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
};

await page.locator('.nav-item', { hasText: 'Pinned' }).click();
await page.locator('a.post').first().waitFor();
await settle();
await page.screenshot({ path: join(out, 'screenshot-1-pinned.png') });

await page.locator('.folder-slot', { hasText: 'Food' }).click();
await page.locator('a.post').first().waitFor();
await settle();
await page.screenshot({ path: join(out, 'screenshot-2-folder.png') });

await page.locator('.nav-item', { hasText: 'All subscriptions' }).click();
await page.getByRole('tab', { name: 'Publications' }).click();
const row = page.locator('.pub').filter({ has: page.getByRole('link', { name: 'Signal & Noise', exact: true }) });
await row.scrollIntoViewIfNeeded();
await row.getByRole('button', { name: 'Folders' }).click();
await settle();
await page.screenshot({ path: join(out, 'screenshot-3-organize.png') });
await context.close();

// ── Promo tiles ──────────────────────────────────────────────────────────────
const font = (path) => `url(data:font/woff2;base64,${readFileSync(path).toString('base64')}) format('woff2')`;
const icon = `data:image/svg+xml;base64,${readFileSync('assets/icon.svg').toString('base64')}`;
const shot = `data:image/png;base64,${readFileSync(join(out, 'screenshot-1-pinned.png')).toString('base64')}`;
const css = `
  @font-face { font-family: Display; src: ${font('node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2')}; font-weight: 200 800; }
  @font-face { font-family: Body; src: ${font('node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2')}; }
  html, body { margin: 0; }
  body { background: #17213a; color: #fff; font-family: Body; overflow: hidden; }
  h1 { font: 700 40px/1 Display; letter-spacing: -0.02em; margin: 0; }
  p { margin: 0; color: #c3cce0; }`;
const tagline = 'Folders and pins for your Substack subscriptions';

const browser = await chromium.launch();
const promo = await browser.newPage({ viewport: { width: 440, height: 280 } });
await promo.setContent(`<style>${css}</style>
  <div style="height:280px;display:flex;flex-direction:column;justify-content:center;gap:14px;padding:0 36px;box-sizing:border-box">
    <img src="${icon}" width="56" height="56" style="border-radius:13px">
    <div>
      <h1 style="font-size:34px">${APP_NAME}</h1>
      <div style="font:600 17px Display;color:#c3cce0;margin-top:6px">for Substack</div>
    </div>
    <p style="font-size:15px;line-height:1.35;max-width:340px">${tagline}</p>
  </div>`);
await promo.evaluate(() => document.fonts.ready);
await promo.screenshot({ path: join(out, 'promo-small.png') });

const marquee = await browser.newPage({ viewport: { width: 1400, height: 560 } });
await marquee.setContent(`<style>${css}</style>
  <div style="height:560px;display:flex;align-items:center;gap:56px;padding-left:80px;box-sizing:border-box">
    <div style="width:420px;flex:none;display:flex;flex-direction:column;gap:22px">
      <img src="${icon}" width="88" height="88" style="border-radius:20px">
      <div>
        <h1 style="font-size:52px">${APP_NAME}</h1>
        <div style="font:600 24px Display;color:#c3cce0;margin-top:10px">for Substack</div>
      </div>
      <p style="font-size:20px;line-height:1.4">${DESCRIPTION}</p>
    </div>
    <img src="${shot}" style="width:900px;border-radius:14px;box-shadow:0 24px 60px rgb(0 0 0 / .45);transform:translateY(60px)">
  </div>`);
await marquee.evaluate(() => document.fonts.ready);
await marquee.screenshot({ path: join(out, 'promo-marquee.png') });
await browser.close();

console.log(`wrote store/ images for “${FULL_NAME}”`);
