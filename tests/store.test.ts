import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { LibraryOp } from '@/lib/library';
import { DOC_KEY, fromSyncItems, LibraryStore, toSyncItems, type LibraryDoc } from '@/lib/store';

const create = (id: string, name = id): LibraryOp => ({ kind: 'createFolder', id, name });
const add = (folderId: string, pubId: number): LibraryOp => ({ kind: 'addToFolder', folderId, pubId });
const pin = (pubId: number): LibraryOp => ({ kind: 'setPinned', pubId, pinned: true });

const syncLibrary = async () => fromSyncItems(await fakeBrowser.storage.sync.get(null));
const localDoc = async () => (await fakeBrowser.storage.local.get(DOC_KEY))[DOC_KEY] as LibraryDoc;

/** Makes the next sync.set wait until the returned function is called. */
function holdNextSyncSet() {
  const realSet = fakeBrowser.storage.sync.set.bind(fakeBrowser.storage.sync);
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  vi.spyOn(fakeBrowser.storage.sync, 'set').mockImplementationOnce(async (items) => {
    await gate;
    return realSet(items);
  });
  return release;
}

beforeEach(() => {
  fakeBrowser.reset();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('LibraryStore', () => {
  it('saves every edit locally at once and syncs them together after a pause', async () => {
    const store = new LibraryStore();
    const setSpy = vi.spyOn(fakeBrowser.storage.sync, 'set');
    await store.mutate([create('a', 'Tech')]);
    await store.mutate([add('a', 1)]);
    await store.mutate([pin(1)]);

    expect((await localDoc()).library).toEqual({ folders: [{ id: 'a', name: 'Tech', pubIds: [1] }], pinned: [1] });
    expect((await localDoc()).dirty).toBe(true);
    expect(setSpy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(await syncLibrary()).toEqual((await localDoc()).library);
    expect((await localDoc()).dirty).toBe(false);
  });

  it('keeps edits sent at the same time from different tabs', async () => {
    const store = new LibraryStore();
    await store.mutate([create('a')]);
    await Promise.all([store.mutate([pin(1)]), store.mutate([add('a', 2)]), store.mutate([pin(3)])]);
    const { library } = await store.getDoc();
    expect(library.pinned).toEqual([1, 3]);
    expect(library.folders[0]!.pubIds).toEqual([2]);
  });

  it('keeps an edit made while a sync is in flight, and syncs it next', async () => {
    const store = new LibraryStore();
    await store.mutate([create('a')]);
    const release = holdNextSyncSet();
    await vi.advanceTimersByTimeAsync(1000); // Flush starts and blocks in sync.set.

    await store.mutate([pin(9)]); // Edit during the flush.
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect((await store.getDoc()).dirty).toBe(true); // The flushed snapshot didn't include pin 9.

    await vi.advanceTimersByTimeAsync(1000);
    expect((await syncLibrary()).pinned).toEqual([9]);
    expect((await store.getDoc()).dirty).toBe(false);
  });

  it('ignores sync changes while it has unsynced edits, and applies them otherwise', async () => {
    const store = new LibraryStore();
    await store.mutate([pin(1)]);
    await fakeBrowser.storage.sync.set(toSyncItems({ folders: [], pinned: [99] })); // Another device.
    await store.onSyncChanged();
    expect((await store.getDoc()).library.pinned).toEqual([1]);

    await vi.advanceTimersByTimeAsync(1000); // Our edit wins the sync.
    expect((await syncLibrary()).pinned).toEqual([1]);

    await fakeBrowser.storage.sync.set(toSyncItems({ folders: [], pinned: [1, 42] }));
    await store.onSyncChanged();
    const doc = await store.getDoc();
    expect(doc.library.pinned).toEqual([1, 42]);
    expect((await localDoc()).version).toBe(doc.version);
  });

  it('rejects an edit that would not fit in sync storage and leaves the library unchanged', async () => {
    const store = new LibraryStore();
    await store.mutate([create('a', 'Everything')]);
    const before = await store.getDoc();
    const tooMany = Array.from({ length: 1200 }, (_, i) => add('a', 1_000_000 + i));
    await expect(store.mutate(tooMany)).rejects.toThrow(/“Everything” is full/);
    expect(await store.getDoc()).toEqual(before);
  });

  it('rejects an import larger than the total sync quota', async () => {
    const store = new LibraryStore();
    const folders = Array.from({ length: 20 }, (_, f) => ({
      id: `f${f}`,
      name: `Folder ${f}`,
      pubIds: Array.from({ length: 700 }, (_, i) => 1_000_000 + f * 1000 + i),
    }));
    await expect(store.mutate([{ kind: 'replace', library: { folders, pinned: [] } }])).rejects.toThrow(/outgrown/);
  });

  it('removes deleted folders from sync before writing new ones', async () => {
    const store = new LibraryStore();
    await store.mutate([create('old')]);
    await vi.advanceTimersByTimeAsync(1000);

    const calls: string[] = [];
    vi.spyOn(fakeBrowser.storage.sync, 'remove').mockImplementation(async () => void calls.push('remove'));
    vi.spyOn(fakeBrowser.storage.sync, 'set').mockImplementation(async () => void calls.push('set'));
    await store.mutate([{ kind: 'replace', library: { folders: [{ id: 'new', name: 'New', pubIds: [] }], pinned: [] } }]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toEqual(['remove', 'set']);
  });

  it('resumes syncing edits left by a worker that stopped before syncing', async () => {
    const doc: LibraryDoc = { library: { folders: [], pinned: [5] }, version: 3, dirty: true, syncError: null };
    await fakeBrowser.storage.local.set({ [DOC_KEY]: doc });
    const store = new LibraryStore();
    await store.ready();
    await vi.advanceTimersByTimeAsync(0);
    expect((await syncLibrary()).pinned).toEqual([5]);
    expect((await store.getDoc()).version).toBe(3);
  });

  it('loads folders saved by an earlier version from sync', async () => {
    await fakeBrowser.storage.sync.set(toSyncItems({ folders: [{ id: 'a', name: 'A', pubIds: [1] }], pinned: [1] }));
    const doc = await new LibraryStore().getDoc();
    expect(doc.library.folders[0]!.name).toBe('A');
    expect(doc.dirty).toBe(false);
  });

  it('reports a failed sync, keeps the edits, and retries', async () => {
    const store = new LibraryStore();
    vi.spyOn(fakeBrowser.storage.sync, 'set').mockRejectedValueOnce(new Error('MAX_WRITE_OPERATIONS_PER_MINUTE quota exceeded'));
    await store.mutate([pin(1)]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await localDoc()).toMatchObject({ dirty: true, syncError: expect.stringMatching(/MAX_WRITE/) });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(await localDoc()).toMatchObject({ dirty: false, syncError: null });
    expect((await syncLibrary()).pinned).toEqual([1]);
  });

  it('stays inside the write budget', async () => {
    const store = new LibraryStore({ writesPerMinute: 2 });
    const setSpy = vi.spyOn(fakeBrowser.storage.sync, 'set');
    await store.mutate([pin(1)]);
    await vi.advanceTimersByTimeAsync(1000); // Write 1.
    await store.mutate([pin(2)]);
    await vi.advanceTimersByTimeAsync(1000); // Would be write 2 of 2 plus a possible remove: must wait.
    expect(setSpy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(setSpy).toHaveBeenCalledTimes(2);
    expect((await syncLibrary()).pinned).toEqual([1, 2]);
  });
});
