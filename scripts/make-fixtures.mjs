// Writes synthetic test fixtures shaped like Substack's API responses. Every
// publication, person, post and domain here is invented; no network access.
//   tests/fixtures/subscriptions.json   GET /api/v1/subscriptions (sibling `publications` shape)
//   tests/fixtures/posts-by-author.json GET /api/v1/profile/posts, keyed by profile_user_id
// Usage: node scripts/make-fixtures.mjs
import { writeFileSync } from 'node:fs';

// [name, author, options]. Options cover the cases the parser and UI handle:
// paid subscriptions, custom domains, missing logos, missing authors, authors
// who also post to another publication, and publications with no posts.
const PUBLICATIONS = [
  ['Field Notes on Rivers', 'Mara Quill', { paid: true, posts: 7 }],
  ['The Quiet Ledger', 'Tobias Venn', { customDomain: 'ledger.example.com', posts: 6 }],
  ['Kiln & Glaze', 'Priya Oduya', { posts: 5, alsoPostsElsewhere: true }],
  ['Midweek Maps', 'Hollis Grange', { noLogo: true, posts: 6 }],
  ['Small Engines', 'Dana Ruiz-Park', { paid: true, customDomain: 'smallengines.example.org', posts: 5 }],
  ['Soup Season', 'Wen Albrecht', { posts: 8 }],
  ['Longhand', 'Ines Marlow', { posts: 4, paywalled: true }],
  ['The Tidewater Review', 'Felix Obi', { posts: 6 }],
  ['Ferment Weekly', 'Juniper Hale', { noLogo: true, posts: 3 }],
  ['Orbit Desk', 'Sam Achterberg', { posts: 5 }],
  ['Porchlight', 'Rosa Delacroix-Imai', { posts: 0 }],
  ['Unsigned Dispatch', null, { posts: 0 }],
  ['Cartographer’s Almanac', 'Theo Brandt', { paid: true, posts: 4 }],
  ['Second Draft', 'Lena Kovač', { posts: 5 }],
];

const TOPICS = ['notes', 'a field guide', 'what I got wrong', 'the long version', 'questions from readers', 'a short history', 'the numbers', 'an interview'];
const BASE_DATE = Date.parse('2026-09-26T15:00:00.000Z');
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

const subscriptions = [];
const publications = [];
const postsByAuthor = {};
let postId = 5000;

PUBLICATIONS.forEach(([name, author, opts], i) => {
  const id = 1000 + i;
  const authorId = author ? 2000 + i : null;
  const subdomain = slugify(name).replace(/-/g, '');
  const home = opts.customDomain ? `https://${opts.customDomain}` : `https://${subdomain}.substack.com`;

  subscriptions.push({
    user_id: 1,
    id: 3000 + i,
    membership_state: opts.paid ? 'subscribed' : 'free_signup',
    type: null,
    is_founding: false,
    publication_id: id,
  });
  publications.push({
    id,
    name,
    subdomain,
    custom_domain: opts.customDomain ?? null,
    custom_domain_optional: false,
    logo_url: opts.noLogo ? null : `https://substack-post-media.s3.amazonaws.com/public/images/fixture-logo-${id}.png`,
    author_id: authorId,
    primary_user_id: authorId,
    hero_text: `${name} is an invented publication used in tests.`,
    copyright: author,
    payments_state: opts.paid ? 'enabled' : 'disabled',
    author: author && { id: authorId, name: author, handle: slugify(author) },
  });

  if (!authorId) return;
  const posts = [];
  for (let n = 0; n < opts.posts; n++) {
    const slug = `${slugify(name)}-${n + 1}`;
    posts.push({
      id: postId++,
      publication_id: id,
      title: `${name}: ${TOPICS[(i + n) % TOPICS.length]}`,
      subtitle: n % 3 === 2 ? null : `Issue ${opts.posts - n} of an invented newsletter.`,
      description: null,
      slug,
      type: 'newsletter',
      audience: opts.paywalled && n % 2 === 0 ? 'only_paid' : 'everyone',
      canonical_url: `${home}/p/${slug}`,
      // Spread publications across the timeline so merged feeds interleave.
      post_date: new Date(BASE_DATE - (n * 5 + i * 0.7) * 24 * 3600 * 1000).toISOString(),
      cover_image: n % 2 === 0 ? `https://substack-post-media.s3.amazonaws.com/public/images/fixture-cover-${id}-${n}.jpeg` : null,
    });
  }
  if (opts.alsoPostsElsewhere) {
    // A guest post on another publication shows up in the author's feed and must be filtered out.
    posts.unshift({ ...posts[0], id: postId++, publication_id: 9999, title: 'A guest post somewhere else', slug: 'guest', canonical_url: 'https://elsewhere.example.net/p/guest' });
  }
  postsByAuthor[authorId] = { posts };
});

writeFileSync('tests/fixtures/subscriptions.json', JSON.stringify({ subscriptions, publications }, null, 1) + '\n');
writeFileSync('tests/fixtures/posts-by-author.json', JSON.stringify(postsByAuthor, null, 1) + '\n');
console.log(`${publications.length} publications, ${Object.values(postsByAuthor).flatMap((a) => a.posts).length} posts`);
