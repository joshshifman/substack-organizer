// The user's organization: folders of publications plus pinned publications.
// This is the only state the extension owns; everything else comes from Substack.
// Everything here is pure. Persistence lives in store.ts (background worker).

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

export const MAX_FOLDER_NAME = 80;

export const newFolderId = () => Math.random().toString(36).slice(2, 10);

/**
 * An edit, sent from the reader to the background worker. Ops are applied to the
 * latest library in order, so they describe intent ("pin 42") rather than a new
 * snapshot, and applying one twice has the same effect as once.
 */
export type LibraryOp =
  | { kind: 'createFolder'; id: string; name: string }
  | { kind: 'renameFolder'; folderId: string; name: string }
  | { kind: 'deleteFolder'; folderId: string }
  | { kind: 'moveFolder'; folderId: string; toIndex: number }
  | { kind: 'addToFolder'; folderId: string; pubId: number }
  | { kind: 'removeFromFolder'; folderId: string; pubId: number }
  | { kind: 'setPinned'; pubId: number; pinned: boolean }
  | { kind: 'replace'; library: Library };

export function applyOp(lib: Library, op: LibraryOp): Library {
  switch (op.kind) {
    case 'createFolder': {
      if (lib.folders.some((f) => f.id === op.id)) return lib;
      return { ...lib, folders: [...lib.folders, { id: op.id, name: cleanName(op.name), pubIds: [] }] };
    }
    case 'renameFolder':
      return mapFolder(lib, op.folderId, (f) => ({ ...f, name: cleanName(op.name) }));
    case 'deleteFolder':
      return { ...lib, folders: lib.folders.filter((f) => f.id !== op.folderId) };
    case 'moveFolder': {
      const folder = lib.folders.find((f) => f.id === op.folderId);
      if (!folder) return lib;
      const folders = lib.folders.filter((f) => f !== folder);
      folders.splice(Math.max(0, Math.min(op.toIndex, folders.length)), 0, folder);
      return { ...lib, folders };
    }
    case 'addToFolder':
      return mapFolder(lib, op.folderId, (f) => (f.pubIds.includes(op.pubId) ? f : { ...f, pubIds: [...f.pubIds, op.pubId] }));
    case 'removeFromFolder':
      return mapFolder(lib, op.folderId, (f) => ({ ...f, pubIds: f.pubIds.filter((id) => id !== op.pubId) }));
    case 'setPinned': {
      const has = lib.pinned.includes(op.pubId);
      if (has === op.pinned) return lib;
      return { ...lib, pinned: op.pinned ? [...lib.pinned, op.pubId] : lib.pinned.filter((id) => id !== op.pubId) };
    }
    case 'replace':
      return parseLibrary(op.library);
  }
}

export const applyOps = (lib: Library, ops: LibraryOp[]) => ops.reduce(applyOp, lib);

/** Publications that are in no folder. */
export function unsortedIds(lib: Library, allIds: number[]): number[] {
  const sorted = new Set(lib.folders.flatMap((f) => f.pubIds));
  return allIds.filter((id) => !sorted.has(id));
}

function mapFolder(lib: Library, folderId: string, fn: (f: Folder) => Folder): Library {
  return { ...lib, folders: lib.folders.map((f) => (f.id === folderId ? fn(f) : f)) };
}

function cleanName(name: string): string {
  const trimmed = name.trim().slice(0, MAX_FOLDER_NAME);
  if (!trimmed) throw new Error('Folder names can’t be empty.');
  return trimmed;
}

const isPubId = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) > 0;
const uniqueIds = (xs: unknown): number[] | null =>
  Array.isArray(xs) && xs.every(isPubId) ? [...new Set(xs)] : null;

/**
 * Validates untrusted JSON (an import file) into a Library, or throws. Folder ids
 * become storage keys, so duplicates are rejected rather than silently merged.
 */
export function parseLibrary(value: unknown): Library {
  const v = value as any;
  const pinned = uniqueIds(v?.pinned);
  if (!v || !Array.isArray(v.folders) || !pinned) {
    throw new Error('This file is not a folders export from this extension.');
  }
  const seen = new Set<string>();
  const folders = v.folders.map((f: any): Folder => {
    const pubIds = uniqueIds(f?.pubIds);
    if (typeof f?.name !== 'string' || !f.name.trim() || !pubIds) {
      throw new Error('This file has a folder without a name or publication list.');
    }
    const id = typeof f.id === 'string' && /^[a-z0-9]{1,32}$/i.test(f.id) ? f.id : newFolderId();
    if (seen.has(id)) throw new Error(`This file has two folders with the id “${id}”.`);
    seen.add(id);
    return { id, name: cleanName(f.name), pubIds };
  });
  return { folders, pinned };
}
