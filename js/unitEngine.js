// unitEngine.js
// Aggregates a full unit (leader + 5 members) into a result set:
//  - real, validated stats and skill effects (primary output)
//  - a faithfully-ported "Overall Power" estimate from the original sheet,
//    magic constants and all, clearly labeled as an approximation
//
// See statEngine.js / skillEngine.js for the underlying validated pieces.

import { resolveMemberStats, getStatRoles } from './statEngine.js';
import { evaluateLeaderCondition, resolveEffectRecipients } from './skillEngine.js';
import { getSkillLevel, SKILL_LEVEL_TYPES } from './statEngine.js';

/**
 * @typedef {object} UnitInput
 * @property {object} leaderCard - member record used as leader
 * @property {number} leaderLevel
 * @property {number} leaderBloom
 * @property {{card:object, level:number, bloom:number}[]} unit - exactly 5 entries
 */

/**
 * Compute the real (validated) stats + skill picture for a unit.
 */
export function computeUnit(input, data) {
  const { members: cardPotentials, characterGroupings } = data;
  const { leaderCard, leaderLevel, leaderBloom, unit } = input;

  if (unit.length !== 5) throw new Error('Unit must have exactly 5 members');

  // --- 1. Real per-member stats (no leader buff mixed in) ---
  const memberStats = unit.map(({ card, level, bloom }) => ({
    cardId: card.cardId,
    name: card.characterName,
    level,
    bloom,
    stats: resolveMemberStats(card, level, bloom, cardPotentials),
    roles: getStatRoles(card),
  }));

  const statTotals = memberStats.reduce(
    (acc, m) => ({
      performance: acc.performance + m.stats.performance,
      technique: acc.technique + m.stats.technique,
      sense: acc.sense + m.stats.sense,
    }),
    { performance: 0, technique: 0, sense: 0 }
  );

  const unitCards = unit.map((u) => u.card);

  // --- 2. Leader skill ---
  let leaderResult = null;
  if (leaderCard.leaderSkill) {
    const conditionMet = evaluateLeaderCondition(
      leaderCard.leaderSkill.condition,
      leaderCard,
      unitCards,
      characterGroupings
    );
    leaderResult = {
      condition: leaderCard.leaderSkill.condition,
      conditionMet, // true / false / 'situational' (combo/life-based, can't pre-evaluate)
      effects: conditionMet === false ? [] : leaderCard.leaderSkill.effects,
    };
  }

  // --- 3. Passive skills (per member) - two independent gates: (a) an
  // optional census-style condition on the SKILL ITSELF (e.g. "2+ Happy cards
  // in the unit"), same mechanic as Leader Skill conditions; (b) target
  // resolution (who actually receives the effect once active). A passive with
  // no condition is unconditionally active and may target itself.
  const passiveResults = unit.map(({ card, bloom }) => {
    const passiveLevel = getSkillLevel(card, bloom, cardPotentials, SKILL_LEVEL_TYPES.PASSIVE);
    const levelData = card.passiveSkill?.[String(passiveLevel)];
    if (!levelData) return { cardId: card.cardId, level: passiveLevel, effects: [] };
    const conditionMet = evaluateLeaderCondition(levelData.condition, leaderCard, unitCards, characterGroupings);
    const resolved = levelData.effects.map((effect) => {
      const recipients = conditionMet ? resolveEffectRecipients(effect.target, card, unitCards, characterGroupings) : [];
      return {
        type: effect.type,
        valuePermil: Number(effect.value),
        recipients: recipients.map((c) => c.cardId),
        applies: recipients.length > 0,
        conditionMet,
      };
    });
    return { cardId: card.cardId, level: passiveLevel, condition: levelData.condition, conditionMet, effects: resolved };
  });

  // --- 4. Active skills (exact values, no High/Medium/Low bucketing) ---
  const activeResults = unit.map(({ card, bloom }) => {
    const activeLevel = getSkillLevel(card, bloom, cardPotentials, SKILL_LEVEL_TYPES.ACTIVE);
    const levelData = card.activeSkill?.[String(activeLevel)];
    if (!levelData) return { cardId: card.cardId, level: activeLevel };

    // Some active skills replace their base effect with a stronger one under a
    // condition (e.g. "Score UP 45%, or 90% with 40+ combo"). Static team-
    // composition conditions (attribute/grouping) are evaluated for real;
    // dynamic in-song state (combo/life/judgement/song) can't be pre-evaluated,
    // so - per instruction - the enhanced value is assumed for simulation
    // purposes, flagged as 'assumed' rather than silently treated as certain.
    let conditionMet = null;
    let effectiveEffects = levelData.effects;
    if (levelData.enhancedCondition) {
      const evalResult = evaluateLeaderCondition(levelData.enhancedCondition, leaderCard, unitCards, characterGroupings);
      conditionMet = evalResult === 'situational' ? 'assumed' : evalResult;
      effectiveEffects = conditionMet === true || conditionMet === 'assumed' ? levelData.enhancedEffects : levelData.effects;
    }

    return {
      cardId: card.cardId,
      level: activeLevel,
      activationProbabilityPercent: levelData.activationProbabilityPermil / 10,
      coolTimeSeconds: levelData.coolTimeMs / 1000,
      effectDurationSeconds: levelData.effectDurationMs / 1000,
      enhancedCondition: levelData.enhancedCondition,
      enhancedConditionMet: conditionMet,
      baseEffects: levelData.effects.map((e) => ({ type: e.type, valuePercent: Number(e.value) / 10 })),
      enhancedEffects: levelData.enhancedEffects?.map((e) => ({ type: e.type, valuePercent: Number(e.value) / 10 })) ?? [],
      effects: effectiveEffects.map((e) => ({
        type: e.type,
        valuePercent: Number(e.value) / 10,
      })),
    };
  });

  // --- 5. Special skills (exact values incl. the additionalEffects fix) ---
  const specialResults = unit.map(({ card, bloom }) => {
    const specialLevel = getSkillLevel(card, bloom, cardPotentials, SKILL_LEVEL_TYPES.SPECIAL);
    const levelData = card.specialSkill?.[String(specialLevel)];
    if (!levelData) return { cardId: card.cardId, level: specialLevel };
    return {
      cardId: card.cardId,
      level: specialLevel,
      effectDurationSeconds: levelData.effectDurationMs / 1000,
      supportBonusPercent: levelData.effects[0] ? Number(levelData.effects[0].value) / 10 : null,
      activationRateUpPercent: levelData.additionalEffects?.[0]
        ? Number(levelData.additionalEffects[0].value) / 10
        : null,
    };
  });

  return {
    memberStats,
    statTotals,
    leader: leaderResult,
    passives: passiveResults,
    actives: activeResults,
    specials: specialResults,
  };
}

/**
 * Assign each unit member's Special Skill to a fever timestamp, in performance-order
 * (matching the sheet's "Special Skill 1..5" columns mapped 1:1 to a song's fever points).
 * @param {object[]} specialResults - output of computeUnit(...).specials, in unit order
 * @param {number[]} feverSeconds - the song's fever activation timestamps (seconds), in order
 */
export function mapSpecialSkillsToSong(specialResults, feverSeconds) {
  return specialResults.map((special, i) => ({
    ...special,
    activationTimeSeconds: feverSeconds[i] ?? null,
  }));
}

// ---------------------------------------------------------------------------
// "Overall Power" ESTIMATE — faithful port of the original sheet's formula,
// including its unexplained magic constants (5319, 2137, 5139). This is NOT
// derived from datamined truth; it's the original author's regression fit
// against observed in-game power values. Keep clearly labeled as an estimate
// anywhere it's shown in the UI.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// HOLOMEM BOARD — Phase 1 (performance-relevant effects only: stat ups,
// active skill activation/cooldown, and Score Support). Board data is
// pre-grouped into categories (see board_categories.json), each a list of
// nodes sorted cheapest-first (ties broken by higher value = optimal path).
// A "count" per category means "the N cheapest/best nodes in that category
// are unlocked" — not individual node-by-node selection.
//
// NOT YET COVERED (flagged, not guessed at): Connect Effect area multipliers,
// generation-conditional nodes, leader active-skill-addition/level-up nodes,
// Life Up, and song/singer-specific score bonuses.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// HOLOMEM BOARD — Phase 1 covers the two node areas that matter for live
// performance and are unambiguous to model from the datamine:
//   - RED "Leader" area  (nodeType LEADER) - always targets the whole unit,
//     regardless of whether this character is actually leading
//   - BLUE "Member" area (nodeType CARD)   - always targets this character
//     alone, only relevant if she's placed in the performing unit
// GREEN "All Member" (nodeType ALL_MEMBER, generation-conditional) and
// YELLOW "Content" (nodeType CONTENT, song/reward-specific) areas are
// deliberately excluded for now - manual entry recommended for those.
// Category keys are "leader|EFFECT_TYPE" or "member|EFFECT_TYPE"; each a list
// of nodes sorted cheapest-first (ties broken by higher value).
// ---------------------------------------------------------------------------

/**
 * HOLOMEM BOARD - node unlocking follows the physical path: a node can only
 * be unlocked if it's directly adjacent (one grid step, no diagonals) to the
 * center or to another already-unlocked node, forming an unbroken chain back
 * to (0,0). This includes CONNECTION-type junction nodes (no stat effect of
 * their own, but real point cost) which bridge gaps between effect nodes -
 * e.g. the connect-effect anchor points themselves sit on the path this way.
 * Unlocked state is tracked as a single set of "x,y" position keys per
 * character (leader + member + connectors share one walkable graph, joined
 * at the center).
 */

/** Builds a position ("x,y") -> node-info lookup for a character's full board
 *  (effect nodes from both areas, plus structural connector nodes). */
export function buildBoardIndex(charData) {
  const index = new Map();
  for (const [key, nodes] of Object.entries(charData.categories)) {
    const [area, type] = key.split('|');
    nodes.forEach((n, i) => {
      const x = n.x || 0;
      const y = n.y || 0;
      index.set(`${x},${y}`, { kind: 'effect', key, area, type, index: i, cost: n.cost, value: n.value, grade: n.grade, requiresSinger: !!n.requiresSinger });
    });
  }
  for (const c of charData.connectors || []) {
    const posKey = `${c.x},${c.y}`;
    if (!index.has(posKey)) {
      index.set(posKey, { kind: 'connector', cost: c.cost });
    }
  }
  return index;
}

const NEIGHBOR_OFFSETS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** Whether the node at (x,y) can be unlocked given the current unlocked set
 *  (must be adjacent to the center or to an already-unlocked neighbor). */
export function canUnlock(unlockedSet, x, y) {
  for (const [dx, dy] of NEIGHBOR_OFFSETS) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx === 0 && ny === 0) return true; // adjacent to center - always unlockable
    if (unlockedSet.has(`${nx},${ny}`)) return true;
  }
  return false;
}

/** Finds the shortest chain of nodes (by posKey, "x,y") from the center out
 *  to the node at (x,y), walking only through positions that actually exist
 *  in `boardIndex` (real board nodes/connectors). Returns an array of posKeys
 *  in order from nearest-the-center to the target (target included, center
 *  excluded) - i.e. exactly the set of nodes that need to become unlocked for
 *  the target to be reachable, on top of whatever's already unlocked. Returns
 *  null if (x,y) isn't a valid node or there's no path back to the center. */
export function findUnlockPath(boardIndex, x, y) {
  const targetKey = `${x},${y}`;
  if (targetKey === '0,0') return [];
  if (!boardIndex.has(targetKey)) return null;

  const visited = new Set(['0,0']);
  const parent = new Map();
  const queue = ['0,0'];
  while (queue.length) {
    const cur = queue.shift();
    if (cur === targetKey) break;
    const [cx, cy] = cur.split(',').map(Number);
    for (const [dx, dy] of NEIGHBOR_OFFSETS) {
      const nKey = `${cx + dx},${cy + dy}`;
      if (visited.has(nKey)) continue;
      if (!boardIndex.has(nKey)) continue; // only real nodes carry the path (center already visited)
      visited.add(nKey);
      parent.set(nKey, cur);
      queue.push(nKey);
    }
  }
  if (!visited.has(targetKey)) return null;

  const path = [];
  let cur = targetKey;
  while (cur !== '0,0') {
    path.push(cur);
    cur = parent.get(cur);
  }
  path.reverse();
  return path;
}

/** Re-computes which nodes in `unlockedSet` are still reachable from the
 *  center via other unlocked nodes, and returns a trimmed set with any now-
 *  disconnected nodes removed (cascading lock after removing a node). */
export function pruneDisconnected(unlockedSet) {
  const reachable = new Set();
  const queue = ['0,0'];
  while (queue.length) {
    const posKey = queue.shift();
    if (reachable.has(posKey)) continue;
    reachable.add(posKey);
    const [x, y] = posKey.split(',').map(Number);
    for (const [dx, dy] of NEIGHBOR_OFFSETS) {
      const nKey = `${x + dx},${y + dy}`;
      if (unlockedSet.has(nKey) && !reachable.has(nKey)) queue.push(nKey);
    }
  }
  reachable.delete('0,0');
  return new Set([...unlockedSet].filter((p) => reachable.has(p)));
}

/** Total points spent across a character's unlocked set (effect nodes + connectors). */
export function boardPointsSpentFromSet(boardIndex, unlockedSet) {
  let total = 0;
  for (const posKey of unlockedSet) {
    const node = boardIndex.get(posKey);
    if (node) total += node.cost;
  }
  return total;
}

/** Merges a list of [start,end) windows into their non-overlapping union,
 *  sorted by start. Shared helper for coverage measurement below. */
function mergeWindows(windows) {
  const sorted = windows.slice().sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [s, e] of sorted) {
    if (e <= s) continue;
    if (merged.length && s <= merged[merged.length - 1][1]) {
      merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], e);
    } else {
      merged.push([s, e]);
    }
  }
  return merged;
}

/** How much of the union of `targetWindows` is covered by `windows`. Used to
 *  score fever-window coverage separately from overall coverage. */
function coverageWithinTargets(windows, targetWindows) {
  if (!targetWindows.length) return 0;
  const merged = mergeWindows(windows);
  let covered = 0;
  for (const [ts, te] of targetWindows) {
    let cur = ts;
    for (const [s, e] of merged) {
      const os = Math.max(s, cur);
      const oe = Math.min(e, te);
      if (oe > os) {
        covered += oe - os;
        cur = Math.max(cur, oe);
      }
      if (cur >= te) break;
    }
  }
  return covered;
}

/** Merges a list of [start,end) windows (seconds) and measures how much of
 *  [lo,hi) they cover, returning both the covered total and the list of
 *  remaining gaps. Shared helper for the frequency-node optimizer below. */
function measureCoverage(windows, lo, hi) {
  const sorted = windows.slice().sort((a, b) => a[0] - b[0]);
  let cur = lo;
  let covered = 0;
  const gaps = [];
  for (const [s, e] of sorted) {
    const start = Math.max(s, lo);
    if (start > cur) {
      gaps.push([cur, start]);
      cur = start;
    }
    if (e > cur) {
      covered += e - cur;
      cur = e;
    }
  }
  if (cur < hi) gaps.push([cur, hi]);
  return { coveredSeconds: covered, gaps };
}

/**
 * Brute-forces all 4^5 = 1024 possible "Activation Frequency UP" node-tier
 * assignments (0-3 of the 3 shared blue Member-area nodes per character,
 * each +4% permil) for a 5-member unit against a given song length, and
 * returns whichever assignment maximizes active-skill coverage - ties broken
 * by fewest total nodes spent.
 *
 * If `feverWindows` is given (a list of [start,end) second ranges - e.g. this
 * song's 5 fever/Special-Skill windows), coverage is scored LEXICOGRAPHICALLY:
 * fever-window coverage is maximized first, and only among tier assignments
 * that tie on that is overall song coverage then maximized, with fewest
 * nodes as the final tiebreak. Pass an empty array (or omit) to just optimize
 * total coverage with no fever priority.
 *
 * Uses the SAME formula as applyBoardBonuses (division, not a flat cooldown
 * cut): newCooldown = baseCooldown / (1 + tier * 0.04), since "Activation
 * Frequency UP X%" boosts 1/cooldown, not cooldown itself.
 *
 * @param {{coolTimeSeconds:number, effectDurationSeconds:number}[]} activeSkills
 *        - base (pre-board-bonus) cooldown/duration for each of the 5 members,
 *          at their current Bloom-resolved skill level.
 * @param {number} songDurationSeconds
 * @param {number[][]} [feverWindows] - optional [start,end) ranges to prioritize
 * @returns {{tiers:number[], nodesUsed:number, coveredSeconds:number,
 *            totalSeconds:number, coveragePercent:number, gaps:number[][],
 *            isFullCoverage:boolean, feverTotalSeconds:number,
 *            feverCoveredSeconds:number, feverCoveragePercent:number|null,
 *            isFullFeverCoverage:boolean|null}|null}
 */
export function findOptimalFrequencyNodes(activeSkills, songDurationSeconds, feverWindows) {
  if (!Array.isArray(activeSkills) || activeSkills.length !== 5) return null;
  if (!songDurationSeconds || songDurationSeconds <= 0) return null;
  const EPS = 1e-6;

  const mergedFeverWindows = mergeWindows(
    (feverWindows || []).map(([s, e]) => [Math.max(0, s), Math.min(songDurationSeconds, e)]).filter(([s, e]) => e > s)
  );
  const feverTotal = mergedFeverWindows.reduce((sum, [s, e]) => sum + (e - s), 0);

  let best = null;
  const TIERS = [0, 1, 2, 3];
  for (const t0 of TIERS)
    for (const t1 of TIERS)
      for (const t2 of TIERS)
        for (const t3 of TIERS)
          for (const t4 of TIERS) {
            const tiers = [t0, t1, t2, t3, t4];
            const windows = [];
            for (let i = 0; i < 5; i++) {
              const skill = activeSkills[i];
              if (!skill || skill.coolTimeSeconds == null || skill.effectDurationSeconds == null) continue;
              const effCool = skill.coolTimeSeconds / (1 + tiers[i] * 0.04);
              if (effCool <= 0) continue;
              let t = effCool;
              while (t < songDurationSeconds - EPS) {
                const end = Math.min(t + skill.effectDurationSeconds, songDurationSeconds);
                windows.push([t, end]);
                t += effCool;
              }
            }
            const { coveredSeconds, gaps } = measureCoverage(windows, 0, songDurationSeconds);
            const coveredFever = feverTotal > 0 ? coverageWithinTargets(windows, mergedFeverWindows) : 0;
            const nodesUsed = tiers.reduce((a, b) => a + b, 0);

            const better =
              !best ||
              coveredFever > best.coveredFever + EPS ||
              (Math.abs(coveredFever - best.coveredFever) <= EPS && coveredSeconds > best.coveredSeconds + EPS) ||
              (Math.abs(coveredFever - best.coveredFever) <= EPS &&
                Math.abs(coveredSeconds - best.coveredSeconds) <= EPS &&
                nodesUsed < best.nodesUsed);

            if (better) {
              best = { tiers, coveredSeconds, coveredFever, gaps, nodesUsed };
            }
          }

  return {
    tiers: best.tiers,
    nodesUsed: best.nodesUsed,
    coveredSeconds: best.coveredSeconds,
    totalSeconds: songDurationSeconds,
    coveragePercent: (best.coveredSeconds / songDurationSeconds) * 100,
    gaps: best.gaps,
    isFullCoverage: best.coveredSeconds >= songDurationSeconds - EPS,
    feverTotalSeconds: feverTotal,
    feverCoveredSeconds: best.coveredFever,
    feverCoveragePercent: feverTotal > 0 ? (best.coveredFever / feverTotal) * 100 : null,
    isFullFeverCoverage: feverTotal > 0 ? best.coveredFever >= feverTotal - EPS : null,
  };
}

/** All k-element subsets of `arr`, for small arrays (k, arr.length <= ~4 in
 *  practice here - at most 3 frequency nodes exist per board). */
function combinations(arr, k) {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [first, ...rest] = arr;
  const withFirst = combinations(rest, k - 1).map((c) => [first, ...c]);
  const withoutFirst = combinations(rest, k);
  return [...withFirst, ...withoutFirst];
}

/**
 * Finds the cheapest (fewest board points) way to reach exactly
 * `targetCount` of a character's 3 shared "Activation Frequency UP" (blue
 * Member-area) nodes unlocked - unlocking more if under target, or LOCKING
 * some back down if over target, reusing findUnlockPath / pruneDisconnected
 * so the result matches exactly what a manual click on the board would do
 * (including any connector nodes pulled in en route when unlocking, or
 * freed up when a lock cascades to now-disconnected nodes).
 *
 * Unlocking: greedy - at each step adds whichever still-needed frequency
 * node has the cheapest incremental path given what's already
 * (hypothetically) unlocked so far. Not a guaranteed global optimum if two
 * of the three nodes shared part of their path, but the 3 frequency nodes
 * sit on separate branches on every character's board, so greedy is exact
 * in practice.
 *
 * Locking: with at most 3 frequency nodes there are at most 3 choices of
 * which one(s) to lock, so this brute-forces every combination and picks
 * whichever locks free the most total board points after cascading
 * pruneDisconnected - not just count-optimal but point-optimal too.
 *
 * @param {Map<string,object>} boardIndex - from buildBoardIndex()
 * @param {Set<string>} currentUnlockedSet - this character's current unlocks
 * @param {number} targetCount - 0-3, how many frequency nodes should end up unlocked
 * @returns {{targetCount:number, currentCount:number, nodesToUnlock:string[],
 *            nodesToLock:string[], additionalPointCost:number,
 *            pointsRefunded:number, alreadySufficient:boolean}}
 */
export function planFrequencyNodeUnlock(boardIndex, currentUnlockedSet, targetCount) {
  const freqNodePositions = [];
  for (const [posKey, node] of boardIndex.entries()) {
    if (node.kind === 'effect' && node.area === 'member' && node.type === 'LIVE_ACTIVE_SKILL_COOL_TIME_SHORTEN_PERMIL_UP') {
      freqNodePositions.push(posKey);
    }
  }

  const alreadyUnlocked = freqNodePositions.filter((p) => currentUnlockedSet.has(p));
  const target = Math.max(0, Math.min(targetCount, freqNodePositions.length));
  const diff = target - alreadyUnlocked.length;

  if (diff === 0) {
    return {
      targetCount: target,
      currentCount: alreadyUnlocked.length,
      nodesToUnlock: [],
      nodesToLock: [],
      additionalPointCost: 0,
      pointsRefunded: 0,
      alreadySufficient: true,
    };
  }

  if (diff < 0) {
    // Need to lock (-diff) of the currently-unlocked frequency nodes. Try
    // every combination (cheap - at most 3 choose up to 3) and keep the
    // one whose cascade frees the most points.
    const numToLock = -diff;
    let best = null;
    for (const combo of combinations(alreadyUnlocked, numToLock)) {
      const working = new Set(currentUnlockedSet);
      for (const p of combo) working.delete(p);
      const pruned = pruneDisconnected(working);
      const removedPositions = [...currentUnlockedSet].filter((p) => !pruned.has(p));
      const pointsFreed = removedPositions.reduce((sum, p) => sum + (boardIndex.get(p)?.cost || 0), 0);
      if (!best || pointsFreed > best.pointsFreed) {
        best = { removedPositions, pointsFreed };
      }
    }
    return {
      targetCount: target,
      currentCount: alreadyUnlocked.length,
      nodesToUnlock: [],
      nodesToLock: best.removedPositions,
      additionalPointCost: 0,
      pointsRefunded: best.pointsFreed,
      alreadySufficient: false,
    };
  }

  const stillNeeded = diff;
  const working = new Set(currentUnlockedSet);
  const allNewPositions = [];
  let totalCost = 0;

  for (let i = 0; i < stillNeeded; i++) {
    let bestCand = null;
    let bestPath = null;
    let bestCost = Infinity;
    for (const cand of freqNodePositions) {
      if (working.has(cand)) continue;
      const [x, y] = cand.split(',').map(Number);
      const path = findUnlockPath(boardIndex, x, y);
      if (!path) continue;
      const newSteps = path.filter((p) => !working.has(p));
      const cost = newSteps.reduce((sum, p) => sum + (boardIndex.get(p)?.cost || 0), 0);
      if (cost < bestCost) {
        bestCost = cost;
        bestCand = cand;
        bestPath = newSteps;
      }
    }
    if (bestCand == null) break; // shouldn't happen on real board data
    for (const p of bestPath) working.add(p);
    allNewPositions.push(...bestPath);
    totalCost += bestCost;
  }

  return {
    targetCount: target,
    currentCount: alreadyUnlocked.length,
    nodesToUnlock: allNewPositions,
    nodesToLock: [],
    additionalPointCost: totalCost,
    pointsRefunded: 0,
    alreadySufficient: false,
  };
}

/**
 * @param {Record<string, Set<string>>} unlockedPositions - characterId -> Set of "x,y" unlocked position keys
 * @param {Record<string, object>} boardCategoriesData - board_categories.json
 * @param {{characterId:string, cardId:string, isLeaderSlot:boolean, isUnitMember:boolean}[]} slots
 *        - isLeaderSlot: true only for the slot actually chosen as leader this run.
 *          Leader-area (red) bonuses ONLY apply from this slot's selections.
 *        - isUnitMember: true for the 5 performing slots. Member-area (blue) bonuses
 *          only apply from a slot with this set (and only benefit that slot's own card).
 * @param {string[]} [songSingerCharacterIds] - characterIds credited as singers on the
 *        currently selected song. A handful of Leader nodes ("when included as a
 *        singer, grants...") only apply if the leader's own characterId is in this
 *        list - real datamined mechanic, not every Leader node has it. Points spent
 *        still count toward the node regardless; only the stat effect is gated.
 */
export function computeBoardBonuses(unlockedPositions, boardCategoriesData, slots, songSingerCharacterIds) {
  const unitCardIds = slots.filter((s) => s.isUnitMember).map((s) => s.cardId);
  const singerIds = songSingerCharacterIds || [];

  const statFlat = {};
  const statPermil = {};
  const activationProbabilityPermil = {};
  const cooldownShortenPermil = {};
  const scoreSupportPermil = {};
  const pointsSpent = {};

  const ensureStat = (map, cardId) => {
    if (!map[cardId]) map[cardId] = { performance: 0, technique: 0, sense: 0 };
    return map[cardId];
  };

  for (const slot of slots) {
    const unlockedSet = unlockedPositions[slot.characterId];
    const charData = boardCategoriesData[slot.characterId];
    if (!unlockedSet || !charData) continue;

    const boardIndex = buildBoardIndex(charData);
    pointsSpent[slot.characterId] = (pointsSpent[slot.characterId] || 0) + boardPointsSpentFromSet(boardIndex, unlockedSet);

    for (const posKey of unlockedSet) {
      const node = boardIndex.get(posKey);
      if (!node || node.kind !== 'effect') continue;

      if (node.area === 'leader' && !slot.isLeaderSlot) continue;
      if (node.area === 'member' && !slot.isUnitMember) continue;
      if (node.requiresSinger && !singerIds.includes(slot.characterId)) continue;

      const recipients = node.area === 'leader' ? unitCardIds : [slot.cardId];
      const sum = node.value;

      for (const cardId of recipients) {
        switch (node.type) {
          case 'ALL_PARAMETER_UP': {
            const st = ensureStat(statFlat, cardId);
            st.performance += sum;
            st.technique += sum;
            st.sense += sum;
            break;
          }
          case 'PERFORMANCE_UP':
            ensureStat(statFlat, cardId).performance += sum;
            break;
          case 'TECHNIQUE_UP':
            ensureStat(statFlat, cardId).technique += sum;
            break;
          case 'SENSE_UP':
            ensureStat(statFlat, cardId).sense += sum;
            break;
          case 'ALL_PARAMETER_UP_PERMIL_UP': {
            const st = ensureStat(statPermil, cardId);
            st.performance += sum;
            st.technique += sum;
            st.sense += sum;
            break;
          }
          case 'PERFORMANCE_UP_PERMIL_UP':
            ensureStat(statPermil, cardId).performance += sum;
            break;
          case 'TECHNIQUE_UP_PERMIL_UP':
            ensureStat(statPermil, cardId).technique += sum;
            break;
          case 'SENSE_UP_PERMIL_UP':
            ensureStat(statPermil, cardId).sense += sum;
            break;
          case 'LIVE_ACTIVE_SKILL_ACTIVATION_PROBABILITY_UP_PERMIL_UP':
            activationProbabilityPermil[cardId] = (activationProbabilityPermil[cardId] || 0) + sum;
            break;
          case 'LIVE_ACTIVE_SKILL_COOL_TIME_SHORTEN_PERMIL_UP':
            cooldownShortenPermil[cardId] = (cooldownShortenPermil[cardId] || 0) + sum;
            break;
          case 'LIVE_ACTIVE_SKILL_EFFECT_UP_PERMIL_UP':
            scoreSupportPermil[cardId] = (scoreSupportPermil[cardId] || 0) + sum;
            break;
        }
      }
    }
  }

  return { statFlat, statPermil, activationProbabilityPermil, cooldownShortenPermil, scoreSupportPermil, pointsSpent };
}

/** Merges two board-bonus-shaped objects (e.g. base board + connect bonuses) into one. */
export function mergeBoardBonuses(a, b) {
  const mergeStatMap = (m1, m2) => {
    const out = { ...m1 };
    for (const [cardId, stats] of Object.entries(m2)) {
      const existing = out[cardId] || { performance: 0, technique: 0, sense: 0 };
      out[cardId] = {
        performance: existing.performance + stats.performance,
        technique: existing.technique + stats.technique,
        sense: existing.sense + stats.sense,
      };
    }
    return out;
  };
  const mergeNumMap = (m1, m2) => {
    const out = { ...m1 };
    for (const [cardId, v] of Object.entries(m2)) out[cardId] = (out[cardId] || 0) + v;
    return out;
  };
  return {
    statFlat: mergeStatMap(a.statFlat, b.statFlat),
    statPermil: mergeStatMap(a.statPermil, b.statPermil),
    activationProbabilityPermil: mergeNumMap(a.activationProbabilityPermil, b.activationProbabilityPermil),
    cooldownShortenPermil: mergeNumMap(a.cooldownShortenPermil, b.cooldownShortenPermil),
    scoreSupportPermil: mergeNumMap(a.scoreSupportPermil, b.scoreSupportPermil),
    pointsSpent: { ...(a.pointsSpent || {}), ...(b.pointsSpent || {}) },
  };
}

/** Mutates a computeUnit() result in place, folding in board bonuses so every
 * existing panel (stats, actives, coverage, power) picks them up automatically.
 * Stat order of operations: card's own permil bonuses are already baked into
 * memberStats; board permil bonuses scale that same total again, then board
 * flat bonuses are added on top.
 */
export function applyBoardBonuses(result, boardBonuses) {
  for (const m of result.memberStats) {
    const permil = boardBonuses.statPermil[m.cardId];
    if (permil) {
      m.stats.performance = Math.round(m.stats.performance * (1 + permil.performance / 1000));
      m.stats.technique = Math.round(m.stats.technique * (1 + permil.technique / 1000));
      m.stats.sense = Math.round(m.stats.sense * (1 + permil.sense / 1000));
    }
    const flat = boardBonuses.statFlat[m.cardId];
    if (flat) {
      m.stats.performance += flat.performance;
      m.stats.technique += flat.technique;
      m.stats.sense += flat.sense;
    }
  }

  result.statTotals = result.memberStats.reduce(
    (acc, m) => ({
      performance: acc.performance + m.stats.performance,
      technique: acc.technique + m.stats.technique,
      sense: acc.sense + m.stats.sense,
    }),
    { performance: 0, technique: 0, sense: 0 }
  );

  result.actives.forEach((a, i) => {
    const cardId = result.memberStats[i].cardId;
    const actUp = boardBonuses.activationProbabilityPermil[cardId];
    if (actUp && a.activationProbabilityPercent != null) {
      a.activationProbabilityPercent += actUp / 10;
    }
    const freqUp = boardBonuses.cooldownShortenPermil[cardId];
    if (freqUp && a.coolTimeSeconds != null) {
      // The internal name is "cool time shorten" but the in-game description
      // text is "Activation Frequency UP X%" - it's a frequency increase, not
      // a direct time reduction. frequency = 1/cooldown, so:
      //   new_frequency = base_frequency * (1 + freqUp%)
      //   new_cooldown = 1 / new_frequency = base_cooldown / (1 + freqUp%)
      a.coolTimeSeconds = a.coolTimeSeconds / (1 + freqUp / 1000);
    }
  });

  return result;
}

/** Merges board-sourced Score Support (percent) into the passive-derived Score Support map. */
export function mergeScoreSupport(passiveScoreSupport, boardScoreSupportPermil) {
  const merged = { ...passiveScoreSupport };
  for (const [cardId, permil] of Object.entries(boardScoreSupportPermil)) {
    merged[cardId] = (merged[cardId] || 0) + permil / 10;
  }
  return merged;
}

// ---------------------------------------------------------------------------
// HOLOMEM BOARD - CONNECT EFFECTS ("manually bounded" approach)
// Each card that has a skillTreeConnectEffectId can be placed as a connector
// in one of 3 slots on another character's board (center/leader/member),
// determined by its own area type. The connector's bloom level decides which
// boost tier applies (bloom 5 -> level 2, matching the real
// SKILL_TREE_CONNECT_EFFECT_LEVEL_UP potential unlock; below that -> level 1).
// The connector's nodeCount is a budget: the user allocates that many
// "boosted node" slots across the RECEIVING character's own board categories
// (within the matching area), and the top N already-unlocked nodes (by value)
// in each chosen category receive the % boost. Node identity/position
// matching is not attempted - this is the "manually bounded" tier.
// ---------------------------------------------------------------------------

/**
 * @param {object} connectorCard - the connecting character's card (member record)
 * @param {number} connectorBloom
 * @param {Record<string, object>} cardConnectInfo - card_connect_info.json
 * @param {object} cardPotentials - card_potentials.json, needed to resolve the real
 *        bloom-5 threshold (rarity-dependent) for the level-1 vs level-2 boost tier
 */
export function getConnectorInfo(connectorCard, connectorBloom, cardConnectInfo, cardPotentials) {
  const info = cardConnectInfo[connectorCard.cardId];
  if (!info) return null;
  const level = getSkillLevel(connectorCard, connectorBloom, cardPotentials, SKILL_LEVEL_TYPES.TREE_CONNECT) === 2 ? 2 : 1;
  const boostPermil = level === 2 ? info.boostPermilLevel2 : info.boostPermilLevel1;
  return { area: info.area, nodeCount: info.nodeCount, level, boostPermil, pattern: info.pattern };
}

/**
 * @param {Record<string, {center?:object, leader?:object, member?:object}>} connectSelections
 *        - receivingCharacterId -> per-slot { connectorCardId, connectorBloom }
 * @param {Record<string, object>} boardCategoriesData - board_categories.json (now includes `anchors`
 *        per character: {center:{x,y}, leader:{x,y}, member:{x,y}} - real connect-point positions)
 * @param {Record<string, Set<string>>} boardSelections - characterId -> Set of "x,y" unlocked position keys
 * @param {Record<string, object>} cardConnectInfo - card_connect_info.json (now includes `pattern`:
 *        relative offsets from the connector's own anchor)
 * @param {Record<string, object>} cardsById - members.json indexed by cardId
 * @param {object} cardPotentials - card_potentials.json (for bloom-level resolution)
 * @param {{characterId:string, cardId:string, isLeaderSlot:boolean, isUnitMember:boolean}[]} slots
 */
export function computeConnectBonuses(
  connectSelections,
  boardCategoriesData,
  boardSelections,
  cardConnectInfo,
  cardsById,
  cardPotentials,
  slots
) {
  const statFlat = {};
  const statPermil = {};
  const activationProbabilityPermil = {};
  const cooldownShortenPermil = {};
  const scoreSupportPermil = {};

  const ensureStat = (map, cardId) => {
    if (!map[cardId]) map[cardId] = { performance: 0, technique: 0, sense: 0 };
    return map[cardId];
  };

  const applyValue = (cardId, type, value) => {
    switch (type) {
      case 'ALL_PARAMETER_UP': {
        const st = ensureStat(statFlat, cardId);
        st.performance += value;
        st.technique += value;
        st.sense += value;
        break;
      }
      case 'PERFORMANCE_UP':
        ensureStat(statFlat, cardId).performance += value;
        break;
      case 'TECHNIQUE_UP':
        ensureStat(statFlat, cardId).technique += value;
        break;
      case 'SENSE_UP':
        ensureStat(statFlat, cardId).sense += value;
        break;
      case 'ALL_PARAMETER_UP_PERMIL_UP': {
        const st = ensureStat(statPermil, cardId);
        st.performance += value;
        st.technique += value;
        st.sense += value;
        break;
      }
      case 'PERFORMANCE_UP_PERMIL_UP':
        ensureStat(statPermil, cardId).performance += value;
        break;
      case 'TECHNIQUE_UP_PERMIL_UP':
        ensureStat(statPermil, cardId).technique += value;
        break;
      case 'SENSE_UP_PERMIL_UP':
        ensureStat(statPermil, cardId).sense += value;
        break;
      case 'LIVE_ACTIVE_SKILL_ACTIVATION_PROBABILITY_UP_PERMIL_UP':
        activationProbabilityPermil[cardId] = (activationProbabilityPermil[cardId] || 0) + value;
        break;
      case 'LIVE_ACTIVE_SKILL_COOL_TIME_SHORTEN_PERMIL_UP':
        cooldownShortenPermil[cardId] = (cooldownShortenPermil[cardId] || 0) + value;
        break;
      case 'LIVE_ACTIVE_SKILL_EFFECT_UP_PERMIL_UP':
        scoreSupportPermil[cardId] = (scoreSupportPermil[cardId] || 0) + value;
        break;
    }
  };

  for (const slot of slots) {
    const config = connectSelections[slot.characterId];
    const charData = boardCategoriesData[slot.characterId];
    if (!config || !charData) continue;

    // Build a position -> node lookup once per receiving character (across
    // both leader and member areas - a pattern isn't restricted to "its own"
    // area, per the real game's behavior).
    const byPosition = new Map();
    for (const [key, nodes] of Object.entries(charData.categories)) {
      const [area, type] = key.split('|');
      nodes.forEach((n, index) => {
        const x = n.x || 0;
        const y = n.y || 0;
        byPosition.set(`${x},${y}`, { key, area, type, index, value: n.value });
      });
    }

    for (const [slotType, setup] of Object.entries(config)) {
      if (!setup?.connectorCardId) continue;
      if (slotType === 'leader' && !slot.isLeaderSlot) continue;
      if (slotType === 'member' && !slot.isUnitMember) continue;

      const connectorCard = cardsById[setup.connectorCardId];
      if (!connectorCard) continue;
      const connectorInfo = getConnectorInfo(connectorCard, setup.connectorBloom || 0, cardConnectInfo, cardPotentials);
      if (!connectorInfo?.boostPermil || !connectorInfo.pattern) continue;

      const anchor = charData.anchors?.[slotType];
      if (!anchor || anchor.x == null) continue; // e.g. no member path resolvable

      const unlockedSet = boardSelections[slot.characterId];
      const recipients = {
        leader: slots.filter((s) => s.isUnitMember).map((s) => s.cardId),
        member: [slot.cardId],
      };

      for (const offset of connectorInfo.pattern) {
        const px = anchor.x + (offset.x || 0);
        const py = anchor.y + (offset.y || 0);
        const posKey = `${px},${py}`;
        const node = byPosition.get(posKey);
        if (!node) continue; // pattern cell lands on empty space - no node there
        if (!unlockedSet?.has(posKey)) continue; // node exists but isn't unlocked - nothing to boost
        // A connector's pattern can extend beyond its own connect-slot's
        // "native" area (e.g. a Member-slot connector's pattern reaching a
        // Leader-area position). Leader-area nodes never contribute unless
        // this slot is actually the leader, regardless of which connect slot
        // the connector was assigned to - same rule as plain board nodes.
        if (node.area === 'leader' && !slot.isLeaderSlot) continue;
        if (!recipients[node.area]) continue; // e.g. content-area - not modeled/reachable, but guard anyway

        const extraValue = Math.ceil(node.value * (connectorInfo.boostPermil / 1000));
        for (const cardId of recipients[node.area]) {
          applyValue(cardId, node.type, extraValue);
        }
      }
    }
  }

  return { statFlat, statPermil, activationProbabilityPermil, cooldownShortenPermil, scoreSupportPermil };
}

const STAT_EFFECT_TYPES = {
  LivePassiveSkillEffectType_LIVE_PASSIVE_SKILL_EFFECT_TYPE_PERFORMANCE_UP_PERMIL_UP: 'performance',
  LivePassiveSkillEffectType_LIVE_PASSIVE_SKILL_EFFECT_TYPE_TECHNIQUE_UP_PERMIL_UP: 'technique',
  LivePassiveSkillEffectType_LIVE_PASSIVE_SKILL_EFFECT_TYPE_SENSE_UP_PERMIL_UP: 'sense',
};
const ALL_PARAMETER_TYPE =
  'LivePassiveSkillEffectType_LIVE_PASSIVE_SKILL_EFFECT_TYPE_ALL_PARAMETER_UP_PERMIL_UP';
export const SCORE_SUPPORT_TYPE =
  'LivePassiveSkillEffectType_LIVE_PASSIVE_SKILL_EFFECT_TYPE_LIVE_ACTIVE_SKILL_EFFECT_UP_PERMIL_UP';

/**
 * Real, recipient-driven Passive Skill contribution to the Overall Power estimate.
 * Mirrors the original sheet's fitted-formula shape (LARGE() of qualifying members'
 * stats, minus a flat per-member offset, times the effect %) but uses ACTUAL passive
 * targeting (resolveEffectRecipients) instead of manually-entered Type/Stat/Bonus
 * columns. Score-Support-type effects are excluded here — per the sheet's own model,
 * they don't contribute to Overall Power (see computeScoreSupport instead).
 *
 * Same caveat as estimateOverallPower: the per-member offsets (2137/5, 5139/5) are
 * the original author's fitted constants, not datamined truth.
 */
/**
 * Real (non-fitted) Overall Power breakdown, matching the in-game "Unit Score
 * Details" screen's left-hand side. Each bucket is computed independently
 * against the unbuffed base stat (never stacking on another bucket's output),
 * matching the game's simple additive total.
 *
 * @param {object} result - computeUnit() output, AFTER applyBoardBonuses (so
 *        result.memberStats holds the final board/connect-buffed values).
 * @param {{cardId:string, stats:{performance,technique,sense}}[]} baseStats
 *        - the pre-board snapshot (level + bloom only) for the same 5 unit
 *        members, in the same order as result.memberStats.
 */
export function computeOverallPowerBreakdown(result, baseStats) {
  const baseByCardId = Object.fromEntries(baseStats.map((m) => [m.cardId, m.stats]));

  // Member Parameter: base (level + bloom, no board) stats, summed.
  let memberParameter = 0;
  for (const m of baseStats) {
    memberParameter += m.stats.performance + m.stats.technique + m.stats.sense;
  }

  // Holomem Board Bonus: the delta board+connect bonuses added on top of base.
  let holomemBoardBonus = 0;
  for (const m of result.memberStats) {
    const base = baseByCardId[m.cardId];
    if (!base) continue;
    holomemBoardBonus += m.stats.performance + m.stats.technique + m.stats.sense;
    holomemBoardBonus -= base.performance + base.technique + base.sense;
  }

  // Outfit Skill: the leader's own leader-skill stat buff, applied to the
  // relevant BASE stat total across the unit (not the board-buffed total).
  let outfitSkill = 0;
  const leaderEffect = result.leader?.effects?.[0];
  if (leaderEffect && result.leader.conditionMet === true) {
    const permil = Number(leaderEffect.valuePermil ?? leaderEffect.value ?? 0);
    let relevantBase = 0;
    if (leaderEffect.type?.includes('ALL_PARAMETER')) {
      relevantBase = memberParameter;
    } else if (leaderEffect.type?.includes('PERFORMANCE')) {
      relevantBase = baseStats.reduce((s, m) => s + m.stats.performance, 0);
    } else if (leaderEffect.type?.includes('TECHNIQUE')) {
      relevantBase = baseStats.reduce((s, m) => s + m.stats.technique, 0);
    } else if (leaderEffect.type?.includes('SENSE')) {
      relevantBase = baseStats.reduce((s, m) => s + m.stats.sense, 0);
    }
    outfitSkill = Math.round(relevantBase * (permil / 1000));
  }

  // Passive Skill: only the stat-boosting passive effect types (ALL/PERF/
  // TECH/SENSE _UP_PERMIL_UP) - Score Support is a different mechanic and
  // belongs to the Score Bonus side, not Overall Power.
  const STAT_KEY_BY_TYPE = {
    LivePassiveSkillEffectType_LIVE_PASSIVE_SKILL_EFFECT_TYPE_PERFORMANCE_UP_PERMIL_UP: 'performance',
    LivePassiveSkillEffectType_LIVE_PASSIVE_SKILL_EFFECT_TYPE_TECHNIQUE_UP_PERMIL_UP: 'technique',
    LivePassiveSkillEffectType_LIVE_PASSIVE_SKILL_EFFECT_TYPE_SENSE_UP_PERMIL_UP: 'sense',
  };
  const ALL_PARAM_TYPE = 'LivePassiveSkillEffectType_LIVE_PASSIVE_SKILL_EFFECT_TYPE_ALL_PARAMETER_UP_PERMIL_UP';
  let passiveSkill = 0;
  for (const p of result.passives) {
    for (const effect of p.effects) {
      if (!effect.applies) continue;
      const statKey = STAT_KEY_BY_TYPE[effect.type];
      const isAllParam = effect.type === ALL_PARAM_TYPE;
      if (!statKey && !isAllParam) continue;
      for (const recipientId of effect.recipients) {
        const base = baseByCardId[recipientId];
        if (!base) continue;
        const relevantBase = isAllParam ? base.performance + base.technique + base.sense : base[statKey];
        passiveSkill += relevantBase * (effect.valuePermil / 1000);
      }
    }
  }
  passiveSkill = Math.round(passiveSkill);

  return { memberParameter, outfitSkill, holomemBoardBonus, passiveSkill };
}

export function estimatePassivePower(passiveResults, memberStats) {
  const statsByCardId = Object.fromEntries(memberStats.map((m) => [m.cardId, m.stats]));
  let total = 0;

  for (const p of passiveResults) {
    for (const effect of p.effects) {
      if (!effect.applies) continue;
      if (effect.type === SCORE_SUPPORT_TYPE) continue; // doesn't contribute to Power

      const statKey = STAT_EFFECT_TYPES[effect.type];
      const isAllParam = effect.type === ALL_PARAMETER_TYPE;
      if (!statKey && !isAllParam) continue;

      const perMemberOffset = isAllParam ? 5139 / 5 : 2137 / 5;
      for (const recipientId of effect.recipients) {
        const stats = statsByCardId[recipientId];
        if (!stats) continue;
        const rawValue = isAllParam ? stats.performance + stats.technique + stats.sense : stats[statKey];
        const contribution = (rawValue - perMemberOffset) * (effect.valuePermil / 1000);
        total += contribution;
      }
    }
  }
  return Math.round(total);
}

/**
 * Real Score Support: total % boost to Active Skill score-effect that each unit
 * member receives from teammates' (or their own SELF-target) Score-Support-type
 * passives. This is a genuine gameplay mechanic (amplifies active skill Score Up %
 * when it fires), not a Power-estimate component — matches the sheet's separate
 * "Score Support" table, but computed from real targeting instead of manual entry.
 *
 * NOTE: does not yet include the leader's board-specific "Score Support UP" stat
 * (sheet's D16) — that requires the Holomem Board "which nodes are unlocked" UI,
 * not yet built.
 * @returns {Record<string, number>} cardId -> total Score Support percent received
 */
export function computeScoreSupport(passiveResults) {
  const support = {};
  for (const p of passiveResults) {
    for (const effect of p.effects) {
      if (!effect.applies || effect.type !== SCORE_SUPPORT_TYPE) continue;
      for (const recipientId of effect.recipients) {
        support[recipientId] = (support[recipientId] || 0) + effect.valuePermil / 10;
      }
    }
  }
  return support;
}

/**
 * Second-by-second simulation of Active Skill coverage across a song, mirroring
 * the original sheet's model (rows 60-241): each member's active skill is assumed
 * to fire deterministically every `coolTimeSeconds`, staying active for
 * `effectDurationSeconds` each time (a best-case coverage envelope, not a dice-roll
 * simulation of the real activation %). Score Support and Special Skill overlap
 * combine MULTIPLICATIVELY with the base bonus, per the sheet's own formula:
 *   finalBonus = baseBonus * (1 + (scoreSupport + specialOverlapBonus) / 100)
 * This stacking behavior is the original author's assumption, not confirmed
 * against real game mechanics.
 *
 * @param {object[]} activeResults - unitEngine.computeUnit(...).actives, in unit order
 * @param {object[]} specialResults - unitEngine.computeUnit(...).specials, in unit order
 * @param {object[]} unitCards - the 5 unit member cards, same order as above
 * @param {Record<string,number>} scoreSupport - output of computeScoreSupport(...)
 * @param {number[]} feverSeconds - the song's 5 fever timestamps (special skill activation times)
 * @param {number} durationSeconds - song length
 * @returns {{t:number, perMember:{cardId:string,active:boolean,effectiveBonus:number,baseBonus:number,totalSupportBonus:number,activationChance:number|null,activationStart:number|null,unitIndex:number}[], maxBonus:number, winnerCardId:string|null, inSpecialWindow:boolean, noBonusDuringSpecial:boolean}[]}
 */
export function simulateActiveTimeline({
  activeResults,
  specialResults,
  unitCards,
  scoreSupport,
  feverSeconds,
  durationSeconds,
}) {
  const points = [];

  for (let t = 0; t <= Math.round(durationSeconds); t++) {
    // Which (if any) member's special skill window covers this second, and its
    // support-bonus contribution (first match wins, mirroring the sheet's IF-chain;
    // fever windows rarely overlap in practice).
    let specialBonus = 0;
    let inSpecialWindow = false;
    let specialWindowIndex = -1;
    for (let j = 0; j < specialResults.length; j++) {
      const start = feverSeconds[j];
      const dur = specialResults[j]?.effectDurationSeconds;
      if (start != null && dur != null && t >= start && t < start + dur) {
        specialBonus = specialResults[j].supportBonusPercent || 0;
        inSpecialWindow = true;
        specialWindowIndex = j;
        break;
      }
    }

    const perMember = activeResults.map((a, i) => {
      const cardId = unitCards[i].cardId;
      const cooldown = a.coolTimeSeconds;
      const dur = a.effectDurationSeconds;
      const scoreEffect = a.effects?.find((e) => e.type.endsWith('_TYPE_SCORE_UP_PERMIL_UP'));
      const baseBonus = scoreEffect ? scoreEffect.valuePercent : 0;
      const active = cooldown && dur ? t >= cooldown && t % cooldown < dur : false;
      const support = scoreSupport[cardId] || 0;
      const effectiveBonus = active ? baseBonus * (1 + (support + specialBonus) / 100) : 0;

      const specialActivationUp = inSpecialWindow
        ? specialResults[specialWindowIndex]?.activationRateUpPercent || 0
        : 0;
      const activationChance = active
        ? Math.round((a.activationProbabilityPercent || 0) * (1 + specialActivationUp / 100) * 100) / 100
        : null;

      // When this member's current activation window began (the start of this
      // specific cooldown cycle) - used to break ties: earlier activation wins.
      const activationStart = active ? t - (t % cooldown) : null;

      return {
        cardId,
        active,
        effectiveBonus,
        baseBonus,
        totalSupportBonus: support + specialBonus,
        activationChance,
        activationStart,
        unitIndex: i,
      };
    });

    const maxBonus = Math.max(0, ...perMember.map((m) => m.effectiveBonus));
    const winnerCardId = resolveWinner(perMember);
    points.push({
      t,
      perMember,
      maxBonus,
      winnerCardId,
      inSpecialWindow,
      noBonusDuringSpecial: inSpecialWindow && maxBonus === 0,
    });
  }

  return points;
}

/**
 * Resolves which member's active-skill bonus actually applies this second when
 * multiple are active at once: highest effective bonus wins; on a tie, whichever
 * activation started earlier wins; if both started in the same second, earlier
 * performance/unit order (leader-adjacent first) wins. Confirmed rule, not a guess.
 */
export function resolveWinner(perMember) {
  const candidates = perMember.filter((m) => m.active && m.effectiveBonus > 0);
  if (!candidates.length) return null;
  let winner = candidates[0];
  for (const m of candidates.slice(1)) {
    if (
      m.effectiveBonus > winner.effectiveBonus ||
      (m.effectiveBonus === winner.effectiveBonus && m.activationStart < winner.activationStart) ||
      (m.effectiveBonus === winner.effectiveBonus &&
        m.activationStart === winner.activationStart &&
        m.unitIndex < winner.unitIndex)
    ) {
      winner = m;
    }
  }
  return winner.cardId;
}

// ---------------------------------------------------------------------------
// Theoretical max score (all-PERFECT_PLUS) per-second calculation
// ---------------------------------------------------------------------------

/** PERFECT_PLUS scoreCoefficientPermilMultiply per note type, from LiveNote.json.
 *  Same value regardless of critical/non-critical - the game's note-scoring
 *  table has no separate critical dimension, only note type x judgement. */
export const NOTE_WEIGHTS_PERFECT_PLUS = {
  T: 1000, // tap
  F: 1050, // flick
  LS: 1000, // long start
  LE: 1000, // long end
  LFE: 1000, // long flick end
  LR: 100, // long relay
  LC: 100, // long hold/continuation
};

// LiveCombo.json's live_combo-1 curve (used by every song): +1% per 100 combo, capped at +10% from 1000+.
const COMBO_BONUS_BREAKPOINTS = [
  [1000, 0.1],
  [900, 0.09],
  [800, 0.08],
  [700, 0.07],
  [600, 0.06],
  [500, 0.05],
  [400, 0.04],
  [300, 0.03],
  [200, 0.02],
  [100, 0.01],
  [0, 0],
];
export function comboBonusAt(cumulativeCombo) {
  for (const [threshold, bonus] of COMBO_BONUS_BREAKPOINTS) {
    if (cumulativeCombo >= threshold) return bonus;
  }
  return 0;
}

// Fixed per product decision - the Content(Yellow)-area "song/singer-specific"
// board bonus is assumed maxed rather than computed from real node selections.
export const SKILL_TREE_BONUS = 0.1;

function strippedTypeCode(code) {
  return code.endsWith('!') ? code.slice(0, -1) : code;
}

/**
 * Theoretical-maximum (every note PERFECT_PLUS) per-second score:
 *   NoteScore = ceil(deckPower * 2.3 * musicCoefficient / totalChartWeight
 *                     * judgementCoefficient[type] * (1+comboBonus) * (1+skillBonus) * (1+skillTreeBonus))
 *   musicCoefficient = 1 + (liveScoreCoefficientPermil/1000) * (difficultyLevel - 5)
 * skillBonus is read straight from the coverage timeline's maxBonus (already
 * "strongest active skill wins", already includes score support multiplicatively).
 * comboBonus uses the cumulative note count at the START of each second for
 * every note in that second - an approximation on the rare second that
 * crosses a 100-combo threshold mid-second, exact otherwise (per-second data
 * doesn't preserve note-by-note order within a second).
 *
 * @param {object[]} timeline - simulateActiveTimeline() output (gives maxBonus per second)
 * @param {(number[]|undefined)[]} noteDensityEntries - per-second [count, {code:count}] from note_density/{musicId}.json, for the chosen difficulty
 * @param {number} deckPower - Overall Power total (memberParameter+outfitSkill+passiveSkill+holomemBoardBonus+memoryBonus+powerUpBonus)
 * @param {number} liveScoreCoefficientPermil - song's own coefficient (Music.json)
 * @param {number} difficultyLevel - numeric difficulty rating for the chosen difficulty
 * @returns {{perSecond:{t:number,score:number}[], totalChartWeight:number, musicCoefficient:number, grandTotal:number}}
 */
export function computeScoreTimeline(timeline, noteDensityEntries, deckPower, liveScoreCoefficientPermil, difficultyLevel) {
  const musicCoefficient = 1 + (liveScoreCoefficientPermil / 1000) * (difficultyLevel - 5);

  let totalChartWeight = 0;
  for (const entry of noteDensityEntries) {
    if (!entry || !entry[0] || !entry[1]) continue;
    for (const [code, count] of Object.entries(entry[1])) {
      totalChartWeight += (NOTE_WEIGHTS_PERFECT_PLUS[strippedTypeCode(code)] || 0) * count;
    }
  }

  const baseFactor = totalChartWeight > 0 ? (deckPower * 2.3 * musicCoefficient) / totalChartWeight : 0;

  let cumulativeCombo = 0;
  let grandTotal = 0;
  const perSecond = [];
  for (const point of timeline) {
    const entry = noteDensityEntries[point.t];
    const comboBonus = comboBonusAt(cumulativeCombo);
    const skillBonus = (point.maxBonus || 0) / 100;
    let secondScore = 0;
    if (entry && entry[0] > 0 && entry[1]) {
      for (const [code, count] of Object.entries(entry[1])) {
        const weight = NOTE_WEIGHTS_PERFECT_PLUS[strippedTypeCode(code)] || 0;
        const noteScore = Math.ceil(baseFactor * weight * (1 + comboBonus) * (1 + skillBonus) * (1 + SKILL_TREE_BONUS));
        secondScore += noteScore * count;
      }
      cumulativeCombo += entry[0];
    }
    grandTotal += secondScore;
    perSecond.push({ t: point.t, score: secondScore });
  }

  return { perSecond, totalChartWeight, musicCoefficient, grandTotal };
}

/**
 * @param {object} statTotals - {performance, technique, sense} summed across the unit
 * @param {{buffStat:string, buffScorePercent:number, conditionMet:boolean}} leaderBuff
 *        - buffStat: 'performance'|'technique'|'sense'|'all'
 * @param {number} manualBoardBonus - Holomem Board Bonus (still requires manual input;
 *        automating this from skilltree.json needs a "which nodes has the player
 *        unlocked" UI, not yet built)
 * @param {number} manualMemoryBonus
 * @param {number} manualPowerUpBonus
 */
export function estimateOverallPower({
  statTotals,
  leaderBuff,
  passivePowerEstimate = 0, // see NOTE below
  manualBoardBonus = 0,
  manualMemoryBonus = 0,
  manualPowerUpBonus = 0,
}) {
  const totalStat = statTotals.performance + statTotals.technique + statTotals.sense;

  // Member Parameter = N18 - 5319
  const memberParameter = totalStat - 5319;

  // Outfit Skill (leader buff contribution)
  let outfitSkill = 0;
  if (leaderBuff?.conditionMet) {
    if (leaderBuff.buffStat === 'all') {
      outfitSkill = Math.ceil((totalStat * leaderBuff.buffScorePercent) / 100);
    } else {
      const statSum = statTotals[leaderBuff.buffStat] ?? 0;
      outfitSkill = Math.ceil((statSum - 2137) * (leaderBuff.buffScorePercent / 100));
    }
  }

  // Passive Power: the original array formula (LARGE() over qualifying members,
  // minus 2137/5 per entry) is complex enough that porting it exactly requires
  // per-member "Passive Stat"/"Passive Type" classification identical to the
  // sheet's manual Member List columns. NOT yet ported — pass a precomputed
  // `passivePowerEstimate` if you want this included, otherwise it's 0.
  const passiveSkill = passivePowerEstimate;

  const total =
    memberParameter + outfitSkill + passiveSkill + manualBoardBonus + manualMemoryBonus + manualPowerUpBonus;

  return {
    memberParameter,
    outfitSkill,
    passiveSkill,
    boardBonus: manualBoardBonus,
    memoryBonus: manualMemoryBonus,
    powerUpBonus: manualPowerUpBonus,
    total,
    _isEstimate: true,
    _note:
      'Derived from the original spreadsheet\u2019s fitted formula (magic constants 5319/2137), not from datamined truth. Treat as approximate.',
  };
}
