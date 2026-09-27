// Client for Substack's undocumented web API. All requests go to substack.com and
// ride on the browser's existing login cookies. Endpoint shapes can change without
// notice, so parsing is defensive and lives next to the fetch that needs it.

const API = 'https://substack.com/api/v1';

export interface Publication {
  id: number;
  name: string;
  /** Publication home page (custom domain when it has one). */
  url: string;
  logoUrl: string | null;
  authorId: number | null;
  authorName: string | null;
  description: string | null;
  /** True for a paid (or comped) subscription. */
  paid: boolean;
}

export interface Post {
  id: number;
  publicationId: number;
  title: string;
  subtitle: string | null;
  url: string;
  date: string;
  coverImage: string | null;
  paywalled: boolean;
}

export class NotSignedInError extends Error {
  constructor() {
    super('Not signed in to Substack');
    this.name = 'NotSignedInError';
  }
}

type Json = Record<string, any>;

/** Resized copy of a Substack-hosted image via Substack's image CDN. */
export function thumb(url: string, width: number, height = width): string {
  return `https://substackcdn.com/image/fetch/w_${width * 2},h_${height * 2},c_fill,f_auto,q_auto:good/${encodeURIComponent(url)}`;
}

// ── Requests ─────────────────────────────────────────────────────────────────
// All requests from this page share one small pool, so switching views quickly
// can't pile up parallel request queues, and a 429 pauses every request, not just
// the one that got it.

const MAX_CONCURRENT = 4;
const MAX_RETRIES = 2;
let active = 0;
const waiting: Array<() => void> = [];
let cooldownUntil = 0;

function acquireSlot(signal?: AbortSignal): Promise<() => void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      active--;
      waiting.shift()?.();
    };
    const grant = () => {
      signal?.removeEventListener('abort', onAbort);
      active++;
      resolve(release);
    };
    const onAbort = () => {
      const i = waiting.indexOf(grant);
      if (i !== -1) waiting.splice(i, 1);
      reject(signal!.reason);
    };
    if (active < MAX_CONCURRENT) return grant();
    waiting.push(grant);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    if (ms <= 0) return resolve();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => (clearTimeout(timer), reject(signal.reason)), { once: true });
  });
}

/** How long a 429 asks us to wait: Retry-After (seconds or a date), else exponential backoff with jitter. */
export function retryDelayMs(retryAfter: string | null, attempt: number, now = Date.now()): number {
  let ms = NaN;
  if (retryAfter) ms = /^\d+$/.test(retryAfter.trim()) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - now;
  if (!Number.isFinite(ms)) ms = 2000 * 2 ** attempt + Math.random() * 500;
  return Math.min(Math.max(ms, 1000), 60_000);
}

async function getJson(path: string, signal?: AbortSignal, attempt = 0): Promise<any> {
  const release = await acquireSlot(signal);
  let res: Response;
  try {
    await sleep(cooldownUntil - Date.now(), signal);
    res = await fetch(`${API}${path}`, { credentials: 'include', signal });
  } finally {
    release();
  }
  if (res.status === 401 || res.status === 403) throw new NotSignedInError();
  if (res.status === 429 && attempt < MAX_RETRIES) {
    cooldownUntil = Math.max(cooldownUntil, Date.now() + retryDelayMs(res.headers.get('retry-after'), attempt));
    return getJson(path, signal, attempt + 1);
  }
  if (res.status === 429) throw new Error('Substack is limiting requests right now. Try again in a minute.');
  if (!res.ok) throw new Error(`Substack returned ${res.status} for ${path}`);
  return res.json();
}

function publicationUrl(pub: Json): string {
  if (pub.custom_domain) return `https://${pub.custom_domain}`;
  return `https://${pub.subdomain}.substack.com`;
}

function toPublication(pub: Json, membershipState: string | undefined): Publication {
  const author = pub.author ?? pub.primaryUser ?? {};
  return {
    id: pub.id,
    name: pub.name ?? pub.subdomain ?? `Publication ${pub.id}`,
    url: publicationUrl(pub),
    logoUrl: pub.logo_url ?? null,
    authorId: pub.author_id ?? pub.primary_user_id ?? author.id ?? null,
    authorName: author.name ?? pub.author_name ?? pub.copyright ?? null,
    description: pub.hero_text ?? null,
    paid: membershipState === 'subscribed',
  };
}

/**
 * Parses GET /subscriptions. Handles both known shapes: subscriptions that embed
 * their `publication`, and subscriptions with a sibling `publications` array
 * joined on `publication_id`.
 */
export function parseSubscriptions(body: Json): Publication[] {
  const subs: Json[] = Array.isArray(body.subscriptions) ? body.subscriptions : [];
  const pubsById = new Map<number, Json>();
  for (const pub of body.publications ?? []) pubsById.set(pub.id, pub);

  const seen = new Set<number>();
  const result: Publication[] = [];
  for (const sub of subs) {
    const pub = sub.publication ?? pubsById.get(sub.publication_id);
    if (!pub || seen.has(pub.id)) continue;
    seen.add(pub.id);
    result.push(toPublication(pub, sub.membership_state));
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The reader's subscriptions. `/user/profile/self` is what Substack's own clients
 * use and nests each publication in its subscription. `/subscriptions` is a
 * fallback: on real accounts it can return an empty `subscriptions` array.
 */
export async function fetchSubscriptions(): Promise<Publication[]> {
  const self = await getJson('/user/profile/self');
  const fromProfile = parseSubscriptions(self);
  if (fromProfile.length) return fromProfile;

  const legacy = await getJson('/subscriptions?tvOnly=false');
  const fromLegacy = parseSubscriptions(legacy);
  if (fromLegacy.length) return fromLegacy;

  // The profile answered in the shape we know with an empty list: a real empty account.
  if (Array.isArray(self?.subscriptions)) return [];

  // Neither response looks like what we expect; say what came back so it can be fixed.
  const describe = (body: Json) => `{${Object.keys(body ?? {}).slice(0, 12).join(', ')}}`;
  throw new Error(
    `Substack returned no subscriptions. profile/self had ${self?.subscriptions?.length ?? 'no'} subscriptions ` +
      `${describe(self)}; /subscriptions had ${describe(legacy)}.`,
  );
}

export function parsePosts(body: Json, publicationId: number): Post[] {
  const posts: Json[] = Array.isArray(body.posts) ? body.posts : [];
  return posts
    // Malformed entries would break date sorting or produce dead links; skip them.
    .filter(
      (p) =>
        p.publication_id === publicationId &&
        typeof p.title === 'string' &&
        typeof p.post_date === 'string' &&
        !Number.isNaN(Date.parse(p.post_date)) &&
        /^https?:\/\//.test(p.canonical_url ?? ''),
    )
    .map((p) => ({
      id: p.id,
      publicationId: p.publication_id,
      title: p.title,
      subtitle: p.subtitle || p.description || null,
      url: p.canonical_url,
      date: p.post_date,
      coverImage: p.cover_image ?? null,
      paywalled: p.audience === 'only_paid' || p.audience === 'founding',
    }));
}

/**
 * Recent posts for one publication. Uses the author's profile feed on substack.com
 * (works for custom-domain publications without extra permissions) and keeps only
 * posts from this publication. Guest posts by other writers are not included.
 */
export async function fetchRecentPosts(pub: Publication, signal?: AbortSignal, limit = 6): Promise<Post[]> {
  if (pub.authorId == null) return [];
  const body = await getJson(`/profile/posts?profile_user_id=${pub.authorId}&limit=${limit * 2}`, signal);
  return parsePosts(body, pub.id).slice(0, limit);
}
