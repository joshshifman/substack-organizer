// The user's organization: folders of publications plus pinned publications.
// This is the only state the extension owns; everything else comes from Substack.
// Operations are pure (Library in, Library out); storage is at the bottom.

export interface Folder {
  id: string;
  name: string;
  /** Publication ids. A publication can be in any number of folders. */
  pubIds: number[];
}

export interface Library {
  /** In display order. */
  folders: Folder[];
  pinned: number[];
}

export const emptyLibrary: Library = { folders: [], pinned: [] };

const newId = () => Math.random().toString(36).slice(2, 10);

export function createFolder(lib: Library, name: string): Library {
  return { ...lib, folders: [...lib.folders, { id: newId(), name: name.trim(), pubIds: [] }] };
}

export function renameFolder(lib: Library, folderId: string, name: string): Library {
  return mapFolder(lib, folderId, (f) => ({ ...f, name: name.trim() }));
}

export function deleteFolder(lib: Library, folderId: string): Library {
  return { ...lib, folders: lib.folders.filter((f) => f.id !== folderId) };
}

/** Moves a folder to `toIndex` in the display order. */
export function moveFolder(lib: Library, folderId: string, toIndex: number): Library {
  const folder = lib.folders.find((f) => f.id === folderId);
  if (!folder) return lib;
  const folders = lib.folders.filter((f) => f !== folder);
  folders.splice(Math.max(0, Math.min(toIndex, folders.length)), 0, folder);
  return { ...lib, folders };
}

export function addToFolder(lib: Library, folderId: string, pubId: number): Library {
  return mapFolder(lib, folderId, (f) =>
    f.pubIds.includes(pubId) ? f : { ...f, pubIds: [...f.pubIds, pubId] },
  );
}

export function removeFromFolder(lib: Library, folderId: string, pubId: number): Library {
  return mapFolder(lib, folderId, (f) => ({ ...f, pubIds: f.pubIds.filter((id) => id !== pubId) }));
}

export function togglePin(lib: Library, pubId: number): Library {
  const pinned = lib.pinned.includes(pubId)
    ? lib.pinned.filter((id) => id !== pubId)
    : [...lib.pinned, pubId];
  return { ...lib, pinned };
}

/** Publications that are in no folder. */
export function unsortedIds(lib: Library, allIds: number[]): number[] {
  const sorted = new Set(lib.folders.flatMap((f) => f.pubIds));
  return allIds.filter((id) => !sorted.has(id));
}

function mapFolder(lib: Library, folderId: string, fn: (f: Folder) => Folder): Library {
  return { ...lib, folders: lib.folders.map((f) => (f.id === folderId ? fn(f) : f)) };
}

/** Validates untrusted JSON (an import file) into a Library, or throws. */
export function parseLibrary(value: unknown): Library {
  const v = value as any;
  const isIds = (x: unknown) => Array.isArray(x) && x.every((n) => Number.isInteger(n));
  if (!v || !Array.isArray(v.folders) || !isIds(v.pinned)) {
    throw new Error('This file is not a Substack Organizer export.');
  }
  const folders = v.folders.map((f: any) => {
    if (typeof f?.name !== 'string' || !isIds(f.pubIds)) {
      throw new Error('This file has a folder without a name or publication list.');
    }
    return { id: typeof f.id === 'string' ? f.id : newId(), name: f.name, pubIds: f.pubIds };
  });
  return { folders, pinned: v.pinned };
}

// ── Storage ──────────────────────────────────────────────────────────────────
// chrome.storage.sync follows the user across Chrome installs but caps each key
// at 8 KB, so each folder gets its own key and `meta` holds order and pins.

const META_KEY = 'meta';
const folderKey = (id: string) => `folder:${id}`;

interface Meta {
  v: 1;
  folderOrder: string[];
  pinned: number[];
}

export async function loadLibrary(): Promise<Library> {
  const all = await browser.storage.sync.get(null);
  const meta = all[META_KEY] as Meta | undefined;
  if (!meta) return emptyLibrary;
  const folders = meta.folderOrder.flatMap((id) => {
    const stored = all[folderKey(id)] as Omit<Folder, 'id'> | undefined;
    return stored ? [{ id, name: stored.name, pubIds: stored.pubIds }] : [];
  });
  return { folders, pinned: meta.pinned };
}

export async function saveLibrary(lib: Library): Promise<void> {
  const meta: Meta = { v: 1, folderOrder: lib.folders.map((f) => f.id), pinned: lib.pinned };
  const items: Record<string, unknown> = { [META_KEY]: meta };
  for (const f of lib.folders) items[folderKey(f.id)] = { name: f.name, pubIds: f.pubIds };

  const existing = Object.keys(await browser.storage.sync.get(null));
  const stale = existing.filter((k) => k.startsWith('folder:') && !(k in items));
  await browser.storage.sync.set(items);
  if (stale.length) await browser.storage.sync.remove(stale);
}

export function onLibraryChanged(callback: () => void): () => void {
  const listener = (_changes: unknown, area: string) => {
    if (area === 'sync') callback();
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
