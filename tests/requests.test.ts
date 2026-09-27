import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { Publication } from '@/lib/substack';

// Fresh modules per test: the request pool and cooldown are module-level state.
const load = async () => ({ ...(await import('@/lib/substack')), ...(await import('@/lib/cache')) });

const pub = (id: number): Publication => ({
  id,
  name: `Pub ${id}`,
  url: `https://pub${id}.example.com`,
  logoUrl: null,
  authorId: id + 100,
  authorName: null,
  description: null,
  paid: false,
});
const postsBody = (pubId: number, n = 2) => ({
  posts: Array.from({ length: n }, (_, i) => ({
    id: pubId * 10 + i,
    publication_id: pubId,
    title: `Post ${i}`,
    canonical_url: `https://pub${pubId}.example.com/p/${i}`,
    post_date: new Date(Date.UTC(2026, 8, 20 - i, pubId)).toISOString(),
  })),
});
const authorOf = (url: string) => Number(new URL(url).searchParams.get('profile_user_id'));

/** A fetch whose responses are released by hand, recording how many run at once. */
function controlledFetch() {
  const pending: Array<{ url: string; resolve: (r: Response) => void }> = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const fetch = vi.fn((url: string, init?: RequestInit) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    return new Promise<Response>((resolve, reject) => {
      init?.signal?.addEventListener('abort', () => (inFlight--, reject(init.signal!.reason)));
      pending.push({ url, resolve: (r) => (inFlight--, resolve(r)) });
    });
  });
  const answerAll = () => {
    for (const { url, resolve } of pending.splice(0)) resolve(Response.json(postsBody(authorOf(url) - 100)));
  };
  return { fetch, pending, answerAll, maxInFlight: () => maxInFlight };
}

beforeEach(() => {
  vi.resetModules();
  fakeBrowser.reset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Substack requests', () => {
  it('runs at most four requests at once across all callers', async () => {
    const { fetchRecentPosts } = await load();
    const f = controlledFetch();
    vi.stubGlobal('fetch', f.fetch);
    const all = Promise.all(Array.from({ length: 10 }, (_, i) => fetchRecentPosts(pub(i + 1))));
    for (let round = 0; round < 3; round++) {
      await vi.waitFor(() => expect(f.pending.length).toBeGreaterThan(0));
      f.answerAll();
    }
    expect((await all).flat()).toHaveLength(20);
    expect(f.maxInFlight()).toBe(4);
  });

  it('drops queued requests when their caller aborts', async () => {
    const { fetchRecentPosts } = await load();
    const f = controlledFetch();
    vi.stubGlobal('fetch', f.fetch);
    const controller = new AbortController();
    const calls = Array.from({ length: 8 }, (_, i) => fetchRecentPosts(pub(i + 1), controller.signal).catch((e) => e));
    await vi.waitFor(() => expect(f.fetch).toHaveBeenCalledTimes(4));
    controller.abort();
    const results = await Promise.all(calls);
    expect(results.every((r) => r instanceof DOMException && r.name === 'AbortError')).toBe(true);
    expect(f.fetch).toHaveBeenCalledTimes(4); // The four queued requests never started.
  });

  it('waits out Retry-After on a 429, pausing other requests too', async () => {
    vi.useFakeTimers();
    const { fetchRecentPosts } = await load();
    const times: number[] = [];
    let first = true;
    vi.stubGlobal('fetch', async (url: string) => {
      times.push(Date.now());
      if (first) {
        first = false;
        return new Response('', { status: 429, headers: { 'retry-after': '5' } });
      }
      return Response.json(postsBody(authorOf(url) - 100));
    });
    const start = Date.now();
    const a = fetchRecentPosts(pub(1));
    await vi.advanceTimersByTimeAsync(0);
    const b = fetchRecentPosts(pub(2)); // Starts during the cooldown.
    await vi.advanceTimersByTimeAsync(5000);
    expect(await a).toHaveLength(2);
    expect(await b).toHaveLength(2);
    expect(times.slice(1).every((t) => t - start >= 5000)).toBe(true);
  });

  it('parses Retry-After and falls back to bounded backoff', async () => {
    const { retryDelayMs } = await load();
    expect(retryDelayMs('7', 0)).toBe(7000);
    expect(retryDelayMs(new Date(Date.UTC(2026, 0, 1, 0, 0, 30)).toUTCString(), 0, Date.UTC(2026, 0, 1))).toBe(30_000);
    expect(retryDelayMs('9999', 0)).toBe(60_000);
    expect(retryDelayMs(null, 1)).toBeGreaterThanOrEqual(4000);
    expect(retryDelayMs('soon', 0)).toBeLessThan(2600);
  });
});

describe('recentPosts cache', () => {
  it('uses the cache after a forced refresh instead of forcing every later load', async () => {
    const { recentPosts } = await load();
    const fetch = vi.fn(async (url: string) => Response.json(postsBody(authorOf(url) - 100)));
    vi.stubGlobal('fetch', fetch);
    const pubs = [pub(1), pub(2)];
    await recentPosts(pubs);
    expect(fetch).toHaveBeenCalledTimes(2);
    await recentPosts(pubs, { force: true });
    expect(fetch).toHaveBeenCalledTimes(4);
    await vi.waitFor(async () => expect(Object.keys(await fakeBrowser.storage.local.get(null))).toHaveLength(2));
    const { posts } = await recentPosts(pubs);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(posts).toHaveLength(4);
  });

  it('keeps fresh posts when caching them fails', async () => {
    const { recentPosts } = await load();
    vi.stubGlobal('fetch', async (url: string) => Response.json(postsBody(authorOf(url) - 100)));
    vi.spyOn(fakeBrowser.storage.local, 'set').mockRejectedValue(new Error('QUOTA_BYTES quota exceeded'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { posts, failed } = await recentPosts([pub(1)]);
    expect(posts).toHaveLength(2);
    expect(failed).toEqual([]);
  });

  it('reports publications that failed and keeps the rest of the feed', async () => {
    const { recentPosts } = await load();
    vi.stubGlobal('fetch', async (url: string) =>
      authorOf(url) === 102 ? new Response('', { status: 500 }) : Response.json(postsBody(authorOf(url) - 100)),
    );
    const { posts, failed } = await recentPosts([pub(1), pub(2)]);
    expect(posts.map((p) => p.publicationId)).toEqual([1, 1]);
    expect(failed.map((p) => p.id)).toEqual([2]);
  });

  it('skips posts with unusable dates or links', async () => {
    const { parsePosts } = await load();
    const body = {
      posts: [
        { id: 1, publication_id: 5, title: 'ok', canonical_url: 'https://x.example.com/p/1', post_date: '2026-01-01T00:00:00Z' },
        { id: 2, publication_id: 5, title: 'no date', canonical_url: 'https://x.example.com/p/2', post_date: null },
        { id: 3, publication_id: 5, title: 'bad link', canonical_url: 'javascript:alert(1)', post_date: '2026-01-01T00:00:00Z' },
      ],
    };
    expect(parsePosts(body, 5).map((p) => p.id)).toEqual([1]);
  });
});
