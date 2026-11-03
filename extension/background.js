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
  const windows = await chrome.windows.getAll({ populate: true });
  const existing = windows.find((win) => win.type === 'popup' &&
    win.tabs?.some((item) => item.url?.startsWith(appUrl)));
  if (existing) {
    if (tab?.id != null) {
      const appTab = existing.tabs.find((item) => item.url?.startsWith(appUrl));
      if (appTab?.id != null) await chrome.tabs.update(appTab.id, { url: `${appUrl}?tabId=${tab.id}&windowId=${tab.windowId}` });
    }
    await chrome.windows.update(existing.id, { focused: true, ...await getWindowLayout() });
    return;
  }
  const target = Number.isInteger(tab?.id) ? `?tabId=${tab.id}&windowId=${tab.windowId}` : '';
  await chrome.windows.create({
    url: `${appUrl}${target}`,
    type: 'popup',
    focused: true,
    ...await getWindowLayout()
  });
});
