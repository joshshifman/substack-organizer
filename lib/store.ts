// The single writer for the user's library. Runs in the background service worker.
//
// Reader tabs send ops (see library.ts); the store applies them in arrival order to
// the latest state, so concurrent edits from several tabs can't overwrite each
// other. Every accepted edit is written immediately to `libraryDoc` in
// chrome.storage.local, which is the durable working copy readers watch. Writes to
// chrome.storage.sync are batched and throttled to stay inside Chrome's quotas; if
// the worker stops before syncing, the next start finds `dirty: true` and resumes.
//
// Across devices, the last device to sync wins.

import { applyOps, emptyLibrary, type Folder, type Library, type LibraryOp } from './library';

export const DOC_KEY = 'libraryDoc';

export interface LibraryDoc {
  library: Library;
  /** Increases with every change, so readers can ignore out-of-order updates. */
  version: number;
  /** True while local edits haven't reached chrome.storage.sync yet. */
  dirty: boolean;
  /** Why the last sync attempt failed, if it did. Edits are still kept locally. */
  syncError: string | null;
}

// ── Sync storage format ──────────────────────────────────────────────────────
// Each folder gets its own key so no single item nears the 8 KB per-item limit;
// `meta` holds folder order and pins. (Same format as v0.1.0.)

const META_KEY = 'meta';
const FOLDER_PREFIX = 'folder:';
const folderKey = (id: string) => `${FOLDER_PREFIX}${id}`;

interface Meta {
  v: 1;
  folderOrder: string[];
  pinned: number[];
}

/** chrome.storage.sync quotas, with a little headroom on the byte limits. */
export const SYNC_LIMITS = { bytesPerItem: 8192 - 64, totalBytes: 102_400 - 512, maxItems: 512 };

export class LibraryLimitError extends Error {}

export function toSyncItems(lib: Library): Record<string, unknown> {
  const meta: Meta = { v: 1, folderOrder: lib.folders.map((f) => f.id), pinned: lib.pinned };
  const items: Record<string, unknown> = { [META_KEY]: meta };
  for (const f of lib.folders) items[folderKey(f.id)] = { name: f.name, pubIds: f.pubIds };
  return items;
}

export function fromSyncItems(all: Record<string, unknown>): Library {
  const meta = all[META_KEY] as Meta | undefined;
  if (!meta || !Array.isArray(meta.folderOrder)) return emptyLibrary;
  const folders = meta.folderOrder.flatMap((id): Folder[] => {
    const stored = all[folderKey(id)] as { name?: unknown; pubIds?: unknown } | undefined;
    if (typeof stored?.name !== 'string' || !Array.isArray(stored.pubIds)) return [];
    return [{ id, name: stored.name, pubIds: stored.pubIds.filter(Number.isSafeInteger) }];
  });
  return { folders, pinned: Array.isArray(meta.pinned) ? meta.pinned.filter(Number.isSafeInteger) : [] };
}

const byteLength = (s: string) => new TextEncoder().encode(s).length;

/** Throws a LibraryLimitError, in user-facing words, if `lib` won't fit in sync storage. */
export function checkSyncLimits(lib: Library): void {
  const items = toSyncItems(lib);
  if (Object.keys(items).length > SYNC_LIMITS.maxItems) {
    throw new LibraryLimitError(`You can have at most ${SYNC_LIMITS.maxItems - 1} folders.`);
  }
  let total = 0;
  for (const [key, value] of Object.entries(items)) {
    const size = byteLength(key) + byteLength(JSON.stringify(value));
    total += size;
    if (size <= SYNC_LIMITS.bytesPerItem) continue;
    if (key === META_KEY) {
      throw new LibraryLimitError('You have too many pinned publications and folders to sync. Unpin some publications first.');
    }
    const folder = lib.folders.find((f) => folderKey(f.id) === key);
    throw new LibraryLimitError(`“${folder?.name}” is full. A folder can hold about 1,000 publications.`);
  }
  if (total > SYNC_LIMITS.totalBytes) {
    throw new LibraryLimitError('Your folders have outgrown Chrome’s 100 KB sync storage. Remove some publications from folders first.');
  }
}

const sameLibrary = (a: Library, b: Library) => JSON.stringify(a) === JSON.stringify(b);

// ── Store ────────────────────────────────────────────────────────────────────

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export interface StoreOptions {
  /** Wait this long after the last edit before syncing. */
  debounceMs: number;
  /** But never hold edits longer than this. */
  maxWaitMs: number;
  /** Retry delay after a failed sync. */
  retryMs: number;
  /** Write budget. Chrome allows 120 writes/minute and 1,800/hour. */
  writesPerMinute: number;
  writesPerHour: number;
}

const defaults: StoreOptions = { debounceMs: 1000, maxWaitMs: 5000, retryMs: MINUTE, writesPerMinute: 100, writesPerHour: 1500 };

export class LibraryStore {
  private library: Library = emptyLibrary;
  private version = 0;
  private dirty = false;
  private syncError: string | null = null;
  private loading: Promise<void> | null = null;
  private localWrites: Promise<void> = Promise.resolve();
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private dirtySince = 0;
  private flushing = false;
  private writeTimes: number[] = [];
  private readonly opts: StoreOptions;

  constructor(options: Partial<StoreOptions> = {}) {
    this.opts = { ...defaults, ...options };
    // Start loading right away so a worker woken by any event resumes pending syncs.
    this.ready().catch((err) => console.warn('Could not load folders', err));
  }

  /** Loads once; a failed load is retried on the next call. */
  ready(): Promise<void> {
    this.loading ??= this.load().catch((err) => {
      this.loading = null;
      throw err;
    });
    return this.loading;
  }

  async getDoc(): Promise<LibraryDoc> {
    await this.ready();
    return this.doc();
  }

  /** Applies `ops` atomically. Throws, leaving the library unchanged, if they're invalid or won't fit. */
  async mutate(ops: LibraryOp[]): Promise<LibraryDoc> {
    await this.ready();
    // Synchronous from here to the assignment: concurrent calls apply in order.
    const next = applyOps(this.library, ops);
    if (sameLibrary(next, this.library)) return this.doc();
    checkSyncLimits(next);
    this.library = next;
    this.version++;
    this.dirty = true;
    this.dirtySince ||= Date.now();
    this.scheduleFlush();
    await this.persistLocal();
    return this.doc();
  }

  /** Called when chrome.storage.sync changes, e.g. from another device. */
  async onSyncChanged(): Promise<void> {
    await this.ready().catch(() => {});
    // Local edits win; they'll overwrite sync on the next flush.
    if (this.dirty || this.flushing) return;
    const version = this.version;
    const remote = fromSyncItems(await browser.storage.sync.get(null));
    if (this.dirty || this.flushing || this.version !== version || sameLibrary(remote, this.library)) return;
    this.library = remote;
    this.version++;
    await this.persistLocal();
  }

  /** Writes pending edits to chrome.storage.sync now, within the write budget. */
  async flush(): Promise<void> {
    clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
    if (!this.dirty || this.flushing) return;
    const wait = this.budgetWait(2);
    if (wait > 0) return this.scheduleFlush(wait);

    this.flushing = true;
    const version = this.version;
    const items = toSyncItems(this.library);
    try {
      const existing = await browser.storage.sync.get(null);
      const stale = Object.keys(existing).filter((k) => k.startsWith(FOLDER_PREFIX) && !(k in items));
      const changed = Object.fromEntries(
        Object.entries(items).filter(([k, v]) => JSON.stringify(existing[k]) !== JSON.stringify(v)),
      );
      // Remove deleted folders first, so replacing everything (an import) never
      // needs room for the old and new folders at the same time.
      if (stale.length) {
        this.writeTimes.push(Date.now());
        await browser.storage.sync.remove(stale);
      }
      if (Object.keys(changed).length) {
        this.writeTimes.push(Date.now());
        await browser.storage.sync.set(changed);
      }
      this.syncError = null;
      if (this.version === version) {
        this.dirty = false;
        this.dirtySince = 0;
      }
    } catch (err) {
      this.syncError = (err as Error).message || String(err);
    } finally {
      this.flushing = false;
    }
    await this.persistLocal().catch((err) => console.warn('Could not save folders locally', err));
    if (this.syncError) this.scheduleFlush(this.opts.retryMs);
    else if (this.dirty) this.scheduleFlush();
  }

  private doc(): LibraryDoc {
    return { library: this.library, version: this.version, dirty: this.dirty, syncError: this.syncError };
  }

  private async load(): Promise<void> {
    const local = (await browser.storage.local.get(DOC_KEY))[DOC_KEY] as LibraryDoc | undefined;
    if (local) {
      this.library = local.library;
      this.version = local.version;
    }
    if (local?.dirty) {
      // Edits from a previous worker that never reached sync.
      this.dirty = true;
      this.dirtySince = Date.now();
      this.scheduleFlush(0);
      return;
    }
    let remote: Library;
    try {
      remote = fromSyncItems(await browser.storage.sync.get(null));
    } catch (err) {
      if (local) return; // Keep the local copy if sync can't be read.
      throw err;
    }
    if (!local || !sameLibrary(remote, this.library)) {
      this.library = remote;
      this.version++;
      await this.persistLocal();
    }
  }

  /** Queues a write of the current state; writes land in the order they were queued. */
  private persistLocal(): Promise<void> {
    const snapshot = this.doc();
    this.localWrites = this.localWrites.catch(() => {}).then(() => browser.storage.local.set({ [DOC_KEY]: snapshot }));
    return this.localWrites;
  }

  private scheduleFlush(delay?: number): void {
    const now = Date.now();
    const due = delay ?? Math.max(0, Math.min(this.opts.debounceMs, this.dirtySince + this.opts.maxWaitMs - now));
    clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => void this.flush(), due);
  }

  /** Milliseconds until `needed` more writes fit in both budget windows. */
  private budgetWait(needed: number): number {
    const now = Date.now();
    this.writeTimes = this.writeTimes.filter((t) => now - t < HOUR);
    const waitFor = (windowMs: number, limit: number) => {
      const recent = this.writeTimes.filter((t) => now - t < windowMs);
      const excess = recent.length + needed - limit;
      return excess <= 0 ? 0 : recent[excess - 1]! + windowMs - now;
    };
    return Math.max(waitFor(MINUTE, this.opts.writesPerMinute), waitFor(HOUR, this.opts.writesPerHour));
  }
}
