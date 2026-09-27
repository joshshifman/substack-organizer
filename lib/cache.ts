// Local cache of Substack data so the reader opens instantly and doesn't refetch
// posts on every click. Substack stays the source of truth; this is disposable.

import { fetchRecentPosts, fetchSubscriptions, type Post, type Publication } from './substack';

const POSTS_TTL_MS = 30 * 60 * 1000;
const SUBS_KEY = 'subscriptions';
const postsKey = (pubId: number) => `posts:${pubId}`;

interface Cached<T> {
  fetchedAt: number;
  data: T;
}

export async function cachedSubscriptions(): Promise<Cached<Publication[]> | null> {
  const got = await browser.storage.local.get(SUBS_KEY);
  return (got[SUBS_KEY] as Cached<Publication[]>) ?? null;
}

export async function refreshSubscriptions(): Promise<Cached<Publication[]>> {
  const entry = { fetchedAt: Date.now(), data: await fetchSubscriptions() };
  await browser.storage.local.set({ [SUBS_KEY]: entry });
  return entry;
}

/**
 * Recent posts across `pubs`, newest first. Serves fresh cache entries and fetches
 * the rest a few at a time. `force` ignores the cache.
 */
export async function recentPosts(pubs: Publication[], force = false): Promise<Post[]> {
  const keys = pubs.map((p) => postsKey(p.id));
  const cached = (await browser.storage.local.get(keys)) as Record<string, Cached<Post[]>>;
  const now = Date.now();

  const results: Post[][] = [];
  const stale: Publication[] = [];
  for (const pub of pubs) {
    const entry = cached[postsKey(pub.id)];
    if (!force && entry && now - entry.fetchedAt < POSTS_TTL_MS) results.push(entry.data);
    else stale.push(pub);
  }

  const fresh = await mapLimit(stale, 4, async (pub) => {
    try {
      const data = await fetchRecentPosts(pub);
      await browser.storage.local.set({ [postsKey(pub.id)]: { fetchedAt: Date.now(), data } });
      return data;
    } catch (err) {
      // One broken publication shouldn't blank the feed; fall back to stale cache.
      console.warn(`Could not load posts for ${pub.name}`, err);
      return cached[postsKey(pub.id)]?.data ?? [];
    }
  });

  return [...results, ...fresh].flat().sort((a, b) => b.date.localeCompare(a.date));
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
