// End-to-end check: loads the built extension into Chromium, serves Substack's API
// from fixtures, and drives the reader. Run `pnpm build` first, then `pnpm e2e`.
// Screenshots go to .amp/in/artifacts/.
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const extensionPath = resolve('dist/chrome-mv3');
const shots = resolve('.amp/in/artifacts');
mkdirSync(shots, { recursive: true });

const subscriptions = JSON.parse(readFileSync('tests/fixtures/subscriptions.json', 'utf8'));
const postsByAuthor = JSON.parse(readFileSync('tests/fixtures/posts-by-author.json', 'utf8'));
// GET /user/profile/self nests each publication inside its subscription.
const pubsById = new Map(subscriptions.publications.map((p) => [p.id, p]));
const profileSelf = {
  id: 1,
  handle: 'reader',
  subscriptions: subscriptions.subscriptions.map(({ publication_id, ...s }) => ({ ...s, publication: pubsById.get(publication_id) })),
};

/** Retries `check` until it stops throwing: edits reach the page asynchronously via the background worker. */
async function eventually(check, timeout = 5000) {
  const end = Date.now() + timeout;
  for (;;) {
    try {
      return await check();
    } catch (err) {
      if (Date.now() > end) throw err;
      await new Promise((r) => setTimeout(r, 50));
    }
  }
}

let noticeShot = 0;
async function launch({ signedIn, empty = false }) {
  const calls = { posts: 0, api: 0 };
  const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'so-e2e-')), {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 860 },
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  // Images go through Substack's CDN; answer with a placeholder so the test stays offline.
  await context.route('https://substackcdn.com/**', (route) => {
    const hue = [...route.request().url()].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0);
    route.fulfill({
      contentType: 'image/svg+xml',
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="hsl(${hue} 45% 62%)"/></svg>`,
    });
  });
  await context.route('https://substack.com/api/v1/**', (route) => {
    calls.api++;
    const url = new URL(route.request().url());
    if (!signedIn) return route.fulfill({ status: 401, json: { errors: [{ msg: 'Please sign in' }] } });
    if (url.pathname === '/api/v1/user/profile/self') return route.fulfill({ json: empty ? { ...profileSelf, subscriptions: [] } : profileSelf });
    if (url.pathname === '/api/v1/subscriptions') return route.fulfill({ json: { subscriptions: [], publications: [] } });
    if (url.pathname === '/api/v1/profile/posts') {
      calls.posts++;
      return route.fulfill({ json: postsByAuthor[url.searchParams.get('profile_user_id')] ?? { posts: [] } });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const extensionId = new URL(worker.url()).host;
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`chrome-extension://${extensionId}/reader.html`);
  // First run: nothing is requested from Substack until the notice is accepted.
  await page.getByRole('button', { name: 'Continue' }).waitFor();
  await page.waitForTimeout(200);
  assert.equal(calls.api, 0, 'requested Substack before the first-run notice was accepted');
  if (!noticeShot++) await page.screenshot({ path: join(shots, '0-first-run.png') });
  await page.getByRole('button', { name: 'Continue' }).click();
  return { context, page, errors, calls };
}

// Publications whose authors have posts in the fixture, so feeds aren't empty.
const pubsWithPosts = subscriptions.publications
  .filter((p) => postsByAuthor[p.author_id]?.posts.some((post) => post.publication_id === p.id))
  .map((p) => p.name);

// ── Signed out ───────────────────────────────────────────────────────────────
{
  const { context, page } = await launch({ signedIn: false });
  await page.getByRole('heading', { name: 'Sign in to Substack to see your subscriptions' }).waitFor();
  await page.screenshot({ path: join(shots, '1-signed-out.png') });
  await context.close();
  console.log('✓ first-run notice shown before any Substack request; signed-out screen');
}

// ── Signed in, no subscriptions ──────────────────────────────────────────────
{
  const { context, page, errors } = await launch({ signedIn: true, empty: true });
  await page.getByRole('heading', { name: 'You\'re not subscribed to anything on Substack yet' }).waitFor();
  await page.locator('.nav-item', { hasText: 'All subscriptions' }).click();
  await page.getByRole('heading', { name: 'You\'re not subscribed to anything on Substack yet' }).waitFor();
  assert.equal(await page.locator('.banner').count(), 0);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: join(shots, '1b-no-subscriptions.png') });
  await context.close();
  console.log('✓ an account with no subscriptions gets the empty screen, not an error');
}

// ── Signed in ────────────────────────────────────────────────────────────────
{
  const { context, page, errors, calls } = await launch({ signedIn: true });
  const pubRow = (name) => page.locator('.pub').filter({ has: page.getByRole('link', { name, exact: true }) });

  await page.getByRole('heading', { name: 'Pinned' }).waitFor();
  await page.getByText('Pin the publications you read most').waitFor();
  const icons = await page.evaluate(async () => {
    const favicon = document.querySelector('link[rel=icon]')?.getAttribute('href');
    const { action, icons } = chrome.runtime.getManifest();
    const urls = [favicon, ...Object.values(icons ?? {}), ...Object.values(action?.default_icon ?? {})];
    return Promise.all(urls.map(async (u) => [u, u ? (await fetch(u)).status : 'missing']));
  });
  assert.ok(icons.length >= 9 && icons.every(([, status]) => status === 200), JSON.stringify(icons));
  console.log('✓ favicon and toolbar icons are packaged');
  await page.screenshot({ path: join(shots, '2-empty-pinned.png') });

  await page.getByRole('button', { name: 'Browse all subscriptions' }).click();
  await page.getByRole('heading', { name: 'All subscriptions' }).waitFor();
  assert.equal(await page.locator('.pub').count(), subscriptions.publications.length);
  console.log(`✓ lists all ${subscriptions.publications.length} subscriptions`);

  // Pin three publications.
  for (const name of pubsWithPosts.slice(0, 3)) await pubRow(name).getByRole('button', { name: 'Pin to top' }).click();
  await eventually(async () => assert.equal(await page.locator('.nav-item', { hasText: 'Pinned' }).locator('.nav-count').innerText(), '3'));
  console.log('✓ pinning updates the Pinned count');

  // Create a folder from the sidebar.
  await page.getByRole('button', { name: 'New folder' }).click();
  await page.getByRole('textbox', { name: 'New folder name' }).fill('Must read');
  await page.keyboard.press('Enter');
  const slot = page.locator('.folder-slot', { hasText: 'Must read' });
  await slot.waitFor();

  // File one publication with the picker, another by dragging onto the folder.
  const [picked, dragged, viaPickerNew] = pubsWithPosts.slice(3, 6);
  await pubRow(picked).getByRole('button', { name: 'Folders' }).click();
  await page.getByRole('dialog', { name: 'Choose folders' }).getByLabel('Must read').click();
  await page.keyboard.press('Escape');
  await pubRow(dragged).dragTo(slot);
  await eventually(async () => assert.equal(await slot.locator('.nav-count').innerText(), '2'));
  const withLogo = subscriptions.publications.filter((p) => [picked, dragged].includes(p.name) && p.logo_url).length;
  assert.equal(await slot.locator('.logo-stack img').count(), withLogo);
  console.log('✓ filing by picker and by drag-and-drop');

  // Create a second folder straight from the picker.
  await pubRow(viaPickerNew).getByRole('button', { name: 'Folders' }).click();
  await page.getByRole('dialog').getByRole('textbox', { name: 'New folder name' }).fill('Economics');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await page.locator('.folder-slot', { hasText: 'Economics' }).waitFor();
  await pubRow(viaPickerNew).locator('.chip', { hasText: 'Economics' }).waitFor();
  console.log('✓ creating a folder from the picker files the publication into it');

  // Reorder: drag Economics above Must read.
  await page.locator('.folder-slot', { hasText: 'Economics' }).dragTo(slot);
  await eventually(async () => assert.deepEqual(await page.locator('.folder-slot .nav-label').allInnerTexts(), ['Economics', 'Must read']));
  console.log('✓ folder reordering');
  await page.screenshot({ path: join(shots, '3-all-publications.png') });

  // Pinned feed shows posts from pinned publications, newest first.
  await page.locator('.nav-item', { hasText: 'Pinned' }).click();
  await page.locator('a.post').first().waitFor();
  const dates = await page.locator('a.post time').evaluateAll((els) => els.map((e) => e.getAttribute('datetime')));
  assert.deepEqual(dates, [...dates].sort().reverse());
  const feedPubs = new Set(await page.locator('.post-pub').allInnerTexts());
  assert.deepEqual([...feedPubs].sort(), pubsWithPosts.slice(0, 3).sort());
  console.log(`✓ pinned feed: ${dates.length} posts from ${feedPubs.size} publications, newest first`);
  assert.equal(await page.locator('.sidebar .active').count(), 1);
  assert.equal(await page.locator('.sidebar .drop').count(), 0);
  console.log('✓ exactly one sidebar item is active and no drop highlight is stuck');
  await page.mouse.move(700, 400);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(shots, '4-pinned-feed.png') });

  // Folder view + persistence across reload.
  await slot.click();
  await page.getByRole('heading', { name: 'Must read' }).waitFor();
  await page.locator('a.post').first().waitFor();
  const folderFeedPubs = new Set(await page.locator('.post-pub').allInnerTexts());
  assert.deepEqual([...folderFeedPubs].sort(), [picked, dragged].sort());
  console.log('✓ folder feed shows only that folder’s publications');
  await page.screenshot({ path: join(shots, '5-folder-feed.png') });
  await page.reload();
  await page.getByRole('heading', { name: 'Must read' }).waitFor();
  assert.equal(await page.locator('.folder-slot', { hasText: 'Must read' }).locator('.nav-count').innerText(), '2');
  console.log('✓ folders, pins and current view survive a reload');

  // Rename and delete.
  await page.getByRole('button', { name: 'Rename' }).click();
  await page.getByRole('textbox', { name: 'Folder name' }).fill('Daily');
  await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: 'Daily' }).waitFor();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('heading', { name: 'Pinned' }).waitFor();
  await eventually(async () => assert.deepEqual(await page.locator('.folder-slot .nav-label').allInnerTexts(), ['Economics']));
  console.log('✓ rename and delete');

  // Filtering.
  await page.locator('.nav-item', { hasText: 'All subscriptions' }).click();
  await page.getByRole('tab', { name: 'Publications' }).click();
  await page.getByPlaceholder('Filter publications').fill(pubsWithPosts[0].slice(0, 6));
  assert.ok((await page.locator('.pub').count()) < subscriptions.publications.length);
  console.log('✓ filter');

  // Two reader tabs editing at the same moment: both edits survive, in both tabs.
  const page2 = await context.newPage();
  page2.on('pageerror', (e) => errors.push(e.message));
  await page2.goto(page.url());
  await page2.locator('.nav-item', { hasText: 'Pinned' }).waitFor();
  const unpinned = subscriptions.publications.filter((p) => !pubsWithPosts.slice(0, 3).includes(p.name)).slice(0, 2);
  const pinVia = (p, pubId) =>
    p.evaluate((id) => chrome.runtime.sendMessage({ type: 'library/mutate', ops: [{ kind: 'setPinned', pubId: id, pinned: true }] }), pubId);
  await Promise.all([pinVia(page, unpinned[0].id), pinVia(page2, unpinned[1].id)]);
  for (const p of [page, page2]) {
    await eventually(async () => assert.equal(await p.locator('.nav-item', { hasText: 'Pinned' }).locator('.nav-count').innerText(), '5'));
  }
  console.log('✓ simultaneous edits from two tabs both survive');
  await page2.close();

  // Edits reach chrome.storage.sync after a short pause.
  await eventually(async () => {
    const sync = await page.evaluate(() => chrome.storage.sync.get(null));
    assert.equal(sync.meta?.pinned.length, 5);
    assert.deepEqual(sync.meta.folderOrder.map((id) => sync[`folder:${id}`].name), ['Economics']);
  }, 8000);
  await page.getByText('Folders saved').waitFor();
  console.log('✓ folders and pins sync to chrome.storage.sync');

  // An import too big for sync storage is refused and changes nothing.
  const big = { folders: [{ id: 'big', name: 'Everything', pubIds: Array.from({ length: 1500 }, (_, i) => 5_000_000 + i) }], pinned: [] };
  page.once('dialog', (d) => d.accept());
  await page.locator('input[type=file]').setInputFiles({ name: 'big.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(big)) });
  await page.getByText('“Everything” is full').waitFor();
  assert.deepEqual(await page.locator('.folder-slot .nav-label').allInnerTexts(), ['Economics']);
  console.log('✓ an import too large to sync is refused with a clear message');

  // "Check for new posts" refreshes once; later loads go back to the cache.
  const economics = page.locator('.folder-slot', { hasText: 'Economics' });
  await economics.click();
  await page.locator('a.post').first().waitFor();
  const beforeRefresh = calls.posts;
  const refresh = page.getByRole('button', { name: 'Check for new posts' });
  await refresh.click();
  await eventually(async () => assert.ok(await refresh.isEnabled()));
  assert.equal(calls.posts, beforeRefresh + 1); // Economics holds one publication.
  await page.getByRole('tab', { name: 'Publications' }).click();
  await page.getByRole('tab', { name: 'Latest posts' }).click();
  await page.locator('a.post').first().waitFor();
  await page.locator('.nav-item', { hasText: 'Pinned' }).click();
  await page.locator('a.post').first().waitFor();
  const afterPinned = calls.posts;
  await economics.click();
  await page.locator('a.post').first().waitFor();
  await page.waitForTimeout(300);
  assert.equal(calls.posts, afterPinned);
  console.log('✓ a manual refresh fetches once; switching modes and views afterwards uses the cache');

  // Clearing the cache deletes Substack data, keeps folders, and reloads subscriptions.
  await page.evaluate(() => chrome.storage.local.set({ 'posts:424242': { fetchedAt: 0, data: [] } }));
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Clear cache' }).click();
  await page.locator('.nav-item', { hasText: 'All subscriptions' }).waitFor();
  await eventually(async () => {
    const local = await page.evaluate(() => chrome.storage.local.get(null));
    assert.ok(!('posts:424242' in local), 'cached posts survived Clear cache');
    assert.ok('subscriptions' in local && 'libraryDoc' in local && 'noticeAcceptedAt' in local);
  });
  assert.deepEqual(await page.locator('.folder-slot .nav-label').allInnerTexts(), ['Economics']);
  console.log('✓ Clear cache deletes Substack data and keeps folders');

  assert.deepEqual(errors, [], `page errors: ${errors.join('\n')}`);
  await context.close();
}

console.log(`\nScreenshots in ${shots}`);
