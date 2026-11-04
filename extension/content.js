(() => {
if (globalThis.__hamleChessContentLoaded) return;

function deepQueryAll(root, selector, found = []) {
  if (!root?.querySelectorAll) return found;
  const pending = [root];
  const visited = new Set();
  while (pending.length) {
    const current = pending.pop();
    if (!current?.querySelectorAll || visited.has(current)) continue;
    visited.add(current);
    for (const match of current.querySelectorAll(selector)) found.push(match);
    for (const el of current.querySelectorAll('*')) {
      if (el.shadowRoot && !visited.has(el.shadowRoot)) pending.push(el.shadowRoot);
    }
  }
  return found;
}

function isBoardFlipped(board) {
  return !!board.closest('.orientation-black, .flipped') ||
    (board.matches('[data-cg-type="board"]') && /rotate\(\s*180deg\s*\)/i.test(board.style.transform));
}

function readPieces(board) {
  const cells = new Map();
  if (board.matches('wc-chess-board')) {
    for (const el of board.querySelectorAll('.piece[class*="square-"]')) {
      const cls = [...el.classList];
      const pc = cls.find(x => /^(w|b)[kqrbnp]$/.test(x));
      const pos = cls.find(x => /^square-[1-8][1-8]$/.test(x));
      if (!pc || !pos) continue;
      const xy = pos.slice(7); const file = Number(xy[0]), rank = Number(xy[1]);
      cells.set(`${'abcdefgh'[file - 1]}${rank}`, `${pc[0]}${pc[1]}`);
    }
  } else {
    const rect = board.getBoundingClientRect();
    const chessground = board.matches('[data-cg-type="board"]');
    const flipped = isBoardFlipped(board);
    for (const el of board.querySelectorAll('piece, [data-piece], [data-role], [data-cg-type="piece"], [class*="piece"]')) {
      const cls = [...el.classList];
      const descriptor = [el.getAttribute('data-piece'), el.getAttribute('data-role'), ...cls].filter(Boolean).join(' ').toLowerCase();
      const cgPiece = chessground && cls.length === 1 ? cls[0].match(/^([wb])([kqrbnp])$/) : null;
      const color = cgPiece?.[1] || (/\b(white|w)\b/.test(descriptor) ? 'w' : /\b(black|b)\b/.test(descriptor) ? 'b' : null);
      const role = cgPiece?.[2] || descriptor.match(/\b(king|queen|rook|bishop|knight|pawn)\b/)?.[1];
      if (!color || !role) continue;
      const box = el.getBoundingClientRect();
      let col = Math.floor(((box.left + box.width / 2) - rect.left) / (rect.width / 8));
      let row = Math.floor(((box.top + box.height / 2) - rect.top) / (rect.height / 8));
      if (col < 0 || col > 7 || row < 0 || row > 7) continue;
      if (flipped) { col = 7 - col; row = 7 - row; }
      const file = 'abcdefgh'[col], rank = String(8 - row);
      const map = { king:'k', queen:'q', rook:'r', bishop:'b', knight:'n', pawn:'p' };
      cells.set(`${file}${rank}`, `${color}${map[role] || role}`);
    }
  }
  return cells;
}

function cleanSan(text) {
  const figureMap = { '♔':'K', '♚':'K', '♕':'Q', '♛':'Q', '♖':'R', '♜':'R', '♗':'B', '♝':'B', '♘':'N', '♞':'N' };
  const san = text.replace(/[♔♚♕♛♖♜♗♝♘♞]/g, glyph => figureMap[glyph])
    .replace(/^\s*\d+\.(?:\.\.)?\s*/, '').replace(/[!?]+$/g, '').trim();
  return /^(?:O-O(?:-O)?|0-0(?:-0)?|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=?[QRBN])?)[+#]?$/.test(san) ? san.replace(/0/g, 'O') : null;
}

function readMoveHistory() {
  const chessComLists = deepQueryAll(document, 'wc-simple-move-list');
  const chessComMoves = chessComLists.map(list => {
    const nodes = [...list.querySelectorAll('.node')]
      .filter(node => !node.closest('[data-node="variation-ply"]'));
    return nodes.map(node => cleanSan(node.innerText || node.textContent || '')).filter(Boolean);
  }).sort((a, b) => b.length - a.length)[0];
  if (chessComMoves?.length) return chessComMoves;

  // Lichess renders its notation in custom move elements inside the round move panel.
  const roots = deepQueryAll(document, 'i5d, .rmoves, .move-list, .moves');
  const lichessMoves = roots.map(root => {
    let nodes = [...root.querySelectorAll('z7yx, move, .move')];
    if (!nodes.length) {
      const selected = root.querySelector('.a1t');
      if (selected) {
        const tag = selected.tagName;
        nodes = [...selected.parentElement.children].filter(node => node.tagName === tag);
      }
    }
    return nodes.map(node => cleanSan(node.innerText || node.textContent || '')).filter(Boolean);
  }).sort((a, b) => b.length - a.length)[0];
  return lichessMoves || [];
}

function getBoardPosition(rectHint = null, includeElement = false) {
  // Lichess uses the custom element <cg-board>; Chess.com uses <wc-chess-board>.
  // Search open shadow roots too, as some page layouts mount the board there.
  const boards = [...new Set(deepQueryAll(document, 'wc-chess-board, cg-board, .cg-board, [data-cg-type="board"], chess-board, .chess-board, [data-testid*="chessboard"], [data-testid*="chess-board"]'))];
  const candidates = boards.map(board => ({ board, cells: readPieces(board), rect: board.getBoundingClientRect() }))
    .filter(x => {
      const ratio = x.rect.width / x.rect.height;
      const visibleWidth = Math.max(0, Math.min(x.rect.right, window.innerWidth) - Math.max(x.rect.left, 0));
      const visibleHeight = Math.max(0, Math.min(x.rect.bottom, window.innerHeight) - Math.max(x.rect.top, 0));
      return x.cells.size >= 2 && x.rect.width > 120 && x.rect.height > 120 &&
        ratio > 0.8 && ratio < 1.2 && visibleWidth > 100 && visibleHeight > 100;
    })
    .map(x => {
      const visibleArea = Math.max(0, Math.min(x.rect.right, window.innerWidth) - Math.max(x.rect.left, 0)) *
        Math.max(0, Math.min(x.rect.bottom, window.innerHeight) - Math.max(x.rect.top, 0));
      const centerDistance = Math.hypot(
        (x.rect.left + x.rect.width / 2) - window.innerWidth / 2,
        (x.rect.top + x.rect.height / 2) - window.innerHeight / 2
      );
      return { ...x, visibleArea, centerDistance };
    })
    .map(candidate => {
      if (!rectHint) return { ...candidate, overlap: 0 };
      const left = Math.max(candidate.rect.left, rectHint.left);
      const top = Math.max(candidate.rect.top, rectHint.top);
      const right = Math.min(candidate.rect.right, rectHint.right);
      const bottom = Math.min(candidate.rect.bottom, rectHint.bottom);
      const overlap = Math.max(0, right - left) * Math.max(0, bottom - top);
      return { ...candidate, overlap: overlap / (candidate.rect.width * candidate.rect.height) };
    })
    .filter(candidate => !rectHint || candidate.overlap >= 0.2)
    .sort((a,b) => {
      if (rectHint) return b.overlap - a.overlap;
      if (location.hostname.includes('worldchess')) {
        const aScore = a.visibleArea / (1 + a.centerDistance / Math.max(window.innerWidth, window.innerHeight));
        const bScore = b.visibleArea / (1 + b.centerDistance / Math.max(window.innerWidth, window.innerHeight));
        return bScore - aScore || b.cells.size - a.cells.size;
      }
      return b.visibleArea - a.visibleArea || b.cells.size - a.cells.size;
    });
  if (!candidates.length) return { error: 'Bu sayfada okunabilir bir satranç tahtası bulamadım. Canlı oyun sekmesinde 2B tahtayı açıp yeniden dene.' };
  const { board, cells, rect } = candidates[0];
  const flipped = board.classList.contains('orientation-black') || isBoardFlipped(board);
  let turn = null;
  const clocks = [...document.querySelectorAll('.clock-player-turn, .rclock.running, .clock.running')];
  const clock = clocks.map(el => ({ el, box: el.getBoundingClientRect() }))
    .filter(x => x.box.width && x.box.height)
    .sort((a, b) => Math.abs((a.box.top + a.box.height / 2) - (rect.y + rect.height / 2)) - Math.abs((b.box.top + b.box.height / 2) - (rect.y + rect.height / 2)))[0];
  if (clock) {
    const center = clock.box.top + clock.box.height / 2;
    if (center < rect.y) turn = flipped ? 'w' : 'b';
    else if (center > rect.bottom) turn = flipped ? 'b' : 'w';
  }
  return {
    pieces: Object.fromEntries(cells),
    site: location.hostname.includes('lichess') ? 'Lichess' : location.hostname.includes('worldchess') ? 'World Chess' : 'Chess.com',
    moveHistory: readMoveHistory(),
    boardRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    viewport: { width: window.innerWidth, height: window.innerHeight },
    flipped,
    turn,
    ...(includeElement ? { boardElement: board } : {})
  };
}

let activeArrow = null;
let arrowResizeObserver = null;
let arrowDomObserver = null;
function updateArrowGeometry() {
  if (!activeArrow) return;
  if (!activeArrow.boardElement?.isConnected) {
    let replacement = getBoardPosition(activeArrow.rectHint, true);
    if (replacement.error) replacement = getBoardPosition(null, true);
    if (replacement.error) { clearArrow(); return; }
    activeArrow.boardElement = replacement.boardElement;
    activeArrow.flipped = replacement.flipped;
    activeArrow.rectHint = {
      left: replacement.boardRect.x, top: replacement.boardRect.y,
      right: replacement.boardRect.x + replacement.boardRect.width,
      bottom: replacement.boardRect.y + replacement.boardRect.height
    };
    arrowResizeObserver?.disconnect();
    arrowResizeObserver?.observe(activeArrow.boardElement);
  }
  const rect = activeArrow.boardElement.getBoundingClientRect();
  activeArrow.overlay.style.left = `${rect.x}px`;
  activeArrow.overlay.style.top = `${rect.y}px`;
  activeArrow.overlay.style.width = `${rect.width}px`;
  activeArrow.overlay.style.height = `${rect.height}px`;
  const point = square => {
    let file = square.charCodeAt(0) - 97;
    let row = 8 - Number(square[1]);
    if (activeArrow.flipped) { file = 7 - file; row = 7 - row; }
    return { x: (file + 0.5) * 100, y: (row + 0.5) * 100 };
  };
  const from = point(activeArrow.move.from), to = point(activeArrow.move.to);
  const circle = activeArrow.overlay.querySelector('circle');
  circle.setAttribute('cx', from.x); circle.setAttribute('cy', from.y);
  const line = activeArrow.overlay.querySelector('line');
  line.setAttribute('x1', from.x); line.setAttribute('y1', from.y);
  line.setAttribute('x2', to.x); line.setAttribute('y2', to.y);
}
function clearArrow() {
  activeArrow?.overlay.remove();
  activeArrow = null;
  arrowResizeObserver?.disconnect();
  arrowDomObserver?.disconnect();
}
window.addEventListener('scroll', updateArrowGeometry, true);
window.addEventListener('resize', updateArrowGeometry);
window.addEventListener('focus', updateArrowGeometry);
document.addEventListener('visibilitychange', updateArrowGeometry);
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'READ_CHESS_BOARD') {
    const selected = message.rectHint ? getBoardPosition(message.rectHint) : null;
    sendResponse(selected && !selected.error ? selected : getBoardPosition());
  }
  if (message?.type === 'PICK_CHESS_BOARD') {
    startBoardPicker(sendResponse);
    return true;
  }
  if (message?.type === 'SHOW_MOVE_ARROW') {
    const hint = message.boardRect && {
      left: message.boardRect.x, top: message.boardRect.y,
      right: message.boardRect.x + message.boardRect.width,
      bottom: message.boardRect.y + message.boardRect.height
    };
    const board = getBoardPosition(hint, true);
    if (board.error) sendResponse({ error: board.error });
    else { drawMoveArrow(message.move, board); sendResponse({ ok: true }); }
  }
  if (message?.type === 'CLEAR_MOVE_ARROW') {
    clearArrow();
    sendResponse({ ok: true });
  }
});

function drawMoveArrow(move, board) {
  if (!move?.from || !move?.to) return;
  clearArrow();
  const { x, y, width, height } = board.boardRect;
  const root = 'http://www.w3.org/2000/svg';
  const overlay = document.createElement('div');
  overlay.id = 'hamle-move-overlay';
  overlay.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:${width}px;height:${height}px;z-index:2147483646;pointer-events:none`;
  const svg = document.createElementNS(root, 'svg');
  svg.setAttribute('viewBox', '0 0 800 800');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('width', '100%'); svg.setAttribute('height', '100%');
  const defs = document.createElementNS(root, 'defs');
  const marker = document.createElementNS(root, 'marker');
  marker.setAttribute('id', 'hamle-arrow-head');
  marker.setAttribute('markerWidth', '8'); marker.setAttribute('markerHeight', '8');
  marker.setAttribute('refX', '6'); marker.setAttribute('refY', '3');
  marker.setAttribute('orient', 'auto'); marker.setAttribute('markerUnits', 'strokeWidth');
  const head = document.createElementNS(root, 'path');
  head.setAttribute('d', 'M0,0 L0,6 L7,3 z'); head.setAttribute('fill', '#d5fa79');
  marker.append(head); defs.append(marker); svg.append(defs);
  const circle = document.createElementNS(root, 'circle');
  circle.setAttribute('r', '21');
  circle.setAttribute('fill', '#d5fa7926'); circle.setAttribute('stroke', '#d5fa79'); circle.setAttribute('stroke-width', '4');
  const line = document.createElementNS(root, 'line');
  line.setAttribute('stroke', '#d5fa79'); line.setAttribute('stroke-width', '11');
  line.setAttribute('stroke-linecap', 'round'); line.setAttribute('marker-end', 'url(#hamle-arrow-head)');
  line.setAttribute('filter', 'drop-shadow(0 1px 3px #172015)');
  svg.append(circle, line); overlay.append(svg); document.documentElement.append(overlay);
  const rectHint = {
    left: board.boardRect.x, top: board.boardRect.y,
    right: board.boardRect.x + board.boardRect.width,
    bottom: board.boardRect.y + board.boardRect.height
  };
  activeArrow = { move, overlay, boardElement: board.boardElement, flipped: board.flipped, rectHint };
  if (typeof ResizeObserver !== 'undefined') {
    arrowResizeObserver = new ResizeObserver(updateArrowGeometry);
    arrowResizeObserver.observe(board.boardElement);
  }
  arrowDomObserver = new MutationObserver(() => {
    if (activeArrow && !activeArrow.boardElement?.isConnected) updateArrowGeometry();
  });
  arrowDomObserver.observe(document.documentElement, { childList: true, subtree: true });
  updateArrowGeometry();
}

function startBoardPicker(sendResponse) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(5,12,10,.18);cursor:crosshair;touch-action:none;user-select:none';
  const selection = document.createElement('div');
  selection.style.cssText = 'position:fixed;display:none;border:2px solid #d5fa79;background:rgba(213,250,121,.12);box-shadow:0 0 0 9999px rgba(5,12,10,.22);pointer-events:none';
  const prompt = document.createElement('div');
  prompt.textContent = 'Satranç tahtasının tamamını çerçeve içine al · Esc: iptal';
  prompt.style.cssText = 'position:fixed;top:18px;left:50%;transform:translateX(-50%);padding:10px 14px;border-radius:8px;background:#17221f;color:#f1f3e9;font:600 14px Segoe UI,sans-serif;box-shadow:0 3px 18px #0008;white-space:nowrap';
  overlay.append(selection, prompt);
  document.documentElement.append(overlay);
  let start = null;
  let finished = false;
  const cleanup = () => {
    if (finished) return;
    finished = true;
    overlay.remove();
    document.removeEventListener('keydown', onKeyDown, true);
  };
  const cancel = () => { cleanup(); sendResponse({ cancelled: true }); };
  const onKeyDown = event => { if (event.key === 'Escape') cancel(); };
  document.addEventListener('keydown', onKeyDown, true);
  overlay.addEventListener('pointerdown', event => {
    if (event.target === prompt) return;
    start = { x: event.clientX, y: event.clientY };
    selection.style.display = 'block';
    selection.style.left = `${start.x}px`; selection.style.top = `${start.y}px`;
    selection.style.width = '0'; selection.style.height = '0';
    overlay.setPointerCapture(event.pointerId);
  });
  overlay.addEventListener('pointermove', event => {
    if (!start) return;
    const left = Math.min(start.x, event.clientX), top = Math.min(start.y, event.clientY);
    selection.style.left = `${left}px`; selection.style.top = `${top}px`;
    selection.style.width = `${Math.abs(event.clientX - start.x)}px`;
    selection.style.height = `${Math.abs(event.clientY - start.y)}px`;
  });
  overlay.addEventListener('pointerup', event => {
    if (!start) return;
    const rectHint = {
      left: Math.min(start.x, event.clientX), top: Math.min(start.y, event.clientY),
      right: Math.max(start.x, event.clientX), bottom: Math.max(start.y, event.clientY)
    };
    start = null;
    cleanup();
    if (rectHint.right - rectHint.left < 100 || rectHint.bottom - rectHint.top < 100) {
      sendResponse({ error: 'Alan çok küçük seçildi. Tahtanın tamamını çerçeve içine alıp yeniden dene.' });
      return;
    }
    const board = getBoardPosition(rectHint);
    if (board.error) {
      sendResponse({ error: 'Seçtiğin alanın içinde tanıdığım bir 2B satranç tahtası yok. Oyun tahtasının tamamını seç.' });
      return;
    }
    sendResponse(board);
  });
  overlay.addEventListener('contextmenu', event => { event.preventDefault(); cancel(); });
}
globalThis.__hamleChessContentLoaded = true;
})();
