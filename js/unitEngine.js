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
    // Main leader-skill effects are usually a stat buff, but 10 cards in the
    // datamine have Score Support as their ONLY (main) effect instead - no
    // stat buff at all. Resolved with target-based recipients the same way
    // passive effects are, so computeLeaderScoreSupport() below can pick up
    // score-support-type entries here regardless of whether they're the
    // main effect or the additional one (see below).
    const rawEffects = conditionMet === false ? [] : leaderCard.leaderSkill.effects || [];
    const effects = rawEffects.map((effect) => {
      const recipients = conditionMet ? resolveEffectRecipients(effect.target, leaderCard, unitCards, characterGroupings) : [];
      return {
        type: effect.type,
        valuePermil: Number(effect.value),
        recipients: recipients.map((c) => c.cardId),
        applies: recipients.length > 0,
      };
    });

    // Some leader skills carry a SECOND effect (seen so far: always a Score
    // Support boost) gated by its own additional condition - same pattern as
    // Active Skill's enhancedEffects and Special Skill's additionalEffects,
    // just not previously extracted for leader skills. In every case checked
    // in the datamine, the additional condition is identical to the main
    // one, but it's evaluated separately here rather than assumed, in case a
    // future card differs.
    let additionalConditionMet = null;
    let additionalEffects = [];
    if (leaderCard.leaderSkill.additionalCondition) {
      additionalConditionMet = evaluateLeaderCondition(
        leaderCard.leaderSkill.additionalCondition,
        leaderCard,
        unitCards,
        characterGroupings
      );
      const rawAdditionalEffects = additionalConditionMet === false ? [] : leaderCard.leaderSkill.additionalEffects || [];
      additionalEffects = rawAdditionalEffects.map((effect) => {
        const recipients = additionalConditionMet ? resolveEffectRecipients(effect.target, leaderCard, unitCards, characterGroupings) : [];
        return {
          type: effect.type,
          valuePermil: Number(effect.value),
          recipients: recipients.map((c) => c.cardId),
          applies: recipients.length > 0,
        };
      });
    }
    leaderResult = {
      condition: leaderCard.leaderSkill.condition,
      conditionMet, // true / false / 'situational' (combo/life-based, can't pre-evaluate)
      effects,
      additionalCondition: leaderCard.leaderSkill.additionalCondition ?? null,
      additionalConditionMet,
      additionalEffects,
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

/** Merges board-sourced (permil) and leader-sourced (percent, already
 *  resolved via computeLeaderScoreSupport) Score Support into the passive-
 *  derived Score Support map. leaderScoreSupportPercent is optional so
 *  existing callers that haven't been updated yet still work. */
export function mergeScoreSupport(passiveScoreSupport, boardScoreSupportPermil, leaderScoreSupportPercent) {
  const merged = { ...passiveScoreSupport };
  for (const [cardId, permil] of Object.entries(boardScoreSupportPermil)) {
    merged[cardId] = (merged[cardId] || 0) + permil / 10;
  }
  if (leaderScoreSupportPercent) {
    for (const [cardId, percent] of Object.entries(leaderScoreSupportPercent)) {
      merged[cardId] = (merged[cardId] || 0) + percent;
    }
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
 * @param {{cardId:string, stats:{performance,technique,sense}}[]} [memberOnlyBaseStats]
 *        - optional: a snapshot with ONLY member-area (blue) board nodes and
 *        the member-portion of connect patterns applied (no leader-area/red).
 *        When given, holomemBoardBonus splits into redBonus (leader-area
 *        nodes + leader-portion of connects - the delta between this and the
 *        fully-buffed result.memberStats) and blueBonus (member-area nodes +
 *        member-portion of connects - the delta between this and baseStats).
 *        Without it, holomemBoardBonus is still returned as their sum, but
 *        redBonus/blueBonus individually aren't meaningful (both 0/lumped).
 */
export function computeOverallPowerBreakdown(result, baseStats, memberOnlyBaseStats) {
  const baseByCardId = Object.fromEntries(baseStats.map((m) => [m.cardId, m.stats]));
  const memberOnlyByCardId = memberOnlyBaseStats ? Object.fromEntries(memberOnlyBaseStats.map((m) => [m.cardId, m.stats])) : null;

  // Per-member accumulators, keyed by cardId - needed so Member Power-Up
  // Bonus can be computed per member (per member parameter + outfit skill +
  // passive skill + red/blue board bonus, summed, times the power-up %) then
  // summed across the unit, rather than applying the % to one team-wide total.
  const perMember = {};
  const ensure = (cardId) => (perMember[cardId] ??= { cardId, memberParameter: 0, outfitSkill: 0, passiveSkill: 0, redBonus: 0, blueBonus: 0 });

  // Member Parameter: base (level + bloom, no board) stats, summed. Also
  // exposes each member's raw P/T/S individually (not just the summed
  // total) - Memory Bonus needs per-member-PER-STAT ceiling, matching the
  // Outfit/Passive Skill rounding rule, confirmed against the reverse-
  // engineering doc's worked example (112,960 x 5.6% ceil'd per-stat = 6,336,
  // vs 6,326 from a single aggregate round).
  let memberParameter = 0;
  const perMemberStats = [];
  for (const m of baseStats) {
    const total = m.stats.performance + m.stats.technique + m.stats.sense;
    memberParameter += total;
    ensure(m.cardId).memberParameter = total;
    perMemberStats.push({ cardId: m.cardId, performance: m.stats.performance, technique: m.stats.technique, sense: m.stats.sense });
  }

  // Blue Bonus: member-area board nodes + member-portion of connect patterns
  // (isolated via the memberOnly snapshot vs the pure base).
  // Red Bonus: leader-area nodes + leader-portion of connect patterns -
  // whatever's left when the fully-buffed result is diffed against the
  // blue-only snapshot instead of the pure base.
  let blueBonus = 0;
  let redBonus = 0;
  for (const m of result.memberStats) {
    const base = baseByCardId[m.cardId];
    if (!base) continue;
    const full = m.stats.performance + m.stats.technique + m.stats.sense;
    const pure = base.performance + base.technique + base.sense;
    const memberOnly = memberOnlyByCardId?.[m.cardId];
    let memberBlue, memberRed;
    if (memberOnly) {
      const memberOnlyTotal = memberOnly.performance + memberOnly.technique + memberOnly.sense;
      memberBlue = memberOnlyTotal - pure;
      memberRed = full - memberOnlyTotal;
    } else {
      memberBlue = full - pure; // no split possible - lump it all as before
      memberRed = 0;
    }
    blueBonus += memberBlue;
    redBonus += memberRed;
    const acc = ensure(m.cardId);
    acc.blueBonus = memberBlue;
    acc.redBonus = memberRed;
  }
  const holomemBoardBonus = blueBonus + redBonus;

  // Outfit Skill: the leader's own leader-skill stat buff (if any - some
  // leader skills are Score Support only, contributing 0 here but picked up
  // by computeLeaderScoreSupport() instead). Sum of roundup(affected stat *
  // bonus), per member per stat - not one roundup of the aggregated total,
  // since ceil(a)+ceil(b) generally != ceil(a+b). Iterates every leader
  // effect, not just the first, in case a future card has more than one.
  let outfitSkill = 0;
  if (result.leader?.conditionMet === true) {
    for (const leaderEffect of result.leader.effects || []) {
      const permil = Number(leaderEffect.valuePermil ?? 0);
      const bonus = permil / 1000;
      const isAllParam = leaderEffect.type?.includes('ALL_PARAMETER');
      const statKey = isAllParam
        ? null
        : leaderEffect.type?.includes('PERFORMANCE')
        ? 'performance'
        : leaderEffect.type?.includes('TECHNIQUE')
        ? 'technique'
        : leaderEffect.type?.includes('SENSE')
        ? 'sense'
        : null;
      if (!isAllParam && !statKey) continue; // not a stat-buff type (e.g. Score Support) - doesn't belong here
      for (const m of baseStats) {
        let contribution = 0;
        if (isAllParam) {
          contribution += Math.ceil(m.stats.performance * bonus);
          contribution += Math.ceil(m.stats.technique * bonus);
          contribution += Math.ceil(m.stats.sense * bonus);
        } else {
          contribution += Math.ceil(m.stats[statKey] * bonus);
        }
        outfitSkill += contribution;
        ensure(m.cardId).outfitSkill += contribution;
      }
    }
  }

  // Passive Skill: only the stat-boosting passive effect types (ALL/PERF/
  // TECH/SENSE _UP_PERMIL_UP) - Score Support is a different mechanic and
  // belongs to the Score Bonus side, not Overall Power. Same roundup-per-
  // member-per-stat rule as Outfit Skill.
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
      const bonus = effect.valuePermil / 1000;
      for (const recipientId of effect.recipients) {
        const base = baseByCardId[recipientId];
        if (!base) continue;
        let contribution = 0;
        if (isAllParam) {
          contribution += Math.ceil(base.performance * bonus);
          contribution += Math.ceil(base.technique * bonus);
          contribution += Math.ceil(base.sense * bonus);
        } else {
          contribution += Math.ceil(base[statKey] * bonus);
        }
        passiveSkill += contribution;
        ensure(recipientId).passiveSkill += contribution;
      }
    }
  }

  return {
    memberParameter,
    outfitSkill,
    holomemBoardBonus,
    redBonus,
    blueBonus,
    passiveSkill,
    perMember: Object.values(perMember),
    perMemberStats,
  };
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

/** Same idea as computeScoreSupport(), but for the leader's OWN leader-skill
 *  effects - checks both the main effect (10 cards have Score Support as
 *  their entire leader skill, e.g. Oozora Subaru's Vibrant Sun Splash!: +60%
 *  to the whole team, unconditional, no stat buff at all) and the additional
 *  effect (12 cards, e.g. Watame's Floatie Float Time: +25% once 2+
 *  Attribute-3 cards are in the deck, stacked on top of a stat buff). Most
 *  leader skills have neither and this returns {}. */
export function computeLeaderScoreSupport(leaderResult) {
  const support = {};
  if (!leaderResult) return support;
  for (const effect of [...(leaderResult.effects || []), ...(leaderResult.additionalEffects || [])]) {
    if (!effect.applies || effect.type !== SCORE_SUPPORT_TYPE) continue;
    for (const recipientId of effect.recipients) {
      support[recipientId] = (support[recipientId] || 0) + effect.valuePermil / 10;
    }
  }
  return support;
}

// ---------------------------------------------------------------------------
// UNIT SCORE - "Active Skill %" line of the in-game Unit Score Details panel.
// A completely separate simulator from simulateActiveTimeline() above: fixed
// synthetic 200-second timeline (not any real song's duration/fever seconds),
// probability-weighted MEAN per second (not "strongest wins"), no combo-gate
// onset handling yet (deferred, per product decision - see chat).
// ---------------------------------------------------------------------------

const UNIT_SCORE_TIMELINE_SECONDS = 200;
const ACTIVE_SCORE_UP_TYPE_SUFFIX = '_TYPE_SCORE_UP_PERMIL_UP';
const COMBO_GTE_TYPE = 'LiveSkillTriggerType_LIVE_SKILL_TRIGGER_TYPE_COMBO_GTE';

/**
 * Per-card inputs for the Unit Score simulator, extracted from
 * computeUnit()'s activeResults - magnitude and probability converted to
 * PERMIL (the doc's convention: 95% = 950), matching the worked-example
 * numbers exactly (e.g. Lui: mag=950, prob=460, cooldown=21, duration=8).
 *
 * COMBO-GATE ONSET: a card whose enhanced magnitude sits behind a "Combo >=
 * N" condition doesn't use it for the whole timeline - only from t0 onward
 * (t0 = N/2, assuming 2 combo/sec; confirmed exactly at N=40 -> t0=20 against
 * real deck data, extrapolated for other N since the doc flags those as
 * untested). LIFE-gated and static deck-composition conditions are NOT
 * time-gated - life starts full (t=0) and composition is either true for the
 * whole run or not, matching computeUnit()'s existing effects resolution, so
 * only combo-gated cards get comboOnsetT/enhancedMagPermil set here; every
 * other card's magPermil is already the single correct value from
 * activeResults[i].effects, unchanged from before.
 *
 * @param {object[]} activeResults - computeUnit(...).actives, in unit order
 * @param {object[]} unitCards - the 5 unit member cards, same order
 * @returns {{cardId:string, magPermil:number, probPermil:number, cooldown:number, duration:number, comboOnsetT?:number, enhancedMagPermil?:number}[]}
 */
export function extractActiveSkillInputs(activeResults, unitCards) {
  return activeResults.map((a, i) => {
    const isComboGated = a.enhancedCondition?.type === COMBO_GTE_TYPE && a.enhancedConditionMet === 'assumed';
    const baseEffect = a.baseEffects?.find((e) => e.type.endsWith(ACTIVE_SCORE_UP_TYPE_SUFFIX));
    const scoreEffect = a.effects?.find((e) => e.type.endsWith(ACTIVE_SCORE_UP_TYPE_SUFFIX));

    const card = {
      cardId: unitCards[i].cardId,
      magPermil: scoreEffect ? Math.round(scoreEffect.valuePercent * 10) : 0,
      probPermil: Math.round((a.activationProbabilityPercent || 0) * 10),
      cooldown: a.coolTimeSeconds,
      duration: a.effectDurationSeconds,
    };

    if (isComboGated && baseEffect) {
      const enhancedEffect = a.enhancedEffects?.find((e) => e.type.endsWith(ACTIVE_SCORE_UP_TYPE_SUFFIX));
      card.magPermil = Math.round(baseEffect.valuePercent * 10); // base magnitude for t < onset
      card.enhancedMagPermil = enhancedEffect ? Math.round(enhancedEffect.valuePercent * 10) : card.magPermil;
      card.comboOnsetT = Number(a.enhancedCondition.threshold) / 2;
    }

    return card;
  });
}

/**
 * Whether a card's active skill is ON at integer second t, per the doc's
 * definition: ON(card) = seconds t with k*cooldown <= t < k*cooldown+duration
 * for some integer k >= 1 (first activation at t=cooldown, not t=0 - matches
 * the coverage table's existing convention elsewhere in this file).
 */
function isActiveOnAt(card, t) {
  if (!card.cooldown || !card.duration) return false;
  const k = Math.floor(t / card.cooldown);
  for (const kk of [k, k + 1]) {
    if (kk < 1) continue;
    const start = kk * card.cooldown;
    if (t >= start && t < start + card.duration) return true;
  }
  return false;
}

/** The magnitude a card contributes at second t, applying the combo-gate
 *  onset law when the card is combo-gated (see extractActiveSkillInputs). */
function magAt(card, t) {
  if (card.comboOnsetT != null && t >= card.comboOnsetT) return card.enhancedMagPermil;
  return card.magPermil;
}

/**
 * Base-pass Active Skill % - the doc's core formula:
 *   v(t) = Σ_ON(mag(t)*prob) / max(1000, Σ_ON prob), per second
 *   Active = ceil(mean of v(1..200))
 * @param {ReturnType<typeof extractActiveSkillInputs>} cards
 * @returns {{activePercent:number, perSecond:{t:number, v:number}[], meanRaw:number}}
 */
export function computeBaseActiveSkillPercent(cards) {
  const { perSecond, meanRaw } = meanOfTimeline(cards);
  const activePermil = Math.ceil(meanRaw);
  return { activePermil, activePercent: activePermil / 10, perSecond, meanRaw };
}

/** Shared v(t)-over-200-seconds core, used by both the base and boosted
 *  passes - identical formula, just fed different (mag,prob,cooldown) sets. */
function meanOfTimeline(cards) {
  const perSecond = [];
  let sum = 0;
  for (let t = 1; t <= UNIT_SCORE_TIMELINE_SECONDS; t++) {
    let sumMagProb = 0;
    let sumProb = 0;
    for (const c of cards) {
      if (!isActiveOnAt(c, t)) continue;
      sumMagProb += magAt(c, t) * c.probPermil;
      sumProb += c.probPermil;
    }
    const v = sumMagProb / Math.max(1000, sumProb);
    perSecond.push({ t, v });
    sum += v;
  }
  return { perSecond, meanRaw: sum / UNIT_SCORE_TIMELINE_SECONDS };
}

/**
 * Boosted pass (doc section 6): rerun the same 200s timeline with boosted
 * per-card parameters reflecting Outfit+Passive+Board Score Support (E),
 * board activation-probability nodes (probUp), and board cooldown-shorten
 * nodes (shorten):
 *   mag' = ceil(mag * (1 + E/1000))
 *   prob' = ceil(prob * (1 + probUp/1000))
 *   cd' = cooldown / (1 + shorten/1000)
 * E is exactly the site's existing merged `scoreSupport` map (mergeScoreSupport
 * already combines leader/passive/board Score Support into one number per
 * card) - no new resolution needed, confirmed against the datamine that
 * LIVE_ACTIVE_SKILL_EFFECT_UP_PERMIL_UP board nodes are exclusively
 * SET_LIVE_LEADER-triggered, matching the doc's "leader-scope only" E_board.
 *
 * @param {ReturnType<typeof extractActiveSkillInputs>} baseCards
 * @param {Record<string, number>} scoreSupportPercent - E(card), percent (not permil)
 * @param {Record<string, number>} probUpPermil - board activation-probability-up nodes, per cardId
 * @param {Record<string, number>} shortenPermil - board cooldown-shorten nodes, per cardId
 * @returns {{boostedPermil:number, boostedPercent:number, perSecond:{t:number,v:number}[], meanRaw:number, boostedCards:object[]}}
 */
export function computeBoostedActiveSkillPercent(baseCards, scoreSupportPercent, probUpPermil, shortenPermil) {
  const boostedCards = baseCards.map((c) => {
    const E = Math.round((scoreSupportPercent[c.cardId] || 0) * 10); // percent -> permil
    const probUp = probUpPermil[c.cardId] || 0;
    const shorten = shortenPermil[c.cardId] || 0;
    const boosted = {
      cardId: c.cardId,
      // integer-numerator arithmetic throughout - "mag * (1 + E/1000)" as
      // written accumulates floating-point noise (1200*(1+680/1000) comes
      // out 2016.0000000000002 in JS, one ULP over the exact integer 2016,
      // which then wrongly ceils to 2017). "(mag*(1000+E))/1000" does the
      // same math with a single division at the end and lands exactly on
      // 2016 - confirmed against the doc's worked example after this fix.
      magPermil: Math.ceil((c.magPermil * (1000 + E)) / 1000),
      probPermil: Math.ceil((c.probPermil * (1000 + probUp)) / 1000),
      cooldown: (c.cooldown * 1000) / (1000 + shorten),
      duration: c.duration,
    };
    // "the same time-gated magnitude feeds the boosted pass" - the combo-gate
    // onset still applies here, with E boosting whichever of base/enhanced is
    // active at that second.
    if (c.comboOnsetT != null) {
      boosted.comboOnsetT = c.comboOnsetT;
      boosted.enhancedMagPermil = Math.ceil((c.enhancedMagPermil * (1000 + E)) / 1000);
    }
    return boosted;
  });
  const { perSecond, meanRaw } = meanOfTimeline(boostedCards);
  const boostedPermil = Math.ceil(meanRaw);
  return { boostedPermil, boostedPercent: boostedPermil / 10, perSecond, meanRaw, boostedCards };
}

/**
 * Adams' divisor apportionment (doc section 6): allocates an integer target
 * total across N quotas such that every nonzero-quota line gets ceil(quota/D)
 * for a single shared divisor D, chosen so the lines sum EXACTLY to the
 * target. Guarantees every nonzero line is allocated >= 1 (Adams' defining
 * property - it rounds UP, unlike Hamilton/Jefferson's methods). Zero-quota
 * lines are excluded entirely (not "visible") and always get 0.
 *
 * Implementation: sum(ceil(q_i/D)) is a non-increasing step function of D,
 * so binary-search D until the sum matches the target exactly.
 *
 * @param {number[]} quotas - one per line (0 for a line that doesn't apply)
 * @param {number} target - the integer total the lines must sum to (Boost)
 * @returns {number[]} integer allocation per line, same order/length as quotas, summing to target
 */
export function adamsApportionment(quotas, target) {
  const result = quotas.map(() => 0);
  const nonzero = quotas.map((q, i) => ({ q, i })).filter((x) => x.q > 0);
  if (nonzero.length === 0 || target <= 0) return result;

  let lo = 0;
  let hi = Math.max(...nonzero.map((x) => x.q)); // at D=hi, the largest quota's line gets ceil(1)=1
  const sumAt = (D) => nonzero.reduce((s, x) => s + Math.ceil(x.q / D), 0);

  // sumAt(lo=0) is +Infinity (division by 0), sumAt(hi) = however many lines
  // that is (each >=1). If target is below that floor, clamp - can't go
  // lower than 1 per visible line (matches "every visible line >= 1").
  const floor = sumAt(hi);
  if (target <= floor) {
    for (const x of nonzero) result[x.i] = 1;
    return result;
  }

  for (let iter = 0; iter < 200; iter++) {
    const mid = (lo + hi) / 2;
    if (mid === lo || mid === hi) break; // float precision floor reached
    if (sumAt(mid) > target) lo = mid;
    else hi = mid;
  }
  for (const x of nonzero) result[x.i] = Math.ceil(x.q / hi);
  return result;
}

/**
 * Computes the three Outfit/Passive/Board quotas (doc section 6) from raw
 * per-card inputs, ready to feed into adamsApportionment() alongside Boost.
 * w(card) uses BASE mag/prob but the BOOSTED cooldown's ON-count ("the
 * shortened lattice") - this mixed base/boosted convention is explicit in
 * the doc and easy to get wrong.
 *
 * @param {ReturnType<typeof extractActiveSkillInputs>} baseCards
 * @param {object[]} boostedCards - from computeBoostedActiveSkillPercent(...).boostedCards
 * @param {Record<string,number>} outfitPercent - E_outfit per card, PERCENT (computeLeaderScoreSupport() output)
 * @param {Record<string,number>} passivePercent - E_passive per card, PERCENT (computeScoreSupport() output)
 * @param {Record<string,number>} boardPermil - E_board per card, PERMIL (computeBoardBonuses(...).scoreSupportPermil)
 * @param {Record<string,number>} probUpPermil
 * @param {Record<string,number>} shortenPermil
 * @returns {{qOutfit:number, qPassive:number, qBoard:number, W:number}}
 */
export function computeBoostQuotas(baseCards, boostedCards, outfitPercent, passivePercent, boardPermil, probUpPermil, shortenPermil) {
  const boostedByCardId = Object.fromEntries(boostedCards.map((c) => [c.cardId, c]));
  const w = {};
  let W = 0;
  for (const c of baseCards) {
    const boosted = boostedByCardId[c.cardId];
    let onCount = 0;
    for (let t = 1; t <= UNIT_SCORE_TIMELINE_SECONDS; t++) {
      if (isActiveOnAt({ cooldown: boosted.cooldown, duration: boosted.duration }, t)) onCount++;
    }
    // w(card) uses a single "mag" per the doc, but a combo-gated card's
    // magnitude is time-varying - not addressed by either worked example.
    // Using the enhanced value here (applies for 180 of the 200 seconds,
    // vs 20 at base) as the more representative single figure; genuinely
    // untested against real data for this specific combination.
    const cardMag = c.comboOnsetT != null ? c.enhancedMagPermil : c.magPermil;
    w[c.cardId] = cardMag * c.probPermil * onCount;
    W += w[c.cardId];
  }

  // E_outfit is uniform across the whole team when it applies at all - any
  // nonzero entry gives the right value.
  const eOutfitPercent = Math.max(0, ...Object.values(outfitPercent).map((v) => v || 0));
  const qOutfit = eOutfitPercent * 10 * W; // percent -> permil to match doc's permil quotas

  let qPassive = 0;
  let weightedBoard = 0;
  let weightedProbUp = 0;
  let weightedShorten = 0;
  for (const c of baseCards) {
    const cardW = w[c.cardId];
    qPassive += (passivePercent[c.cardId] || 0) * 10 * cardW; // percent -> permil
    weightedBoard += (boardPermil[c.cardId] || 0) * cardW;
    weightedProbUp += (probUpPermil[c.cardId] || 0) * cardW;
    weightedShorten += (shortenPermil[c.cardId] || 0) * cardW;
  }
  const eBar = W > 0 ? weightedBoard / W : 0;
  const pBar = W > 0 ? weightedProbUp / W : 0;
  const sBar = W > 0 ? weightedShorten / W : 0;
  const qBoard = 1000 * W * ((1 + eBar / 1000) * (1 + pBar / 1000) * (1 + sBar / 1000) - 1);

  return { qOutfit, qPassive, qBoard, W };
}

/**
 * Bridges computeUnit()'s specialResults into computeSpecialSkillLine()'s
 * input shape (percent -> permil, field renames). A member with no special
 * skill contributes magPermil=0, correctly skipped by computeSpecialSkillLine.
 * @param {object[]} specialResults - computeUnit(...).specials, in unit order
 */
export function extractSpecialSkillInputs(specialResults) {
  return specialResults.map((s) => ({
    magPermil: s.supportBonusPercent ? Math.round(s.supportBonusPercent * 10) : 0,
    durationSeconds: s.effectDurationSeconds || 0,
    riderPermil: s.activationRateUpPercent ? Math.round(s.activationRateUpPercent * 10) : 0,
  }));
}

/**
 * Special Skill line (doc section 5):
 *   pool = Σ specials(magS * durS * (1 + riderS/2000))
 *   Special = ceil(Active * pool / 120,000)
 * riderS (the special's own activation-rate-up bonus, from
 * additionalEffects) counts at HALF value (divide by 2000, not 1000).
 * Special multiplies the ACTIVE line, not the boosted one.
 *
 * The SPECIAL GATE-RIDER law (a special loses its rider, but keeps its
 * magnitude, when its own deck-composition condition isn't met) is NOT
 * implemented - deferred as a minor accuracy gap, per product decision.
 * Every special's rider is included in full regardless of its condition.
 *
 * @param {number} activePermil - the base-pass Active Skill line, in PERMIL (computeBaseActiveSkillPercent(...).activePermil)
 * @param {{magPermil:number, durationSeconds:number, riderPermil:number}[]} specials - one entry per unit member's special skill (magPermil=0 or entry omitted if the card has none)
 * @returns {{specialPermil:number, specialPercent:number, pool:number}}
 */
export function computeSpecialSkillLine(activePermil, specials) {
  let pool = 0;
  for (const s of specials) {
    if (!s.magPermil || !s.durationSeconds) continue;
    const rider = s.riderPermil || 0;
    pool += (s.magPermil * s.durationSeconds * (2000 + rider)) / 2000; // integer-numerator form of magS*durS*(1+riderS/2000)
  }
  const specialPermil = Math.ceil((activePermil * pool) / 120000);
  return { specialPermil, specialPercent: specialPermil / 10, pool };
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
 * totalChartWeight is passed in rather than derived from noteDensityEntries -
 * it must include chart-wide notes that the per-second display data omits
 * (slide relay points with critical=None, which don't independently earn
 * combo but still occupy a slot in the PERFECT_PLUS coefficient pool -
 * confirmed against a real in-game score discrepancy, see note_density
 * generation script). Summing noteDensityEntries directly under-counts.
 *
 * @param {object[]} timeline - simulateActiveTimeline() output (gives maxBonus per second)
 * @param {(number[]|undefined)[]} noteDensityEntries - per-second [count, {code:count}] from note_density/{musicId}.json's perSecond array, for the chosen difficulty
 * @param {number} deckPower - Overall Power total (memberParameter+outfitSkill+passiveSkill+holomemBoardBonus+memoryBonus+powerUpBonus)
 * @param {number} liveScoreCoefficientPermil - song's own coefficient (Music.json)
 * @param {number} difficultyLevel - numeric difficulty rating for the chosen difficulty
 * @param {number} totalChartWeight - from note_density/{musicId}.json's totalChartWeight field, for the chosen difficulty
 * @returns {{perSecond:{t:number,score:number}[], totalChartWeight:number, musicCoefficient:number, grandTotal:number}}
 */
export function computeScoreTimeline(timeline, noteDensityEntries, deckPower, liveScoreCoefficientPermil, difficultyLevel, totalChartWeight) {
  const musicCoefficient = 1 + (liveScoreCoefficientPermil / 1000) * (difficultyLevel - 5);

  const baseFactor = totalChartWeight > 0 ? (deckPower * 2.3 * musicCoefficient) / totalChartWeight : 0;

  /** Score for one second at a given skillBonus (0-100 scale, i.e. 60 = +60%),
   *  summed across every note-type in that second - shared by both the
   *  winner-based total and each member's own hypothetical score. */
  function secondScoreAt(entry, comboBonus, skillBonusPercent) {
    if (!entry || !entry[0] || !entry[1]) return 0;
    const skillBonus = (skillBonusPercent || 0) / 100;
    let total = 0;
    for (const [code, count] of Object.entries(entry[1])) {
      const weight = NOTE_WEIGHTS_PERFECT_PLUS[strippedTypeCode(code)] || 0;
      const noteScore = Math.ceil(baseFactor * weight * (1 + comboBonus) * (1 + skillBonus) * (1 + SKILL_TREE_BONUS));
      total += noteScore * count;
    }
    return total;
  }

  let cumulativeCombo = 0;
  let grandTotal = 0;
  const perSecond = [];
  const perMemberScores = {}; // cardId -> [{t, score}], using that member's OWN effectiveBonus (0 if inactive that second)
  for (const point of timeline) {
    const entry = noteDensityEntries[point.t];
    const comboBonus = comboBonusAt(cumulativeCombo);

    const secondScore = secondScoreAt(entry, comboBonus, point.maxBonus);

    for (const m of point.perMember) {
      const memberScore = secondScoreAt(entry, comboBonus, m.effectiveBonus);
      (perMemberScores[m.cardId] ??= []).push({ t: point.t, score: memberScore });
    }

    if (entry && entry[0] > 0) cumulativeCombo += entry[0];
    grandTotal += secondScore;
    perSecond.push({ t: point.t, score: secondScore });
  }

  return { perSecond, totalChartWeight, musicCoefficient, grandTotal, perMemberScores };
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
