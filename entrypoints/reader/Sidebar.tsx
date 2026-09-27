import { useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from 'react';
import { newFolderId, parseLibrary, unsortedIds, type Folder, type Library, type LibraryOp } from '@/lib/library';
import type { LibraryDoc } from '@/lib/store';
import { thumb, type Publication } from '@/lib/substack';
import { APP_NAME } from '@/lib/brand';
import type { View } from './App';
import { Icon, type IconName } from './icons';

export const PUB_DRAG = 'application/x-substack-pub';
const FOLDER_DRAG = 'application/x-substack-folder';

interface Props {
  library: Library;
  pubs: Publication[];
  pubsById: Map<number, Publication>;
  view: View;
  onView: (v: View) => void;
  mutate: (...ops: LibraryOp[]) => void;
  sync: LibraryDoc;
  fetchedAt: number;
  onRefresh: () => Promise<void>;
  onClearCache: () => Promise<void>;
}

export function Sidebar({ library, pubs, pubsById, view, onView, mutate, sync, fetchedAt, onRefresh, onClearCache }: Props) {
  const [adding, setAdding] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const live = (ids: number[]) => ids.filter((id) => pubsById.has(id));
  const unsortedCount = unsortedIds(library, pubs.map((p) => p.id)).length;

  const exportLibrary = () => {
    const blob = new Blob([JSON.stringify(library, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `substack-folders-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importLibrary = async (file: File) => {
    try {
      const next = parseLibrary(JSON.parse(await file.text()));
      if (confirm(`Replace your folders and pins with the ${next.folders.length} folders in “${file.name}”?`)) {
        mutate({ kind: 'replace', library: next });
      }
      setImportError(null);
    } catch (err) {
      setImportError(err instanceof SyntaxError ? 'That file is not valid JSON.' : (err as Error).message);
    }
  };

  return (
    <nav className="sidebar" aria-label="Folders">
      <div className="wordmark">
        {APP_NAME}
      </div>

      <div className="nav-group">
        <NavItem
          icon="pin"
          label="Pinned"
          count={live(library.pinned).length}
          active={view.kind === 'pinned'}
          onClick={() => onView({ kind: 'pinned' })}
          onDropPub={(id) => mutate({ kind: 'setPinned', pubId: id, pinned: true })}
        />
        <NavItem icon="all" label="All subscriptions" count={pubs.length} active={view.kind === 'all'} onClick={() => onView({ kind: 'all' })} />
        <NavItem icon="inbox" label="Unsorted" count={unsortedCount} active={view.kind === 'unsorted'} onClick={() => onView({ kind: 'unsorted' })} />
      </div>

      <div className="nav-heading">
        <span>Folders</span>
        <button className="icon-button small" title="New folder" onClick={() => setAdding(true)}>
          <Icon name="plus" size={14} />
        </button>
      </div>

      <ol className="folder-rack">
        {library.folders.map((folder, index) => (
          <FolderSlot
            key={folder.id}
            folder={folder}
            pubs={live(folder.pubIds).flatMap((id) => pubsById.get(id) ?? [])}
            active={view.kind === 'folder' && view.id === folder.id}
            onClick={() => onView({ kind: 'folder', id: folder.id })}
            onDropPub={(id) => mutate({ kind: 'addToFolder', folderId: folder.id, pubId: id })}
            onDropFolder={(id) => mutate({ kind: 'moveFolder', folderId: id, toIndex: index })}
          />
        ))}
        {adding && (
          <li>
            <NewFolderInput
              onDone={(name) => {
                setAdding(false);
                if (name) mutate({ kind: 'createFolder', id: newFolderId(), name });
              }}
            />
          </li>
        )}
        {library.folders.length === 0 && !adding && (
          <li className="rack-empty">
            <button className="text-button" onClick={() => setAdding(true)}>Create your first folder</button>
          </li>
        )}
      </ol>

      <footer className="sidebar-foot">
        <SyncStatus doc={sync} />
        <div className="synced">
          <span>Subscriptions updated {formatAgo(fetchedAt)}</span>
          <button
            className="icon-button small"
            title="Reload subscriptions from Substack"
            disabled={refreshing}
            onClick={async () => {
              setRefreshing(true);
              await onRefresh();
              setRefreshing(false);
            }}
          >
            <Icon name="refresh" size={14} />
          </button>
        </div>
        <div className="row">
          <button className="text-button" onClick={exportLibrary}>Export folders</button>
          <button className="text-button" onClick={() => fileInput.current?.click()}>Import</button>
          <button
            className="text-button"
            title="Delete the subscriptions and posts cached from Substack. Folders and pins are kept."
            onClick={() => {
              if (confirm('Delete the subscriptions and posts cached from Substack? Your folders and pins are kept, and your subscriptions will reload.')) {
                void onClearCache();
              }
            }}
          >
            Clear cache
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) importLibrary(file);
              e.target.value = '';
            }}
          />
        </div>
        {importError && <p className="foot-error">{importError}</p>}
      </footer>
    </nav>
  );
}

function SyncStatus({ doc }: { doc: LibraryDoc }) {
  if (doc.syncError) {
    return (
      <p className="sync-status error" role="status" title={doc.syncError}>
        Folder sync delayed. Your changes are saved in this browser and will sync when Chrome allows.
      </p>
    );
  }
  return (
    <p className="sync-status" role="status">
      {doc.dirty ? 'Saving folders…' : 'Folders saved'}
    </p>
  );
}

function useDropTarget(accepts: string[], onDrop: (type: string, value: string) => void) {
  const [over, setOver] = useState(false);
  const accepted = (e: DragEvent) => accepts.find((t) => e.dataTransfer.types.includes(t));
  return {
    over,
    handlers: {
      onDragOver: (e: DragEvent) => {
        if (!accepted(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setOver(true);
      },
      onDragLeave: (e: DragEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      },
      onDrop: (e: DragEvent) => {
        const type = accepted(e);
        setOver(false);
        if (!type) return;
        e.preventDefault();
        onDrop(type, e.dataTransfer.getData(type));
      },
    },
  };
}

function NavItem(props: {
  icon: IconName;
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  onDropPub?: (pubId: number) => void;
}) {
  const drop = useDropTarget(props.onDropPub ? [PUB_DRAG] : [], (_t, v) => props.onDropPub?.(Number(v)));
  return (
    <button
      className={`nav-item${props.active ? ' active' : ''}${drop.over ? ' drop' : ''}`}
      aria-current={props.active ? 'page' : undefined}
      onClick={props.onClick}
      {...drop.handlers}
    >
      <span className="nav-icon"><Icon name={props.icon} /></span>
      <span className="nav-label">{props.label}</span>
      <span className="nav-count">{props.count}</span>
    </button>
  );
}

function FolderSlot(props: {
  folder: Folder;
  pubs: Publication[];
  active: boolean;
  onClick: () => void;
  onDropPub: (pubId: number) => void;
  onDropFolder: (folderId: string) => void;
}) {
  const drop = useDropTarget([PUB_DRAG, FOLDER_DRAG], (type, value) => {
    if (type === PUB_DRAG) props.onDropPub(Number(value));
    else if (value !== props.folder.id) props.onDropFolder(value);
  });
  const logos = props.pubs.filter((p) => p.logoUrl).slice(0, 4);

  return (
    <li>
      <button
        className={`folder-slot${props.active ? ' active' : ''}${drop.over ? ' drop' : ''}`}
        aria-current={props.active ? 'page' : undefined}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(FOLDER_DRAG, props.folder.id);
          e.dataTransfer.effectAllowed = 'move';
        }}
        onClick={props.onClick}
        {...drop.handlers}
      >
        <span className="logo-stack" aria-hidden="true">
          {logos.length ? logos.map((p, i) => <img key={p.id} src={thumb(p.logoUrl!, 22)} alt="" style={{ '--i': i } as CSSProperties} />) : <Icon name="folder" />}
        </span>
        <span className="nav-label">{props.folder.name}</span>
        <span className="nav-count">{props.pubs.length}</span>
      </button>
    </li>
  );
}

function NewFolderInput({ onDone }: { onDone: (name: string | null) => void }) {
  const [name, setName] = useState('');
  // Submit, Escape and blur can all fire for one edit; only the first counts.
  const finished = useRef(false);
  const finish = (value: string | null) => {
    if (finished.current) return;
    finished.current = true;
    onDone(value?.trim() || null);
  };
  return (
    <form
      className="new-folder"
      onSubmit={(e) => {
        e.preventDefault();
        finish(name);
      }}
    >
      <input
        autoFocus
        placeholder="Folder name"
        aria-label="New folder name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => finish(name)}
        onKeyDown={(e) => e.key === 'Escape' && finish(null)}
      />
    </form>
  );
}

function formatAgo(ts: number): ReactNode {
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
