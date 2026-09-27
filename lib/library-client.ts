// Reader-side access to the library owned by the background worker (store.ts).

import type { LibraryOp } from './library';
import { DOC_KEY, type LibraryDoc } from './store';

export type LibraryMessage = { type: 'library/get' } | { type: 'library/mutate'; ops: LibraryOp[] };
export type LibraryResponse = { ok: true; doc: LibraryDoc } | { ok: false; error: string };

async function send(message: LibraryMessage): Promise<LibraryDoc> {
  const response = (await browser.runtime.sendMessage(message)) as LibraryResponse | undefined;
  if (!response) throw new Error('The extension’s background worker didn’t respond. Reload the page.');
  if (!response.ok) throw new Error(response.error);
  return response.doc;
}

export const getLibraryDoc = () => send({ type: 'library/get' });

/** Applies ops in the background. Rejects with a user-facing message if they can't be saved. */
export const mutateLibrary = (ops: LibraryOp[]) => send({ type: 'library/mutate', ops });

/** Calls back with every new version of the library, from this tab's edits or anyone else's. */
export function watchLibraryDoc(callback: (doc: LibraryDoc) => void): () => void {
  const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    const doc = changes[DOC_KEY]?.newValue as LibraryDoc | undefined;
    if (area === 'local' && doc) callback(doc);
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
