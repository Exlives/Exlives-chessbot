import { Chess } from 'https://esm.sh/chess.js@1.4.0';

const game = new Chess();
const boardEl = document.querySelector('#board');
const moveList = document.querySelector('#move-list');
const statusTitle = document.querySelector('#status-title');
const statusText = document.querySelector('#status-text');
const engineNote = document.querySelector('#engine-note');
const colorSelect = document.querySelector('#color-select');
const depthSelect = document.querySelector('#depth-select');
const pieces = { w: { k:'♔', q:'♕', r:'♖', b:'♗', n:'♘', p:'♙' }, b: { k:'♚', q:'♛', r:'♜', b:'♝', n:'♞', p:'♟' } };
const values = { p:100, n:320, b:335, r:500, q:900, k:20000 };
let humanColor = 'w';
let selected = null;
let legalTargets = [];
let thinking = false;
let lastMove = null;
let botTimer = null;

function squareName(row, col) { return `${String.fromCharCode(97 + col)}${8 - row}`; }
function render() {
  const flipped = humanColor === 'b';
  boardEl.innerHTML = '';
  const files = flipped ? 'hgfedcba' : 'abcdefgh';
  const ranks = flipped ? '12345678' : '87654321';
  document.querySelector('#file-labels').innerHTML = [...files].map(f => `<span>${f}</span>`).join('');
  document.querySelector('#rank-labels').innerHTML = [...ranks].map(r => `<span>${r}</span>`).join('');
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const row = flipped ? 7 - r : r, col = flipped ? 7 - c : c;
    const sq = squareName(row, col), piece = game.get(sq);
    const cell = document.createElement('div');
    cell.className = `square ${(row + col) % 2 ? 'dark' : 'light'}`;
    cell.setAttribute('role', 'gridcell'); cell.setAttribute('aria-label', `${sq}${piece ? ` ${piece.color === 'w' ? 'beyaz' : 'siyah'} ${piece.type}` : ''}`);
    if (lastMove && (sq === lastMove.from || sq === lastMove.to)) cell.classList.add('last-move');
    if (sq === selected) cell.classList.add('selected');
    if (legalTargets.includes(sq)) { cell.classList.add('legal'); if (piece) cell.classList.add('has-piece'); }
    if (game.isCheck() && piece?.type === 'k' && piece.color === game.turn()) cell.classList.add('check');
    if (piece) { const span = document.createElement('span'); span.className = `piece ${piece.color === 'w' ? 'white' : 'black'}`; span.textContent = pieces[piece.color][piece.type]; cell.append(span); }
    cell.addEventListener('click', () => onSquareClick(sq)); boardEl.append(cell);
  }
  renderMoves(); updateStatus();
  document.querySelector('#bot-caption').textContent = thinking ? 'Pozisyonu analiz ediyor…' : game.turn() === (humanColor === 'w' ? 'b' : 'w') && !game.isGameOver() ? 'Hamlesi' : 'Sıra bekliyor';
  document.querySelector('#human-caption').textContent = humanColor === 'w' ? 'Beyaz taşlar' : 'Siyah taşlar';
  document.querySelector('#human-turn').classList.toggle('active', game.turn() === humanColor && !game.isGameOver() && !thinking);
  document.querySelector('#undo').disabled = game.history().length === 0 || thinking;
}
function onSquareClick(sq) {
  if (thinking || game.isGameOver() || game.turn() !== humanColor) return;
  const piece = game.get(sq);
  if (selected && legalTargets.includes(sq)) {
    let promotion = 'q';
    if (piece?.type === 'p' && (sq.endsWith('8') || sq.endsWith('1'))) {
      const answer = prompt('Terfi edeceğin taşı seç: vezir (q), kale (r), fil (b), at (n)', 'q');
      if (answer && ['q','r','b','n'].includes(answer.toLowerCase())) promotion = answer.toLowerCase();
    }
    const move = game.move({ from: selected, to: sq, promotion });
    if (move) { lastMove = move; selected = null; legalTargets = []; render(); if (!game.isGameOver()) scheduleBot(); return; }
  }
  if (piece?.color === humanColor) { selected = sq; legalTargets = game.moves({ square: sq, verbose: true }).map(m => m.to); }
  else { selected = null; legalTargets = []; }
  render();
}
function updateStatus() {
  if (game.isCheckmate()) { statusTitle.textContent = game.turn() === humanColor ? 'Mat oldun' : 'Mat! Kazandın'; statusText.textContent = `${game.turn() === 'w' ? 'Beyaz' : 'Siyah'} şah mat oldu.`; }
  else if (game.isDraw()) { statusTitle.textContent = 'Oyun berabere'; statusText.textContent = drawReason(); }
  else if (thinking) { statusTitle.textContent = 'Bot düşünüyor'; statusText.textContent = 'Yasal hamleleri ve konumu analiz ediyor.'; }
  else if (game.isCheck()) { statusTitle.textContent = 'Şah!'; statusText.textContent = game.turn() === humanColor ? 'Şah altındasın; güvenli bir hamle yap.' : 'Bot şah altında.'; }
  else if (game.turn() === humanColor) { statusTitle.textContent = 'Hamle sende'; statusText.textContent = 'Taşını seç, sonra hedef kareye dokun.'; }
  else { statusTitle.textContent = 'Botun sırası'; statusText.textContent = 'Bot hamlesini hazırlıyor.'; }
}
function drawReason() { if (game.isStalemate()) return 'Pat nedeniyle oyun sona erdi.'; if (game.isThreefoldRepetition()) return 'Üç konum tekrarı.'; if (game.isInsufficientMaterial()) return 'Mat için yeterli taş kalmadı.'; return 'Berabere.'; }
function renderMoves() {
  const hist = game.history();
  if (!hist.length) { moveList.innerHTML = '<div class="empty-moves">İlk hamleni bekliyoruz…</div>'; return; }
  let html = '';
  for (let i = 0; i < hist.length; i += 2) html += `<div class="move-row"><span class="move-number">${i / 2 + 1}.</span><span class="move-san">${hist[i]}</span><span class="move-san">${hist[i + 1] || ''}</span></div>`;
  moveList.innerHTML = html; moveList.scrollTop = moveList.scrollHeight;
}

function evaluate() {
  const b = game.board(); let score = 0;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const p = b[r][c]; if (!p) continue;
    const sign = p.color === 'w' ? 1 : -1;
    const advance = p.color === 'w' ? 6 - r : r - 1;
    let positional = 0;
    if (p.type === 'p') positional = advance * 8 + (c > 1 && c < 6 ? 4 : 0);
    else if (p.type === 'n') positional = (3.5 - Math.abs(3.5 - c)) * 7 + (3.5 - Math.abs(3.5 - r)) * 7;
    else if (p.type === 'b') positional = (3.5 - Math.abs(3.5 - c)) * 4;
    else if (p.type === 'q') positional = (3.5 - Math.abs(3.5 - c)) * 2;
    else if (p.type === 'k' && game.isGameOver() === false) positional = (r > 5 ? 12 : 0) - Math.abs(3.5 - c) * 3;
    score += sign * (values[p.type] + positional);
  }
  return score;
}
function orderMoves(moves) {
  return moves.sort((a,b) => moveScore(b) - moveScore(a));
}
function moveScore(m) { return (m.captured ? values[m.captured] * 10 - values[m.piece] : 0) + (m.promotion ? values[m.promotion] : 0) + (m.san?.includes('+') ? 50 : 0); }
function search(depth, alpha, beta, maximizing) {
  if (depth === 0 || game.isGameOver()) {
    if (game.isCheckmate()) return game.turn() === 'w' ? -100000 - depth : 100000 + depth;
    return evaluate();
  }
  const moves = orderMoves(game.moves({ verbose: true }));
  if (maximizing) {
    let best = -Infinity;
    for (const m of moves) { game.move(m); const score = search(depth - 1, alpha, beta, false); game.undo(); best = Math.max(best, score); alpha = Math.max(alpha, score); if (beta <= alpha) break; }
    return best;
  }
  let best = Infinity;
  for (const m of moves) { game.move(m); const score = search(depth - 1, alpha, beta, true); game.undo(); best = Math.min(best, score); beta = Math.min(beta, score); if (beta <= alpha) break; }
  return best;
}
function findBestMove(depth) {
  const maximizing = game.turn() === 'w'; let bestScore = maximizing ? -Infinity : Infinity; let bestMoves = [];
  const moves = orderMoves(game.moves({ verbose: true }));
  for (const m of moves) {
    game.move(m); const score = search(depth - 1, -Infinity, Infinity, !maximizing); game.undo();
    if ((maximizing && score > bestScore) || (!maximizing && score < bestScore)) { bestScore = score; bestMoves = [m]; }
    else if (score === bestScore) bestMoves.push(m);
  }
  return bestMoves[Math.floor(Math.random() * bestMoves.length)];
}
function scheduleBot() {
  thinking = true; render();
  botTimer = setTimeout(() => {
    const started = performance.now(); const move = findBestMove(Number(depthSelect.value));
    if (move) { game.move(move); lastMove = move; }
    thinking = false; const elapsed = ((performance.now() - started) / 1000).toFixed(1);
    engineNote.textContent = `Bot ${elapsed} sn içinde ${depthSelect.value} hamle derinliğinde analiz yaptı.`;
    render();
  }, 40);
}
function startGame() {
  clearTimeout(botTimer); game.reset(); humanColor = colorSelect.value; selected = null; legalTargets = []; lastMove = null; thinking = false;
  engineNote.textContent = 'Bot her turda yasal hamleleri arayıp konumu değerlendirir.'; render();
  if (humanColor === 'b') scheduleBot();
}
document.querySelector('#new-game').addEventListener('click', startGame);
document.querySelector('#undo').addEventListener('click', () => {
  if (thinking || !game.history().length) return;
  game.undo(); if (game.turn() === humanColor && game.history().length) game.undo();
  const prev = game.history({ verbose: true }).at(-1); lastMove = prev || null; selected = null; legalTargets = []; render();
});
colorSelect.addEventListener('change', startGame);
depthSelect.addEventListener('change', () => { document.querySelector('#level-label').textContent = ({2:'Kolay',3:'Orta',4:'Zor'})[depthSelect.value]; });
document.querySelector('#copy-pgn').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(game.pgn() || ''); const btn = document.querySelector('#copy-pgn'); btn.textContent = 'Kopyalandı'; setTimeout(() => btn.textContent = 'Kopyala', 1300); }
  catch { engineNote.textContent = 'Panoya kopyalanamadı; tarayıcı izinlerini kontrol et.'; }
});
render();
