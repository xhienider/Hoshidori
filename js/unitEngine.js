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
