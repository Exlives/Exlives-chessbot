import { Chess } from './vendor/chess.js';
import { getStockfish, stopStockfish } from './engine.js';

const result = document.querySelector('#result');
const boardPreview = document.querySelector('#board-preview');
const boardImage = document.querySelector('#board-image');
const ownColorSelect = document.querySelector('#own-color');
let sourceTabId = null;
let boardWatchTabId = null;
let miniMode = false;
let microMode = false;
let miniWindowId = null;
let windowModeInitialized = false;
let boundsSaveTimer = null;
let pendingWindowBounds = null;
let pendingWindowMode = null;

const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));

function currentWindowMode() {
  return microMode ? 'micro' : miniMode ? 'mini' : 'full';
}

function isValidWindowBounds(bounds) {
  return bounds && [bounds.left, bounds.top, bounds.width, bounds.height].every(Number.isFinite);
}

function getStoredWindowBounds(settings, mode) {
  const saved = settings.chessbotWindowBounds;
  if (isValidWindowBounds(saved)) {
    return (settings.chessbotWindowMode || 'full') === mode ? saved : null;
  }
  return isValidWindowBounds(saved?.[mode]) ? saved[mode] : null;
}

async function saveWindowBounds(mode, bounds) {
  if (!isValidWindowBounds(bounds)) return;
  const settings = await chrome.storage.local.get(['chessbotWindowBounds', 'chessbotWindowMode']);
  let saved = settings.chessbotWindowBounds;
  if (isValidWindowBounds(saved)) {
    saved = { [settings.chessbotWindowMode || 'full']: saved };
  } else if (!saved || typeof saved !== 'object' || Array.isArray(saved)) {
    saved = {};
  }
  await chrome.storage.local.set({
    chessbotWindowBounds: { ...saved, [mode]: bounds }
  });
}

async function persistWindowBounds() {
  if (boundsSaveTimer !== null) {
    clearTimeout(boundsSaveTimer);
    boundsSaveTimer = null;
  }
  if (!pendingWindowBounds || !pendingWindowMode) return;
  const bounds = pendingWindowBounds;
  const mode = pendingWindowMode;
  pendingWindowBounds = null;
  pendingWindowMode = null;
  await saveWindowBounds(mode, bounds);
}

function scheduleWindowBoundsSave(win) {
  if (!isValidWindowBounds(win)) return;
  pendingWindowBounds = {
    left: win.left,
    top: win.top,
    width: win.width,
    height: win.height
  };
  pendingWindowMode = currentWindowMode();
  if (boundsSaveTimer !== null) clearTimeout(boundsSaveTimer);
  boundsSaveTimer = setTimeout(() => {
    boundsSaveTimer = null;
    void persistWindowBounds().catch(error => console.error('Pencere konumu kaydedilemedi.', error));
  }, 250);
}

function displayForBounds(displays, bounds) {
  const centerX = bounds.left + bounds.width / 2;
  const centerY = bounds.top + bounds.height / 2;
  return displays.find(({ workArea }) =>
    centerX >= workArea.left && centerX < workArea.left + workArea.width &&
    centerY >= workArea.top && centerY < workArea.top + workArea.height) ||
    displays.find(item => item.isPrimary) || displays[0];
}

function clampWindowBounds(bounds, display) {
  const area = display?.workArea;
  if (!area) return bounds;
  const width = Math.min(Math.max(180, bounds.width), area.width);
  const height = Math.min(Math.max(88, bounds.height), area.height);
  return {
    left: Math.min(Math.max(bounds.left, area.left), area.left + area.width - width),
    top: Math.min(Math.max(bounds.top, area.top), area.top + area.height - height),
    width,
    height
  };
}

async function setMiniMode(enabled, restoring = false) {
  const previousMode = currentWindowMode();
  const targetMode = enabled ? 'mini' : 'full';
  const win = await chrome.windows.getCurrent();
  miniWindowId = win.id;
  const displays = await chrome.system.display.getInfo();
  if (win.id == null) return;
  const currentBounds = { left: win.left, top: win.top, width: win.width, height: win.height };
  if (!restoring) {
    await persistWindowBounds();
    await saveWindowBounds(previousMode, currentBounds);
  }
  const settings = await chrome.storage.local.get(['chessbotWindowBounds', 'chessbotWindowMode']);
  const savedBounds = getStoredWindowBounds(settings, targetMode);
  const display = displayForBounds(displays, savedBounds || currentBounds);
  const area = display?.workArea;
  if (!area) return;
  const defaults = enabled
    ? { width: Math.max(180, Math.min(320, area.width - 16)), height: 190 }
    : {
        width: Math.min(520, Math.max(320, area.width - 24)),
        height: Math.min(1000, Math.max(560, area.height))
      };
  const bounds = clampWindowBounds(savedBounds || { ...currentBounds, ...defaults }, display);

  miniMode = enabled;
  microMode = false;
  document.body.classList.remove('micro-mode');
  document.body.classList.toggle('mini-mode', enabled);
  if (!enabled) document.body.style.width = '';
  await chrome.windows.update(win.id, {
    ...bounds,
    focused: true
  });
  if (!restoring) await chrome.storage.local.set({ chessbotWindowMode: targetMode });
  const toggle = document.querySelector('#mini-toggle');
  toggle.title = enabled ? 'Pencereyi büyüt' : 'Küçük pencereye geç';
  toggle.setAttribute('aria-label', toggle.title);
  const microToggle = document.querySelector('#micro-toggle');
  microToggle.textContent = 'Mini mod';
  microToggle.title = 'Mini mod';
  microToggle.setAttribute('aria-label', microToggle.title);
}

async function setMicroMode(enabled, restoring = false) {
  if (!miniMode || microMode === enabled) return;
  const previousMode = currentWindowMode();
  const targetMode = enabled ? 'micro' : 'mini';
  const win = await chrome.windows.getCurrent();
  miniWindowId = win.id;
  const displays = await chrome.system.display.getInfo();
  if (win.id == null) return;
  const currentBounds = { left: win.left, top: win.top, width: win.width, height: win.height };
  if (!restoring) {
    await persistWindowBounds();
    await saveWindowBounds(previousMode, currentBounds);
  }
  const settings = await chrome.storage.local.get(['chessbotWindowBounds', 'chessbotWindowMode']);
  const savedBounds = getStoredWindowBounds(settings, targetMode);
  const display = displayForBounds(displays, savedBounds || currentBounds);
  const area = display?.workArea;
  if (!area) return;
  const usableSavedBounds = enabled && savedBounds && savedBounds.height < 126 ? null : savedBounds;
  const defaults = enabled
    ? { width: 230, height: 126 }
    : { width: Math.max(180, Math.min(320, area.width - 16)), height: 190 };
  const bounds = clampWindowBounds(usableSavedBounds || { ...currentBounds, ...defaults }, display);

  microMode = enabled;
  document.body.classList.toggle('micro-mode', enabled);
  document.body.style.width = enabled ? '100%' : '';
  const toggle = document.querySelector('#micro-toggle');
  toggle.textContent = enabled ? 'Mini moda dön' : 'Mini mod';
  toggle.title = toggle.textContent;
  toggle.setAttribute('aria-label', toggle.title);

  await chrome.windows.update(win.id, {
    ...bounds,
    focused: true
  });
  if (!restoring) await chrome.storage.local.set({ chessbotWindowMode: targetMode });
}

chrome.windows.onBoundsChanged.addListener(win => {
  if (!windowModeInitialized || win.id !== miniWindowId || win.state === 'minimized') return;
  scheduleWindowBoundsSave(win);
});

void chrome.windows.getCurrent().then(win => {
  miniWindowId = win.id;
}).catch(error => console.error('Pencere kimliği okunamadı.', error));

window.addEventListener('beforeunload', () => {
  void persistWindowBounds().catch(error => console.error('Pencere konumu kaydedilemedi.', error));
});

// Chrome extensions cannot set the OS-level always-on-top flag for a window.
// Keep the compact helper above other Chrome windows by raising it whenever
// focus moves to another Chrome window. External applications are unaffected.
let restoringMiniFocus = false;
chrome.windows.onFocusChanged.addListener(async focusedWindowId => {
  if (!miniMode || restoringMiniFocus || focusedWindowId === chrome.windows.WINDOW_ID_NONE) return;
  const ownWindow = await chrome.windows.getCurrent();
  if (ownWindow.id == null || ownWindow.state === 'minimized' || focusedWindowId === ownWindow.id) return;
  restoringMiniFocus = true;
  try { await chrome.windows.update(ownWindow.id, { focused: true }); }
  catch { /* The helper may have closed while focus was changing. */ }
  finally { restoringMiniFocus = false; }
});

document.querySelector('#close-app').addEventListener('click', async () => {
  await clearArrowOnSite();
  await persistWindowBounds();
  const win = await chrome.windows.getCurrent();
  if (win.id != null) chrome.windows.remove(win.id);
});
document.querySelector('#mini-toggle').addEventListener('click', () => setMiniMode(!miniMode));
document.querySelector('#micro-toggle').addEventListener('click', async () => {
  if (!miniMode) await setMiniMode(true);
  await setMicroMode(!microMode);
});
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
function getPositionState(board, fallbackTurn) {
  const moveHistory = board.moveHistory || [];
  const initialPosition = isStartingPosition(board);
  const game = gameFromPosition(board, initialPosition ? 'w' : (board.turn || fallbackTurn));
  const historyIsCurrent = (moveHistory.length > 0 || initialPosition) &&
    game.history().length === moveHistory.length &&
    matchesBoard(game, board.pieces);
  const historyTurn = historyIsCurrent ? game.turn() : null;
  const boardTurn = board.turn === 'w' || board.turn === 'b' ? board.turn : null;
  const turn = historyTurn && boardTurn && historyTurn !== boardTurn
    ? null
    : historyTurn || boardTurn || (initialPosition ? 'w' : null);
  return { game, moveHistory, historyIsCurrent, turn };
}
function gameAfterSingleLegalMove(game, pieces) {
  if (!game) return null;
  for (const move of game.moves({ verbose: true })) {
    const next = new Chess(game.fen());
    next.move({ from: move.from, to: move.to, ...(move.promotion ? { promotion: move.promotion } : {}) });
    if (matchesBoard(next, pieces)) return next;
  }
  return null;
}
function moveFromUci(game, uci) {
  const match = uci?.match(/^([a-h][1-8])([a-h][1-8])([qrbn])?$/);
  if (!match) return null;
  return game.move({ from: match[1], to: match[2], ...(match[3] ? { promotion: match[3] } : {}) });
}
function nonRepeatingSearchMoves(game, historyIsCurrent) {
  const hasNonPawnMaterial = game.board().flat().some(piece => piece && !['k', 'p'].includes(piece.type));
  if (!historyIsCurrent || !hasNonPawnMaterial) return null;

  const moves = game.moves({ verbose: true });
  const repeatingMoves = new Set();
  for (const move of moves) {
    const uci = `${move.from}${move.to}${move.promotion || ''}`;
    game.move({ from: move.from, to: move.to, ...(move.promotion ? { promotion: move.promotion } : {}) });
    try {
      if (game.isThreefoldRepetition()) repeatingMoves.add(uci);
    } finally {
      game.undo();
    }
  }
  if (!repeatingMoves.size) return null;
  const allowedMoves = moves
    .map(move => `${move.from}${move.to}${move.promotion || ''}`)
    .filter(uci => !repeatingMoves.has(uci));
  return allowedMoves.length ? allowedMoves : null;
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
      const terminalText = /\b(checkmate|stalemate|draw|resign(?:ed|s)?|wins?|won|lost|victory|defeat|timeout|flagged|abandoned|game over|game ended)\b|\bgame\s+(?:has\s+)?(?:finished|ended)\b|oyun\s+(?:bitti|sona erdi)|berabere|terk(?:\s+etti)?|kazandı|kaybetti|süre\s+doldu|şah\s+mat\b/i;
      const gameOver = [...document.querySelectorAll(
        '.game__result, .result-wrap, .game-over-modal, wc-chess-game-over-modal, [class*="game-over"], [class*="gameOver"], [class*="game-result"], [data-testid*="game-over"], [data-testid*="game-result"], [data-cy*="game-result"]'
      )].some(element => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        const text = (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim();
        if (!rect.width || !rect.height || style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
        return text.length > 0 && text.length <= 400 && terminalText.test(text);
      });
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
        gameOver,
        turn: moveHistory.length % 2 ? 'b' : (moveHistory.length || isInitialPosition ? 'w' : null)
      };
    }
  });
  const board = injected?.result || null;
  if (board) {
    try {
      const clock = await chrome.tabs.sendMessage(tabId, {
        type: 'READ_CHESS_CLOCK',
        boardRect: board.boardRect,
        flipped: board.flipped,
        turn: board.turn
      });
      board.clockSeconds = Number.isFinite(clock?.seconds) ? clock.seconds : null;
    } catch { /* Clock detection is optional; normal analysis remains available. */ }
  }
  if (board && boardWatchTabId !== tabId) {
    const watch = await chrome.tabs.sendMessage(tabId, { type: 'START_CHESS_BOARD_WATCH' });
    if (watch?.ok) boardWatchTabId = tabId;
  }
  return board;
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
let lastConfirmedGame = null;
let verifiedWorldChessPosition = null;
let speculativeWorldChessPosition = null;
let lastAnalyzedWorldChessSignature = null;
let lastFlipped = null;
let lastGameKey = null;
let worldChessHistoryPending = false;
let analysisInProgressSignature = null;
let analysisInProgressToken = 0;
let analysisInProgressFast = false;
let scanning = false;
let forcedScanQueued = false;
let gameFinished = false;
let ownColor = ownColorSelect.value;
let liveTracking = true;
let pollTimer = null;
let analysisGeneration = 0;
let autoDetectColor = true;
let autoPlay = true;
let autoAppliedSignature = null;
let autoMoveInProgress = false;
let awaitingOpponentMoveSignature = null;

// Keep board recognition responsive without repeatedly reading the page too aggressively.
const BOARD_SETTLE_MS = 75;
const LIVE_POLL_MS = 100;
const LOW_TIME_THRESHOLD_SECONDS = 20;
const LOW_TIME_SEARCH_DEPTH = 12;
const LOW_TIME_SEARCH_MS = 50;

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
  let tab;
  if (Number.isInteger(tabId) && tabId > 0) tab = await chrome.tabs.get(tabId);
  else {
    const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    tab = activeTab;
  }
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

async function applyMoveOnSite(move, board) {
  if (sourceTabId == null) return { error: 'Oyun sekmesi bulunamadı.' };
  try {
    const [pageState] = await chrome.scripting.executeScript({
      target: { tabId: sourceTabId },
      func: () => ({
        isLichess: location.hostname === 'lichess.org',
        isSpectator: /spectator/i.test(document.title) ||
          [...document.querySelectorAll('[role="tab"], .tabs-horiz a, .game__meta')].some(el => /spectator room/i.test(el.textContent || ''))
      })
    });
    if (pageState?.result?.isLichess && pageState.result.isSpectator) {
      return { error: 'Bu Lichess sekmesi izleyici görünümünde; oyunda manuel hamle de yapılamıyor. Lichess’te “Play with the computer” üzerinden oyuncu oyunu başlatıp o sekmeyi seç.' };
    }
  } catch (error) {
    return { error: `Lichess oyun sekmesini doğrulayamadım: ${error.message}` };
  }
  const sendMoveInput = async mode => {
    const { board: inputBoard } = await readCurrentBoard();
    if (!inputBoard || inputBoard.error) {
      return { error: inputBoard?.error || 'Hamle öncesi tahta ölçüleri alınamadı.' };
    }
    if (getSignature(inputBoard) !== getSignature(board)) {
      return { error: 'Tahta hamle gönderilmeden önce değişti; yeni konumu analiz ediyorum.' };
    }
    const inputPosition = getPositionState(inputBoard, ownColor);
    const currentTurnVerified = inputBoard.site !== 'World Chess'
      ? inputPosition.turn === ownColor
      : (inputPosition.historyIsCurrent || inputPosition.moveHistory.length > 0) &&
        inputPosition.turn === ownColor;
    const verifiedWorldChessTurn = inputBoard.site === 'World Chess' &&
      verifiedWorldChessPosition?.signature === getSignature(inputBoard) &&
      verifiedWorldChessPosition.game.turn() === ownColor;
    if (!currentTurnVerified && !verifiedWorldChessTurn) {
      return { error: 'Hamle gönderilmeden önce sıra doğrulanamadı; rakibin sırasındayken hamle yapmıyorum.' };
    }
    return chrome.runtime.sendMessage({
      type: 'APPLY_TRUSTED_CHESS_MOVE',
      tabId: sourceTabId,
      move,
      flipped: inputBoard.flipped,
      boardRect: inputBoard.boardRect,
      mode
    });
  };
  const waitForBoardChange = async timeoutMs => {
    const deadline = Date.now() + timeoutMs;
    let lastReadError = null;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 100));
      try {
        const { board: updated } = await readCurrentBoard();
        if (updated && !updated.error && getSignature(updated) !== getSignature(board)) {
          return { changed: true };
        }
        if (!updated) lastReadError = new Error('İçerik betiği tahtadan yanıt vermedi.');
        else if (updated.error) lastReadError = new Error(updated.error);
      } catch (error) {
        lastReadError = error;
      }
    }
    return { changed: false, lastReadError };
  };
  try {
    const primaryMode = board.site === 'Lichess' ? 'click' : 'drag';
    const applied = await sendMoveInput(primaryMode);
    if (applied?.error) return applied;
    let verification = await waitForBoardChange(primaryMode === 'click' ? 1800 : 4000);
    if (verification.changed) return { ok: true, changed: true };

    const fallbackMode = primaryMode === 'click'
      ? 'drag'
      : board.site === 'World Chess' ? 'click' : null;
    if (fallbackMode && !verification.lastReadError) {
      const fallback = await sendMoveInput(fallbackMode);
      if (fallback?.error) return fallback;
      verification = await waitForBoardChange(3200);
      if (verification.changed) return { ok: true, changed: true };
    }

    const reason = verification.lastReadError ? ` Tahta okunurken son hata: ${verification.lastReadError.message}` : '';
    return { error: `Hamle gönderildi ancak tahtada doğrulanmadı.${reason}` };
  } catch (error) {
    return { error: `Hamle uygulanamadı: ${error?.message || String(error)}` };
  }
}

window.addEventListener('pagehide', () => { void clearArrowOnSite(); });

function getSignature(board) {
  return JSON.stringify(Object.entries(board.pieces).sort(([a], [b]) => a.localeCompare(b)));
}

function getGameKey(tab) {
  try {
    const url = new URL(tab?.url || '');
    if (url.hostname.endsWith('worldchess.com')) {
      const match = url.pathname.match(/^\/[^/]+\/game\/([^/]+)/i) || url.pathname.match(/^\/game\/([^/]+)/i);
      return match ? `${url.hostname}:${match[1]}` : null;
    }
    if (url.hostname.endsWith('chess.com')) {
      const match = url.pathname.match(/\/game\/(?:live|daily)\/([^/]+)/i);
      return match ? `${url.hostname}:${match[1]}` : null;
    }
    if (url.hostname.endsWith('lichess.org')) {
      const match = url.pathname.match(/^\/([a-z0-9]{8})(?:\/(?:white|black))?\/?$/i);
      return match ? `${url.hostname}:${match[1]}` : null;
    }
    return null;
  } catch { return null; }
}

function hasNewGameStarted(board, gameKey, changed) {
  const moveCount = (board.moveHistory || []).length;
  const restartedAfterFinish = gameFinished && changed &&
    (moveCount <= 2 || moveCount < lastHistoryPly);
  return lastSignature !== null && (
    (gameKey && lastGameKey && gameKey !== lastGameKey) ||
    restartedAfterFinish ||
    (isStartingPosition(board) && (changed || board.flipped !== lastFlipped || moveCount < lastHistoryPly))
  );
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

async function analyzeBoard(board, turn, game, historyIsCurrent) {
  const generation = ++analysisGeneration;
  const signature = getSignature(board);
  const depthSelect = document.querySelector('#depth');
  const selectedDepth = depthSelect.selectedOptions[0];
  const lowTime = turn === ownColor && Number.isFinite(board.clockSeconds) &&
    board.clockSeconds <= LOW_TIME_THRESHOLD_SECONDS;
  const searchDepth = lowTime ? LOW_TIME_SEARCH_DEPTH : Number(depthSelect.value);
  const searchTimeMs = lowTime ? LOW_TIME_SEARCH_MS : Number(selectedDepth.dataset.time);
  const useLiteEngine = selectedDepth.value === '12';
  const searchMoves = nonRepeatingSearchMoves(game, historyIsCurrent);
  const avoidingRepetition = searchMoves !== null;
  analysisInProgressFast = lowTime || searchTimeMs <= 800;
  const timingLabel = `${lowTime ? ' · Süre az, hızlı mod' : ''}${avoidingRepetition ? ' · Tekrar beraberliği önleniyor' : ''}`;
  result.innerHTML = `<span class="thinking-line"><span class="spinner"></span>Analiz ediliyor…${timingLabel}</span><span>${board.site} · ${turn === 'w' ? 'Beyaz' : 'Siyah'} için en iyi hamle aranıyor.</span>`;
  boardPreview.hidden = true;
  // Paint the status and snapshot the position before starting engine work.
  if (document.visibilityState === 'visible') {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }
  if (board.error) throw new Error(board.error);
  if (game.isGameOver()) throw new Error('Bu konumda yasal hamle yok. Sıradaki rengi kontrol et.');
  // The preview is independent from engine analysis. Start both at once so a
  // screenshot/canvas decode cannot delay the first engine result.
  const screenshotPromise = autoPlay && miniMode
    ? Promise.resolve(false)
    : captureBoard(board).then(() => false).catch(() => true);
  if (generation !== analysisGeneration) return;
  const engine = getStockfish();
  let search;
  try {
    search = await engine.search(game.fen(), searchDepth, info => {
      if (generation !== analysisGeneration) return;
      const score = scoreText(info);
      const progressLabel = `${lowTime ? ' · Süre az, hızlı mod' : ` Derinlik ${info.depth}`}${avoidingRepetition ? ' · Tekrar beraberliği önleniyor' : ''}`;
      result.innerHTML = `<span class="thinking-line"><span class="spinner"></span>Analiz ediliyor…${progressLabel}</span><span>${score}</span>`;
    }, searchTimeMs, () => generation === analysisGeneration, useLiteEngine, searchMoves);
  } catch (error) {
    if (generation !== analysisGeneration) return;
    throw error;
  }
  if (generation !== analysisGeneration) return;
  const { board: currentBoard } = await readCurrentBoard();
  if (generation !== analysisGeneration) return;
  const currentPosition = currentBoard.error ? null : getPositionState(currentBoard, ownColor);
  if (currentBoard.error || getSignature(currentBoard) !== signature ||
      currentPosition?.turn !== turn) {
    const invalidationGeneration = ++analysisGeneration;
    stopStockfish();
    await clearArrowOnSite();
    if (invalidationGeneration !== analysisGeneration) return;
    document.querySelector('#move-arrow').hidden = true;
    result.textContent = 'Tahta veya hamle sırası değişti; güncel konumu tekrar kontrol ediyorum.';
    forcedScanQueued = true;
    return;
  }
  // Keep the root position intact: the engine PV starts with this same move,
  // and explainMove replays that PV from the unmodified position.
  const move = moveFromUci(new Chess(game.fen()), search.uci);
  if (!move) throw new Error('Stockfish bu konumda yasal bir hamle döndürmedi.');
  const moveText = `${move.from} → ${move.to}${move.promotion ? `=${move.promotion.toUpperCase()}` : ''}`;
  const opponentLine = lastOpponentMove ? `<span class="opponent-move">Rakibin hamlesi: ${lastOpponentMove}</span>` : '';
  const explanation = explainMove(game, move, search.info);
  const repetitionNote = avoidingRepetition
    ? '<span class="explanation">Üç tekrar beraberliğine götüren hamlelerden kaçınıldı.</span>'
    : '';
  result.innerHTML = `<span>Canlı takip · ${board.site} · ${turn === 'w' ? 'Beyaz' : 'Siyah'} oynar</span>${opponentLine}<strong class="san">${move.san}</strong><span>Taşını ${moveText} oynat.</span><span class="explanation">${explanation}</span>${repetitionNote}`;
  showArrow(move, board.flipped);
  if (board.site === 'World Chess' || !autoPlay) void showArrowOnSite(move, board);
  if (autoPlay && !autoMoveInProgress) {
    if (autoAppliedSignature !== signature) {
      autoMoveInProgress = true;
      let moveApplied = false;
      try {
        if (generation !== analysisGeneration || !autoPlay) return;
        const { board: currentBoard } = await readCurrentBoard();
        const currentPosition = currentBoard.error ? null : getPositionState(currentBoard, ownColor);
        const currentTurn = currentPosition?.turn;
        const currentTurnVerified = currentBoard.site === 'World Chess'
          ? (currentPosition?.historyIsCurrent || currentPosition?.moveHistory.length > 0) &&
            currentTurn === ownColor
          : currentTurn === ownColor;
        const verifiedWorldChessTurn = currentBoard.site === 'World Chess' &&
          verifiedWorldChessPosition?.signature === signature &&
          verifiedWorldChessPosition.game.turn() === ownColor &&
          getSignature(currentBoard) === signature;
        if (generation !== analysisGeneration || !autoPlay) return;
        if (currentBoard.error || getSignature(currentBoard) !== signature ||
            (!currentTurnVerified && !verifiedWorldChessTurn)) {
          result.insertAdjacentHTML('beforeend', '<br><span class="explanation">Otomatik oyun: Analiz hazır; tahta ve hamle sırası doğrulanana kadar hamle göndermiyorum.</span>');
          return;
        }
        const applied = await applyMoveOnSite({ from: move.from, to: move.to, promotion: move.promotion }, currentBoard);
        if (generation !== analysisGeneration) return;
        if (applied?.error) {
          result.insertAdjacentHTML('beforeend', `<br><span class="explanation">Otomatik oyun: ${errorText(applied.error, 'Hamle uygulanamadı.')}</span>`);
          if (/izleyici modunda/i.test(errorText(applied.error, ''))) {
            autoPlay = false;
            autoPlayToggle.setAttribute('aria-pressed', 'false');
            autoPlayToggle.classList.remove('is-on');
            autoPlayToggle.innerHTML = '<span class="toggle-dot"></span>Otomatik oyun: Kapalı';
            setLiveTracking(false);
          }
        } else if (applied?.changed === false) {
          result.insertAdjacentHTML('beforeend', '<br><span class="explanation">Otomatik oyun: Hamle gönderildi, ancak tahtada değişiklik doğrulanamadı.</span>');
        } else {
          moveApplied = true;
          autoAppliedSignature = signature;
          const playedGame = new Chess(game.fen());
          playedGame.move({ from: move.from, to: move.to, ...(move.promotion ? { promotion: move.promotion } : {}) });
          lastConfirmedGame = playedGame;
          trackedTurn = playedGame.turn();
          awaitingOpponentMoveSignature = getSignature({ pieces: boardMapFromGame(playedGame) });
          verifiedWorldChessPosition = null;
          speculativeWorldChessPosition = null;
          result.insertAdjacentHTML('beforeend', '<br><span class="explanation">Otomatik oyun: Hamle tahtaya uygulandı.</span>');
        }
      } finally {
        autoMoveInProgress = false;
        if (liveTracking && moveApplied) forcedScanQueued = true;
      }
    }
  }
  screenshotPromise.then(screenshotFailed => {
    if (generation !== analysisGeneration || !screenshotFailed) return;
    result.insertAdjacentHTML('beforeend', '<br><span>Tahta görüntüsü alınamadı; hamle önerisi hazır.</span>');
  });
}

async function waitForNextGame(board, signature, gameKey) {
  if (!gameFinished) {
    gameFinished = true;
    analysisGeneration++;
    stopStockfish();
    await clearArrowOnSite();
    document.querySelector('#move-arrow').hidden = true;
    boardPreview.hidden = true;
    autoAppliedSignature = null;
  }
  awaitingOpponentMoveSignature = null;
  if (signature && board.pieces) {
    lastSignature = signature;
    lastPieces = { ...board.pieces };
    lastFlipped = board.flipped;
    lastGameKey = gameKey;
    latestBoard = board;
    if (Array.isArray(board.moveHistory)) lastHistoryPly = board.moveHistory.length;
  } else {
    lastSignature = '[]';
    lastPieces = {};
    lastFlipped = null;
    lastGameKey = gameKey || 'game-finished';
    lastHistoryPly = 0;
  }
  trackedTurn = null;
  result.textContent = 'Oyun bitti. Yeni oyun başlayana kadar bekliyorum.';
}

async function scanPosition(force = false) {
  if (scanning || autoMoveInProgress) {
    if (force) forcedScanQueued = true;
    return;
  }
  scanning = true;
  try {
    const { tab, board } = await readCurrentBoard();
    if (board.error) {
      if (board.gameOver) await waitForNextGame(board, null, getGameKey(tab));
      else if (lastSignature === null) result.textContent = board.error;
      return;
    }
    let gameKey = getGameKey(tab);
    let signature = getSignature(board);
    let changed = signature !== lastSignature;
    if (changed) lastAnalyzedWorldChessSignature = null;
    const boardTurnChanged = board.turn != null && board.turn !== trackedTurn;
    const worldChessHistoryChanged = board.site === 'World Chess' &&
      (board.moveHistory || []).length !== lastHistoryPly;
    if (board.site !== 'World Chess') {
      worldChessHistoryPending = false;
      lastConfirmedGame = null;
      verifiedWorldChessPosition = null;
      speculativeWorldChessPosition = null;
      lastAnalyzedWorldChessSignature = null;
    }
    let newGameDetected = hasNewGameStarted(board, gameKey, changed);
    if (board.gameOver && !(gameFinished && newGameDetected)) {
      await waitForNextGame(board, signature, gameKey);
      return;
    }
    if (gameFinished && !newGameDetected) return;
    if (analysisInProgressSignature === signature && !analysisInProgressFast &&
        trackedTurn === ownColor && (board.turn == null || board.turn === ownColor) &&
        Number.isFinite(board.clockSeconds) && board.clockSeconds <= LOW_TIME_THRESHOLD_SECONDS) {
      analysisGeneration++;
      analysisInProgressFast = true;
      forcedScanQueued = true;
      if (board.site === 'World Chess') lastAnalyzedWorldChessSignature = null;
      stopStockfish();
    }
    if (!changed && !newGameDetected && !force && trackedTurn !== null &&
        !boardTurnChanged && !worldChessHistoryChanged && !worldChessHistoryPending) return;
    // Wait for animations to settle, then read the board again. This avoids
    // treating an in-flight piece as a second move or missing the reply.
    if (changed && lastSignature !== null) {
      await new Promise(resolve => setTimeout(resolve, BOARD_SETTLE_MS));
      const stable = await readCurrentBoard();
      if (stable.board.error) {
        if (stable.board.gameOver) {
          await waitForNextGame(stable.board, null, getGameKey(stable.tab));
        }
        return;
      }
      gameKey = getGameKey(stable.tab);
      board.pieces = stable.board.pieces;
      board.boardRect = stable.board.boardRect;
      board.viewport = stable.board.viewport;
      board.flipped = stable.board.flipped;
      board.turn = stable.board.turn;
      board.clockSeconds = stable.board.clockSeconds;
      board.moveHistory = stable.board.moveHistory;
      board.gameOver = stable.board.gameOver;
      signature = getSignature(board);
      changed = signature !== lastSignature;
      newGameDetected = hasNewGameStarted(board, gameKey, changed);
      if (board.gameOver && !(gameFinished && newGameDetected)) {
        await waitForNextGame(board, signature, gameKey);
        return;
      }
    }
    if (gameFinished && !newGameDetected) return;
    if (newGameDetected) gameFinished = false;
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
      lastConfirmedGame = null;
      verifiedWorldChessPosition = null;
      speculativeWorldChessPosition = null;
      lastAnalyzedWorldChessSignature = null;
      autoAppliedSignature = null;
      awaitingOpponentMoveSignature = null;
      worldChessHistoryPending = false;
      analysisInProgressSignature = null;
      analysisInProgressFast = false;
      gameFinished = false;
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
    const position = getPositionState(board, ownColor);
    let { game: positionGame, turn: observedTurn } = position;
    const { moveHistory, historyIsCurrent } = position;
    const previousTurn = trackedTurn;
    const previousPieces = lastPieces;
    if (historyIsCurrent) {
      if (autoAppliedSignature !== signature) {
        lastConfirmedGame = new Chess(positionGame.fen());
      }
      verifiedWorldChessPosition = null;
      speculativeWorldChessPosition = null;
    } else if (board.site === 'World Chess') {
      if (autoAppliedSignature && changed && lastConfirmedGame &&
          matchesBoard(lastConfirmedGame, board.pieces)) {
        positionGame = new Chess(lastConfirmedGame.fen());
        verifiedWorldChessPosition = { signature, game: positionGame };
        speculativeWorldChessPosition = null;
        observedTurn = positionGame.turn();
      } else if (verifiedWorldChessPosition?.signature === signature) {
        positionGame = new Chess(verifiedWorldChessPosition.game.fen());
        observedTurn = positionGame.turn();
      } else if (changed && previousTurn && previousTurn !== ownColor && previousPieces) {
        const confirmedPreviousGame = lastConfirmedGame?.turn() === previousTurn &&
          matchesBoard(lastConfirmedGame, previousPieces)
          ? lastConfirmedGame
          : new Chess(getFen(previousPieces, previousTurn));
        const inferredGame = gameAfterSingleLegalMove(confirmedPreviousGame, board.pieces);
        if (inferredGame?.turn() === ownColor) {
          verifiedWorldChessPosition = { signature, game: inferredGame };
          speculativeWorldChessPosition = null;
          positionGame = inferredGame;
          observedTurn = inferredGame.turn();
        }
      }
      if (verifiedWorldChessPosition?.signature !== signature &&
          speculativeWorldChessPosition?.signature === signature) {
        positionGame = new Chess(speculativeWorldChessPosition.game.fen());
        observedTurn = ownColor;
      } else if (verifiedWorldChessPosition?.signature !== signature &&
          ((observedTurn === ownColor && !previousTurn) ||
            (changed && previousTurn && previousTurn !== ownColor))) {
        positionGame = new Chess(getFen(board.pieces, ownColor));
        speculativeWorldChessPosition = { signature, game: positionGame };
        observedTurn = ownColor;
      }
    }
    if (autoAppliedSignature && changed && signature !== autoAppliedSignature) {
      autoAppliedSignature = null;
    }
    if (lastSignature === null) {
      trackedTurn = observedTurn;
      lastHistoryPly = historyIsCurrent ? moveHistory.length : 0;
      if (historyIsCurrent && moveHistory.length) {
        const lastMover = moveHistory.length % 2 ? 'w' : 'b';
        if (lastMover !== ownColor) lastOpponentMove = moveHistory.at(-1);
      }
    } else if (changed) {
      trackedTurn = observedTurn;
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
      trackedTurn = observedTurn;
      for (let ply = lastHistoryPly; ply < moveHistory.length; ply++) {
        const mover = ply % 2 ? 'b' : 'w';
        if (mover !== ownColor) lastOpponentMove = moveHistory[ply];
      }
      lastHistoryPly = moveHistory.length;
    } else {
      trackedTurn = observedTurn;
    }
    if (board.site === 'World Chess' && !historyIsCurrent) lastHistoryPly = moveHistory.length;
    lastSignature = signature;
    lastFlipped = board.flipped;
    lastGameKey = gameKey;
    lastPieces = { ...board.pieces };
    latestBoard = board;
    const worldChessHistoryNeedsSync = board.site === 'World Chess' &&
      moveHistory.length > 0 && !historyIsCurrent;
    const hasVerifiedWorldChessPosition = verifiedWorldChessPosition?.signature === signature;
    const hasSpeculativeWorldChessPosition = speculativeWorldChessPosition?.signature === signature;
    worldChessHistoryPending = worldChessHistoryNeedsSync && !hasVerifiedWorldChessPosition;
    if (positionGame.isGameOver()) {
      await waitForNextGame(board, signature, gameKey);
      return;
    }
    if (awaitingOpponentMoveSignature) {
      const opponentReplied = signature !== awaitingOpponentMoveSignature &&
        trackedTurn === ownColor;
      if (opponentReplied) {
        awaitingOpponentMoveSignature = null;
      } else {
        const waitingMessage = 'Hamle uygulandı; rakibin yanıtını bekliyorum.';
        if (result.textContent !== waitingMessage) {
          analysisGeneration++;
          stopStockfish();
          await clearArrowOnSite();
          document.querySelector('#move-arrow').hidden = true;
        }
        result.textContent = waitingMessage;
        return;
      }
    }
    if (autoAppliedSignature === signature) {
      const waitingMessage = 'Hamle uygulandı; rakibin yanıtını bekliyorum.';
      if (result.textContent !== waitingMessage) {
        analysisGeneration++;
        stopStockfish();
        await clearArrowOnSite();
        document.querySelector('#move-arrow').hidden = true;
        result.textContent = waitingMessage;
      }
      return;
    }
    if (worldChessHistoryPending && !hasSpeculativeWorldChessPosition && !observedTurn) {
      analysisGeneration++;
      stopStockfish();
      if (!result.textContent.includes('Hamle geçmişi eşleştiriliyor')) {
        result.innerHTML = `<span>Canlı takip · ${board.site}</span><strong class="san">Konum doğrulanıyor</strong><span>Hamle geçmişi eşleştiriliyor; doğrulanınca devam edeceğim.</span>`;
      }
      return;
    }
    if (board.site === 'World Chess' && historyIsCurrent &&
        lastAnalyzedWorldChessSignature === signature) {
      lastAnalyzedWorldChessSignature = null;
    }
    if (trackedTurn === null) {
      if (previousTurn !== null || changed || force) {
        if (!autoMoveInProgress) {
          analysisGeneration++;
          stopStockfish();
        }
        await clearArrowOnSite();
        document.querySelector('#move-arrow').hidden = true;
        result.innerHTML = `<span>Canlı takip · ${board.site}</span><strong class="san">Hamle sırası belirsiz</strong><span>Tahtadan hamle sırası doğrulanamadı; güvenlik için bekliyorum.</span>`;
      }
      return;
    }
    if (trackedTurn !== ownColor) {
      if (board.site === 'World Chess' && worldChessHistoryPending && !changed) return;
      if (!autoMoveInProgress) {
        analysisGeneration++;
        stopStockfish();
      }
      await clearArrowOnSite();
      document.querySelector('#move-arrow').hidden = true;
      const opponentLine = lastOpponentMove ? `<span class="opponent-move">Rakibin hamlesi: ${lastOpponentMove}</span>` : '';
      result.innerHTML = `<span>Canlı takip · ${board.site}</span><strong class="san">Rakibin sırası</strong>${opponentLine}<span>Tahtayı izliyorum; sıra sana gelince güncel konumdan ipucu vereceğim.</span>`;
      if (!miniMode) {
        void captureBoard(board).catch(() => { boardPreview.hidden = true; });
      }
      return;
    }
    // Let later polls see opponent moves while Stockfish searches in its worker.
    scanning = false;
    if (board.site === 'World Chess' && lastAnalyzedWorldChessSignature === signature) return;
    if (analysisInProgressSignature === signature) {
      if (force) forcedScanQueued = true;
      return;
    }
    const analysisToken = ++analysisInProgressToken;
    analysisInProgressSignature = signature;
    if (board.site === 'World Chess') lastAnalyzedWorldChessSignature = signature;
    try {
      await analyzeBoard(board, trackedTurn, positionGame, historyIsCurrent);
    } finally {
      if (analysisInProgressToken === analysisToken && analysisInProgressSignature === signature) {
        analysisInProgressSignature = null;
        analysisInProgressFast = false;
      }
    }
  } catch (error) {
    result.textContent = errorText(error, 'Tahtayı okuyamadım. Satranç sekmesini yenileyip tekrar dene.');
  } finally {
    scanning = false;
    if (forcedScanQueued && !autoMoveInProgress && !analysisInProgressSignature) {
      forcedScanQueued = false;
      setTimeout(() => { void scanPosition(true); }, 0);
    }
  }
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
  gameFinished = false;
  trackedTurn = null;
  latestBoard = null;
  lastPieces = null;
  lastOpponentMove = null;
  lastHistoryPly = 0;
  lastConfirmedGame = null;
  verifiedWorldChessPosition = null;
  speculativeWorldChessPosition = null;
  lastAnalyzedWorldChessSignature = null;
  lastFlipped = null;
  lastGameKey = null;
  worldChessHistoryPending = false;
  analysisInProgressSignature = null;
  analysisInProgressFast = false;
  autoAppliedSignature = null;
  awaitingOpponentMoveSignature = null;
  analysisGeneration++;
  stopStockfish();
  clearArrowOnSite();
  ownColor = '';
  autoDetectColor = true;
  ownColorSelect.value = '';
  document.querySelector('#depth').value = '20';
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
  lastConfirmedGame = null;
  verifiedWorldChessPosition = null;
  speculativeWorldChessPosition = null;
  lastAnalyzedWorldChessSignature = null;
  lastFlipped = null;
  lastGameKey = null;
  worldChessHistoryPending = false;
  analysisInProgressSignature = null;
  analysisInProgressFast = false;
  autoAppliedSignature = null;
  awaitingOpponentMoveSignature = null;
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
    pollTimer = setInterval(() => scanPosition(), LIVE_POLL_MS);
  }
}
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== 'CHESS_BOARD_CHANGED' || sender.id !== chrome.runtime.id ||
      sender.tab?.id !== sourceTabId || !liveTracking) return;
  void scanPosition(true);
});
liveToggle.addEventListener('click', () => setLiveTracking(!liveTracking));
const autoPlayToggle = document.querySelector('#auto-play-toggle');
function setAutoPlay(enabled) {
  autoPlay = enabled;
  autoPlayToggle.setAttribute('aria-pressed', String(enabled));
  autoPlayToggle.classList.toggle('is-on', enabled);
  autoPlayToggle.innerHTML = `<span class="toggle-dot"></span>Otomatik oyun: ${enabled ? 'Açık' : 'Kapalı'}`;
  if (enabled) {
    setLiveTracking(true);
    result.textContent = 'Otomatik oyun açık. Sıra senin taşlarına geldiğinde en iyi hamleyi tahtaya uygulayacağım.';
  } else {
    result.textContent = 'Otomatik oyun kapalı.';
  }
}
autoPlayToggle.addEventListener('click', () => setAutoPlay(!autoPlay));
const depthSelect = document.querySelector('#depth');
const savedDepth = localStorage.getItem('analysisDepth');
if ([...depthSelect.options].some(option => option.value === savedDepth)) {
  depthSelect.value = savedDepth;
}
depthSelect.addEventListener('change', async () => {
  localStorage.setItem('analysisDepth', depthSelect.value);
  const selectedValue = depthSelect.value;
  const useLite = Number(depthSelect.selectedOptions[0].dataset.time) <= 800;
  if (!autoMoveInProgress) {
    const activeSignature = analysisInProgressSignature;
    if (activeSignature) {
      analysisGeneration++;
      stopStockfish();
      while (analysisInProgressSignature === activeSignature) {
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    }
    if (liveTracking) lastAnalyzedWorldChessSignature = null;
  }
  void getStockfish().warmup(useLite).catch(error => {
    if (depthSelect.value === selectedValue && !analysisInProgressSignature && !gameFinished) {
      result.textContent = errorText(error, 'Stockfish motoru hazırlanamadı.');
    }
  });
  if (liveTracking && !autoMoveInProgress) await scanPosition(true);
});
// Preload the engine that matches the selected analysis budget.
const initialSearchTimeMs = Number(depthSelect.selectedOptions[0].dataset.time);
void getStockfish().warmup(initialSearchTimeMs <= 800).catch(() => {});
// Start with auto-play and live tracking enabled; the user can turn it off.
(async () => {
  try {
    // Always start in the normal view. Compact modes are opt-in for the
    // current session and should not change the next launch screen.
    await chrome.storage.local.set({ chessbotWindowMode: 'full' });
  } catch (error) {
    console.error('Başlangıç pencere modu ayarlanamadı.', error);
  } finally {
    windowModeInitialized = true;
  }
  setAutoPlay(true);
})();
