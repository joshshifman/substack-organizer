import type { LibraryMessage, LibraryResponse } from '@/lib/library-client';
import { LibraryStore } from '@/lib/store';

export default defineBackground(() => {
  const store = new LibraryStore();

  // Reader tabs read and edit the library only through these messages.
  browser.runtime.onMessage.addListener((message: LibraryMessage, _sender, sendResponse: (r: LibraryResponse) => void) => {
    const run =
      message?.type === 'library/get' ? store.getDoc() : message?.type === 'library/mutate' ? store.mutate(message.ops) : null;
    if (!run) return;
    run.then(
      (doc) => sendResponse({ ok: true, doc }),
      (err: Error) => sendResponse({ ok: false, error: err.message || String(err) }),
    );
    return true; // Keeps the channel open for the async response.
  });

  browser.storage.onChanged.addListener((_changes, area) => {
    if (area === 'sync') void store.onSyncChanged();
  });

  // Toolbar click: focus the reader tab if it's open, otherwise open one.
  // runtime.getContexts finds our own pages without needing the "tabs" permission.
  browser.action.onClicked.addListener(async () => {
    const url = browser.runtime.getURL('/reader.html');
    const [existing] = await browser.runtime.getContexts({
      contextTypes: [browser.runtime.ContextType.TAB],
      documentUrls: [url],
    });
    try {
      if (existing && existing.tabId !== -1) {
        await browser.tabs.update(existing.tabId, { active: true });
        await browser.windows.update(existing.windowId, { focused: true });
        return;
      }
    } catch {
      // The tab closed between finding and focusing it; open a new one.
    }
    await browser.tabs.create({ url });
  });
});
