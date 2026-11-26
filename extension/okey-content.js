(() => {
  if (globalThis.__exlivesOkeyReaderLoaded) return;

  const colors = ['red', 'blue', 'yellow', 'green', 'black'];

  function readDocument(doc) {
    const win = doc.defaultView;
    const candidates = [...doc.querySelectorAll('.stamp')].flatMap(el => {
      const box = el.getBoundingClientRect();
      if (!box.width || !box.height || box.bottom < 0 || box.top > win.innerHeight) return [];
      const classes = [...el.classList];
      const color = colors.find(name => classes.includes(name));
      const text = (el.innerText || el.textContent || '').trim();
      const value = /^(?:[1-9]|1[0-3])$/.test(text) ? Number(text) : /^R$/i.test(text) ? 0 : null;
      if (!color || value === null || box.top + box.height / 2 < win.innerHeight * 0.55) return [];
      return [{ color, value, wild: el.classList.contains('marked'), x: box.left + box.width / 2, y: box.top + box.height / 2, height: box.height }];
    });
    if (!candidates.length) return null;

    candidates.sort((a, b) => a.y - b.y || a.x - b.x);
    const rows = [];
    for (const tile of candidates) {
      let row = rows.find(candidate => Math.abs(candidate.centerY - tile.y) <= Math.max(12, tile.height * 0.42));
      if (!row) rows.push(row = { centerY: tile.y, tiles: [] });
      row.tiles.push(tile);
      row.centerY = row.tiles.reduce((sum, item) => sum + item.y, 0) / row.tiles.length;
    }
    rows.sort((a, b) => b.tiles.length - a.tiles.length || b.centerY - a.centerY);
    const hand = rows[0];
    if (!hand || hand.tiles.length < 7) return null;
    hand.tiles.sort((a, b) => a.x - b.x);
    return {
      tiles: hand.tiles.map(({ color, value, wild }) => ({ color, value, wild })),
      count: hand.tiles.length,
      page: win.location.href
    };
  }

  function readVisibleHand() {
    const docs = [document];
    for (const frame of document.querySelectorAll('iframe')) {
      try { if (frame.contentDocument) docs.push(frame.contentDocument); } catch { /* Ignore cross-origin ad frames. */ }
    }
    const hands = docs.map(readDocument).filter(Boolean).sort((a, b) => b.count - a.count);
    return hands[0] || { error: 'Alt taraftaki ıstakayı okuyamadım. Oyun başladıktan sonra tekrar dene.' };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'READ_OKEY_HAND') return;
    sendResponse(readVisibleHand());
  });

  globalThis.__exlivesOkeyReaderLoaded = true;
})();
