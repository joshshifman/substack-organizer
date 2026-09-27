import { describe, expect, it } from 'vitest';
import { applyOps, emptyLibrary, parseLibrary, unsortedIds, type LibraryOp } from '@/lib/library';

const create = (id: string, name = id): LibraryOp => ({ kind: 'createFolder', id, name });
const run = (...ops: LibraryOp[]) => applyOps(emptyLibrary, ops);

describe('library ops', () => {
  it('creates, renames and deletes folders', () => {
    let l = run(create('a', 'Tech'), create('b', ' Politics '));
    expect(l.folders.map((f) => f.name)).toEqual(['Tech', 'Politics']);
    l = applyOps(l, [{ kind: 'renameFolder', folderId: 'a', name: 'AI' }, { kind: 'deleteFolder', folderId: 'b' }]);
    expect(l.folders).toEqual([{ id: 'a', name: 'AI', pubIds: [] }]);
  });

  it('rejects empty folder names and ignores a repeated create', () => {
    expect(() => run(create('a', '   '))).toThrow(/can’t be empty/);
    expect(run(create('a', 'One'), create('a', 'Two')).folders.map((f) => f.name)).toEqual(['One']);
  });

  it('reorders folders and clamps the target index', () => {
    const l = run(create('a'), create('b'), create('c'));
    const order = (op: LibraryOp) => applyOps(l, [op]).folders.map((f) => f.id);
    expect(order({ kind: 'moveFolder', folderId: 'c', toIndex: 0 })).toEqual(['c', 'a', 'b']);
    expect(order({ kind: 'moveFolder', folderId: 'a', toIndex: 99 })).toEqual(['b', 'c', 'a']);
    expect(applyOps(l, [{ kind: 'moveFolder', folderId: 'missing', toIndex: 0 }])).toBe(l);
  });

  it('lets a publication live in several folders without duplicates', () => {
    let l = run(create('a'), create('b'));
    l = applyOps(l, [
      { kind: 'addToFolder', folderId: 'a', pubId: 1 },
      { kind: 'addToFolder', folderId: 'a', pubId: 1 },
      { kind: 'addToFolder', folderId: 'b', pubId: 1 },
    ]);
    expect(l.folders.map((f) => f.pubIds)).toEqual([[1], [1]]);
    l = applyOps(l, [{ kind: 'removeFromFolder', folderId: 'a', pubId: 1 }]);
    expect(l.folders.map((f) => f.pubIds)).toEqual([[], [1]]);
  });

  it('pins idempotently and computes unsorted publications', () => {
    const pin = (pubId: number, pinned: boolean): LibraryOp => ({ kind: 'setPinned', pubId, pinned });
    let l = run(pin(7, true), pin(7, true));
    expect(l.pinned).toEqual([7]);
    expect(applyOps(l, [pin(7, false), pin(7, false)]).pinned).toEqual([]);
    l = applyOps(l, [create('a'), { kind: 'addToFolder', folderId: 'a', pubId: 2 }]);
    expect(unsortedIds(l, [1, 2, 3])).toEqual([1, 3]);
  });
});

describe('parseLibrary (imports)', () => {
  it('round-trips an export', () => {
    const l = run(create('a', 'A'), { kind: 'addToFolder', folderId: 'a', pubId: 1 }, { kind: 'setPinned', pubId: 1, pinned: true });
    expect(parseLibrary(JSON.parse(JSON.stringify(l)))).toEqual(l);
  });

  it('rejects files that are not exports', () => {
    expect(() => parseLibrary({ folders: 'nope', pinned: [] })).toThrow(/not a Substack Organizer export/);
    expect(() => parseLibrary({ folders: [{ name: 'X', pubIds: ['a'] }], pinned: [] })).toThrow(/folder/);
    expect(() => parseLibrary({ folders: [{ name: 'X', pubIds: [-1] }], pinned: [] })).toThrow(/folder/);
  });

  it('rejects duplicate folder ids instead of merging them', () => {
    const file = { folders: [{ id: 'x', name: 'One', pubIds: [] }, { id: 'x', name: 'Two', pubIds: [] }], pinned: [] };
    expect(() => parseLibrary(file)).toThrow(/two folders with the id “x”/);
  });

  it('removes duplicate publications and pins', () => {
    expect(parseLibrary({ folders: [{ id: 'a', name: 'A', pubIds: [1, 1, 2] }], pinned: [3, 3] })).toEqual({
      folders: [{ id: 'a', name: 'A', pubIds: [1, 2] }],
      pinned: [3],
    });
  });
});
