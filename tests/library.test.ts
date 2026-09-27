import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import * as lib from '@/lib/library';

const withFolders = (...names: string[]) => names.reduce(lib.createFolder, lib.emptyLibrary);

describe('library operations', () => {
  it('creates, renames and deletes folders', () => {
    let l = withFolders('Tech', ' Politics ');
    expect(l.folders.map((f) => f.name)).toEqual(['Tech', 'Politics']);
    l = lib.renameFolder(l, l.folders[0]!.id, 'AI');
    expect(l.folders[0]!.name).toBe('AI');
    l = lib.deleteFolder(l, l.folders[0]!.id);
    expect(l.folders.map((f) => f.name)).toEqual(['Politics']);
  });

  it('reorders folders and clamps the target index', () => {
    const l = withFolders('A', 'B', 'C');
    const [a, , c] = l.folders;
    expect(lib.moveFolder(l, c!.id, 0).folders.map((f) => f.name)).toEqual(['C', 'A', 'B']);
    expect(lib.moveFolder(l, a!.id, 99).folders.map((f) => f.name)).toEqual(['B', 'C', 'A']);
    expect(lib.moveFolder(l, 'missing', 0)).toBe(l);
  });

  it('lets a publication live in several folders without duplicates', () => {
    let l = withFolders('A', 'B');
    const [a, b] = l.folders.map((f) => f.id) as [string, string];
    l = lib.addToFolder(l, a, 1);
    l = lib.addToFolder(l, a, 1);
    l = lib.addToFolder(l, b, 1);
    expect(l.folders.map((f) => f.pubIds)).toEqual([[1], [1]]);
    l = lib.removeFromFolder(l, a, 1);
    expect(l.folders.map((f) => f.pubIds)).toEqual([[], [1]]);
  });

  it('toggles pins and computes unsorted publications', () => {
    let l = lib.togglePin(withFolders('A'), 7);
    expect(l.pinned).toEqual([7]);
    expect(lib.togglePin(l, 7).pinned).toEqual([]);
    l = lib.addToFolder(l, l.folders[0]!.id, 2);
    expect(lib.unsortedIds(l, [1, 2, 3])).toEqual([1, 3]);
  });

  it('validates imported files', () => {
    const l = lib.addToFolder(withFolders('A'), withFolders('A').folders[0]!.id, 1);
    expect(lib.parseLibrary(JSON.parse(JSON.stringify(l)))).toEqual(l);
    expect(() => lib.parseLibrary({ folders: 'nope', pinned: [] })).toThrow(/not a Substack Organizer export/);
    expect(() => lib.parseLibrary({ folders: [{ name: 'X', pubIds: ['a'] }], pinned: [] })).toThrow(/folder/);
  });
});

describe('library storage', () => {
  beforeEach(() => fakeBrowser.reset());

  it('round-trips through chrome.storage.sync with one key per folder', async () => {
    let l = withFolders('A', 'B');
    l = lib.addToFolder(l, l.folders[1]!.id, 42);
    l = lib.togglePin(l, 42);
    await lib.saveLibrary(l);

    const stored = await fakeBrowser.storage.sync.get(null);
    expect(Object.keys(stored).sort()).toEqual(['meta', ...l.folders.map((f) => `folder:${f.id}`)].sort());
    expect(await lib.loadLibrary()).toEqual(l);
  });

  it('removes keys for deleted folders', async () => {
    const l = withFolders('A', 'B');
    await lib.saveLibrary(l);
    await lib.saveLibrary(lib.deleteFolder(l, l.folders[0]!.id));
    const stored = await fakeBrowser.storage.sync.get(null);
    expect(Object.keys(stored)).not.toContain(`folder:${l.folders[0]!.id}`);
    expect((await lib.loadLibrary()).folders.map((f) => f.name)).toEqual(['B']);
  });

  it('loads an empty library on first run', async () => {
    expect(await lib.loadLibrary()).toEqual(lib.emptyLibrary);
  });
});
