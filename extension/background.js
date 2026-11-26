const appUrl = chrome.runtime.getURL('popup.html');

async function getWindowLayout() {
  try {
    const displays = await chrome.system.display.getInfo();
    const display = displays.find((item) => item.isPrimary) || displays[0];
    const area = display?.workArea;
    if (area) {
      const width = Math.min(520, Math.max(320, area.width - 24));
      const height = Math.min(1000, Math.max(560, area.height));
      return { width, height, left: area.left + area.width - width, top: area.top };
    }
  } catch { /* Use the browser's default placement if display info is unavailable. */ }
  return {};
}

chrome.action.onClicked.addListener(async (tab) => {
  const okeyTab = /rekoroyun\.com\/(?:okey\.html|embed\/okey\/)/i.test(tab?.url || '');
  const appUrl = chrome.runtime.getURL(okeyTab ? 'okey.html' : 'popup.html');
  let readerError = '';
  if (okeyTab && Number.isInteger(tab?.id)) {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['okey-content.js'] });
    } catch (error) {
      readerError = error?.message || String(error);
    }
  }
  const windows = await chrome.windows.getAll({ populate: true });
  const existing = windows.find((win) => win.type === 'popup' &&
    win.tabs?.some((item) => /(?:popup|okey)\.html(?:\?|$)/.test(item.url || '')));
  const params = new URLSearchParams();
  if (Number.isInteger(tab?.id)) params.set('tabId', tab.id);
  if (Number.isInteger(tab?.windowId)) params.set('windowId', tab.windowId);
  if (readerError) params.set('readerError', readerError);
  const query = params.toString();
  const target = query ? `?${query}` : '';
  if (existing) {
    if (tab?.id != null) {
      const appTab = existing.tabs.find((item) => /(?:popup|okey)\.html/.test(item.url || ''));
      if (appTab?.id != null) await chrome.tabs.update(appTab.id, { url: `${appUrl}${target}` });
    }
    await chrome.windows.update(existing.id, { focused: true, ...await getWindowLayout() });
    return;
  }
  await chrome.windows.create({
    url: `${appUrl}${target}`,
    type: 'popup',
    focused: true,
    ...await getWindowLayout()
  });
});
