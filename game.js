'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#90caf9', // J - pale blue
  '#ffb74d', // L - orange
];

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
];

const LINE_SCORES = [0, 100, 300, 500, 800];

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');
const themeToggleBtn = document.getElementById('theme-toggle');
const nameEntry = document.getElementById('name-entry');
const playerNameInput = document.getElementById('player-name');
const saveScoreBtn = document.getElementById('save-score-btn');
const overlayRecords = document.getElementById('overlay-records');
const startOverlay = document.getElementById('start-overlay');
const startRecords = document.getElementById('start-records');
const playBtn = document.getElementById('play-btn');

const THEME_KEY = 'tetris-theme';
const HIGHSCORES_KEY = 'tetris-highscores';
const STATS_KEY = 'tetris-stats';
const MAX_SCORES = 5;
let gridLineColor = '#22222e';

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
// true once init() has run at least once (game in progress or finished)
let started = false;
// combo + per-game tracking
let combo, bestComboThisGame;
// row index to highlight in the rendered table (when current score enters top 5)
let highlightIndex = -1;

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomPiece() {
  const type = Math.floor(Math.random() * 7) + 1;
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  if (cleared) {
    combo++;
    if (combo > bestComboThisGame) bestComboThisGame = combo;
    lines += cleared;
    score += (LINE_SCORES[cleared] || 0) * level;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    updateHUD();
  } else {
    combo = 0;
  }
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  merge();
  clearLines();
  spawn();
}

function spawn() {
  current = next;
  next = randomPiece();
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const color = COLORS[colorIndex];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = 'rgba(255,255,255,0.12)';
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  context.globalAlpha = 1;
}

function drawGrid() {
  ctx.strokeStyle = gridLineColor;
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  // ghost
  const gy = ghostY();
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

  // current piece
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
}

function loadHighScores() {
  try {
    const raw = localStorage.getItem(HIGHSCORES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(e => e && typeof e.score === 'number')
      .map(e => ({ name: String(e.name || '???'), score: e.score }));
  } catch (err) {
    return [];
  }
}

function saveHighScores(scores) {
  try {
    localStorage.setItem(HIGHSCORES_KEY, JSON.stringify(scores));
  } catch (err) { /* ignore */ }
}

function loadStats() {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    if (!raw) return { bestCombo: 0, maxLines: 0 };
    const parsed = JSON.parse(raw);
    return {
      bestCombo: typeof parsed.bestCombo === 'number' ? parsed.bestCombo : 0,
      maxLines: typeof parsed.maxLines === 'number' ? parsed.maxLines : 0,
    };
  } catch (err) {
    return { bestCombo: 0, maxLines: 0 };
  }
}

function saveStats(stats) {
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
  } catch (err) { /* ignore */ }
}

function escapeHTML(str) {
  return String(str).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

// Inserts `score` into the stored scores under `name` and returns the new index
// (0-based) if it made the top 5, otherwise -1. Persists the updated list.
function recordHighScore(name, scoreValue) {
  const scores = loadHighScores();
  const entry = { name, score: scoreValue };
  scores.push(entry);
  scores.sort((a, b) => b.score - a.score);
  const top = scores.slice(0, MAX_SCORES);
  saveHighScores(top);
  return top.indexOf(entry);
}

function renderRecords(container, highlight) {
  const scores = loadHighScores();
  const stats = loadStats();
  const hi = typeof highlight === 'number' ? highlight : -1;

  let rows = '';
  for (let i = 0; i < MAX_SCORES; i++) {
    const e = scores[i];
    const cls = i === hi ? ' class="hl"' : '';
    const name = e ? escapeHTML(e.name) : '—';
    const sc = e ? e.score.toLocaleString() : '—';
    rows += `<tr${cls}><td>${i + 1}</td><td>${name}</td><td>${sc}</td></tr>`;
  }

  container.innerHTML = `
    <h3 class="records-title">Récords</h3>
    <table class="records-table">
      <thead><tr><th>#</th><th>Nombre</th><th>Puntuación</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="records-stats">
      <span>Mejor combo: <strong>${stats.bestCombo}</strong></span>
      <span>Máximo de líneas: <strong>${stats.maxLines}</strong></span>
    </div>
    <button type="button" class="reset-records-btn">Resetear records</button>
  `;
  const resetBtn = container.querySelector('.reset-records-btn');
  if (resetBtn) resetBtn.addEventListener('click', resetRecords);
}

function resetRecords() {
  try {
    localStorage.removeItem(HIGHSCORES_KEY);
    localStorage.removeItem(STATS_KEY);
  } catch (err) { /* ignore */ }
  highlightIndex = -1;
  renderRecords(startRecords);
  renderRecords(overlayRecords);
}

function updateStats() {
  const stats = loadStats();
  let changed = false;
  if (bestComboThisGame > stats.bestCombo) { stats.bestCombo = bestComboThisGame; changed = true; }
  if (lines > stats.maxLines) { stats.maxLines = lines; changed = true; }
  if (changed) saveStats(stats);
}

function commitScore() {
  const name = (playerNameInput.value || '').trim().slice(0, 12) || 'AAA';
  highlightIndex = recordHighScore(name, score);
  nameEntry.classList.add('hidden');
  renderRecords(overlayRecords, highlightIndex);
  renderRecords(startRecords);
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  updateStats();
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  // Determine whether this score would enter the top 5 (without persisting yet).
  const existing = loadHighScores();
  const qualifies = existing.length < MAX_SCORES || score > existing[existing.length - 1].score;
  highlightIndex = -1;
  if (qualifies && score > 0) {
    nameEntry.classList.remove('hidden');
    playerNameInput.value = '';
    renderRecords(overlayRecords);
    setTimeout(() => playerNameInput.focus(), 0);
  } else {
    nameEntry.classList.add('hidden');
    renderRecords(overlayRecords);
  }
  overlay.classList.remove('hidden');
}

function togglePause() {
  if (!started || gameOver) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    overlay.classList.remove('hidden');
  }
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  dropAccum += dt;
  if (dropAccum >= dropInterval) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
    } else {
      lockPiece();
    }
  }
  draw();
  animId = requestAnimationFrame(loop);
}

function init() {
  started = true;
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  dropInterval = 1000;
  dropAccum = 0;
  combo = 0;
  bestComboThisGame = 0;
  highlightIndex = -1;
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  nameEntry.classList.add('hidden');
  overlay.classList.add('hidden');
  startOverlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

function showStartScreen() {
  renderRecords(startRecords);
  startOverlay.classList.remove('hidden');
}

document.addEventListener('keydown', e => {
  if (e.code === 'KeyP') { togglePause(); return; }
  if (!started || paused || gameOver) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) current.x--;
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) current.x++;
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', init);
playBtn.addEventListener('click', init);
saveScoreBtn.addEventListener('click', commitScore);
playerNameInput.addEventListener('keydown', e => {
  if (e.code === 'Enter' || e.key === 'Enter') {
    e.preventDefault();
    commitScore();
  }
});

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const computed = getComputedStyle(document.documentElement).getPropertyValue('--grid-line').trim();
  if (computed) gridLineColor = computed;
}

const savedTheme = localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
applyTheme(savedTheme);

themeToggleBtn.addEventListener('click', () => {
  const currentTheme = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  const nextTheme = currentTheme === 'light' ? 'dark' : 'light';
  applyTheme(nextTheme);
  localStorage.setItem(THEME_KEY, nextTheme);
});

showStartScreen();
