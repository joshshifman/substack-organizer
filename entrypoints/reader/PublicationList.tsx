import { useEffect, useRef, useState } from 'react';
import * as lib from '@/lib/library';
import type { Library } from '@/lib/library';
import { thumb, type Publication } from '@/lib/substack';
import { Icon } from './icons';
import { PUB_DRAG } from './Sidebar';

interface Props {
  pubs: Publication[];
  library: Library;
  update: (fn: (l: Library) => Library) => void;
  /** The folder being viewed, if any. Its chip is omitted since it's implied. */
  currentFolderId: string | null;
}

export function PublicationList({ pubs, library, update, currentFolderId }: Props) {
  const [pickerFor, setPickerFor] = useState<number | null>(null);
  const pinned = new Set(library.pinned);

  if (pubs.length === 0) {
    return (
      <div className="empty">
        <h2>No publications match</h2>
        <p>Try a different filter.</p>
      </div>
    );
  }

  return (
    <>
      <p className="hint">Drag a publication onto a folder in the sidebar to file it, or use “Folders”.</p>
      <ul className="pubs">
        {pubs.map((pub) => {
          const folders = library.folders.filter((f) => f.pubIds.includes(pub.id));
          const isPinned = pinned.has(pub.id);
          return (
            <li
              key={pub.id}
              className="pub"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(PUB_DRAG, String(pub.id));
                e.dataTransfer.effectAllowed = 'copyMove';
              }}
            >
              {pub.logoUrl ? <img className="logo" src={thumb(pub.logoUrl, 40)} alt="" loading="lazy" /> : <span className="logo placeholder">{pub.name[0]}</span>}
              <div className="pub-text">
                <a className="pub-name" href={pub.url} target="_blank" rel="noreferrer">{pub.name}</a>
                <span className="pub-author">
                  {pub.authorName}
                  {pub.paid && <span className="badge">Paid</span>}
                </span>
              </div>
              <div className="chips">
                {folders
                  .filter((f) => f.id !== currentFolderId)
                  .map((f) => (
                    <span key={f.id} className="chip">
                      {f.name}
                      <button
                        title={`Remove from ${f.name}`}
                        aria-label={`Remove ${pub.name} from ${f.name}`}
                        onClick={() => update((l) => lib.removeFromFolder(l, f.id, pub.id))}
                      >
                        <Icon name="x" size={11} />
                      </button>
                    </span>
                  ))}
              </div>
              <div className="pub-actions">
                {currentFolderId && (
                  <button className="text-button" onClick={() => update((l) => lib.removeFromFolder(l, currentFolderId, pub.id))}>
                    Remove
                  </button>
                )}
                <div className="picker-anchor">
                  <button
                    className="button small"
                    aria-expanded={pickerFor === pub.id}
                    onClick={() => setPickerFor(pickerFor === pub.id ? null : pub.id)}
                  >
                    <Icon name="folder" size={14} /> Folders
                  </button>
                  {pickerFor === pub.id && (
                    <FolderPicker pubId={pub.id} library={library} update={update} onClose={() => setPickerFor(null)} />
                  )}
                </div>
                <button
                  className={`pin-toggle${isPinned ? ' on' : ''}`}
                  aria-pressed={isPinned}
                  title={isPinned ? 'Unpin' : 'Pin to top'}
                  onClick={() => update((l) => lib.togglePin(l, pub.id))}
                >
                  <Icon name="pin" />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function FolderPicker({ pubId, library, update, onClose }: { pubId: number; library: Library; update: Props['update']; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [name, setName] = useState('');

  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div className="picker" ref={ref} role="dialog" aria-label="Choose folders">
      {library.folders.map((f) => {
        const checked = f.pubIds.includes(pubId);
        return (
          <label key={f.id} className="picker-row">
            <input
              type="checkbox"
              checked={checked}
              onChange={() => update((l) => (checked ? lib.removeFromFolder(l, f.id, pubId) : lib.addToFolder(l, f.id, pubId)))}
            />
            <span>{f.name}</span>
          </label>
        );
      })}
      <form
        className="picker-new"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          update((l) => {
            const withFolder = lib.createFolder(l, name);
            return lib.addToFolder(withFolder, withFolder.folders.at(-1)!.id, pubId);
          });
          setName('');
        }}
      >
        <input placeholder="New folder" aria-label="New folder name" value={name} onChange={(e) => setName(e.target.value)} autoFocus={library.folders.length === 0} />
        <button className="icon-button small" type="submit" title="Create folder" disabled={!name.trim()}>
          <Icon name="plus" size={14} />
        </button>
      </form>
    </div>
  );
}
