export default defineBackground(() => {
  // Toolbar click: focus the reader tab if it's open, otherwise open one.
  // runtime.getContexts finds our own pages without needing the "tabs" permission.
  browser.action.onClicked.addListener(async () => {
    const url = browser.runtime.getURL('/reader.html');
    const [existing] = await browser.runtime.getContexts({
      contextTypes: [browser.runtime.ContextType.TAB],
      documentUrls: [url],
    });
    if (existing && existing.tabId !== -1) {
      await browser.tabs.update(existing.tabId, { active: true });
      await browser.windows.update(existing.windowId, { focused: true });
    } else {
      await browser.tabs.create({ url });
    }
  });
});
