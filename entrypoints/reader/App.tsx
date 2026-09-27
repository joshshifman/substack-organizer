import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cachedSubscriptions, recentPosts, refreshSubscriptions } from '@/lib/cache';
import { emptyLibrary, unsortedIds, type LibraryOp } from '@/lib/library';
import { getLibraryDoc, mutateLibrary, watchLibraryDoc } from '@/lib/library-client';
import type { LibraryDoc } from '@/lib/store';
import { NotSignedInError, type Post, type Publication } from '@/lib/substack';
import { Icon } from './icons';
import { Sidebar } from './Sidebar';
import { PostList } from './PostList';
import { PublicationList } from './PublicationList';

export type View =
  | { kind: 'pinned' }
  | { kind: 'all' }
  | { kind: 'unsorted' }
  | { kind: 'folder'; id: string };

type Mode = 'posts' | 'publications';

/** Beyond this many publications a merged post feed is too many requests. */
const MAX_FEED_PUBS = 60;

type SubsState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'error'; message: string }
  | { status: 'ready'; pubs: Publication[]; fetchedAt: number; signedOut?: boolean; refreshError?: string };

export default function App() {
  const [subs, setSubs] = useState<SubsState>({ status: 'loading' });
  const [doc, setDoc] = useState<LibraryDoc | null>(null);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [view, setView] = useState<View>(loadView);
  const [mode, setMode] = useState<Mode>('posts');
  const [query, setQuery] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);

  // Library: owned by the background worker. Every version arrives through
  // watchLibraryDoc (or as a reply); older versions arriving late are ignored.
  const acceptDoc = useCallback((next: LibraryDoc) => {
    setDoc((prev) => (!prev || next.version >= prev.version ? next : prev));
  }, []);
  const loadLibrary = useCallback(() => {
    setLibraryError(null);
    getLibraryDoc().then(acceptDoc, (err: Error) => setLibraryError(err.message));
  }, [acceptDoc]);
  useEffect(() => {
    const unwatch = watchLibraryDoc(acceptDoc); // Subscribe first so no update is missed.
    loadLibrary();
    return unwatch;
  }, [acceptDoc, loadLibrary]);
  const library = doc?.library ?? emptyLibrary;

  const mutate = useCallback(
    (...ops: LibraryOp[]) => {
      mutateLibrary(ops).then(
        (next) => {
          acceptDoc(next);
          setSaveError(null);
        },
        (err: Error) => setSaveError(`Couldn't save that change: ${err.message}`),
      );
    },
    [acceptDoc],
  );

  // Subscriptions: show the cache immediately, then refresh from Substack.
  const syncSubscriptions = useCallback(async () => {
    const cached = await cachedSubscriptions();
    if (cached) setSubs({ status: 'ready', pubs: cached.data, fetchedAt: cached.fetchedAt });
    try {
      const fresh = await refreshSubscriptions();
      setSubs({ status: 'ready', pubs: fresh.data, fetchedAt: fresh.fetchedAt });
    } catch (err) {
      if (err instanceof NotSignedInError) {
        setSubs(cached ? { status: 'ready', pubs: cached.data, fetchedAt: cached.fetchedAt, signedOut: true } : { status: 'signed-out' });
      } else if (cached) {
        setSubs({ status: 'ready', pubs: cached.data, fetchedAt: cached.fetchedAt, refreshError: (err as Error).message });
      } else {
        setSubs({ status: 'error', message: (err as Error).message });
      }
    }
  }, []);

  useEffect(() => {
    syncSubscriptions();
  }, [syncSubscriptions]);

  useEffect(() => localStorage.setItem('view', JSON.stringify(view)), [view]);

  const pubs = subs.status === 'ready' ? subs.pubs : [];
  const pubsById = useMemo(() => new Map(pubs.map((p) => [p.id, p])), [pubs]);

  // A folder that was deleted (maybe in another tab) falls back to Pinned.
  const folder = view.kind === 'folder' ? library.folders.find((f) => f.id === view.id) : undefined;
  useEffect(() => {
    if (view.kind === 'folder' && !folder && doc) setView({ kind: 'pinned' });
  }, [view, folder, doc]);

  const viewPubs = useMemo(() => {
    const pick = (ids: number[]) => ids.flatMap((id) => pubsById.get(id) ?? []);
    const byName = (a: Publication, b: Publication) => a.name.localeCompare(b.name);
    switch (view.kind) {
      case 'pinned':
        return pick(library.pinned).sort(byName);
      case 'all':
        return pubs;
      case 'unsorted':
        return pick(unsortedIds(library, pubs.map((p) => p.id)));
      case 'folder':
        return pick(folder?.pubIds ?? []).sort(byName);
    }
  }, [view, library, pubs, pubsById, folder]);

  const feedAllowed = viewPubs.length > 0 && viewPubs.length <= MAX_FEED_PUBS;
  const effectiveMode: Mode = feedAllowed ? mode : 'publications';

  // Posts for the current view. The feed remembers which publications it was
  // loaded for, so switching views never shows the previous view's posts.
  const [feed, setFeed] = useState<{ key: string; posts: Post[] } | null>(null);
  const [postsNonce, setPostsNonce] = useState(0);
  const feedKey = `${viewPubs.map((p) => p.id).join(',')}#${postsNonce}`;
  const posts = feed?.key === feedKey ? feed.posts : null;
  useEffect(() => {
    if (effectiveMode !== 'posts' || !feedAllowed) return;
    let cancelled = false;
    recentPosts(viewPubs, postsNonce > 0).then((p) => !cancelled && setFeed({ key: feedKey, posts: p }));
    return () => {
      cancelled = true;
    };
    // viewPubs and postsNonce are captured through feedKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedKey, effectiveMode]);

  const q = query.trim().toLowerCase();
  const visiblePubs = q
    ? viewPubs.filter((p) => `${p.name} ${p.authorName ?? ''}`.toLowerCase().includes(q))
    : viewPubs;
  const visiblePosts =
    posts && q
      ? posts.filter((p) => `${p.title} ${pubsById.get(p.publicationId)?.name ?? ''}`.toLowerCase().includes(q))
      : posts;

  const title =
    view.kind === 'pinned' ? 'Pinned' : view.kind === 'all' ? 'All subscriptions' : view.kind === 'unsorted' ? 'Unsorted' : folder?.name ?? '';

  if (subs.status === 'loading') return <FullPage title="Loading your subscriptions…" />;
  if (subs.status === 'signed-out') {
    return (
      <FullPage title="Sign in to Substack to see your subscriptions">
        <p>This extension reads your subscriptions using your Substack login in this browser.</p>
        <div className="row">
          <a className="button primary" href="https://substack.com/sign-in" target="_blank" rel="noreferrer">
            Sign in to Substack
          </a>
          <button className="button" onClick={() => { setSubs({ status: 'loading' }); syncSubscriptions(); }}>
            I've signed in
          </button>
        </div>
      </FullPage>
    );
  }
  if (libraryError) {
    return (
      <FullPage title="Couldn't load your folders">
        <p>{libraryError}</p>
        <button className="button primary" onClick={loadLibrary}>Try again</button>
      </FullPage>
    );
  }
  if (subs.status === 'error') {
    return (
      <FullPage title="Couldn't load your subscriptions">
        <p>{subs.message}</p>
        <button className="button primary" onClick={() => { setSubs({ status: 'loading' }); syncSubscriptions(); }}>
          Try again
        </button>
      </FullPage>
    );
  }

  // Editing waits for the saved library, so nothing can be built on an empty stand-in.
  if (!doc) return <FullPage title="Loading your folders…" />;

  return (
    <div className="app">
      <Sidebar
        library={library}
        pubs={pubs}
        pubsById={pubsById}
        view={view}
        onView={(v) => { setView(v); setMode('posts'); setQuery(''); }}
        mutate={mutate}
        sync={doc}
        fetchedAt={subs.fetchedAt}
        onRefresh={syncSubscriptions}
      />
      <main className="main">
        <div className="column">
        {subs.signedOut && (
          <div className="banner">
            You're signed out of Substack, so this list may be out of date.{' '}
            <a href="https://substack.com/sign-in" target="_blank" rel="noreferrer">Sign in</a>
          </div>
        )}
        {saveError && <div className="banner error">{saveError}</div>}
        {subs.refreshError && <div className="banner error">Couldn't refresh your subscriptions: {subs.refreshError}</div>}

        <header className="main-head">
          <div className="title-row">
            {view.kind === 'folder' && folder ? (
              <FolderTitle
                name={folder.name}
                onRename={(name) => mutate({ kind: 'renameFolder', folderId: folder.id, name })}
                onDelete={() => {
                  if (confirm(`Delete the folder “${folder.name}”? The publications stay subscribed.`)) {
                    mutate({ kind: 'deleteFolder', folderId: folder.id });
                    setView({ kind: 'pinned' });
                  }
                }}
              />
            ) : (
              <h1>{title}</h1>
            )}
            <span className="count">{viewPubs.length} publications</span>
          </div>

          {viewPubs.length > 0 && <div className="toolbar">
            <div className="segmented" role="tablist">
              <button
                role="tab"
                aria-selected={effectiveMode === 'posts'}
                disabled={!feedAllowed}
                title={feedAllowed ? undefined : viewPubs.length ? `Latest posts work for up to ${MAX_FEED_PUBS} publications. Open a folder instead.` : undefined}
                onClick={() => setMode('posts')}
              >
                Latest posts
              </button>
              <button role="tab" aria-selected={effectiveMode === 'publications'} onClick={() => setMode('publications')}>
                Publications
              </button>
            </div>
            <label className="search">
              <Icon name="search" />
              <input
                type="search"
                placeholder={effectiveMode === 'posts' ? 'Filter posts' : 'Filter publications'}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            {effectiveMode === 'posts' && (
              <button className="icon-button" title="Check for new posts" onClick={() => setPostsNonce((n) => n + 1)}>
                <Icon name="refresh" />
              </button>
            )}
          </div>}
        </header>

        {viewPubs.length === 0 ? (
          <EmptyView view={view} onBrowse={() => { setView({ kind: 'all' }); setMode('publications'); }} />
        ) : effectiveMode === 'posts' ? (
          <PostList posts={visiblePosts} pubsById={pubsById} />
        ) : (
          <PublicationList
            pubs={visiblePubs}
            library={library}
            mutate={mutate}
            currentFolderId={view.kind === 'folder' ? view.id : null}
          />
        )}
        </div>
      </main>
    </div>
  );
}

function loadView(): View {
  try {
    const v = JSON.parse(localStorage.getItem('view') ?? '');
    if (v && ['pinned', 'all', 'unsorted', 'folder'].includes(v.kind)) return v;
  } catch {}
  return { kind: 'pinned' };
}

function FullPage({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="full-page">
      <div className="full-page-card">
        <h1>{title}</h1>
        {children}
      </div>
    </div>
  );
}

function FolderTitle({ name, onRename, onDelete }: { name: string; onRename: (n: string) => void; onDelete: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  useEffect(() => setDraft(name), [name]);

  if (editing) {
    return (
      <form
        className="rename"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim()) onRename(draft);
          setEditing(false);
        }}
      >
        <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => setEditing(false)} aria-label="Folder name" />
      </form>
    );
  }
  return (
    <>
      <h1>{name}</h1>
      <button className="text-button" onClick={() => setEditing(true)}>Rename</button>
      <button className="text-button danger" onClick={onDelete}>Delete</button>
    </>
  );
}

function EmptyView({ view, onBrowse }: { view: View; onBrowse: () => void }) {
  const copy = {
    pinned: ['Pin the publications you read most', 'Pinned publications show up here with their latest posts. Use the pin on any publication to add it.'],
    folder: ['This folder is empty', 'Drag publications onto the folder in the sidebar, or use “Folders” on any publication.'],
    unsorted: ['Everything is in a folder', 'New subscriptions will land here until you file them.'],
    all: ['No subscriptions yet', 'Subscribe to a publication on Substack and it will show up here.'],
  }[view.kind];
  return (
    <div className="empty">
      <h2>{copy[0]}</h2>
      <p>{copy[1]}</p>
      {view.kind !== 'all' && view.kind !== 'unsorted' && (
        <button className="button primary" onClick={onBrowse}>Browse all subscriptions</button>
      )}
    </div>
  );
}
