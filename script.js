const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

const stageText = document.getElementById("stageText");
const scoreText = document.getElementById("scoreText");
const coinText = document.getElementById("coinText");
const lineText = document.getElementById("lineText");
const skillButtons = Array.from(document.querySelectorAll(".skill-btn"));

const COLS = 10;
const VISIBLE_ROWS = 20;
const HIDDEN_ROWS = 4;
const ROWS = VISIBLE_ROWS + HIDDEN_ROWS;

const BASE_DROP_MS = 17;
const MIN_DROP_MS = 3;
const ROUTING_MAX_LVL = 2;
const BASE_SKILL_COST = 60;
const MAX_BOARD_CELL_W = 34;
const MIN_BOARD_CELL_W = 12;

const COLORS = [
  "#0b1533",
  "#61d2ff",
  "#7cff8f",
  "#ffcf61",
  "#ff6fbd",
  "#d97bff",
  "#f66b6b",
  "#77a5ff",
];

const PIECE_TEMPLATES = [
  [
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 0],
  ],
  [
    [1, 0],
    [0, 1],
    [1, 1],
    [2, 1],
  ],
  [
    [0, 0],
    [0, 1],
    [1, 1],
    [2, 1],
  ],
  [
    [0, 1],
    [1, 1],
    [2, 1],
    [2, 0],
  ],
  [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ],
  [
    [0, 0],
    [1, 0],
    [1, 1],
    [2, 1],
  ],
  [
    [1, 0],
    [2, 0],
    [0, 1],
    [1, 1],
  ],
];

const CHAOS_TEMPLATES = [
  {
    stage: 2,
    templates: [[[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]]],
    copyStep: 3,
  },
  {
    stage: 3,
    templates: [[[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]]],
    copyStep: 3,
  },
  {
    stage: 4,
    templates: [[[0, 0], [2, 0], [0, 1], [1, 1], [2, 1]]],
    copyStep: 3,
  },
];

const state = {
  boards: [],
  active: null,
  pieceQueue: [],
  dropAccumulator: 0,
  lastTs: 0,
  linesThisRun: 0,
  totalScore: 0,
  credits: 0,
  toasts: [],
  skills: {
    placement: 0,
    rotation: 0,
    routing: 0,
  },
  _pieceSignature: "",
  boardLayouts: [],
  gameOverLock: false,
};

const MAX_PLACEMENT_LVL = 20;
const MAX_ROTATION_LVL = 20;
const EFFECTIVE_PLACEMENT_LVL = 4;
const EFFECTIVE_ROTATION_LVL = 4;
let PIECES = [];

function buildPieceTemplates() {
  const templates = PIECE_TEMPLATES.slice();
  const s = stage();
  for (const entry of CHAOS_TEMPLATES) {
    if (s >= entry.stage) {
      const copyCount = Math.min(entry.copyStep, 1 + Math.floor((s - entry.stage) / 2));
      for (let i = 0; i < copyCount; i++) {
        templates.push(...entry.templates);
      }
    }
  }
  return templates;
}

function refreshPiecePool() {
  const templates = buildPieceTemplates();
  const signature = templates.map((t) => t.flat().join("_")).join("|");
  if (state._pieceSignature === signature) return;

  PIECES = templates.map(makeRotations);
  state._pieceSignature = signature;
  state.pieceQueue = [];
}

function makeRotations(shape) {
  const variants = [];
  let current = normalizeShape(shape);
  for (let r = 0; r < 4; r++) {
    if (!containsShape(variants, current)) {
      variants.push(current);
    }
    current = normalizeShape(current.map(([x, y]) => [y, -x]));
  }
  return variants;
}

function normalizeShape(shape) {
  const minX = Math.min(...shape.map(([x]) => x));
  const minY = Math.min(...shape.map(([, y]) => y));
  return shape.map(([x, y]) => [x - minX, y - minY]);
}

function containsShape(list, candidate) {
  return list.some((shape) => sameShape(shape, candidate));
}

function sameShape(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!b.some(([x, y]) => a[i][0] === x && a[i][1] === y)) return false;
  }
  return true;
}

function createEmptyGrid() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(0));
}

function createBoard() {
  return {
    grid: createEmptyGrid(),
    index: 0,
  };
}

function boardCount() {
  return 1 + Math.min(ROUTING_MAX_LVL, Math.max(0, state.skills.routing));
}

function resetBoards() {
  const count = boardCount();
  state.boards = [];
  for (let i = 0; i < count; i++) {
    state.boards.push(createBoard());
  }
}

function resetRunProgress() {
  state.linesThisRun = 0;
  state.active = null;
  state.dropAccumulator = 0;
  resetBoards();
}

function skillCost(id) {
  if (id === "placement" || id === "rotation") {
    return (BASE_SKILL_COST + state.skills[id] * 20) * 10;
  }
  return (BASE_SKILL_COST + state.skills[id] * 20) * 20;
}

function stage() {
  return Math.floor(state.linesThisRun / 10) + 1;
}

function dropInterval() {
  return BASE_DROP_MS;
}

function enqueuePiece() {
  if (state.pieceQueue.length > 0) return;
  refreshPiecePool();
  const bag = Array.from({ length: PIECES.length }, (_, i) => i);
  shuffleArray(bag);
  state.pieceQueue.push(...bag);
}

function nextPieceType() {
  refreshPiecePool();
  if (state.pieceQueue.length === 0) enqueuePiece();
  return state.pieceQueue.pop();
}

function shuffleArray(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
}

function canPlace(grid, type, rotIdx, x, y) {
  const piece = PIECES[type][rotIdx];
  for (let i = 0; i < piece.length; i++) {
    const [dx, dy] = piece[i];
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) return false;
    if (grid[ny][nx] !== 0) return false;
  }
  return true;
}

function getDropY(grid, type, rotIdx, x) {
  let y = 0;
  while (canPlace(grid, type, rotIdx, x, y + 1)) y++;
  return y;
}

function cloneGrid(grid) {
  return grid.map((row) => row.slice());
}

function placePiece(grid, type, rotIdx, x, y, value) {
  const result = cloneGrid(grid);
  const piece = PIECES[type][rotIdx];
  for (let i = 0; i < piece.length; i++) {
    const [dx, dy] = piece[i];
    result[y + dy][x + dx] = value;
  }
  return result;
}

function clearLines(grid) {
  let cleared = [];
  const newGrid = [];
  for (let y = 0; y < ROWS; y++) {
    const full = grid[y].every((v) => v !== 0);
    if (full) cleared.push(y);
    else newGrid.push(grid[y]);
  }
  while (newGrid.length < ROWS) {
    newGrid.unshift(Array(COLS).fill(0));
  }
  return { grid: newGrid, clearedRows: cleared };
}

function boardMetrics(grid) {
  let heights = [];
  let holes = 0;
  let aggregate = 0;
  let maxHeight = 0;
  for (let c = 0; c < COLS; c++) {
    let colHeight = 0;
    let seenBlock = false;
    for (let r = 0; r < ROWS; r++) {
      if (grid[r][c] !== 0) {
        if (!seenBlock) colHeight = ROWS - r;
        seenBlock = true;
      } else if (seenBlock) {
        holes++;
      }
    }
    heights.push(colHeight);
    aggregate += colHeight;
    maxHeight = Math.max(maxHeight, colHeight);
  }
  let bump = 0;
  for (let i = 1; i < heights.length; i++) bump += Math.abs(heights[i] - heights[i - 1]);
  return { holes, aggregate, bump, maxHeight };
}

function scoreRotationPlacement(cells, gridAfter) {
  let unstable = 0;
  let sideLock = 0;

  for (const [x, y] of cells) {
    if (y < ROWS - 1) {
      const belowBlock = gridAfter[y + 1][x];
      if (belowBlock === 0) unstable++;
    }

    if (x === 0 || gridAfter[y][x - 1] !== 0) sideLock++;
    if (x === COLS - 1 || gridAfter[y][x + 1] !== 0) sideLock++;
  }

  return { unstable, sideLock };
}

function scoreBoardMove(baseScore, boardInfo) {
  const metrics = boardMetrics(boardInfo.gridAfter);
  const clearWeight = [0, 220, 500, 900, 1200][boardInfo.cleared];
  const placementLevel = Math.min(state.skills.placement, EFFECTIVE_PLACEMENT_LVL);
  const rotationLevel = Math.min(state.skills.rotation, EFFECTIVE_ROTATION_LVL);
  const placementBias = placementLevel * 180;
  const rotationScore = boardInfo.rotationScore || { unstable: 0, sideLock: 0 };
  const rotationBias =
    rotationScore.sideLock * (1 + rotationLevel * 1.2) -
    rotationScore.unstable * (12 - rotationLevel * 2);
  const raw =
    clearWeight +
    (boardInfo.y * 4) +
    boardInfo.rowsScore -
    metrics.aggregate * 5 -
    metrics.holes * 14 -
    metrics.bump * 2 -
    metrics.maxHeight * 2 +
    rotationBias;

  if (state.skills.placement === 0) {
    return clearWeight + boardInfo.rowsScore - metrics.holes * 26 + rotationBias + (Math.random() - 0.5) * 420;
  }

  return raw + placementBias;
}

function evaluateBoardChoice(board, type) {
  let best = null;
  const pieceVariants = PIECES[type];
  for (let rotIdx = 0; rotIdx < pieceVariants.length; rotIdx++) {
    const piece = pieceVariants[rotIdx];
    const minX = Math.min(...piece.map(([x]) => x));
    const maxX = Math.max(...piece.map(([x]) => x));
    for (let x = -minX; x <= COLS - maxX - 1; x++) {
      if (!canPlace(board.grid, type, rotIdx, x, 0)) continue;
      const y = getDropY(board.grid, type, rotIdx, x);
      const placed = placePiece(board.grid, type, rotIdx, x, y, 1);
      const cleared = clearLines(placed);
      const placedCells = piece.map(([dx, dy]) => [x + dx, y + dy]);
      const rotationScore = scoreRotationPlacement(placedCells, cleared.grid);
      let rowsScore = 0;
      if (cleared.clearedRows.length === 1) rowsScore = 20;
      else if (cleared.clearedRows.length === 2) rowsScore = 50;
      else if (cleared.clearedRows.length === 3) rowsScore = 110;
      else if (cleared.clearedRows.length === 4) rowsScore = 250;

      const score = scoreBoardMove(0, {
        gridAfter: cleared.grid,
        cleared: cleared.clearedRows.length,
        y,
        rowsScore,
        rotationScore,
      });

      if (!best || score > best.score) {
        best = {
          board,
          x,
          y,
          rotIdx,
          score,
          droppedRows: cleared.clearedRows.length,
          rowsScore,
        };
      }
    }
  }
  return best;
}

function chooseMove(type) {
  let best = null;
  for (let i = 0; i < state.boards.length; i++) {
    const board = state.boards[i];
    const candidate = evaluateBoardChoice(board, type);
    if (!candidate) continue;

    const routingBoost = i * Math.max(0, state.skills.routing) * 100;
    const score = candidate.score + routingBoost;
    if (!best || score > best.score) {
      best = { ...candidate, boardIndex: i, board: undefined, score };
    }
  }
  return best;
}

function isOverflowed(board) {
  for (let r = 0; r < HIDDEN_ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (board.grid[r][c] !== 0) return true;
    }
  }
  return false;
}

function addToast(boardIndex, x, y, text, color = "#76ff9d") {
  state.toasts.push({
    boardIndex,
    x,
    y,
    text,
    color,
    life: 1400,
    age: 0,
  });
}

function maybeSpawnPiece() {
  if (state.active || state.gameOverLock) return;
  const type = nextPieceType();
  const move = chooseMove(type);
  if (!move) {
    triggerGameOver();
    return;
  }

  const selectedBoard = state.boards[move.boardIndex];
  if (!canPlace(selectedBoard.grid, type, move.rotIdx, move.x, 0)) {
    triggerGameOver();
    return;
  }

  state.active = {
    type,
    x: move.x,
    y: 0,
    rotIdx: move.rotIdx,
    boardIndex: move.boardIndex,
    landingY: move.y,
    pieceValue: type + 1,
    targetRows: move.droppedRows,
    targetRowScore: move.rowsScore,
  };
}

function lockActivePiece() {
  if (!state.active) return;
  const board = state.boards[state.active.boardIndex];
  const nextGrid = placePiece(
    board.grid,
    state.active.type,
    state.active.rotIdx,
    state.active.x,
    state.active.y,
    state.active.pieceValue
  );
  const clearResult = clearLines(nextGrid);

  board.grid = clearResult.grid;

  const movedRows = state.active.landingY - state.active.y;
  const dropReward = Math.max(1, Math.floor((Math.abs(movedRows) + state.active.y) / 2));
  const lineCount = clearResult.clearedRows.length;
  const lineBonuses = [0, 40, 90, 140, 240];
  const lineBonus = lineCount > 0 ? lineBonuses[lineCount] : 0;
  const creditGain = dropReward + lineBonus;
  state.credits += creditGain;

  const scoreBonuses = [0, 100, 300, 500, 800];
  state.totalScore += scoreBonuses[lineCount] * stage();

  state.linesThisRun += lineCount;

  const px = state.active.x + 1.5;
  const py = Math.min(state.active.y + 1.5, ROWS - 0.5);
  addToast(
    state.active.boardIndex,
    px,
    Math.max(HIDDEN_ROWS, py),
    `+${dropReward} CR`,
    "#6fe4ff"
  );

  if (lineCount > 0) {
    const centerLine =
      clearResult.clearedRows.reduce((sum, row) => sum + row, 0) /
      clearResult.clearedRows.length;
    addToast(
      state.active.boardIndex,
      COLS / 2,
      Math.max(HIDDEN_ROWS, Math.min(ROWS - 1, centerLine)),
      `+${lineBonus} CR`,
      "#b8ff8a"
    );
  }

  if (isOverflowed(board)) {
    triggerGameOver();
    return;
  }

  if (state.boards.some((b) => isOverflowed(b))) {
    triggerGameOver();
    return;
  }

  state.active = null;
  maybeSpawnPiece();
}

function step() {
  if (!state.active) {
    maybeSpawnPiece();
    return;
  }
  const board = state.boards[state.active.boardIndex];
  if (canPlace(board.grid, state.active.type, state.active.rotIdx, state.active.x, state.active.y + 1)) {
    state.active.y += 1;
    return;
  }
  lockActivePiece();
}

function dropByTime(deltaMs) {
  if (state.gameOverLock) return;
  state.dropAccumulator += deltaMs;
  const interval = dropInterval();
  const maxSteps = 20;
  let moved = 0;
  while (state.dropAccumulator >= interval && !state.gameOverLock && moved < maxSteps) {
    state.dropAccumulator -= interval;
    step();
    moved++;
  }
}

function updateHud() {
  stageText.textContent = String(stage());
  scoreText.textContent = String(state.totalScore);
  coinText.textContent = String(state.credits);
  lineText.textContent = String(state.linesThisRun);

  document.getElementById("placementLvl").textContent = String(state.skills.placement);
  document.getElementById("rotationLvl").textContent = String(state.skills.rotation);
  document.getElementById("routingLvl").textContent = String(state.skills.routing);

  document.getElementById("placementCost").textContent = skillCost("placement");
  document.getElementById("rotationCost").textContent = skillCost("rotation");
  document.getElementById("routingCost").textContent = skillCost("routing");

  for (const btn of skillButtons) {
    const skill = btn.dataset.skill;
    const maxLvl =
      skill === "routing"
        ? ROUTING_MAX_LVL
        : skill === "placement"
        ? MAX_PLACEMENT_LVL
        : MAX_ROTATION_LVL;
    btn.disabled = state.credits < skillCost(skill) || state.skills[skill] >= maxLvl;
  }
}

function upgradeSkill(skill) {
  const maxLvl =
    skill === "routing"
      ? ROUTING_MAX_LVL
      : skill === "placement"
      ? MAX_PLACEMENT_LVL
      : MAX_ROTATION_LVL;
  if (state.skills[skill] >= maxLvl) return;
  const c = skillCost(skill);
  if (state.credits < c) return;
  state.credits -= c;
  state.skills[skill] += 1;

  if (skill === "routing") {
    const before = state.boards.length;
    resetBoards();
    if (state.boards.length > before) {
      state.active = null;
    }
  }

  updateHud();
}

function bindSkills() {
  skillButtons.forEach((btn) => {
    const skill = btn.dataset.skill;
    btn.addEventListener("click", () => upgradeSkill(skill));
  });
}

function setLevelTexts() {
  document.querySelector('[data-skill="placement"] .skill-row').innerHTML = `<span id="placementLvl"></span> - Credit <span id="placementCost"></span>`;
  document.querySelector('[data-skill="rotation"] .skill-row').innerHTML = `<span id="rotationLvl"></span> - Credit <span id="rotationCost"></span>`;
  document.querySelector('[data-skill="routing"] .skill-row').innerHTML = `<span id="routingLvl"></span> - Credit <span id="routingCost"></span>`;
  document.querySelector('[data-skill="placement"]').setAttribute("aria-label", "Upgrade Placement Logic");
  document.querySelector('[data-skill="rotation"]').setAttribute("aria-label", "Upgrade Rotation Logic");
  document.querySelector('[data-skill="routing"]').setAttribute("aria-label", "Upgrade Routing Matrix");
}

function triggerGameOver() {
  state.gameOverLock = true;
  state.toasts = [];
  state.active = null;
  resetRunProgress();
  state.gameOverLock = false;
  updateHud();
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const nextW = Math.floor(rect.width * dpr);
  const nextH = Math.floor(rect.height * dpr);
  if (
    canvas.width === nextW &&
    canvas.height === nextH &&
    canvas.dataset.lastDpr === String(dpr)
  ) {
    return;
  }

  canvas.width = nextW;
  canvas.height = nextH;
  canvas.dataset.lastDpr = String(dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawBoardBackground(x, y, w, h) {
  const grad = ctx.createLinearGradient(x, y, x, y + h);
  grad.addColorStop(0, "#08122a");
  grad.addColorStop(1, "#0a1636");
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, w, h);
}

function drawSingleBoard(board, layout, boardIndex) {
  const { x, y, cellW, boardW, boardH } = layout;
  drawBoardBackground(x, y, boardW, boardH);

  ctx.strokeStyle = "rgba(110,146,235,0.45)";
  ctx.lineWidth = 1;
  for (let c = 0; c <= COLS; c++) {
    const lineX = x + c * cellW;
    ctx.beginPath();
    ctx.moveTo(lineX, y);
    ctx.lineTo(lineX, y + boardH);
    ctx.stroke();
  }
  for (let r = 0; r <= VISIBLE_ROWS; r++) {
    const lineY = y + r * cellW;
    ctx.beginPath();
    ctx.moveTo(x, lineY);
    ctx.lineTo(x + boardW, lineY);
    ctx.stroke();
  }

  for (let r = HIDDEN_ROWS; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const v = board.grid[r][c];
      const drawY = y + (r - HIDDEN_ROWS) * cellW;
      const drawX = x + c * cellW;
      if (v !== 0) {
        ctx.fillStyle = COLORS[v];
        ctx.fillRect(drawX + 1, drawY + 1, cellW - 2, cellW - 2);
      } else {
        ctx.fillStyle = "rgba(255,255,255,0.03)";
        if ((r + c) % 2 === 0) {
          ctx.fillRect(drawX + 1, drawY + 1, cellW - 2, cellW - 2);
        }
      }
    }
  }

  if (state.active && state.active.boardIndex === boardIndex) {
    const piece = state.active;
    const cells = PIECES[piece.type][piece.rotIdx];
    const ghostY = getDropY(board.grid, piece.type, piece.rotIdx, piece.x);
    for (const [dx, dy] of cells) {
      const gx = piece.x + dx;
      const gy = ghostY + dy;
      if (gy >= HIDDEN_ROWS && gy < ROWS) {
        const px = x + gx * cellW;
        const py = y + (gy - HIDDEN_ROWS) * cellW;
        ctx.fillStyle = "rgba(118, 224, 255, 0.2)";
        ctx.fillRect(px + 1, py + 1, cellW - 2, cellW - 2);
      }
      const px = piece.x + dx;
      const py = piece.y + dy;
      if (py >= HIDDEN_ROWS && py < ROWS) {
        const fx = x + px * cellW;
        const fy = y + (py - HIDDEN_ROWS) * cellW;
        ctx.fillStyle = COLORS[piece.pieceValue];
        ctx.fillRect(fx + 1, fy + 1, cellW - 2, cellW - 2);
      }
    }
  }
}

function render() {
  ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  ctx.fillStyle = "#080d1e";
  ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);

  const gap = 14;
  const boardCountValue = state.boards.length;
  const topPad = 28;
  const usableWidth = canvas.clientWidth - gap * (boardCountValue + 1);
  const usableHeight = canvas.clientHeight - 72;

  const boardCellW = Math.max(
    MIN_BOARD_CELL_W,
    Math.min(
      MAX_BOARD_CELL_W,
      Math.floor(
        Math.min(
          usableWidth / (boardCountValue * COLS),
          usableHeight / VISIBLE_ROWS
        )
      )
    )
  );

  const boardW = COLS * boardCellW;
  const boardH = VISIBLE_ROWS * boardCellW;
  const totalW = boardW * boardCountValue + gap * (boardCountValue + 1);
  const startX = (canvas.clientWidth - totalW) / 2;

  state.boardLayouts = [];
  for (let i = 0; i < boardCountValue; i++) {
    const x = startX + gap * (i + 1) + boardW * i;
    const y = topPad;
    state.boardLayouts.push({
      x,
      y,
      cellW: boardCellW,
      boardW,
      boardH,
    });
    drawSingleBoard(state.boards[i], state.boardLayouts[i], i);
  }

  const toastScalePad = 0.54;
  for (let i = 0; i < state.toasts.length; i++) {
    const t = state.toasts[i];
    const layout = state.boardLayouts[t.boardIndex] || state.boardLayouts[0];
    if (!layout) continue;
    const alpha = Math.max(0, 1 - t.age / t.life);
    t.age += 16;
    t.y -= 0.02;
    const tx = layout.x + t.x * layout.cellW;
    const ty = layout.y + (t.y - HIDDEN_ROWS) * layout.cellW - t.age * 0.006;
    if (ty < layout.y - 6) continue;
    if (ty > layout.y + layout.boardH + 8) continue;
    ctx.fillStyle = t.color;
    ctx.globalAlpha = alpha;
    ctx.font = `700 ${Math.max(14, layout.cellW * toastScalePad)}px "Trebuchet MS", Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(t.text, tx + layout.cellW * 0.5, ty);
    ctx.globalAlpha = 1;
  }
  state.toasts = state.toasts.filter((toast) => toast.age < toast.life);

}

function gameLoop(ts) {
  const delta = Math.min(50, ts - (state.lastTs || ts));
  state.lastTs = ts;
  dropByTime(delta);
  render();
  updateHud();
  requestAnimationFrame(gameLoop);
}

function init() {
  setLevelTexts();
  bindSkills();
  resetRunProgress();
  resizeCanvas();
  maybeSpawnPiece();
  updateHud();
  window.addEventListener("resize", resizeCanvas);
  requestAnimationFrame(gameLoop);
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) state.lastTs = performance.now();
});

init();


