/**
 * Materials tracking (Cubes / Hexas per board color) - pure functions, no DOM.
 * Used by js/materialsPage.js. Deliberately SEPARATE from the Team Builder's
 * boardSelections and the Board Manager's greenYellowBoardSelections for now:
 * the account record here is the player's real, whole-account board state
 * (every holomem, all 4 colors), stored under its own localStorage key.
 *
 * Data: data/board_materials.json (tools/extract_board_materials.py).
 *   - models[layout] = the 153 non-center nodes of that board layout, each
 *     { id, x, y, area, kind: 'node'|'connector', grade, points, cost: {itemId: qty}, effect, icon }
 *   - characters[characterId] = { name, model, groups }
 *   - characterOverrides[characterId][nodeId] = { effect, icon } (per-holomem
 *     effect text - e.g. the Green gen-boost nodes; costs never vary)
 *   - materials[itemId] = { name, color, tier }
 *
 * Why this works without resetting anything in-game: every unlocked node is
 * visible on the in-game board and every node's cost is fixed, so
 *   spent (sum over unlocked nodes) + held (in-game item count) = total ever earned.
 *
 * Unlock/lock behaviour mirrors the Board Manager: a node can be unlocked
 * when it's next to the center or to an unlocked node OF THE SAME AREA;
 * clicking a far node unlocks the shortest same-area path to it; locking a
 * node also locks everything that's no longer connected to the center.
 * Connector slots (S-002..S-004) cost nothing and are unlocked
 * automatically whenever a path passes through them.
 */

export const AREAS = ['red', 'blue', 'green', 'yellow'];
export const AREA_LABELS = {
  red: 'Red (Leader)',
  blue: 'Blue (Member)',
  green: 'Green (Card)',
  yellow: 'Yellow (Content)',
};
export const STORAGE_KEY = 'hoshidori_materials_v1';

const NEIGHBORS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const posKey = (x, y) => `${x},${y}`;

/** One holomem's full board: her layout's nodes with her per-holomem effect
 *  overrides applied, plus lookup maps. */
export function getCharacterBoard(boardMaterials, characterId) {
  const ch = boardMaterials.characters[characterId];
  if (!ch) return null;
  const overrides = boardMaterials.characterOverrides?.[characterId] || {};
  const nodes = (boardMaterials.models[ch.model] || []).map((n) => (overrides[n.id] ? { ...n, ...overrides[n.id] } : n));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const byPos = new Map(nodes.map((n) => [posKey(n.x, n.y), n]));
  return { characterId, name: ch.name, model: ch.model, nodes, byId, byPos };
}

/** Adds up costs: { cost: {itemId: qty}, points } for the given nodes. */
export function sumCost(nodes) {
  const cost = {};
  let points = 0;
  for (const n of nodes) {
    points += n.points || 0;
    for (const [itemId, qty] of Object.entries(n.cost || {})) cost[itemId] = (cost[itemId] || 0) + qty;
  }
  return { cost, points };
}

/** Per-area spent and remaining for one holomem. */
export function summarizeCharacter(board, unlockedIds) {
  const unlocked = unlockedIds instanceof Set ? unlockedIds : new Set(unlockedIds || []);
  const out = {};
  for (const area of AREAS) {
    const areaNodes = board.nodes.filter((n) => n.area === area && n.kind === 'node');
    const done = areaNodes.filter((n) => unlocked.has(n.id));
    const left = areaNodes.filter((n) => !unlocked.has(n.id));
    out[area] = {
      unlockedCount: done.length,
      totalCount: areaNodes.length,
      spent: sumCost(done),
      remaining: sumCost(left),
    };
  }
  return out;
}

/** Account-wide totals. account.boards = { characterId: [nodeId...] }.
 *  Returns { spent, remaining, points, perCharacter } where spent/remaining
 *  are {itemId: qty}. "remaining" = what finishing EVERY board of EVERY
 *  holomem in boardMaterials would still cost. */
export function computeAccountTotals(boardMaterials, account) {
  const spent = {};
  const remaining = {};
  const perCharacter = {};
  let points = 0;
  const add = (target, cost) => {
    for (const [k, v] of Object.entries(cost)) target[k] = (target[k] || 0) + v;
  };
  for (const characterId of Object.keys(boardMaterials.characters)) {
    const board = getCharacterBoard(boardMaterials, characterId);
    const summary = summarizeCharacter(board, account?.boards?.[characterId]);
    perCharacter[characterId] = summary;
    for (const area of AREAS) {
      add(spent, summary[area].spent.cost);
      add(remaining, summary[area].remaining.cost);
      points += summary[area].spent.points;
    }
  }
  return { spent, remaining, points, perCharacter };
}

/** Can `node` be unlocked right now (adjacent to center or to an unlocked
 *  node of the same area)? */
export function canUnlockNode(board, unlocked, node) {
  for (const [dx, dy] of NEIGHBORS) {
    const nx = node.x + dx;
    const ny = node.y + dy;
    if (nx === 0 && ny === 0) return true;
    const nb = board.byPos.get(posKey(nx, ny));
    if (nb && nb.area === node.area && unlocked.has(nb.id)) return true;
  }
  return false;
}

/** Shortest chain of same-area node ids from the center to `targetId`
 *  (target included). Null if unreachable. */
export function findPath(board, targetId) {
  const target = board.byId.get(targetId);
  if (!target) return null;
  const start = '0,0';
  const parent = new Map();
  const visited = new Set([start]);
  const queue = [start];
  const goal = posKey(target.x, target.y);
  while (queue.length) {
    const cur = queue.shift();
    if (cur === goal) break;
    const [cx, cy] = cur.split(',').map(Number);
    for (const [dx, dy] of NEIGHBORS) {
      const key = posKey(cx + dx, cy + dy);
      if (visited.has(key)) continue;
      const nb = board.byPos.get(key);
      if (!nb || nb.area !== target.area) continue;
      visited.add(key);
      parent.set(key, cur);
      queue.push(key);
    }
  }
  if (!visited.has(goal)) return null;
  const path = [];
  let cur = goal;
  while (cur !== start) {
    path.push(board.byPos.get(cur).id);
    cur = parent.get(cur);
  }
  return path.reverse();
}

/** Keeps only unlocked nodes still connected to the center through
 *  unlocked same-area nodes. */
export function pruneUnlocked(board, unlocked) {
  const kept = new Set();
  const queue = [];
  for (const id of unlocked) {
    const n = board.byId.get(id);
    if (n && Math.abs(n.x) + Math.abs(n.y) === 1) {
      kept.add(id);
      queue.push(n);
    }
  }
  while (queue.length) {
    const n = queue.shift();
    for (const [dx, dy] of NEIGHBORS) {
      const nb = board.byPos.get(posKey(n.x + dx, n.y + dy));
      if (!nb || nb.area !== n.area || kept.has(nb.id) || !unlocked.has(nb.id)) continue;
      kept.add(nb.id);
      queue.push(nb);
    }
  }
  return kept;
}

/** Click handler logic: returns a NEW Set. Unlocked node -> lock it (and
 *  anything cut off). Locked node -> unlock it, plus the shortest path to it
 *  if it isn't reachable yet. */
export function toggleNode(board, unlockedIds, nodeId) {
  const unlocked = new Set(unlockedIds || []);
  const node = board.byId.get(nodeId);
  if (!node) return unlocked;
  if (unlocked.has(nodeId)) {
    unlocked.delete(nodeId);
    return pruneUnlocked(board, unlocked);
  }
  if (canUnlockNode(board, unlocked, node)) {
    unlocked.add(nodeId);
    return unlocked;
  }
  const path = findPath(board, nodeId);
  if (path) for (const id of path) unlocked.add(id);
  return unlocked;
}

/** Unlock / clear a whole area. Returns a NEW Set. */
export function setArea(board, unlockedIds, area, on) {
  const unlocked = new Set(unlockedIds || []);
  for (const n of board.nodes) {
    if (n.area !== area) continue;
    if (on) unlocked.add(n.id);
    else unlocked.delete(n.id);
  }
  return unlocked;
}

/** Board presets (data/board_presets.json): adds a preset's nodes to the
 *  board - existing unlocks are kept, so presets stack. Presets are stored as
 *  node ids, which sit at mirrored positions on flipped layouts, so one list
 *  works for every holomem. Anything the preset can't connect to the center
 *  is dropped. Returns a NEW Set. */
export function applyPreset(board, unlockedIds, presetNodeIds) {
  const unlocked = new Set(unlockedIds || []);
  for (const id of presetNodeIds || []) if (board.byId.has(id)) unlocked.add(id);
  return pruneUnlocked(board, unlocked);
}

/** Nodes (not connectors) a preset would newly unlock, and their cost. */
export function presetDelta(board, unlockedIds, presetNodeIds) {
  const unlocked = unlockedIds instanceof Set ? unlockedIds : new Set(unlockedIds || []);
  const after = applyPreset(board, unlocked, presetNodeIds);
  const added = [...after].filter((id) => !unlocked.has(id)).map((id) => board.byId.get(id)).filter((n) => n.kind === 'node');
  return { added, ...sumCost(added) };
}

/** Normalises a stored/imported account object; drops ids that aren't real
 *  nodes of that holomem's layout. */
export function normalizeAccount(raw, boardMaterials) {
  const account = { version: 1, boards: {}, held: {}, updatedAt: null };
  if (!raw || typeof raw !== 'object') return account;
  for (const [characterId, ids] of Object.entries(raw.boards || {})) {
    const board = getCharacterBoard(boardMaterials, characterId);
    if (!board || !Array.isArray(ids)) continue;
    const kept = pruneUnlocked(board, new Set(ids.filter((id) => board.byId.has(id))));
    if (kept.size) account.boards[characterId] = [...kept].sort();
  }
  for (const [itemId, qty] of Object.entries(raw.held || {})) {
    const n = Math.max(0, Math.floor(Number(qty)));
    if (boardMaterials.materials[itemId] && Number.isFinite(n)) account.held[itemId] = n;
  }
  account.updatedAt = raw.updatedAt || null;
  return account;
}
