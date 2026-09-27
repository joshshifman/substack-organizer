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
  await prunePosts(new Set(entry.data.map((p) => p.id))).catch((err) => console.warn('Could not prune cached posts', err));
  return entry;
}

const POSTS_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Deletes cached posts for publications you've left, and any older than a week. */
async function prunePosts(subscribed: Set<number>): Promise<void> {
  const all = await browser.storage.local.get(null);
  const now = Date.now();
  const stale = Object.entries(all)
    .filter(([key, value]) => {
      if (!key.startsWith('posts:')) return false;
      const entry = value as Cached<Post[]>;
      return !subscribed.has(Number(key.slice(6))) || now - entry.fetchedAt > POSTS_MAX_AGE_MS;
    })
    .map(([key]) => key);
  if (stale.length) await browser.storage.local.remove(stale);
}

/**
 * Deletes everything cached from Substack (subscriptions and posts). Folders,
 * pins and the first-run notice acknowledgement are kept.
 */
export async function clearSubstackCache(): Promise<void> {
  const keys = Object.keys(await browser.storage.local.get(null)).filter((k) => k === SUBS_KEY || k.startsWith('posts:'));
  await browser.storage.local.remove(keys);
}

// ── First-run notice ─────────────────────────────────────────────────────────
// Nothing is requested from Substack until the user has read what the extension
// reads and stores, and chosen to continue.

const NOTICE_KEY = 'noticeAcceptedAt';

export async function noticeAccepted(): Promise<boolean> {
  return NOTICE_KEY in (await browser.storage.local.get(NOTICE_KEY));
}

export const acceptNotice = () => browser.storage.local.set({ [NOTICE_KEY]: Date.now() });

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
