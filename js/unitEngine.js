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

  // --- 3. Passive skills (per member, condition = target's own gating) ---
  const passiveResults = unit.map(({ card, bloom }) => {
    const passiveLevel = getSkillLevel(card, bloom, cardPotentials, SKILL_LEVEL_TYPES.PASSIVE);
    const levelData = card.passiveSkill?.[String(passiveLevel)];
    if (!levelData) return { cardId: card.cardId, level: passiveLevel, effects: [] };
    const resolved = levelData.effects.map((effect) => {
      const recipients = resolveEffectRecipients(effect.target, card, unitCards, characterGroupings);
      return {
        type: effect.type,
        valuePermil: Number(effect.value),
        recipients: recipients.map((c) => c.cardId),
        applies: recipients.length > 0,
      };
    });
    return { cardId: card.cardId, level: passiveLevel, effects: resolved };
  });

  // --- 4. Active skills (exact values, no High/Medium/Low bucketing) ---
  const activeResults = unit.map(({ card, bloom }) => {
    const activeLevel = getSkillLevel(card, bloom, cardPotentials, SKILL_LEVEL_TYPES.ACTIVE);
    const levelData = card.activeSkill?.[String(activeLevel)];
    if (!levelData) return { cardId: card.cardId, level: activeLevel };
    return {
      cardId: card.cardId,
      level: activeLevel,
      activationProbabilityPercent: levelData.activationProbabilityPermil / 10,
      coolTimeSeconds: levelData.coolTimeMs / 1000,
      effectDurationSeconds: levelData.effectDurationMs / 1000,
      effects: levelData.effects.map((e) => ({
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
      index.set(`${x},${y}`, { kind: 'effect', key, area, type, index: i, cost: n.cost, value: n.value, grade: n.grade });
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

/**
 * @param {Record<string, Set<string>>} unlockedPositions - characterId -> Set of "x,y" unlocked position keys
 * @param {Record<string, object>} boardCategoriesData - board_categories.json
 * @param {{characterId:string, cardId:string, isLeaderSlot:boolean, isUnitMember:boolean}[]} slots
 *        - isLeaderSlot: true only for the slot actually chosen as leader this run.
 *          Leader-area (red) bonuses ONLY apply from this slot's selections.
 *        - isUnitMember: true for the 5 performing slots. Member-area (blue) bonuses
 *          only apply from a slot with this set (and only benefit that slot's own card).
 */
export function computeBoardBonuses(unlockedPositions, boardCategoriesData, slots) {
  const unitCardIds = slots.filter((s) => s.isUnitMember).map((s) => s.cardId);

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
    const cdShorten = boardBonuses.cooldownShortenPermil[cardId];
    if (cdShorten && a.coolTimeSeconds != null) {
      a.coolTimeSeconds = a.coolTimeSeconds * (1 - cdShorten / 1000);
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

        const extraValue = node.value * (connectorInfo.boostPermil / 1000);
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
 * @returns {{t:number, perMember:{cardId:string,active:boolean,effectiveBonus:number,activationChance:number|null,activationStart:number|null,unitIndex:number}[], maxBonus:number, winnerCardId:string|null, inSpecialWindow:boolean, noBonusDuringSpecial:boolean}[]}
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

      return { cardId, active, effectiveBonus, activationChance, activationStart, unitIndex: i };
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
