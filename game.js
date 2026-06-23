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

// ---- Skins / Temas visuales ----
// Each skin has a 1-indexed palette (null at [0], matching COLORS) and a
// block-draw routine. The default "retro" skin reuses COLORS and reproduces
// the original drawBlock look exactly.
const NEON_COLORS = [
  null,
  '#18ffff', // I
  '#ffff00', // O
  '#e040fb', // T
  '#69f0ae', // S
  '#ff5252', // Z
  '#448aff', // J
  '#ffab40', // L
];

const PASTEL_COLORS = [
  null,
  '#a7e8e3', // I
  '#fce8a8', // O
  '#d8b4e2', // T
  '#b8e6c1', // S
  '#f5b5b5', // Z
  '#b5cdf5', // L? -> J
  '#f6cda0', // L
];

const PIXEL_COLORS = COLORS; // pixel skin reuses the base palette + texture overlay

const SKINS = {
  retro:  { colors: COLORS,        boardBg: null },
  neon:   { colors: NEON_COLORS,   boardBg: '#05050a' },
  pastel: { colors: PASTEL_COLORS, boardBg: null },
  pixel:  { colors: PIXEL_COLORS,  boardBg: null },
};

const SKIN_KEY = 'tetris-skin';
let currentSkin = 'retro';

function activePalette() {
  return (SKINS[currentSkin] || SKINS.retro).colors;
}

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
const skinSelect = document.getElementById('skin-select');

const THEME_KEY = 'tetris-theme';
let gridLineColor = '#22222e';

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;

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
    lines += cleared;
    score += (LINE_SCORES[cleared] || 0) * level;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    updateHUD();
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
  const color = activePalette()[colorIndex];
  const a = alpha ?? 1;
  switch (currentSkin) {
    case 'neon':   drawBlockNeon(context, x, y, color, size, a); break;
    case 'pastel': drawBlockPastel(context, x, y, color, size, a); break;
    case 'pixel':  drawBlockPixel(context, x, y, color, size, a); break;
    case 'retro':
    default:       drawBlockRetro(context, x, y, color, size, a); break;
  }
}

// Original look: flat fill + top white highlight strip.
function drawBlockRetro(context, x, y, color, size, alpha) {
  context.globalAlpha = alpha;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  context.fillStyle = 'rgba(255,255,255,0.12)';
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  context.globalAlpha = 1;
}

// Glowing blocks via shadowBlur/shadowColor.
function drawBlockNeon(context, x, y, color, size, alpha) {
  context.globalAlpha = alpha;
  context.save();
  context.shadowColor = color;
  context.shadowBlur = 12;
  context.fillStyle = color;
  context.fillRect(x * size + 2, y * size + 2, size - 4, size - 4);
  context.restore();
  // inner dark core to emphasize the neon outline
  context.fillStyle = 'rgba(0,0,0,0.45)';
  context.fillRect(x * size + 5, y * size + 5, size - 10, size - 10);
  context.globalAlpha = 1;
}

// Soft palette with simulated rounded corners.
function drawBlockPastel(context, x, y, color, size, alpha) {
  context.globalAlpha = alpha;
  context.fillStyle = color;
  const px = x * size + 2;
  const py = y * size + 2;
  const w = size - 4;
  const h = size - 4;
  const r = Math.min(7, w / 2, h / 2);
  context.beginPath();
  if (typeof context.roundRect === 'function') {
    context.roundRect(px, py, w, h, r);
  } else {
    context.moveTo(px + r, py);
    context.arcTo(px + w, py, px + w, py + h, r);
    context.arcTo(px + w, py + h, px, py + h, r);
    context.arcTo(px, py + h, px, py, r);
    context.arcTo(px, py, px + w, py, r);
    context.closePath();
  }
  context.fill();
  // soft top highlight
  context.fillStyle = 'rgba(255,255,255,0.25)';
  context.beginPath();
  context.arc(px + w * 0.32, py + h * 0.3, Math.max(2, w * 0.18), 0, Math.PI * 2);
  context.fill();
  context.globalAlpha = 1;
}

// Flat fill plus a dithered pixel texture overlay.
function drawBlockPixel(context, x, y, color, size, alpha) {
  context.globalAlpha = alpha;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // texture: 6x6 grid of small light/dark pixels in a checker-ish pattern
  const cells = 6;
  const cw = (size - 2) / cells;
  const ox = x * size + 1;
  const oy = y * size + 1;
  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < cells; j++) {
      if ((i + j) % 2 === 0) {
        context.fillStyle = (i % 3 === 0) ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.18)';
        context.fillRect(ox + i * cw, oy + j * cw, Math.ceil(cw), Math.ceil(cw));
      }
    }
  }
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

function skinBoardBg() {
  return (SKINS[currentSkin] || SKINS.retro).boardBg;
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const bg = skinBoardBg();
  if (bg) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
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
  const bg = skinBoardBg();
  if (bg) {
    nextCtx.fillStyle = bg;
    nextCtx.fillRect(0, 0, nextCanvas.width, nextCanvas.height);
  }
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  overlay.classList.remove('hidden');
}

function togglePause() {
  if (gameOver) return;
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
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  dropInterval = 1000;
  dropAccum = 0;
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused || gameOver) return;
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

function applySkin(skin) {
  currentSkin = SKINS[skin] ? skin : 'retro';
  if (skinSelect) skinSelect.value = currentSkin;
  // Re-render with the new skin if a game is already running.
  if (board && current) {
    draw();
    drawNext();
  }
}

const savedSkin = localStorage.getItem(SKIN_KEY);
applySkin(savedSkin || 'retro');

if (skinSelect) {
  skinSelect.addEventListener('change', () => {
    applySkin(skinSelect.value);
    localStorage.setItem(SKIN_KEY, currentSkin);
  });
}

init();
