import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchSubscriptions, NotSignedInError, parsePosts, parseSubscriptions } from '@/lib/substack';
import subscriptionsFixture from './fixtures/subscriptions.json';
import postsByAuthor from './fixtures/posts-by-author.json';

describe('parseSubscriptions', () => {
  it('joins subscriptions to the sibling publications array', () => {
    const pubs = parseSubscriptions(subscriptionsFixture);
    expect(pubs).toHaveLength(subscriptionsFixture.subscriptions.length);
    for (const pub of pubs) {
      expect(pub.name).toBeTruthy();
      expect(pub.url).toMatch(/^https:\/\//);
    }
    // Custom domains win over the substack.com subdomain.
    expect(pubs.find((p) => p.name === 'The Quiet Ledger')?.url).toBe('https://ledger.example.com');
    // A publication without an author has no author feed to read posts from.
    expect(pubs.find((p) => p.name === 'Unsigned Dispatch')).toMatchObject({ authorId: null, authorName: null });
    // Sorted by name for the "All" view.
    const names = pubs.map((p) => p.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it('marks paid subscriptions from membership_state', () => {
    const pubs = parseSubscriptions(subscriptionsFixture);
    const paidIds = new Set(
      subscriptionsFixture.subscriptions.filter((s) => s.membership_state === 'subscribed').map((s) => s.publication_id),
    );
    expect(pubs.filter((p) => p.paid).map((p) => p.id).sort()).toEqual([...paidIds].sort());
  });

  it('accepts subscriptions that embed their publication', () => {
    const embedded = {
      subscriptions: [
        { membership_state: 'free_signup', publication: { id: 1, name: 'Zeta', subdomain: 'zeta', author_id: 9 } },
        { membership_state: 'subscribed', publication: { id: 2, name: 'Alpha', subdomain: 'alpha', custom_domain: 'alpha.com', author_id: 8 } },
      ],
    };
    expect(parseSubscriptions(embedded)).toMatchObject([
      { id: 2, name: 'Alpha', url: 'https://alpha.com', paid: true, authorId: 8 },
      { id: 1, name: 'Zeta', url: 'https://zeta.substack.com', paid: false, authorId: 9 },
    ]);
  });

  it('skips subscriptions whose publication is missing and de-duplicates', () => {
    const body = {
      subscriptions: [{ publication_id: 1 }, { publication_id: 1 }, { publication_id: 404 }],
      publications: [{ id: 1, name: 'One', subdomain: 'one' }],
    };
    expect(parseSubscriptions(body).map((p) => p.id)).toEqual([1]);
  });

  it('returns nothing for an unexpected shape instead of throwing', () => {
    expect(parseSubscriptions({ errors: [{ msg: 'nope' }] })).toEqual([]);
  });
});

describe('parsePosts', () => {
  const [authorId, body] = Object.entries(postsByAuthor).find(([, b]) => b.posts.length > 0)!;
  const pubId = body.posts[0]!.publication_id;

  it('drops guest posts the author wrote for other publications', () => {
    const withGuest = Object.values(postsByAuthor).find((b) => b.posts.some((p) => p.publication_id === 9999))!;
    const own = withGuest.posts.find((p) => p.publication_id !== 9999)!.publication_id;
    const posts = parsePosts(withGuest, own);
    expect(posts).toHaveLength(withGuest.posts.length - 1);
  });

  it('keeps only posts from the requested publication', () => {
    const posts = parsePosts(body, pubId);
    expect(posts.length).toBeGreaterThan(0);
    expect(posts.every((p) => p.publicationId === pubId)).toBe(true);
    expect(posts[0]).toMatchObject({ title: expect.any(String), url: expect.stringMatching(/^https:\/\//), date: expect.any(String) });
    expect(authorId).toBeTruthy();
  });

  it('flags paid-only posts', () => {
    const posts = parsePosts(
      { posts: [{ id: 1, publication_id: 5, title: 'T', canonical_url: 'https://x', post_date: '2026-01-01', audience: 'only_paid' }] },
      5,
    );
    expect(posts[0]!.paywalled).toBe(true);
  });
});

describe('fetchSubscriptions', () => {
  const respond = (routes: Record<string, unknown>) =>
    vi.stubGlobal('fetch', async (url: string) => {
      const path = new URL(url).pathname.replace('/api/v1', '');
      return new Response(JSON.stringify(routes[path] ?? {}), { status: path in routes ? 200 : 404 });
    });
  afterEach(() => vi.unstubAllGlobals());

  it('reads nested subscriptions from /user/profile/self', async () => {
    respond({
      '/user/profile/self': {
        id: 1,
        handle: 'me',
        subscriptions: [{ membership_state: 'subscribed', publication: { id: 5, name: 'Five', subdomain: 'five', author_name: 'Ann' } }],
      },
    });
    expect(await fetchSubscriptions()).toMatchObject([{ id: 5, name: 'Five', paid: true, authorName: 'Ann' }]);
  });

  it('falls back to /subscriptions when the profile has none', async () => {
    respond({ '/user/profile/self': { id: 1, subscriptions: [] }, '/subscriptions': subscriptionsFixture });
    expect(await fetchSubscriptions()).toHaveLength(subscriptionsFixture.subscriptions.length);
  });

  it('reports what came back instead of returning an empty list', async () => {
    respond({ '/user/profile/self': { id: 1, handle: 'me' }, '/subscriptions': { subscriptions: [], publications: [] } });
    await expect(fetchSubscriptions()).rejects.toThrow(/no subscriptions.*\{id, handle\}.*\{subscriptions, publications\}/);
  });

  it('treats 401 as signed out', async () => {
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 401 }));
    await expect(fetchSubscriptions()).rejects.toBeInstanceOf(NotSignedInError);
  });
});
