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

export interface FeedResult {
  /** Newest first. */
  posts: Post[];
  /** Publications whose posts couldn't be refreshed (their cached posts are included if any). */
  failed: Publication[];
}

/**
 * Recent posts across `pubs`. Serves cache entries younger than 30 minutes and
 * fetches the rest; `force` fetches everything. Rejects only if `signal` aborts.
 */
export async function recentPosts(pubs: Publication[], { force = false, signal }: { force?: boolean; signal?: AbortSignal } = {}): Promise<FeedResult> {
  const cached = (await browser.storage.local.get(pubs.map((p) => postsKey(p.id)))) as Record<string, Cached<Post[]>>;
  const now = Date.now();
  const failed: Publication[] = [];

  const lists = await Promise.all(
    pubs.map(async (pub) => {
      const entry = cached[postsKey(pub.id)];
      if (!force && entry && now - entry.fetchedAt < POSTS_TTL_MS) return entry.data;
      try {
        const data = await fetchRecentPosts(pub, signal);
        // Caching is best-effort: a failed write must not discard fresh posts.
        browser.storage.local
          .set({ [postsKey(pub.id)]: { fetchedAt: Date.now(), data } })
          .catch((err) => console.warn('Could not cache posts', err));
        return data;
      } catch (err) {
        if (signal?.aborted) throw err;
        // One broken publication shouldn't blank the feed; fall back to stale cache.
        failed.push(pub);
        return entry?.data ?? [];
      }
    }),
  );
  signal?.throwIfAborted();
  return { posts: lists.flat().sort((a, b) => b.date.localeCompare(a.date)), failed };
}
