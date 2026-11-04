import { Chess } from './vendor/chess.js';
import { getStockfish, stopStockfish } from './engine.js';

const result = document.querySelector('#result');
const boardPreview = document.querySelector('#board-preview');
const boardImage = document.querySelector('#board-image');
const ownColorSelect = document.querySelector('#own-color');
let sourceTabId = null;
let miniMode = false;
let miniWindowId = null;
let pinningMiniWindow = false;

async function setMiniMode(enabled) {
  miniMode = enabled;
  document.body.classList.toggle('mini-mode', enabled);
  const win = await chrome.windows.getCurrent();
  miniWindowId = win.id;
  const displays = await chrome.system.display.getInfo();
  const display = displays.find(item => item.isPrimary) || displays[0];
  const area = display?.workArea;
  if (!area || win.id == null) return;
  const width = enabled ? 320 : Math.min(520, Math.max(320, area.width - 24));
  const height = enabled ? 190 : Math.min(1000, Math.max(560, area.height));
  await chrome.windows.update(win.id, {
    width, height,
    left: area.left + area.width - width,
    top: area.top + 8,
    focused: true
  });
  const toggle = document.querySelector('#mini-toggle');
  toggle.title = enabled ? 'Pencereyi büyüt' : 'Küçük pencereye geç';
  toggle.setAttribute('aria-label', toggle.title);
}

chrome.windows.onBoundsChanged.addListener(async win => {
  if (!miniMode || pinningMiniWindow || win.id !== miniWindowId || win.state === 'minimized') return;
  const displays = await chrome.system.display.getInfo();
  const display = displays.find(item => item.isPrimary) || displays[0];
  const area = display?.workArea;
  if (!area) return;
  const target = { left: area.left + area.width - 320, top: area.top + 8, width: 320, height: 190 };
  if (Math.abs(win.left - target.left) < 2 && Math.abs(win.top - target.top) < 2 && win.width === target.width && win.height === target.height) return;
  pinningMiniWindow = true;
  try { await chrome.windows.update(win.id, target); }
  finally { pinningMiniWindow = false; }
});

// Chrome extensions cannot set the OS-level always-on-top flag for a window.
// Keep the compact helper above other Chrome windows by raising it whenever
// focus moves to another Chrome window. External applications are unaffected.
let restoringMiniFocus = false;
chrome.windows.onFocusChanged.addListener(async focusedWindowId => {
  if (!miniMode || restoringMiniFocus || focusedWindowId === chrome.windows.WINDOW_ID_NONE) return;
  const ownWindow = await chrome.windows.getCurrent();
  if (ownWindow.id == null || focusedWindowId === ownWindow.id) return;
  restoringMiniFocus = true;
  try { await chrome.windows.update(ownWindow.id, { focused: true }); }
  catch { /* The helper may have closed while focus was changing. */ }
  finally { restoringMiniFocus = false; }
});

document.querySelector('#close-app').addEventListener('click', async () => {
  await clearArrowOnSite();
  const win = await chrome.windows.getCurrent();
  if (win.id != null) chrome.windows.remove(win.id);
});
document.querySelector('#mini-toggle').addEventListener('click', () => setMiniMode(!miniMode));
function getFen(piecesBySquare, turn) {
  let rows=[];for(let rank=8;rank>=1;rank--){let row='',empty=0;for(const file of 'abcdefgh'){const p=piecesBySquare[file+rank];if(!p)empty++;else{if(empty)row+=empty;empty=0;row+=p[0]==='w'?p[1].toUpperCase():p[1]}}if(empty)row+=empty;rows.push(row)}
  // Rights are inferred only when king and original rooks remain on their home squares.
  let rights='';const p=piecesBySquare;
  if(p.e1==='wk'&&p.h1==='wr')rights+='K';if(p.e1==='wk'&&p.a1==='wr')rights+='Q';if(p.e8==='bk'&&p.h8==='br')rights+='k';if(p.e8==='bk'&&p.a8==='br')rights+='q';
  return `${rows.join('/')} ${turn} ${rights||'-'} - 0 1`;
}
function boardMapFromGame(game) {
  const map = {};
  const board = game.board();
  for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
    const piece = board[row][col];
    if (piece) map[`${'abcdefgh'[col]}${8-row}`] = `${piece.color}${piece.type}`;
  }
  return map;
}
function isStartingPosition(board) {
  return matchesBoard(new Chess(), board.pieces);
}
function bottomPlayerColor(board) {
  return board.bottomColor || (board.flipped ? 'b' : 'w');
}
function matchesBoard(game, observed) {
  const calculated = boardMapFromGame(game);
  const squares = new Set([...Object.keys(calculated), ...Object.keys(observed)]);
  return [...squares].every(square => calculated[square] === observed[square]);
}
function gameFromPosition(board, fallbackTurn) {
  const history = board.moveHistory || [];
  if (history.length) {
    try {
      const replay = new Chess();
      for (const san of history) replay.move(san);
      if (matchesBoard(replay, board.pieces)) return replay;
    } catch { /* Fall back when the page exposes an incomplete or non-mainline notation list. */ }
  }
  return new Chess(getFen(board.pieces, board.turn || fallbackTurn));
}
function moveFromUci(game, uci) {
  const match = uci?.match(/^([a-h][1-8])([a-h][1-8])([qrbn])?$/);
  if (!match) return null;
  return game.move({ from: match[1], to: match[2], ...(match[3] ? { promotion: match[3] } : {}) });
}
function scoreText(info) {
  if (!info) return '';
  if (info.mate !== null) return info.mate > 0
    ? `Motor zorunlu matı ${info.mate} hamlede görüyor.`
    : `Motor mat tehdidi altında (${Math.abs(info.mate)} hamle).`;
  if (info.cp === null) return '';
  const pawns = (info.cp / 100).toFixed(2);
  return `Motor puanı: ${pawns} piyon.`;
}
function explainMove(game, move, info) {
  let reason;
  if (move.san.includes('#')) reason = 'Bu hamle şah mat ediyor.';
  else if (move.promotion) reason = 'Piyonu terfi ettirip yeni bir taş kazanıyor.';
  else if (move.san.includes('+')) reason = 'Rakip şahı tehdit ederek tempo kazanıyor.';
  else if (move.captured) reason = 'Rakip taşı alıyor.';
  else reason = 'Motor bu hamleyi konum için en güçlü devam olarak seçti.';
  const clone = new Chess(game.fen());
  const line = [];
  for (const uci of (info?.pv || []).slice(0, 5)) {
    const next = moveFromUci(clone, uci);
    if (!next) break;
    line.push(next.san);
  }
  const continuation = line.length ? `Devam örneği: ${line.join(' ')}.` : '';
  return `${reason} ${scoreText(info)} ${continuation}`.trim();
}
async function captureBoard(board) {
  const windowParam = new URLSearchParams(location.search).get('windowId');
  const windowId = windowParam === null ? NaN : Number(windowParam);
  const dataUrl = await chrome.tabs.captureVisibleTab(
    Number.isInteger(windowId) && windowId >= 0 ? windowId : undefined,
    { format: 'png' }
  );
  const screenshot = new Image();
  screenshot.src = dataUrl;
  await screenshot.decode();
  const { boardRect, viewport } = board;
  const scaleX = screenshot.naturalWidth / viewport.width;
  const scaleY = screenshot.naturalHeight / viewport.height;
  const x = Math.max(0, Math.round(boardRect.x * scaleX));
  const y = Math.max(0, Math.round(boardRect.y * scaleY));
  const width = Math.min(screenshot.naturalWidth - x, Math.round(boardRect.width * scaleX));
  const height = Math.min(screenshot.naturalHeight - y, Math.round(boardRect.height * scaleY));
  if (width <= 0 || height <= 0) throw new Error('Tahta görüntüsünü kırpamadım.');
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  canvas.getContext('2d').drawImage(screenshot, x, y, width, height, 0, 0, width, height);
  boardImage.src = canvas.toDataURL('image/png');
  boardPreview.hidden = false;
}

async function readWorldChessBoard(tabId) {
  const [injected] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      const boards = [...document.querySelectorAll('[data-cg-type="board"]')]
        .map(board => ({ board, rect: board.getBoundingClientRect() }))
        .filter(({ board, rect }) => {
          const ratio = rect.width / rect.height;
          const visibleWidth = Math.max(0, Math.min(rect.right, viewport.width) - Math.max(rect.left, 0));
          const visibleHeight = Math.max(0, Math.min(rect.bottom, viewport.height) - Math.max(rect.top, 0));
          return board.classList.contains('cg-board') && rect.width > 200 && rect.height > 200 &&
            ratio > 0.9 && ratio < 1.1 && visibleWidth > 200 && visibleHeight > 200;
        });
      const candidate = boards.sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height)[0];
      if (!candidate) return null;
      const { board, rect } = candidate;
      const styleFlipped = board.classList.contains('orientation-black') ||
        !!board.closest('.orientation-black, .flipped') || /rotate\(\s*180deg\s*\)/i.test(board.style.transform);
      const visualRows = { w: [], b: [] };
      const visualPieces = [];
      for (const piece of board.querySelectorAll('[data-cg-type="piece"]')) {
        const code = [...piece.classList].map(name => name.match(/^([wb])([kqrbnp])$/)).find(Boolean);
        if (!code) continue;
        const box = piece.getBoundingClientRect();
        const centerX = box.left + box.width / 2;
        const centerY = box.top + box.height / 2;
        const file = Math.floor((centerX - rect.left) / (rect.width / 8));
        const row = Math.floor((centerY - rect.top) / (rect.height / 8));
        if (file < 0 || file > 7 || row < 0 || row > 7) continue;
        visualRows[code[1]].push(row);
        visualPieces.push({ color: code[1], type: code[2], file, row });
      }
      if (visualPieces.length < 2) return null;
      const medianRow = values => {
        const sorted = [...values].sort((a, b) => a - b);
        return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
      };
      const whiteMedianRow = medianRow(visualRows.w);
      const blackMedianRow = medianRow(visualRows.b);
      const bottomColor = whiteMedianRow === null || blackMedianRow === null
        ? (styleFlipped ? 'b' : 'w')
        : whiteMedianRow > blackMedianRow ? 'w' : 'b';
      // The lower side's pieces determine the board orientation; CSS rotation
      // classes on World Chess boards are not reliable across game layouts.
      const flipped = bottomColor === 'b';
      const pieces = {};
      for (const piece of visualPieces) {
        let { file, row } = piece;
        if (flipped) { file = 7 - file; row = 7 - row; }
        pieces[`${'abcdefgh'[file]}${8 - row}`] = `${piece.color}${piece.type}`;
      }
      const cleanSan = text => {
        const san = text.replace(/^\s*\d+\.(?:\.\.)?\s*/, '').replace(/[!?]+$/g, '').trim();
        return /^(?:O-O(?:-O)?|0-0(?:-0)?|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=?[QRBN])?)[+#]?$/.test(san)
          ? san.replace(/0/g, 'O') : null;
      };
      const moveHistory = [...document.querySelectorAll('[data-component="GameNotationTable"]')]
        .map(table => [...table.querySelectorAll('button[class*="table_move"]')]
          .map(button => cleanSan(button.innerText || button.textContent || ''))
          .filter(Boolean))
        .sort((a, b) => b.length - a.length)[0] || [];
      const isInitialPosition = (() => {
        const expected = {};
        for (let file = 0; file < 8; file++) {
          expected[`${'abcdefgh'[file]}2`] = 'wp';
          expected[`${'abcdefgh'[file]}7`] = 'bp';
        }
        for (let file = 0; file < 8; file++) {
          const type = 'rnbqkbnr'[file];
          expected[`${'abcdefgh'[file]}1`] = `w${type}`;
          expected[`${'abcdefgh'[file]}8`] = `b${type}`;
        }
        return Object.keys(expected).length === Object.keys(pieces).length &&
          Object.entries(expected).every(([square, piece]) => pieces[square] === piece);
      })();
      return {
        pieces,
        site: 'World Chess',
        moveHistory,
        boardRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        viewport,
        flipped,
        bottomColor,
        turn: moveHistory.length % 2 ? 'b' : (moveHistory.length || isInitialPosition ? 'w' : null)
      };
    }
  });
  return injected?.result || null;
}
function showArrow(move, flipped) {
  const squarePoint = square => {
    let file = square.charCodeAt(0) - 97;
    let row = 8 - Number(square[1]);
    if (flipped) { file = 7 - file; row = 7 - row; }
    return { x: (file + 0.5) * 125, y: (row + 0.5) * 125 };
  };
  const from = squarePoint(move.from), to = squarePoint(move.to);
  const line = document.querySelector('#arrow-line');
  line.setAttribute('x1', from.x); line.setAttribute('y1', from.y);
  line.setAttribute('x2', to.x); line.setAttribute('y2', to.y);
  const origin = document.querySelector('#arrow-origin');
  origin.setAttribute('cx', from.x); origin.setAttribute('cy', from.y);
  document.querySelector('#move-arrow').hidden = false;
}
let lastSignature = null;
let trackedTurn = null;
let latestBoard = null;
let lastPieces = null;
let lastOpponentMove = null;
let lastHistoryPly = 0;
let lastFlipped = null;
let lastGameKey = null;
let scanning = false;
let ownColor = ownColorSelect.value;
let liveTracking = true;
let pollTimer = null;
let analysisGeneration = 0;
let autoDetectColor = true;

function errorText(error, fallback) {
  if (typeof error === 'string' && error.trim()) return error;
  if (error?.message) return error.message;
  try {
    const detail = JSON.stringify(error);
    if (detail && detail !== '{}') return detail;
  } catch { /* Use the caller's fallback for non-serializable values. */ }
  return fallback;
}

async function readCurrentBoard() {
  const params = new URLSearchParams(location.search);
  const tabId = Number(params.get('tabId'));
  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const tab = Number.isInteger(tabId) && tabId > 0 ? await chrome.tabs.get(tabId) : activeTab;
  if (!tab?.id) throw new Error('Etkin satranç sekmesini bulamadım.');
  if (!/^https:\/\/(?:[^/]+\.)?(?:chess\.com|lichess\.org|worldchess\.com)\//i.test(tab.url || '')) {
    throw new Error('Bağlı sekme desteklenen bir satranç sitesi değil. Satranç sekmesine geçip uzantı simgesine tekrar tıkla.');
  }
  sourceTabId = tab.id;
  let board;
  if (/worldchess\.com$/i.test(new URL(tab.url).hostname)) {
    try { board = await readWorldChessBoard(tab.id); } catch { /* Fall back to the content script reader. */ }
  }
  if (board) return { tab, board };
  try {
    board = await chrome.tabs.sendMessage(tab.id, { type: 'READ_CHESS_BOARD' });
  } catch {
    try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }); }
    catch (error) { throw new Error(`Satranç sekmesine erişim reddedildi: ${error.message}. Uzantıyı yenileyip sekmeyi tekrar aç.`); }
    try { board = await chrome.tabs.sendMessage(tab.id, { type: 'READ_CHESS_BOARD' }); }
    catch { throw new Error('İçerik betiği yüklendi ama yanıt vermedi. Satranç sekmesini yenileyip tekrar dene.'); }
  }
  return { tab, board };
}

async function showArrowOnSite(move, board) {
  if (sourceTabId == null) return;
  if (board.site === 'World Chess') {
    try {
      const [injected] = await chrome.scripting.executeScript({
        target: { tabId: sourceTabId },
        args: [move, board.flipped],
        func: (move, flipped) => {
          globalThis.__exlivesWorldChessArrow?.dispose?.();
          document.querySelector('#hamle-move-overlay')?.remove();
          const findBoard = () => [...document.querySelectorAll('[data-cg-type="board"].cg-board')]
            .map(element => ({ element, rect: element.getBoundingClientRect() }))
            .filter(({ rect }) => rect.width > 200 && rect.height > 200 &&
              rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight)
            .sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height)[0]?.element;
          const boardElement = findBoard();
          if (!boardElement) return { error: 'World Chess cg-board tahtası artık görünür değil.' };
          const ns = 'http://www.w3.org/2000/svg';
          const overlay = document.createElement('div');
          overlay.id = 'exlives-worldchess-arrow';
          overlay.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;overflow:visible';
          const svg = document.createElementNS(ns, 'svg');
          svg.setAttribute('viewBox', '0 0 800 800');
          svg.setAttribute('preserveAspectRatio', 'none');
          svg.setAttribute('width', '100%');
          svg.setAttribute('height', '100%');
          const defs = document.createElementNS(ns, 'defs');
          const marker = document.createElementNS(ns, 'marker');
          marker.id = 'exlives-worldchess-arrowhead';
          marker.setAttribute('markerWidth', '8');
          marker.setAttribute('markerHeight', '8');
          marker.setAttribute('refX', '6');
          marker.setAttribute('refY', '3');
          marker.setAttribute('orient', 'auto');
          const head = document.createElementNS(ns, 'path');
          head.setAttribute('d', 'M0,0 L0,6 L7,3 z');
          head.setAttribute('fill', '#d5fa79');
          marker.append(head);
          defs.append(marker);
          const origin = document.createElementNS(ns, 'circle');
          origin.setAttribute('r', '20');
          origin.setAttribute('fill', '#d5fa7926');
          origin.setAttribute('stroke', '#d5fa79');
          origin.setAttribute('stroke-width', '4');
          const line = document.createElementNS(ns, 'line');
          line.setAttribute('stroke', '#d5fa79');
          line.setAttribute('stroke-width', '11');
          line.setAttribute('stroke-linecap', 'round');
          line.setAttribute('marker-end', 'url(#exlives-worldchess-arrowhead)');
          line.setAttribute('filter', 'drop-shadow(0 1px 3px #172015)');
          svg.append(defs, origin, line);
          overlay.append(svg);
          document.documentElement.append(overlay);

          let observedBoard = null;
          let resizeObserver = null;
          const point = square => {
            let file = square.charCodeAt(0) - 97;
            let row = 8 - Number(square[1]);
            if (flipped) { file = 7 - file; row = 7 - row; }
            return { x: (file + 0.5) * 100, y: (row + 0.5) * 100 };
          };
          const update = () => {
            const currentBoard = findBoard();
            if (!currentBoard) { overlay.remove(); return; }
            if (currentBoard !== observedBoard) {
              resizeObserver?.disconnect();
              observedBoard = currentBoard;
              resizeObserver?.observe(observedBoard);
            }
            const rect = currentBoard.getBoundingClientRect();
            Object.assign(overlay.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
            const from = point(move.from), to = point(move.to);
            origin.setAttribute('cx', from.x); origin.setAttribute('cy', from.y);
            line.setAttribute('x1', from.x); line.setAttribute('y1', from.y);
            line.setAttribute('x2', to.x); line.setAttribute('y2', to.y);
          };
          resizeObserver = new ResizeObserver(update);
          resizeObserver.observe(boardElement);
          const onChange = () => update();
          window.addEventListener('resize', onChange);
          window.addEventListener('scroll', onChange, true);
          const mutationObserver = new MutationObserver(update);
          mutationObserver.observe(document.documentElement, { childList: true, subtree: true });
          globalThis.__exlivesWorldChessArrow = {
            dispose() {
              mutationObserver.disconnect();
              resizeObserver.disconnect();
              window.removeEventListener('resize', onChange);
              window.removeEventListener('scroll', onChange, true);
              overlay.remove();
            }
          };
          update();
          return { ok: true };
        }
      });
      if (injected?.result?.ok) return;
    } catch { /* Try the content-script overlay below. */ }
  }
  const message = {
      type: 'SHOW_MOVE_ARROW', move,
      boardRect: board.boardRect
  };
  try {
    await chrome.tabs.sendMessage(sourceTabId, message);
  } catch {
    try {
      await chrome.scripting.executeScript({ target: { tabId: sourceTabId }, files: ['content.js'] });
      await chrome.tabs.sendMessage(sourceTabId, message);
    } catch { /* The in-app arrow remains available if the page rejects the overlay. */ }
  }
}
async function clearArrowOnSite() {
  if (sourceTabId == null) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: sourceTabId },
      func: () => {
        globalThis.__exlivesWorldChessArrow?.dispose?.();
        delete globalThis.__exlivesWorldChessArrow;
        document.querySelector('#exlives-worldchess-arrow, #hamle-move-overlay')?.remove();
      }
    });
  } catch { /* The game tab may have closed or navigated away. */ }
  try { await chrome.tabs.sendMessage(sourceTabId, { type: 'CLEAR_MOVE_ARROW' }); } catch { /* The tab may have closed. */ }
}

window.addEventListener('pagehide', () => { void clearArrowOnSite(); });

function getSignature(board) {
  return JSON.stringify(Object.entries(board.pieces).sort(([a], [b]) => a.localeCompare(b)));
}

function getGameKey(tab) {
  try {
    const url = new URL(tab?.url || '');
    const match = url.pathname.match(/^\/[^/]+\/game\/([^/]+)/i) || url.pathname.match(/^\/game\/([^/]+)/i);
    return url.hostname.endsWith('worldchess.com') && match ? `${url.hostname}:${match[1]}` : null;
  } catch { return null; }
}

function describeMove(before, after, mover) {
  if (!before || !after) return null;
  const squares = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed = [...squares].filter(square => before[square] !== after[square]);
  const origins = changed.filter(square => before[square]?.[0] === mover && !after[square]);
  const destinations = changed.filter(square => after[square]?.[0] === mover && after[square] !== before[square]);
  if (!origins.length || !destinations.length) return null;
  const from = origins.find(square => before[square]?.[1] === 'k') || origins[0];
  const to = destinations.find(square => after[square]?.[1] === 'k') || destinations[0];
  const names = { p: 'Piyon', n: 'At', b: 'Fil', r: 'Kale', q: 'Vezir', k: 'Şah' };
  const piece = before[from]?.[1] || after[to]?.[1];
  const promotion = before[from]?.[1] === 'p' && after[to]?.[1] !== 'p'
    ? ` (terfi: ${names[after[to][1]] || 'taş'})` : '';
  return `${names[piece] || 'Taş'} ${from} → ${to}${promotion}`;
}

async function analyzeBoard(board, turn, game) {
  const generation = ++analysisGeneration;
  result.innerHTML = `<span class="thinking-line"><span class="spinner"></span>Analiz ediliyor…</span><span>${board.site} · ${turn === 'w' ? 'Beyaz' : 'Siyah'} için en iyi hamle aranıyor.</span>`;
  boardPreview.hidden = true;
  // Paint the status and snapshot the position before starting engine work.
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  if (board.error) throw new Error(board.error);
  if (game.isGameOver()) throw new Error('Bu konumda yasal hamle yok. Sıradaki rengi kontrol et.');
  let screenshotFailed = false;
  try { await captureBoard(board); } catch { screenshotFailed = true; }
  if (generation !== analysisGeneration) return;
  const engine = getStockfish();
  const depthSelect = document.querySelector('#depth');
  const selectedDepth = depthSelect.selectedOptions[0];
  const search = await engine.search(game.fen(), Number(depthSelect.value), info => {
    if (generation !== analysisGeneration) return;
    const score = scoreText(info);
    result.innerHTML = `<span class="thinking-line"><span class="spinner"></span>Analiz ediliyor… Derinlik ${info.depth}</span><span>${score}</span>`;
  }, Number(selectedDepth.dataset.time));
  if (generation !== analysisGeneration) return;
  // Keep the root position intact: the engine PV starts with this same move,
  // and explainMove replays that PV from the unmodified position.
  const move = moveFromUci(new Chess(game.fen()), search.uci);
  if (!move) throw new Error('Stockfish bu konumda yasal bir hamle döndürmedi.');
  const moveText = `${move.from} → ${move.to}${move.promotion ? `=${move.promotion.toUpperCase()}` : ''}`;
  const opponentLine = lastOpponentMove ? `<span class="opponent-move">Rakibin hamlesi: ${lastOpponentMove}</span>` : '';
  const explanation = explainMove(game, move, search.info);
  result.innerHTML = `<span>Canlı takip · ${board.site} · ${turn === 'w' ? 'Beyaz' : 'Siyah'} oynar</span>${opponentLine}<strong class="san">${move.san}</strong><span>Taşını ${moveText} oynat.</span><span class="explanation">${explanation}</span>`;
  showArrow(move, board.flipped);
  await showArrowOnSite(move, board);
  if (screenshotFailed) result.insertAdjacentHTML('beforeend', '<br><span>Tahta görüntüsü alınamadı; hamle önerisi hazır.</span>');
}

async function scanPosition(force = false) {
  if (scanning) return;
  scanning = true;
  try {
    const { tab, board } = await readCurrentBoard();
    if (board.error) {
      if (lastSignature === null) result.textContent = board.error;
      return;
    }
    let gameKey = getGameKey(tab);
    let signature = getSignature(board);
    let changed = signature !== lastSignature;
    let newGameDetected = lastSignature !== null && (
      (gameKey && lastGameKey && gameKey !== lastGameKey) ||
      (isStartingPosition(board) && (changed || board.flipped !== lastFlipped || (board.moveHistory || []).length < lastHistoryPly))
    );
    if (!changed && !newGameDetected && !force) return;
    // Wait for animations to settle, then read the board again. This avoids
    // treating an in-flight piece as a second move or missing the reply.
    if (changed && lastSignature !== null) {
      await new Promise(resolve => setTimeout(resolve, 350));
      const stable = await readCurrentBoard();
      if (stable.board.error) return;
      gameKey = getGameKey(stable.tab);
      board.pieces = stable.board.pieces;
      board.boardRect = stable.board.boardRect;
      board.viewport = stable.board.viewport;
      board.flipped = stable.board.flipped;
      board.turn = stable.board.turn;
      board.moveHistory = stable.board.moveHistory;
      signature = getSignature(board);
      changed = signature !== lastSignature;
      newGameDetected = lastSignature !== null && (
        (gameKey && lastGameKey && gameKey !== lastGameKey) ||
        (isStartingPosition(board) && (changed || board.flipped !== lastFlipped || (board.moveHistory || []).length < lastHistoryPly))
      );
    }
    // A full starting setup appearing after a played position signals a new game.
    // Reset remembered state and infer the player's side from board orientation.
    if (newGameDetected) {
      analysisGeneration++;
      stopStockfish();
      await clearArrowOnSite();
      trackedTurn = null;
      lastPieces = null;
      lastOpponentMove = null;
      lastHistoryPly = 0;
      lastSignature = null;
      ownColor = bottomPlayerColor(board);
      ownColorSelect.value = ownColor;
      autoDetectColor = true;
      document.querySelector('#move-arrow').hidden = true;
      boardPreview.hidden = true;
      result.textContent = 'Yeni oyun algılandı; taş rengin tahta yönüne göre ayarlandı.';
    }
    ownColor = ownColorSelect.value;
    if (!ownColor && autoDetectColor) {
      ownColor = bottomPlayerColor(board);
      ownColorSelect.value = ownColor;
    }
    if (!ownColor) {
      result.textContent = 'Kendi taş rengini seçerek canlı takibi başlat.';
      return;
    }
    const positionGame = gameFromPosition(board, ownColor);
    const moveHistory = board.moveHistory || [];
    const historyIsCurrent = positionGame.history().length === moveHistory.length && matchesBoard(positionGame, board.pieces);
    const previousTurn = trackedTurn;
    const previousPieces = lastPieces;
    if (lastSignature === null) {
      trackedTurn = historyIsCurrent ? positionGame.turn() : board.turn || (isStartingPosition(board) ? 'w' : ownColor);
      lastHistoryPly = historyIsCurrent ? moveHistory.length : 0;
      if (historyIsCurrent && moveHistory.length) {
        const lastMover = moveHistory.length % 2 ? 'w' : 'b';
        if (lastMover !== ownColor) lastOpponentMove = moveHistory.at(-1);
      }
    } else if (changed) {
      trackedTurn = historyIsCurrent ? positionGame.turn() : board.turn || (trackedTurn === 'w' ? 'b' : 'w');
      if (moveHistory.length < lastHistoryPly && historyIsCurrent) {
        lastOpponentMove = null;
        lastHistoryPly = 0;
      }
      if (historyIsCurrent && moveHistory.length > lastHistoryPly) {
        for (let ply = lastHistoryPly; ply < moveHistory.length; ply++) {
          const mover = ply % 2 ? 'b' : 'w';
          if (mover !== ownColor) lastOpponentMove = moveHistory[ply];
        }
        lastHistoryPly = moveHistory.length;
      } else if (previousPieces && previousTurn && previousTurn !== ownColor) {
        lastOpponentMove = describeMove(previousPieces, board.pieces, previousTurn) || lastOpponentMove;
      }
    } else if (historyIsCurrent && moveHistory.length > lastHistoryPly) {
      for (let ply = lastHistoryPly; ply < moveHistory.length; ply++) {
        const mover = ply % 2 ? 'b' : 'w';
        if (mover !== ownColor) lastOpponentMove = moveHistory[ply];
      }
      lastHistoryPly = moveHistory.length;
    }
    lastSignature = signature;
    lastFlipped = board.flipped;
    lastGameKey = gameKey;
    lastPieces = { ...board.pieces };
    latestBoard = board;
    if (trackedTurn !== ownColor) {
      analysisGeneration++;
      stopStockfish();
      await clearArrowOnSite();
      document.querySelector('#move-arrow').hidden = true;
      const opponentLine = lastOpponentMove ? `<span class="opponent-move">Rakibin hamlesi: ${lastOpponentMove}</span>` : '';
      result.innerHTML = `<span>Canlı takip · ${board.site}</span><strong class="san">Rakibin sırası</strong>${opponentLine}<span>Tahtayı izliyorum; sıra sana gelince güncel konumdan ipucu vereceğim.</span>`;
      try { await captureBoard(board); } catch { boardPreview.hidden = true; }
      return;
    }
    // Let later polls see opponent moves while Stockfish searches in its worker.
    scanning = false;
    await analyzeBoard(board, trackedTurn, positionGame);
  } catch (error) {
    result.textContent = errorText(error, 'Tahtayı okuyamadım. Satranç sekmesini yenileyip tekrar dene.');
  } finally { scanning = false; }
}

document.querySelector('#analyze').addEventListener('click', () => scanPosition(true));
document.querySelector('#show-on-board').addEventListener('click', async () => {
  try {
    await setMiniMode(true);
    await scanPosition(true);
  } catch (error) {
    result.textContent = errorText(error, 'Tahtayı otomatik algılayamadım. Satranç sekmesini kontrol edip tekrar dene.');
  }
});
document.querySelector('#new-game').addEventListener('click', () => {
  lastSignature = null;
  trackedTurn = null;
  latestBoard = null;
  lastPieces = null;
  lastOpponentMove = null;
  lastHistoryPly = 0;
  lastFlipped = null;
  lastGameKey = null;
  analysisGeneration++;
  stopStockfish();
  clearArrowOnSite();
  ownColor = '';
  autoDetectColor = true;
  ownColorSelect.value = '';
  document.querySelector('#depth').value = '12';
  boardPreview.hidden = true;
  document.querySelector('#move-arrow').hidden = true;
  result.textContent = 'Tahtanın yönünden taş rengin algılanıyor…';
  scanPosition(true);
});
ownColorSelect.addEventListener('change', async () => {
  ownColor = ownColorSelect.value;
  autoDetectColor = false;
  lastSignature = null;
  trackedTurn = null;
  latestBoard = null;
  lastPieces = null;
  lastOpponentMove = null;
  lastHistoryPly = 0;
  lastFlipped = null;
  lastGameKey = null;
  analysisGeneration++;
  stopStockfish();
  await clearArrowOnSite();
  document.querySelector('#move-arrow').hidden = true;
  boardPreview.hidden = true;
  if (liveTracking) scanPosition(true);
});
const liveToggle = document.querySelector('#live-toggle');
function setLiveTracking(enabled) {
  liveTracking = enabled;
  liveToggle.setAttribute('aria-pressed', String(enabled));
  liveToggle.classList.toggle('is-on', enabled);
  liveToggle.innerHTML = `<span class="toggle-dot"></span>Ekran izleme: ${enabled ? 'Açık' : 'Kapalı'}`;
  if (pollTimer !== null) { clearInterval(pollTimer); pollTimer = null; }
  if (enabled) {
    scanPosition();
    pollTimer = setInterval(() => scanPosition(), 1100);
  }
}
liveToggle.addEventListener('click', () => setLiveTracking(!liveTracking));
// Live tracking starts enabled; turn it off to analyze only on demand.
setLiveTracking(true);
