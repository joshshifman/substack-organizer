import { thumb, type Post, type Publication } from '@/lib/substack';
import { Icon } from './icons';

export function PostList({ posts, pubsById }: { posts: Post[] | null; pubsById: Map<number, Publication> }) {
  if (!posts) {
    return (
      <ol className="posts" aria-busy="true" aria-label="Loading posts">
        {Array.from({ length: 6 }, (_, i) => (
          <li key={i} className="post skeleton" />
        ))}
      </ol>
    );
  }
  if (posts.length === 0) {
    return (
      <div className="empty">
        <h2>No recent posts found</h2>
        <p>These publications haven't posted lately, or their posts couldn't be loaded. Try “Check for new posts”.</p>
      </div>
    );
  }
  return (
    <ol className="posts">
      {posts.map((post) => {
        const pub = pubsById.get(post.publicationId);
        return (
          <li key={post.id}>
            <a className="post" href={post.url} target="_blank" rel="noreferrer">
              <div className="post-body">
                <div className="post-meta">
                  {pub?.logoUrl && <img className="logo small" src={thumb(pub.logoUrl, 20)} alt="" />}
                  <span className="post-pub">{pub?.name}</span>
                  <time dateTime={post.date}>{formatDate(post.date)}</time>
                  {post.paywalled && (
                    <span className="paywalled" title="Paid subscribers only">
                      <Icon name="lock" size={12} />
                    </span>
                  )}
                </div>
                <h3 className="post-title">{post.title}</h3>
                {post.subtitle && <p className="post-subtitle">{post.subtitle}</p>}
              </div>
              {post.coverImage && <img className="post-cover" src={thumb(post.coverImage, 128, 88)} alt="" loading="lazy" />}
            </a>
          </li>
        );
      })}
    </ol>
  );
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  const hours = (Date.now() - date.getTime()) / 3_600_000;
  if (hours < 1) return 'just now';
  if (hours < 24) return `${Math.floor(hours)}h ago`;
  if (hours < 24 * 7) return date.toLocaleDateString(undefined, { weekday: 'short' });
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric' });
}
