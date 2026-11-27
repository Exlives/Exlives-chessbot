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
  const target = { tabId };
  await chrome.debugger.attach(target, '1.3');
  try {
    const boardSelector = host.endsWith('worldchess.com')
      ? '[data-cg-type="board"].cg-board'
      : host.endsWith('lichess.org') ? 'cg-board' : 'wc-chess-board';
    const currentLayout = await chrome.debugger.sendCommand(target, 'Runtime.evaluate', {
      expression: `(() => {
          const candidates = [...document.querySelectorAll(${JSON.stringify(boardSelector)})]
            .map(board => board.getBoundingClientRect())
            .filter(rect => rect.width > 120 && rect.height > 120 &&
              Math.abs(rect.width - rect.height) <= Math.max(rect.width, rect.height) * 0.2 &&
              rect.right > 0 && rect.bottom > 0 &&
              rect.left < innerWidth && rect.top < innerHeight)
            .sort((a, b) => b.width * b.height - a.width * a.height);
          const rect = candidates[0];
          return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
        })()`,
      returnByValue: true
    });
    const rect = currentLayout?.result?.value;
    if (!rect || ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) {
      throw new Error('Satranç tahtasının güncel boyutlarını okuyamadım.');
    }
    const activeBoardRect = rect;
    const from = squareCenter(move.from, activeBoardRect, flipped);
    const to = squareCenter(move.to, activeBoardRect, flipped);
    if (mode === 'click') {
      const clickSquare = async point => {
        await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
          type: 'mouseMoved', x: point.x, y: point.y, button: 'none', buttons: 0
        });
        await wait(25);
        await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
          type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1
        });
        await wait(35);
        await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
          type: 'mouseReleased', x: point.x, y: point.y, button: 'left', buttons: 0, clickCount: 1
        });
        await wait(55);
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

async function getWindowLayout(restoreSavedBounds = false) {
  const settings = restoreSavedBounds
    ? await chrome.storage.local.get(['chessbotWindowBounds', 'chessbotWindowMode'])
    : {};
  // The app always opens in the normal view. The mini/micro buttons remain
  // available after launch, but the last compact mode is not restored.
  const savedWindowMode = 'full';
  const storedBounds = settings.chessbotWindowBounds;
  const hasFlatBounds = storedBounds &&
    [storedBounds.left, storedBounds.top, storedBounds.width, storedBounds.height].every(Number.isFinite);
  const isNormalSize = bounds => bounds && bounds.width >= 320 && bounds.height >= 560;
  // A legacy flat value may be the old mini/micro size. Only reuse it when
  // it was explicitly saved while the app was in normal mode.
  const savedBounds = hasFlatBounds
    ? (settings.chessbotWindowMode === 'full' && isNormalSize(storedBounds) ? storedBounds : null)
    : (isNormalSize(storedBounds?.[savedWindowMode]) ? storedBounds[savedWindowMode] : null);
  try {
    const displays = await chrome.system.display.getInfo();
    const hasSavedBounds = savedBounds &&
      [savedBounds.left, savedBounds.top, savedBounds.width, savedBounds.height].every(Number.isFinite);
    const savedDisplay = hasSavedBounds && displays.find(({ workArea }) =>
      savedBounds.left + savedBounds.width / 2 >= workArea.left &&
      savedBounds.left + savedBounds.width / 2 < workArea.left + workArea.width &&
      savedBounds.top + savedBounds.height / 2 >= workArea.top &&
      savedBounds.top + savedBounds.height / 2 < workArea.top + workArea.height);
    const display = savedDisplay || displays.find((item) => item.isPrimary) || displays[0];
    const area = display?.workArea;
    if (area) {
      if (hasSavedBounds) {
        const width = Math.min(Math.max(180, savedBounds.width), area.width);
        const height = Math.min(Math.max(88, savedBounds.height), area.height);
        return {
          width,
          height,
          left: Math.min(Math.max(savedBounds.left, area.left), area.left + area.width - width),
          top: Math.min(Math.max(savedBounds.top, area.top), area.top + area.height - height)
        };
      }
      const { width, height } = savedWindowMode === 'micro'
        ? { width: 230, height: 88 }
        : savedWindowMode === 'mini'
          ? { width: Math.max(180, Math.min(320, area.width - 16)), height: 190 }
          : {
              width: Math.min(520, Math.max(320, area.width - 24)),
              height: Math.min(1000, Math.max(560, area.height))
            };
      const safeWidth = Math.min(width, area.width);
      const safeHeight = Math.min(height, area.height);
      return {
        width: safeWidth,
        height: safeHeight,
        left: area.left + area.width - safeWidth,
        top: area.top
      };
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
    await chrome.windows.update(existing.id, { focused: true });
    return;
  }
  await chrome.windows.create({
    url: `${appUrl}${target}`,
    type: 'popup',
    focused: true,
    ...await getWindowLayout(!okeyTab)
  });
});
