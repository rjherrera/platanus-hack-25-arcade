// Platanus Hack 25: Cursed Treasure (Arcade TD)
// Build fire/den/crypt towers on sand/earth/ice. Defend 5 gems across 10 waves.

const config = {
  type: Phaser.AUTO,
  width: 800,
  height: 600,
  backgroundColor: '#0b0f12',
  scene: { create, update }
};

const game = new Phaser.Game(config);

// World/grid
const TILE = 32;
const PANEL_W = 160;
const MAP_W = 800 - PANEL_W;
const COLS = Math.floor(800 / TILE);
const MAP_COLS = Math.floor(MAP_W / TILE);
const ROWS = Math.floor(600 / TILE);
const PATH_RADIUS = 1; // path width = 2*radius+1 tiles

// State
let g;
let uiText;
let sceneRef;
let map = [];
let navPath = [];
let towers = [];
let enemies = [];
let bullets = [];
let gemsOnGround = [];
let gemsLost = 0;
let beams = [];
let scoreDamage = 0;
let touchedGem = false;
let explodeEffects = [];
let pendingShots = [];
let sellMode = false;
let start;
let treasure;
let uiButtons = {};
let countdownText;
let hoverC = -1;
let hoverR = -1;
let terraformMode = false;
let meteorMode = false;
let endUI = null;
let paused = false;
let towersBuiltByType = { fire: 0, den: 0, crypt: 0 };
let speedMult = 1;
let baseGemColors = [];
const METEOR_COST = 200;
const METEOR_RADIUS = 96;
const METEOR_DMG = 150;

let coins = 330;
let mana = 50;
let manaCap = 150;
let manaRegen = 1; // per second
let totalWaves = 10;
let wave = 0;
let waveInProgress = false;
let timeToNextWave = 10;
let spawnQueue = [];
let spawnTimer = 0;
let gemsAtBase = 5;
let towersBuilt = 0;
let selectedBuild = 'temple'; // 'temple' (sand), 'den' (earth), 'crypt' (ice)
let gameEnded = false;

// Colors
const C = {
  path: 0x48525a,
  sand: 0xe2c572,
  earth: 0x886644,
  ice: 0x59c4e6,
  blocked: 0x17301e,
  fire: 0xff5733,
  den: 0x8aff6a,
  crypt: 0xb08cff,
  enemy: 0xf5f5f5,
  hpBack: 0x222222,
  hpFront: 0x00ff66,
  text: '#e6f2ff'
};

// Base gem colors: red, green, blue, yellow, purple
const GEM_COLORS = [0xff4444, 0x44ff44, 0x4488ff, 0xffff55, 0xaa66ff];

// Enemy blueprints
const ENEMIES = {
  goblin: { hp: 50, speed: 80, reward: 8 },
  orc: { hp: 150, speed: 60, reward: 15 },
  troll: { hp: 380, speed: 40, reward: 35 }
};

// Tower blueprints
const TOWERS = {
  // Temple: frequent, low-damage continuous beams (nerfed more)
  temple: { range: 90, rate: 0.12, dmg: 1, bullet: 240, burnDps: 6, burnSec: 3, color: C.fire },
  // Den: slower rate, lower DPS
  den: { range: 120, rate: 0.8, dmg: 12, bullet: 320, color: C.den },
  // Crypt: slower cycle, slightly less damage
  crypt: { range: 120, rate: 1.6, dmg: 16, bullet: 200, slowPct: 0.45, slowSec: 2.2, color: C.crypt }
};

// Path helpers
function gridToXY(c, r) { return { x: c * TILE + TILE / 2, y: r * TILE + TILE / 2 }; }

function create() {
  sceneRef = this;
  g = this.add.graphics();
  uiText = this.add.text(MAP_W + 10, 280, '', { fontFamily: 'Arial, sans-serif', fontSize: '12px', color: C.text, wordWrap: { width: PANEL_W - 20 } });
  baseGemColors = [GEM_COLORS[0], GEM_COLORS[1], GEM_COLORS[2], GEM_COLORS[3], GEM_COLORS[4]];

  buildMapAndPath();
  setupInput(this);
  setupUI(this);
  countdownText = this.add.text(MAP_W + PANEL_W / 2, 160, '', { fontFamily: 'Arial, sans-serif', fontSize: '18px', color: '#ffff88' }).setOrigin(0.5);
}

function setupInput(scene) {
  scene.input.keyboard.on('keydown', (e) => {
    if (gameEnded) return;
    if (e.key === '1') { selectedBuild = 'temple'; terraformMode = false; meteorMode = false; }
    if (e.key === '2') { selectedBuild = 'den'; terraformMode = false; meteorMode = false; }
    if (e.key === '3') { selectedBuild = 'crypt'; terraformMode = false; meteorMode = false; }
    // Terraform per-type hotkeys
    if (e.key.toLowerCase() === 'q') { selectedBuild = 'temple'; terraformMode = true; meteorMode = false; }
    if (e.key.toLowerCase() === 'w') { selectedBuild = 'den'; terraformMode = true; meteorMode = false; }
    if (e.key.toLowerCase() === 'e') { selectedBuild = 'crypt'; terraformMode = true; meteorMode = false; }
    if (e.key === ' ') { speedMult = speedMult === 1 ? 3 : 1; }
    if (e.key.toLowerCase() === 'f') castFrostNova();
    if (e.key.toLowerCase() === 'n' && !waveInProgress && wave < totalWaves) timeToNextWave = 0;
    if (e.key.toLowerCase() === 't') {
      if (!terraformMode) { terraformMode = true; meteorMode = false; }
      else {
        selectedBuild = selectedBuild === 'temple' ? 'den' : selectedBuild === 'den' ? 'crypt' : 'temple';
      }
    }
    if (e.key.toLowerCase() === 'm') meteorMode = !meteorMode, terraformMode = false;
    if (e.key.toLowerCase() === 'r' && gameEnded) restart();
    if (e.key.toLowerCase() === 'x') sellMode = !sellMode;
    if (e.key.toLowerCase() === 'p') paused = !paused;
  });
  // Robust hotkeys
  scene.input.keyboard.on('keydown-N', () => {
    if (!waveInProgress && wave < totalWaves) timeToNextWave = 0;
  });
  scene.input.keyboard.on('keydown-R', () => {
    if (gameEnded) restart();
  });

  scene.input.on('pointerdown', (p) => {
    if (gameEnded) return;
    if (paused) return;
    // If click is in the right UI panel, ignore build handling (buttons handle it)
    if (p.x >= MAP_W) return;
    const cc = Math.floor(p.x / TILE);
    const rr = Math.floor(p.y / TILE);
    if (!inside(cc, rr)) return;
    let c = Math.min(cc, MAP_COLS - 2);
    let r = Math.min(rr, ROWS - 2);
    // Modes: only consume the click if the action can execute; otherwise fall through to building
    if (meteorMode) {
      if (mana >= METEOR_COST) { tryMeteor(p.x, p.y); return; }
      meteorMode = false;
    }
    if (terraformMode) {
      if (mana >= 25 && canTerraformAt(cc, rr)) { tryTerraformGroup(cc, rr); return; }
      terraformMode = false;
    }
    // Sell mode: destroy tower on click
    if (sellMode) {
      const tIdx = findTowerIndexAt(cc, rr);
      if (tIdx !== -1) { coins += 50; towers.splice(tIdx, 1); return; }
      // if no tower under cursor, fall through to build
    }
    if (!canPlaceTower(c, r, selectedBuild)) return;
    const cost = 100 + (towersBuiltByType[selectedBuild] || 0) * 10;
    if (coins < cost) return;
    coins -= cost;
    towersBuilt++; towersBuiltByType[selectedBuild] = (towersBuiltByType[selectedBuild] || 0) + 1;
    const bp = TOWERS[selectedBuild];
    const pos = { x: (c + 1) * TILE, y: (r + 1) * TILE };
    towers.push({ type: selectedBuild, c, r, w: 2, h: 2, x: pos.x, y: pos.y, cd: 0, ...bp });
  });
  scene.input.on('pointermove', (p) => {
    if (p.x >= MAP_W) { hoverC = hoverR = -1; return; }
    hoverC = Math.floor(p.x / TILE);
    hoverR = Math.floor(p.y / TILE);
  });
}

function setupUI(scene) {
  const px = MAP_W;
  // Pause button
  const pauseRect = scene.add.rectangle(px + PANEL_W / 2, 26, PANEL_W - 20, 30, 0x666666, 0.6).setStrokeStyle(2, 0xffffff, 0.4).setInteractive({ useHandCursor: true });
  const pauseTxt = scene.add.text(px + PANEL_W / 2, 26, 'Pause', { fontFamily: 'Arial, sans-serif', fontSize: '14px', color: '#ffffff' }).setOrigin(0.5);
  pauseRect.on('pointerdown', () => {
    paused = !paused;
    pauseTxt.setText(paused ? 'Resume' : 'Pause');
  });
  // Towers group outline and label
  scene.add.rectangle(px + PANEL_W / 2, 120, PANEL_W - 10, 140, 0x000000, 0).setStrokeStyle(2, 0x2a3a4a, 0.8);
  scene.add.text(px + 12, 52, 'Towers', { fontFamily: 'Arial, sans-serif', fontSize: '12px', color: '#ccccff' });

  const makeBtn = (y, label, color, key) => {
    const rect = scene.add.rectangle(px + PANEL_W / 2, y, PANEL_W - 22, 34, color, 0.6).setStrokeStyle(2, 0xffffff, 0.4).setInteractive({ useHandCursor: true });
    const txt = scene.add.text(px + PANEL_W / 2, y, label, { fontFamily: 'Arial, sans-serif', fontSize: '13px', color: '#ffffff' }).setOrigin(0.5);
    rect.on('pointerdown', () => { selectedBuild = key; terraformMode = false; meteorMode = false; });
    return { rect, txt, key, color };
  };
  uiButtons.temple = makeBtn(86, 'Temple (Sand)', C.fire, 'temple');
  uiButtons.den = makeBtn(126, 'Den (Earth)', C.den, 'den');
  uiButtons.crypt = makeBtn(166, 'Crypt (Ice)', C.crypt, 'crypt');
  // Terraform mode buttons
  // Terraform group outline and label
  scene.add.rectangle(px + PANEL_W / 2, 220, PANEL_W - 10, 52, 0x000000, 0).setStrokeStyle(2, 0x2a3a4a, 0.8);
  scene.add.text(px + 12, 196, 'Terraform', { fontFamily: 'Arial, sans-serif', fontSize: '12px', color: '#ccccff' });
  const makeSmallBtn = (x, y, label, color, key) => {
    const rect = scene.add.rectangle(x, y, 44, 24, color, 0.5).setStrokeStyle(1, 0xffffff, 0.6).setInteractive({ useHandCursor: true });
    const txt = scene.add.text(x, y, label, { fontFamily: 'Arial, sans-serif', fontSize: '12px', color: '#ffffff' }).setOrigin(0.5);
    rect.on('pointerdown', () => { selectedBuild = key; terraformMode = true; meteorMode = false; });
    return { rect, txt };
  };
  makeSmallBtn(px + 36, 224, 'Sand', C.sand, 'temple');
  makeSmallBtn(px + 82, 224, 'Earth', C.earth, 'den');
  makeSmallBtn(px + 128, 224, 'Ice', C.ice, 'crypt');

  // Speed toggle at bottom
  const speedY = 560;
  const speedRect = scene.add.rectangle(px + PANEL_W / 2, speedY, PANEL_W - 20, 30, 0x334455, 0.6).setStrokeStyle(2, 0xffffff, 0.4).setInteractive({ useHandCursor: true });
  const speedTxt = scene.add.text(px + PANEL_W / 2, speedY, 'Speed x1', { fontFamily: 'Arial, sans-serif', fontSize: '14px', color: '#ffffff' }).setOrigin(0.5);
  const refreshSpeedBtn = () => {
    speedRect.fillColor = speedMult === 3 ? 0x228822 : 0x334455;
    speedTxt.setText(`Speed x${speedMult}`);
  };
  speedRect.on('pointerdown', () => { speedMult = speedMult === 1 ? 3 : 1; refreshSpeedBtn(); });
  refreshSpeedBtn();
}

function buildMapAndPath() {
  map = [];
  for (let r = 0; r < ROWS; r++) {
    const row = [];
    for (let c = 0; c < COLS; c++) row.push('blocked');
    map.push(row);
  }
  // Carve a 2D corridor within the left 640px (MAP_W)
  const setPath = (cc, rr) => {
    for (let dr = -PATH_RADIUS; dr <= PATH_RADIUS; dr++) {
      for (let dc = -PATH_RADIUS; dc <= PATH_RADIUS; dc++) {
        const rc = rr + dr, cc2 = cc + dc;
        if (!inside(cc2, rc)) continue;
        if (cc2 >= MAP_COLS) continue;
        map[rc][cc2] = 'path';
      }
    }
  };
  const carve = (c1, r1, c2, r2) => {
    let c = c1, r = r1;
    setPath(c, r);
    while (c !== c2) { c += c < c2 ? 1 : -1; setPath(c, r); }
    while (r !== r2) { r += r < r2 ? 1 : -1; setPath(c, r); }
  };

  start = { c: 0, r: 3 };
  treasure = { c: Math.max(3, MAP_COLS - 3), r: Math.min(ROWS - 3, 15) };

  // Multi-turn path: horizontal and vertical bends
  carve(start.c, start.r, 8, 3);
  carve(8, 3, 8, 7);
  carve(8, 7, 3, 7);
  carve(3, 7, 3, 12);
  carve(3, 12, 15, 12);
  carve(15, 12, 15, 5);
  carve(15, 5, Math.min(MAP_COLS - 6, 18), 5);
  carve(Math.min(MAP_COLS - 6, 18), 5, Math.min(MAP_COLS - 6, 18), 15);
  carve(Math.min(MAP_COLS - 6, 18), 15, treasure.c, treasure.r);
  map[treasure.r][treasure.c] = 'path';

  // Place discrete 2x2 buildable clusters (sand/earth/ice)
  placeBuildClusters();

  // Compute navigable path from start to treasure along 'path' tiles
  navPath = computeNavPath(start, treasure).map(p => gridToXY(p.c, p.r));
}

function computeNavPath(src, dst) {
  const q = [];
  const visited = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
  const parent = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  q.push(src);
  visited[src.r][src.c] = true;
  const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
  while (q.length) {
    const cur = q.shift();
    if (cur.c === dst.c && cur.r === dst.r) break;
    for (let d of dirs) {
      const nc = cur.c + d[0];
      const nr = cur.r + d[1];
      if (!inside(nc, nr)) continue;
      if (visited[nr][nc]) continue;
      if (map[nr][nc] !== 'path') continue;
      visited[nr][nc] = true;
      parent[nr][nc] = cur;
      q.push({ c: nc, r: nr });
    }
  }
  const out = [];
  let p = dst;
  while (p) {
    out.push(p);
    p = parent[p.r][p.c];
  }
  out.reverse();
  return out;
}

function nearestNavIndex(x, y) {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < navPath.length; i++) {
    const p = navPath[i];
    const dx = p.x - x, dy = p.y - y;
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

function nearestIdxInPathPts(e, x, y) {
  const pts = e.pathPts || navPath;
  let best = 0, bestD = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const dx = p.x - x, dy = p.y - y;
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

function findTowerIndexAt(cc, rr) {
  for (let i = 0; i < towers.length; i++) {
    const t = towers[i];
    if (cc >= t.c && cc < t.c + (t.w || 2) && rr >= t.r && rr < t.r + (t.h || 2)) return i;
  }
  return -1;
}

function placeBuildClusters() {
  const types = ['sand', 'earth', 'ice'];
  const clustersByType = { sand: [], earth: [], ice: [] };
  const maxTries = 150;
  let placed = 0;
  for (let t = 0; t < maxTries; t++) {
    const type = types[Math.floor(Math.random() * types.length)];
    const c0 = Math.floor(Math.random() * (MAP_COLS - 1));
    const r0 = Math.floor(Math.random() * (ROWS - 1));
    if (!canPlaceClusterAt(c0, r0, type, clustersByType)) continue;
    // Paint 2x2 cluster
    for (let r = r0; r < r0 + 2; r++) {
      for (let c = c0; c < c0 + 2; c++) {
        map[r][c] = type;
      }
    }
    clustersByType[type].push({ c: c0, r: r0 });
    placed++;
    if (placed > 28) break; // keep density moderate
  }
}

function canPlaceClusterAt(c0, r0, type, clustersByType) {
  // inside map area for 2x2
  if (c0 < 0 || r0 < 0 || c0 + 1 >= MAP_COLS || r0 + 1 >= ROWS) return false;
  // must be on blocked and not on path
  for (let r = r0; r < r0 + 2; r++) {
    for (let c = c0; c < c0 + 2; c++) {
      if (map[r][c] !== 'blocked') return false;
    }
  }
  // avoid creating very large fields: limit adjacency of same-type clusters
  const neighbors = clustersByType[type];
  let adjacentCount = 0;
  for (let n of neighbors) {
    const touchH = (n.r === r0 && Math.abs(n.c - c0) === 2);
    const touchV = (n.c === c0 && Math.abs(n.r - r0) === 2);
    if (touchH || touchV) adjacentCount++;
    if (adjacentCount > 1) return false; // allow up to 2 groups in a row
  }
  return true;
}

function canPlaceTower(c0, r0, type) {
  // Ensure footprint inside map
  if (c0 < 0 || r0 < 0 || c0 + 1 >= MAP_COLS || r0 + 1 >= ROWS) return false;
  // Must match terrain type for all 4 cells
  const want = type === 'temple' ? 'sand' : type === 'den' ? 'earth' : 'ice';
  for (let rr = r0; rr < r0 + 2; rr++) {
    for (let cc = c0; cc < c0 + 2; cc++) {
      if (map[rr][cc] !== want) return false;
    }
  }
  // No overlap with other towers
  for (let t of towers) {
    const overlap = !(c0 + 1 < t.c || c0 > t.c + (t.w || 2) - 1 || r0 + 1 < t.r || r0 > t.r + (t.h || 2) - 1);
    if (overlap) return false;
  }
  return true;
}

function tryTerraformGroup(c0, r0) {
  // Convert a single tile of 'blocked' to chosen terrain
  if (mana < 25) return;
  if (!canTerraformAt(c0, r0)) return;
  mana -= 25;
  const targetType = selectedBuild === 'temple' ? 'sand' : selectedBuild === 'den' ? 'earth' : 'ice';
  map[r0][c0] = targetType;
  coins += 10;
  terraformMode = false;
}

function canTerraformAt(c0, r0) {
  return inside(c0, r0) && c0 < MAP_COLS && map[r0][c0] === 'blocked';
}

function tryMeteor(px, py) {
  if (mana < METEOR_COST) return;
  mana -= METEOR_COST;
  explodeEffects.push({ x: px, y: py, r: METEOR_RADIUS, ttl: 0.35 });
  for (let e of enemies) {
    const d = Math.hypot(e.x - px, e.y - py);
    if (d <= METEOR_RADIUS) {
      e.hp -= METEOR_DMG;
      scoreDamage += METEOR_DMG;
    }
  }
}

function randomSpawnCell() {
  const cells = [];
  for (let rr = start.r - PATH_RADIUS; rr <= start.r + PATH_RADIUS; rr++) {
    for (let cc = start.c; cc <= start.c + PATH_RADIUS; cc++) {
      if (inside(cc, rr) && map[rr][cc] === 'path') cells.push({ c: cc, r: rr });
    }
  }
  if (!cells.length) return start;
  return cells[Math.floor(Math.random() * cells.length)];
}

function update(_, dtMs) {
  const dt = Math.min(1 / 30, dtMs / 1000);
  if (gameEnded) { draw(); return; }
  if (paused) { draw(); return; }
  const sdt = dt * speedMult;

  // Mana regen
  mana = Math.min(manaCap, mana + manaRegen * sdt);

  // Waves
  if (!waveInProgress && wave < totalWaves) {
    if (enemies.length === 0 && spawnQueue.length === 0) {
      timeToNextWave -= sdt;
      if (timeToNextWave <= 0) { startWave(); timeToNextWave = 20; }
    } else {
      // Keep countdown visible but not decreasing while wave active
    }
  }
  if (spawnQueue.length) {
    spawnTimer -= sdt;
    if (spawnTimer <= 0) {
      const t = spawnQueue.shift();
      spawnEnemy(t);
      spawnTimer = 0.6; // spacing
    }
  }

  // Systems
  stepEnemies(sdt);
  stepGems(sdt);
  stepTowers(sdt);
  stepPendingShots(sdt);
  stepBullets(sdt);
  stepBeams(sdt);
  stepExplosions(sdt);

  // Win/Lose
  if (gemsLost >= 5 && !gameEnded) endGame(false);
  if (wave === totalWaves && !waveInProgress && enemies.length === 0 && gemsOnGround.length === 0 && !gameEnded) endGame(true);

  draw();
}

function startWave() {
  wave++;
  waveInProgress = true;
  const comp = waveComposition(wave);
  spawnQueue = comp.slice();
}

function waveComposition(n) {
  const arr = [];
  const g = 6 + Math.floor(n * 1.5);
  const o = Math.floor(n / 2);
  const t = Math.floor((n - 3) / 3);
  for (let i = 0; i < g; i++) arr.push('goblin');
  for (let i = 0; i < o; i++) arr.push('orc');
  for (let i = 0; i < t; i++) arr.push('troll');
  return arr;
}

function spawnEnemy(kind) {
  const src = randomSpawnCell();
  const pathCells = computeNavPath(src, treasure);
  const pathPts = pathCells.map(p => gridToXY(p.c, p.r));
  const p0 = pathPts[0];
  const bp = ENEMIES[kind];
  const hpScale = 1 + Math.max(0, wave - 1) * 0.22;
  enemies.push({
    kind,
    x: p0.x,
    y: p0.y,
    hp: Math.floor(bp.hp * hpScale),
    maxHp: Math.floor(bp.hp * hpScale),
    baseSpeed: bp.speed,
    speed: bp.speed,
    reward: bp.reward,
    idx: 0,
    dir: +1, // towards treasure first
    pathPts,
    carrying: false,
    burn: 0,
    burnDps: 0,
    slow: 0,
    slowPct: 0
  });
  if (!spawnQueue.length) waveInProgress = false;
}

function stepEnemies(dt) {
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    // DoT and slow timers
    if (e.burn > 0) { const d = Math.min(e.burn, dt); e.hp -= e.burnDps * d; e.burn -= d; }
    if (e.slow > 0) { e.slow -= dt; if (e.slow <= 0) { e.slow = 0; e.slowPct = 0; } }
    const speed = e.baseSpeed * (1 - e.slowPct);

    // Move along path
    const pathPts = e.pathPts || navPath;
    const tgtIdx = Phaser.Math.Clamp(e.idx + e.dir, 0, pathPts.length - 1);
    const tgt = pathPts[tgtIdx] || pathPts[0];
    const dx = tgt.x - e.x, dy = tgt.y - e.y;
    const dist = Math.hypot(dx, dy);
    const step = speed * dt;
    if (dist <= step) {
      e.x = tgt.x; e.y = tgt.y; e.idx = tgtIdx;
      // Reached treasure or end of path
      if (e.dir === +1 && (!e.carrying) && (tgtIdx === pathPts.length - 1 || nearTreasure(e)) && gemsAtBase > 0) {
        e.carrying = true;
        gemsAtBase -= 1;
        e.gemColor = baseGemColors.pop() || GEM_COLORS[0];
        touchedGem = true;
        e.idx = pathPts.length - 1;
        e.dir = -1;
      } else if (e.dir === +1 && (!e.carrying) && (tgtIdx === pathPts.length - 1 || nearTreasure(e)) && gemsAtBase <= 0) {
        // No gems at base: turn around to exit so game doesn't stall
        e.idx = pathPts.length - 1;
        e.dir = -1;
      } else if (e.dir === -1 && e.idx === 0) {
        // Exited map
        if (e.carrying) { gemsLost += 1; }
        enemies.splice(i, 1);
        continue;
    }
  } else {
      e.x += (dx / dist) * step;
      e.y += (dy / dist) * step;
    }

    // Death check
    if (e.hp <= 0) {
      coins += e.reward;
      if (e.carrying) dropGem(e.x, e.y, e.gemColor);
      enemies.splice(i, 1);
    }
  }
}

function nearTreasure(e) {
  const p = gridToXY(treasure.c, treasure.r);
  return Math.hypot(e.x - p.x, e.y - p.y) < TILE * 0.6;
}

function dropGem(x, y, col) {
  gemsOnGround.push({ x, y, vx: 0, vy: 0, returnDelay: 4, col: col || GEM_COLORS[0] });
}

function stepGems(dt) {
  for (let i = gemsOnGround.length - 1; i >= 0; i--) {
    const gobj = gemsOnGround[i];
    gobj.returnDelay -= dt;
    if (gobj.returnDelay <= 0) {
      if (gobj.idx == null) gobj.idx = nearestNavIndex(gobj.x, gobj.y);
      const targetIdx = navPath.length - 1;
      const nextIdx = Math.min(targetIdx, gobj.idx + 1);
      const tgt = navPath[nextIdx];
      const dx = tgt.x - gobj.x, dy = tgt.y - gobj.y;
      const dist = Math.hypot(dx, dy);
      const step = 20 * dt; // slower return speed
      if (dist <= step) {
        gobj.x = tgt.x; gobj.y = tgt.y; gobj.idx = nextIdx;
        if (gobj.idx >= targetIdx) { baseGemColors.push(gobj.col || GEM_COLORS[0]); gemsOnGround.splice(i, 1); gemsAtBase += 1; continue; }
      } else {
        gobj.x += (dx / dist) * step;
        gobj.y += (dy / dist) * step;
      }
    }
    // Enemy pickup while on ground/returning
    for (let e of enemies) {
      if (!e.carrying && Math.hypot(e.x - gobj.x, e.y - gobj.y) < 14) {
        e.carrying = true;
        e.dir = -1;
        // Ensure return path index roughly matches their current position
        e.idx = nearestIdxInPathPts(e, e.x, e.y);
        e.gemColor = gobj.col || GEM_COLORS[0];
        gemsOnGround.splice(i, 1);
        break;
      }
    }
  }
}

function stepTowers(dt) {
  for (let t of towers) {
    t.cd -= dt;
    if (t.cd > 0) continue;
    // Find targets in range
    const inRange = [];
    for (let e of enemies) {
      const d = Math.hypot(e.x - t.x, e.y - t.y);
      if (d <= t.range) inRange.push({ e, d });
    }
    if (inRange.length === 0) continue;
    inRange.sort((a, b) => (a.e.carrying === b.e.carrying ? a.d - b.d : (b.e.carrying ? 1 : -1)));

    if (t.type === 'temple') {
      // Continuous short beam to nearest target every tick (beam applies damage over time)
      const target = inRange[0].e;
      const beam = { x1: t.x, y1: t.y, x2: target.x, y2: target.y, ttl: 0.08, dmg: t.dmg };
      beams.push(beam);
    } else if (t.type === 'crypt') {
      // Three sequential shots (staggered)
      const shots = Math.min(3, inRange.length);
      for (let i = 0; i < shots; i++) {
        const target = inRange[i].e;
        pendingShots.push({ delay: 0.12 * i, make: () => {
          const b = { x: t.x, y: t.y, tx: target, speed: t.bullet, dmg: Math.ceil(t.dmg * 0.5), type: t.type, burnDps: 0, burnSec: 0, slowPct: t.slowPct || 0, slowSec: t.slowSec || 0, color: t.color };
          bullets.push(b);
        }});
      }
    } else {
      // Den: slower, heavier shot
      const target = inRange[0].e;
      const b = { x: t.x, y: t.y, tx: target, speed: t.bullet, dmg: Math.ceil(t.dmg * 1.6), type: t.type, burnDps: 0, burnSec: 0, slowPct: 0, slowSec: 0, color: t.color };
      bullets.push(b);
    }
    t.cd = t.rate;
  }
}

function shoot(t, e) {
  const b = { x: t.x, y: t.y, tx: e, speed: t.bullet, dmg: t.dmg, type: t.type, burnDps: t.burnDps || 0, burnSec: t.burnSec || 0, slowPct: t.slowPct || 0, slowSec: t.slowSec || 0, color: t.color };
  bullets.push(b);
}

function stepBullets(dt) {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    const e = b.tx;
    if (!e) { bullets.splice(i, 1); continue; }
    const dx = e.x - b.x, dy = e.y - b.y, dist = Math.hypot(dx, dy);
    const step = b.speed * dt;
    if (dist <= step || dist < 8) {
      e.hp -= b.dmg; scoreDamage += b.dmg;
      if (b.type === 'temple') { e.burn = Math.max(e.burn, b.burnSec); e.burnDps = b.burnDps; }
      if (b.type === 'crypt') { e.slow = Math.max(e.slow, b.slowSec); e.slowPct = Math.max(e.slowPct, b.slowPct); }
      bullets.splice(i, 1);
    } else {
      b.x += (dx / dist) * step;
      b.y += (dy / dist) * step;
    }
  }
}

function stepBeams(dt) {
  for (let i = beams.length - 1; i >= 0; i--) {
    const bm = beams[i];
    bm.ttl -= dt;
    if (bm.ttl <= 0) { beams.splice(i, 1); continue; }
    // Apply beam tick damage to enemies near the beam line
    const len = Math.hypot(bm.x2 - bm.x1, bm.y2 - bm.y1);
    const nx = (bm.x2 - bm.x1) / (len || 1);
    const ny = (bm.y2 - bm.y1) / (len || 1);
    const width = 10;
    for (let e of enemies) {
      // Distance from point to line segment
      const px = e.x - bm.x1, py = e.y - bm.y1;
      const proj = Math.max(0, Math.min(len, px * nx + py * ny));
      const cx = bm.x1 + nx * proj, cy = bm.y1 + ny * proj;
      const d = Math.hypot(e.x - cx, e.y - cy);
      if (d < width) {
        const dealt = bm.dmg * dt * 10; e.hp -= dealt; scoreDamage += dealt;
      }
    }
  }
}

function stepPendingShots(dt) {
  for (let i = pendingShots.length - 1; i >= 0; i--) {
    const s = pendingShots[i];
    s.delay -= dt;
    if (s.delay <= 0) { s.make(); pendingShots.splice(i, 1); }
  }
}

function stepExplosions(dt) {
  for (let i = explodeEffects.length - 1; i >= 0; i--) {
    const ex = explodeEffects[i];
    ex.ttl -= dt;
    if (ex.ttl <= 0) explodeEffects.splice(i, 1);
  }
}

function castFrostNova() {
  const cost = 30;
  if (mana < cost) return;
  mana -= cost;
  for (let e of enemies) { e.slow = Math.max(e.slow, 2.5); e.slowPct = Math.max(e.slowPct, 0.6); }
}

function inside(c, r) { return c >= 0 && r >= 0 && c < COLS && r < ROWS; }

function draw() {
  g.clear();

  // Tiles
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const x = c * TILE, y = r * TILE;
      const t = map[r][c];
      const col = t === 'path' ? C.path : t === 'sand' ? C.sand : t === 'earth' ? C.earth : t === 'ice' ? C.ice : C.blocked;
      g.fillStyle(col, 1).fillRect(x, y, TILE - 1, TILE - 1);
    }
  }

  // Right UI panel background overlay
  g.fillStyle(0x0e1822, 1).fillRect(MAP_W, 0, PANEL_W, 600);
  g.lineStyle(2, 0x2a3a4a, 1).strokeRect(MAP_W + 1, 1, PANEL_W - 2, 598);
  // Build/Terraform preview hover
  if (!gameEnded && hoverC >= 0 && hoverR >= 0 && hoverC < MAP_COLS && hoverR < ROWS) {
    const col = selectedBuild === 'temple' ? C.fire : selectedBuild === 'den' ? C.den : C.crypt;
    if (terraformMode) {
      const ok = canTerraformAt(hoverC, hoverR);
      g.fillStyle(col, ok ? 0.35 : 0.15).fillRect(hoverC * TILE + 1, hoverR * TILE + 1, TILE - 2, TILE - 2);
      if (!ok) g.lineStyle(2, 0xff4444, 0.7).strokeRect(hoverC * TILE + 2, hoverR * TILE + 2, TILE - 4, TILE - 4);
    } else {
      const c0 = Math.min(hoverC, MAP_COLS - 2);
      const r0 = Math.min(hoverR, ROWS - 2);
      const ok = canPlaceTower(c0, r0, selectedBuild);
      g.fillStyle(col, ok ? 0.35 : 0.15).fillRect(c0 * TILE + 1, r0 * TILE + 1, 2 * TILE - 2, 2 * TILE - 2);
      if (!ok) g.lineStyle(2, 0xff4444, 0.7).strokeRect(c0 * TILE + 2, r0 * TILE + 2, 2 * TILE - 4, 2 * TILE - 4);
      // Range preview
      const cx = (c0 + 1) * TILE;
      const cy = (r0 + 1) * TILE;
      const r = TOWERS[selectedBuild].range;
      g.lineStyle(1, 0xffffff, 0.25).strokeCircle(cx, cy, r);
    }
  }

  // Treasure base (square) and gem icons
  const base = gridToXY(treasure.c, treasure.r);
  g.fillStyle(0xffcc33, 1).fillRect(base.x - 12, base.y - 12, 24, 24);
  g.lineStyle(2, 0x996600, 1).strokeRect(base.x - 12, base.y - 12, 24, 24);
  for (let i = 0; i < baseGemColors.length; i++) {
    const gx = base.x + 16 + (i % 5) * 10;
    const gy = base.y - 18 - Math.floor(i / 5) * 12;
    const col = baseGemColors[i % baseGemColors.length];
    drawGem(gx, gy, 8, col);
  }

  // Gems on ground
  for (let gm of gemsOnGround) drawGem(gm.x, gm.y, 7, gm.col || 0x66ffe0);

  // Towers
  for (let t of towers) {
    g.fillStyle(TOWERS[t.type].color, 1).fillRect(t.c * TILE + 1, t.r * TILE + 1, (t.w || 2) * TILE - 2, (t.h || 2) * TILE - 2);
    g.lineStyle(1, 0x111111, 0.3).strokeCircle(t.x, t.y, t.range);
  }

  // Enemies
  for (let e of enemies) {
    g.fillStyle(C.enemy, 1).fillCircle(e.x, e.y, 9);
    if (e.carrying) drawGem(e.x, e.y - 14, 5, e.gemColor || 0xffff88);
    // HP bar
    const w = 22, h = 3, px = e.x - w / 2, py = e.y + 12;
    g.fillStyle(C.hpBack, 1).fillRect(px, py, w, h);
    const hpw = Math.max(0, Math.floor((e.hp / e.maxHp) * w));
    g.fillStyle(C.hpFront, 1).fillRect(px, py, hpw, h);
  }

  // Bullets
  for (let b of bullets) g.fillStyle(b.color, 1).fillCircle(b.x, b.y, 3);
  // Beams
  for (let bm of beams) {
    g.lineStyle(3, 0xffaa66, 0.9).strokeLineShape(new Phaser.Geom.Line(bm.x1, bm.y1, bm.x2, bm.y2));
  }
  // Meteor preview/effects
  if (meteorMode && hoverC >= 0 && hoverR >= 0 && hoverC < MAP_COLS && hoverR < ROWS) {
    const px = (hoverC + 0.5) * TILE;
    const py = (hoverR + 0.5) * TILE;
    g.lineStyle(2, 0xff6666, 0.8).strokeCircle(px, py, METEOR_RADIUS);
  }
  for (let ex of explodeEffects) {
    g.fillStyle(0xff6633, ex.ttl / 0.35).fillCircle(ex.x, ex.y, ex.r * (ex.ttl / 0.35));
  }

  // UI
  const cost = 100 + (towersBuiltByType[selectedBuild] || 0) * 10;
  const nextReady = !waveInProgress && wave < totalWaves && enemies.length === 0 && spawnQueue.length === 0;
  const waveText = wave >= totalWaves ? `${wave}/${totalWaves}` : `${Math.max(0, wave)}/${totalWaves}${nextReady ? ` (in ${Math.ceil(timeToNextWave)}s)` : ''}`;
  uiText.setText(
    `Score: ${Math.floor(scoreDamage)}\n` +
    `Safe Gems: ${gemsAtBase}/5\n` +
    `Coins: ${coins}  Mana: ${Math.floor(mana)}\n` +
    `Wave: ${waveText}\n\n` +
    `Build Temple [1] (${(towersBuiltByType.temple || 0) * 10 + 100} coins)\n` +
    `Build Den [2] (${(towersBuiltByType.den || 0) * 10 + 100} coins)\n` +
    `Build Crypt [3] (${(towersBuiltByType.crypt || 0) * 10 + 100} coins)\n` +
    `Terraform [T] (25 mana)\n` +
    `Frost [F] (30 mana)\n` +
    `Meteor [M] (200 mana)\n` +
    `Destroy [X] (+50 coins)\n\n` +
    `Next wave [N]\n` +
    `Pause [P]\n` +
    `Toggle speed [Space]\n`
  );

  // Button selection outlines
  Object.values(uiButtons).forEach(b => {
    const active = b.key === selectedBuild;
    b.rect.setStrokeStyle(active ? 3 : 2, active ? 0xffff66 : 0xffffff, active ? 0.9 : 0.4);
  });
}

function drawGem(x, y, s, col) {
  g.fillStyle(col, 1);
  g.beginPath();
  g.moveTo(x, y - s);
  g.lineTo(x + s, y);
  g.lineTo(x, y + s);
  g.lineTo(x - s, y);
  g.closePath();
  g.fillPath();
}

function endGame(won) {
  gameEnded = true;
  const scene = game.scene.scenes[0];
  if (endUI) { endUI.destroy(); endUI = null; }
  const container = scene.add.container(0, 0);
  const overlay = scene.add.graphics();
  overlay.fillStyle(0x000000, 0.7).fillRect(0, 0, 800, 600);
  container.add(overlay);
  const gemsSaved = Math.max(0, 5 - gemsLost);
  const multGems = Math.max(1, gemsSaved);
  const multPerfect = touchedGem ? 1 : 2;
  const finalScore = Math.floor(scoreDamage * multGems * multPerfect);
  const title = won ? 'YOU DEFENDED THE GEMS!' : 'THE GEMS ARE LOST';
  const t = scene.add.text(400, 260, title, { fontFamily: 'Arial, sans-serif', fontSize: '36px', color: '#ffffff' }).setOrigin(0.5);
  const line2 = scene.add.text(400, 310, `Base: ${Math.floor(scoreDamage)}  x Gems:${multGems}  x Perfect:${multPerfect}`, { fontFamily: 'Arial, sans-serif', fontSize: '18px', color: '#66ffcc' }).setOrigin(0.5);
  const line3 = scene.add.text(400, 350, `Final Score: ${finalScore}`, { fontFamily: 'Arial, sans-serif', fontSize: '28px', color: '#ffff88' }).setOrigin(0.5);
  const line4 = scene.add.text(400, 400, 'Press R to Restart', { fontFamily: 'Arial, sans-serif', fontSize: '18px', color: '#ffff88' }).setOrigin(0.5);
  container.add([t, line2, line3, line4]);
  endUI = container;
}

function restart() {
  // Reset all state
  map = []; navPath = []; towers = []; enemies = []; bullets = []; gemsOnGround = [];
  beams = []; explodeEffects = []; pendingShots = [];
  if (endUI) { endUI.destroy(); endUI = null; }
  paused = false;
  coins = 330; mana = 50; wave = 0; waveInProgress = false; timeToNextWave = 10; spawnQueue = []; spawnTimer = 0; gemsAtBase = 5; gemsLost = 0; towersBuilt = 0; selectedBuild = 'temple'; gameEnded = false; scoreDamage = 0; touchedGem = false; terraformMode = false; meteorMode = false;
  towersBuiltByType = { fire: 0, den: 0, crypt: 0 };
  baseGemColors = [GEM_COLORS[0], GEM_COLORS[1], GEM_COLORS[2], GEM_COLORS[3], GEM_COLORS[4]];
  buildMapAndPath();
}
