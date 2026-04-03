// sim.js — sevo-life simulation engine for the browser
// Self-contained: World, beauty scorer, genomes, decision function
// No dependencies, no imports

// === PRNG ===
function mulberry32(seed) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// === DEFAULT CONFIG ===
export const DEFAULT_CONFIG = {
  width: 60,
  height: 40,
  maxTicks: 500,
  initialResources: 150,
  resourceRegenRate: 0.005,
  trailDecayRate: 0.02,
  energyDrainPerTick: 0.5,
  moveCost: 0.3,
  harvestGain: 5,
  seed: 42,
};

// === WORLD ===
export class World {
  constructor(config, genomes) {
    this.config = config;
    this.tick = 0;
    this.rng = mulberry32(config.seed);
    this.events = []; // per-tick events for rendering

    this.grid = Array.from({ length: config.height }, () =>
      Array.from({ length: config.width }, () => ({
        resource: 0,
        trail: 0,
        trailColor: 0,
        occupied: false,
      }))
    );

    let placed = 0;
    while (placed < config.initialResources) {
      const x = Math.floor(this.rng() * config.width);
      const y = Math.floor(this.rng() * config.height);
      if (this.grid[y][x].resource === 0) {
        this.grid[y][x].resource = 0.3 + this.rng() * 0.7;
        placed++;
      }
    }

    this.entities = genomes.map((genome, i) => {
      const pos = {
        x: Math.floor(this.rng() * config.width),
        y: Math.floor(this.rng() * config.height),
      };
      this.grid[pos.y][pos.x].occupied = true;
      return {
        id: i,
        pos,
        energy: 20,
        age: 0,
        genome,
        alive: true,
        totalHarvested: 0,
        trailsLeft: 0,
        distanceTraveled: 0,
      };
    });
  }

  getNeighbors(pos, radius = 3) {
    const views = [];
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = (pos.x + dx + this.config.width) % this.config.width;
        const ny = (pos.y + dy + this.config.height) % this.config.height;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= radius) {
          views.push({
            pos: { x: nx, y: ny },
            cell: this.grid[ny][nx],
            distance: dist,
            direction: { x: Math.sign(dx), y: Math.sign(dy) },
          });
        }
      }
    }
    return views;
  }

  applyAction(entity, action) {
    const { config, grid } = this;
    switch (action.type) {
      case "move": {
        const nx = (entity.pos.x + action.direction.x + config.width) % config.width;
        const ny = (entity.pos.y + action.direction.y + config.height) % config.height;
        if (!grid[ny][nx].occupied) {
          const oldCell = grid[entity.pos.y][entity.pos.x];
          const entityPeriod = 8 + entity.id * 3;
          const phase = entity.age % (entityPeriod * 3);
          let trailStrength;
          if (phase < entityPeriod) trailStrength = entity.genome.trailIntensity * 0.15;
          else if (phase < entityPeriod * 2) trailStrength = entity.genome.trailIntensity * 0.5;
          else trailStrength = entity.genome.trailIntensity * 0.9;
          oldCell.trail = Math.min(1, oldCell.trail + trailStrength);
          oldCell.trailColor = entity.genome.trailColor;
          if (entity.genome.trailIntensity > 0.1) entity.trailsLeft++;
          oldCell.occupied = false;
          entity.pos = { x: nx, y: ny };
          grid[ny][nx].occupied = true;
          entity.energy -= config.moveCost;
          entity.distanceTraveled++;
        }
        break;
      }
      case "harvest": {
        const cell = grid[entity.pos.y][entity.pos.x];
        if (cell.resource > 0) {
          const gained = Math.min(cell.resource, 1) * config.harvestGain;
          entity.energy += gained;
          entity.totalHarvested += gained;
          cell.resource = 0;
          this.events.push({ type: "harvest", x: entity.pos.x, y: entity.pos.y, id: entity.id });
        }
        break;
      }
      case "trail": {
        const cell = grid[entity.pos.y][entity.pos.x];
        cell.trail = Math.min(1, cell.trail + action.intensity);
        cell.trailColor = action.color;
        entity.trailsLeft++;
        break;
      }
      case "pulse": {
        const r = Math.min(action.radius, 3);
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.sqrt(dx * dx + dy * dy) <= r) {
              const px = (entity.pos.x + dx + config.width) % config.width;
              const py = (entity.pos.y + dy + config.height) % config.height;
              grid[py][px].trail = Math.min(1, grid[py][px].trail + 0.3);
              grid[py][px].trailColor = entity.genome.trailColor;
            }
          }
        }
        entity.energy -= 1;
        entity.trailsLeft += r * r;
        this.events.push({ type: "pulse", x: entity.pos.x, y: entity.pos.y, r, id: entity.id });
        break;
      }
      case "idle":
        entity.energy += 0.1;
        break;
    }
  }

  step(decisionFn) {
    this.tick++;
    this.events = [];
    const { config, grid, entities } = this;

    for (const entity of entities) {
      if (!entity.alive) continue;
      entity.energy -= config.energyDrainPerTick;
      entity.age++;
      if (entity.energy <= 0) {
        entity.alive = false;
        grid[entity.pos.y][entity.pos.x].occupied = false;
        this.events.push({ type: "death", x: entity.pos.x, y: entity.pos.y, id: entity.id });
        continue;
      }
      const neighbors = this.getNeighbors(entity.pos);
      const action = decisionFn(entity, neighbors);
      this.applyAction(entity, action);
    }

    for (let y = 0; y < config.height; y++) {
      for (let x = 0; x < config.width; x++) {
        if (grid[y][x].trail > 0) {
          grid[y][x].trail = Math.max(0, grid[y][x].trail - config.trailDecayRate);
        }
      }
    }

    for (let y = 0; y < config.height; y++) {
      for (let x = 0; x < config.width; x++) {
        if (grid[y][x].resource === 0 && this.rng() < config.resourceRegenRate) {
          grid[y][x].resource = 0.2 + this.rng() * 0.5;
        }
      }
    }
  }

  isFinished() {
    return this.tick >= this.config.maxTicks || this.entities.every((e) => !e.alive);
  }
}

// === BEAUTY SCORER ===
function symmetryScore(grid) {
  const h = grid.length, w = grid[0].length;
  let matches = 0, total = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < Math.floor(w / 2); x++) {
      const left = grid[y][x].trail, right = grid[y][w - 1 - x].trail;
      if (left > 0.1 || right > 0.1) { total++; if (Math.abs(left - right) < 0.3) matches++; }
    }
  }
  for (let y = 0; y < Math.floor(h / 2); y++) {
    for (let x = 0; x < w; x++) {
      const top = grid[y][x].trail, bottom = grid[h - 1 - y][x].trail;
      if (top > 0.1 || bottom > 0.1) { total++; if (Math.abs(top - bottom) < 0.3) matches++; }
    }
  }
  return total > 0 ? matches / total : 0;
}

function complexityScore(grid) {
  const h = grid.length, w = grid[0].length;
  const bins = [0, 0, 0, 0, 0];
  let trailCells = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (grid[y][x].trail > 0.02) {
        bins[Math.min(4, Math.floor(grid[y][x].trail * 5))]++;
        trailCells++;
      }
    }
  }
  let entropy = 0;
  if (trailCells > 0) {
    for (const c of bins) { if (c > 0) { const p = c / trailCells; entropy -= p * Math.log2(p); } }
    entropy /= Math.log2(5);
  }
  let spatialDiff = 0, spatialCount = 0;
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const here = grid[y][x].trail;
      if (here > 0.02 || grid[y][x + 1].trail > 0.02) { spatialDiff += Math.abs(here - grid[y][x + 1].trail); spatialCount++; }
      if (here > 0.02 || grid[y + 1][x].trail > 0.02) { spatialDiff += Math.abs(here - grid[y + 1][x].trail); spatialCount++; }
    }
  }
  const spatial = spatialCount > 0 ? Math.min(1, spatialDiff / spatialCount * 3) : 0;
  return 0.6 * entropy + 0.4 * spatial;
}

function rhythmScore(grid) {
  const h = grid.length, w = grid[0].length;
  function gapReg(gaps) {
    if (gaps.length < 2) return 0;
    const m = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const v = gaps.reduce((a, b) => a + (b - m) ** 2, 0) / gaps.length;
    return Math.max(0, 1 - (m > 0 ? Math.sqrt(v) / m : 1));
  }
  function scanGaps(getTrail) {
    const gaps = [];
    let inT = false, gap = 0;
    for (let i = 0; ; i++) {
      const val = getTrail(i);
      if (val === null) break;
      if (val > 0.1 && !inT) { if (gap > 0) gaps.push(gap); gap = 0; inT = true; }
      else if (val <= 0.1) { gap++; inT = false; }
    }
    return gaps;
  }
  const hGaps = [], vGaps = [];
  for (let y = 0; y < h; y += 2) hGaps.push(...scanGaps(x => x < w ? grid[y][x].trail : null));
  for (let x = 0; x < w; x += 2) vGaps.push(...scanGaps(y => y < h ? grid[y][x].trail : null));
  return 0.5 * gapReg(hGaps) + 0.5 * gapReg(vGaps);
}

function colorHarmonyScore(grid) {
  const h = grid.length, w = grid[0].length;
  const cc = [0, 0, 0, 0, 0, 0];
  let total = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (grid[y][x].trail > 0.1) { cc[Math.min(5, Math.max(0, Math.floor(grid[y][x].trailColor)))]++; total++; }
  }
  if (!total) return 0;
  const used = cc.map((c, i) => ({ color: i, ratio: c / total })).filter(c => c.ratio > 0.05);
  if (used.length <= 1) return 0.2;
  let sum = 0, pairs = 0;
  for (let i = 0; i < used.length; i++) for (let j = i + 1; j < used.length; j++) {
    const d = Math.min(Math.abs(used[i].color - used[j].color), 6 - Math.abs(used[i].color - used[j].color));
    sum += d === 3 ? 1 : d === 2 ? 0.8 : 0.5;
    pairs++;
  }
  return pairs > 0 ? sum / pairs : 0;
}

function coverageScore(grid) {
  const h = grid.length, w = grid[0].length;
  let tc = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (grid[y][x].trail > 0.05) tc++;
  const r = tc / (h * w);
  if (r < 0.1) return r * 5;
  if (r > 0.7) return Math.max(0, 1 - (r - 0.7) * 3);
  return 0.5 + (r - 0.1) * (0.5 / 0.6);
}

export function scoreBeauty(grid) {
  const s = symmetryScore(grid), cx = complexityScore(grid), rh = rhythmScore(grid);
  const ch = colorHarmonyScore(grid), cv = coverageScore(grid);
  return {
    symmetry: s, complexity: cx, rhythm: rh, colorHarmony: ch, coverage: cv,
    total: s * 0.25 + cx * 0.25 + rh * 0.20 + ch * 0.15 + cv * 0.15,
  };
}

// === GENOMES ===
export const GENOMES = [
  { moveSpeed: 0.9, turnBias: 0.1, resourceAttraction: 0.6, trailAttraction: -0.3, harvestThreshold: 0.2, energyConserve: 0.3, explorationDrive: 0.8, trailIntensity: 0.5, trailColor: 0, pulseFrequency: 0.1, patternSymmetry: 0.3, name: "Explorer" },
  { moveSpeed: 0.5, turnBias: -0.1, resourceAttraction: 0.9, trailAttraction: 0.0, harvestThreshold: 0.1, energyConserve: 0.7, explorationDrive: 0.2, trailIntensity: 0.3, trailColor: 1, pulseFrequency: 0.05, patternSymmetry: 0.5, name: "Hoarder" },
  { moveSpeed: 0.7, turnBias: 0.5, resourceAttraction: 0.4, trailAttraction: 0.2, harvestThreshold: 0.3, energyConserve: 0.4, explorationDrive: 0.6, trailIntensity: 0.9, trailColor: 2, pulseFrequency: 0.3, patternSymmetry: 0.8, name: "Artist" },
  { moveSpeed: 0.6, turnBias: 0.0, resourceAttraction: 0.5, trailAttraction: 0.1, harvestThreshold: 0.2, energyConserve: 0.5, explorationDrive: 0.5, trailIntensity: 0.5, trailColor: 3, pulseFrequency: 0.15, patternSymmetry: 0.5, name: "Balanced" },
  { moveSpeed: 1.0, turnBias: -0.3, resourceAttraction: 0.7, trailAttraction: -0.5, harvestThreshold: 0.4, energyConserve: 0.1, explorationDrive: 0.9, trailIntensity: 0.2, trailColor: 4, pulseFrequency: 0.0, patternSymmetry: 0.1, name: "Sprinter" },
  { moveSpeed: 0.3, turnBias: 0.0, resourceAttraction: 0.8, trailAttraction: 0.3, harvestThreshold: 0.15, energyConserve: 0.9, explorationDrive: 0.1, trailIntensity: 0.4, trailColor: 5, pulseFrequency: 0.05, patternSymmetry: 0.6, name: "Conservative" },
  { moveSpeed: 0.5, turnBias: 0.2, resourceAttraction: 0.5, trailAttraction: 0.0, harvestThreshold: 0.25, energyConserve: 0.5, explorationDrive: 0.4, trailIntensity: 0.7, trailColor: 0, pulseFrequency: 0.5, patternSymmetry: 0.9, name: "Pulser" },
  { moveSpeed: 0.6, turnBias: 0.1, resourceAttraction: 0.3, trailAttraction: 0.8, harvestThreshold: 0.2, energyConserve: 0.4, explorationDrive: 0.3, trailIntensity: 0.6, trailColor: 2, pulseFrequency: 0.1, patternSymmetry: 0.7, name: "Follower" },
];

// === DECISION FUNCTION ===
// Seeded per-entity RNG for deterministic browser behavior
const entityRngs = new Map();
function entityRng(id, seed) {
  if (!entityRngs.has(id)) entityRngs.set(id, mulberry32(seed + id * 7919));
  return entityRngs.get(id)();
}

export function decide(entity, neighbors, seed) {
  const g = entity.genome;
  const rng = () => entityRng(entity.id, seed);

  const selfCell = neighbors.find((n) => n.distance === 0);
  const onResource = selfCell ? selfCell.cell.resource > g.harvestThreshold : false;

  if (entity.energy < 5) {
    if (onResource) return { type: "harvest" };
    const rc = neighbors.filter((n) => n.cell.resource > 0.1 && n.distance > 0).sort((a, b) => a.distance - b.distance);
    if (rc.length > 0) return { type: "move", direction: rc[0].direction };
    if (g.energyConserve > 0.5) return { type: "idle" };
  }

  if (onResource) return { type: "harvest" };

  if (entity.energy > 8 && g.pulseFrequency > 0 && entity.age % Math.max(5, Math.round(20 * (1 - g.pulseFrequency))) === 0) {
    return { type: "pulse", radius: 2 };
  }

  if (rng() < g.moveSpeed) {
    let bestDir = { x: 0, y: 0 }, bestScore = -Infinity;
    const dirs = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }, { x: 1, y: 1 }, { x: -1, y: -1 }, { x: 1, y: -1 }, { x: -1, y: 1 }];
    for (const dir of dirs) {
      let score = 0;
      const nearby = neighbors.filter((n) => n.direction.x === dir.x && n.direction.y === dir.y);
      for (const n of nearby) {
        score += n.cell.resource * g.resourceAttraction * (1 / Math.max(n.distance, 0.5));
        score += n.cell.trail * g.trailAttraction * (1 / Math.max(n.distance, 0.5));
        if (!n.cell.occupied) score += 0.1;
      }
      if (g.patternSymmetry > 0.5 && (dir.x === 0 || dir.y === 0)) score += g.patternSymmetry * 0.3;
      score += g.explorationDrive * (rng() * 0.5);
      score += dir.x * g.turnBias * 0.2;
      if (score > bestScore) { bestScore = score; bestDir = dir; }
    }
    return { type: "move", direction: bestDir };
  }

  if (g.trailIntensity > 0.2 && entity.energy > 5) {
    return { type: "trail", intensity: g.trailIntensity, color: g.trailColor };
  }
  return { type: "idle" };
}

// Reset entity RNGs on new simulation
export function resetRngs() {
  entityRngs.clear();
}
