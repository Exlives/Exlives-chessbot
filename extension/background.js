const appUrl = chrome.runtime.getURL('popup.html');
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function squareCenter(square, boardRect, flipped) {
  if (!/^[a-h][1-8]$/.test(square)) throw new Error('Geçersiz satranç karesi.');
  let file = square.charCodeAt(0) - 97;
  let row = 8 - Number(square[1]);
  if (flipped) {
    file = 7 - file;
    row = 7 - row;
  }
  return {
    x: boardRect.x + (file + 0.5) * boardRect.width / 8,
    y: boardRect.y + (row + 0.5) * boardRect.height / 8
  };
}

async function dispatchTrustedChessMove(tabId, move, boardRect, flipped, mode = 'drag') {
  if (!Number.isInteger(tabId) || !move?.from || !move?.to ||
      !boardRect || ![boardRect.x, boardRect.y, boardRect.width, boardRect.height].every(Number.isFinite) ||
      boardRect.width < 120 || boardRect.height < 120 ||
      Math.abs(boardRect.width - boardRect.height) > Math.max(boardRect.width, boardRect.height) * 0.2) {
    throw new Error('Satranç tahtası koordinatları geçersiz.');
  }
  const tab = await chrome.tabs.get(tabId);
  const host = new URL(tab.url || '').hostname;
  if (!/^(?:[^.]+\.)?(?:chess\.com|lichess\.org|worldchess\.com)$/i.test(host)) {
    throw new Error('Hedef sekme desteklenen bir satranç sitesi değil.');
  }
  const from = squareCenter(move.from, boardRect, flipped);
  const to = squareCenter(move.to, boardRect, flipped);
  const target = { tabId };
  await chrome.debugger.attach(target, '1.3');
  try {
    if (mode === 'click') {
      const clickSquare = async point => {
        await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
          type: 'mouseMoved', x: point.x, y: point.y, button: 'none', buttons: 0
        });
        await wait(35);
        await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
          type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1
        });
        await wait(50);
        await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
          type: 'mouseReleased', x: point.x, y: point.y, button: 'left', buttons: 0, clickCount: 1
        });
        await wait(80);
      };
      await clickSquare(from);
      await clickSquare(to);
      return { ok: true };
    }

    if (mode !== 'drag') throw new Error('Bilinmeyen hamle giriş yöntemi.');
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: from.x, y: from.y, button: 'none', buttons: 0
    });
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1
    });
    await wait(35);
    for (let step = 1; step <= 8; step++) {
      const progress = step / 8;
      await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: from.x + (to.x - from.x) * progress,
        y: from.y + (to.y - from.y) * progress,
        button: 'left', buttons: 1
      });
      await wait(25);
    }
    await wait(35);
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0, clickCount: 1
    });
  } finally {
    await chrome.debugger.detach(target);
  }
  return { ok: true };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'APPLY_TRUSTED_CHESS_MOVE') return;
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(''))) {
    sendResponse({ error: 'Hamle isteğinin kaynağı doğrulanamadı.' });
    return;
  }
  dispatchTrustedChessMove(message.tabId, message.move, message.boardRect, message.flipped, message.mode)
    .then(sendResponse)
    .catch(error => sendResponse({ error: error?.message || String(error) }));
  return true;
});

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
