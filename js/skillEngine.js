// skillEngine.js
// Resolves leader-skill conditions and effect-target recipients using the
// real trigger/target structures found in the datamine (LiveSkillTrigger,
// LiveSkillEffectTarget) — see chat history for the Korone/Bijou validation.

/**
 * @param {object|null} condition - member.leaderSkill.condition
 * @param {object} leaderCard - the leader's own member record
 * @param {object[]} unitCards - the 5 unit member cards
 * @param {Record<string,string[]>} characterGroupings - character_groupings.json
 */
export function evaluateLeaderCondition(condition, leaderCard, unitCards, characterGroupings) {
  if (!condition) return true; // no condition = always active

  switch (condition.type) {
    case 'LiveSkillTriggerType_LIVE_SKILL_TRIGGER_TYPE_DECK_CARD_ATTRIBUTE': {
      const count = unitCards.filter((c) => c.attributeType === condition.cardAttributeType).length;
      return count >= Number(condition.threshold);
    }
    case 'LiveSkillTriggerType_LIVE_SKILL_TRIGGER_TYPE_DECK_CARD_CHARACTER_GROUPING': {
      const memberIds = characterGroupings[condition.characterGroupingId] || [];
      const count = unitCards.filter((c) => memberIds.includes(c.characterId)).length;
      return count >= Number(condition.threshold);
    }
    case 'LiveSkillTriggerType_LIVE_SKILL_TRIGGER_TYPE_DECK_LEADER_CHARACTER':
      return condition.characterIds?.includes(leaderCard.characterId) ?? false;
    case 'LiveSkillTriggerType_LIVE_SKILL_TRIGGER_TYPE_DECK_LEADER_CHARACTER_GROUPING': {
      const memberIds = characterGroupings[condition.characterGroupingId] || [];
      return memberIds.includes(leaderCard.characterId);
    }
    default:
      // COMBO_GTE / LIFE_GTE / LIFE_LTE / JUDGEMENT_TYPE_GTE / MUSIC_CHARACTER are
      // live-gameplay-state conditions (combo count, health, note judgement, song)
      // rather than static team-composition conditions — out of scope for a
      // pre-live team simulator. Surface as "situational", not evaluable here.
      return 'situational';
  }
}

/**
 * @param {object} target - a resolved target object
 * @param {object} sourceCard - the card that owns this skill (for SELF targeting)
 * @param {object[]} unitCards - all 5 unit members (the pool to select recipients from)
 * @param {Record<string,string[]>} characterGroupings - character_groupings.json
 * @param {RecipientRanking} [ranking] - how to choose when more members qualify
 *        than `targetCount` allows (see rankingScore). Without it, falls back to
 *        unit order.
 * @returns {object[]} the cards that receive the effect (empty array = condition not met)
 */
export function resolveEffectRecipients(target, sourceCard, unitCards, characterGroupings, ranking) {
  if (!target) return [];

  switch (target.type) {
    case 'LiveSkillEffectTargetType_LIVE_SKILL_EFFECT_TARGET_TYPE_ALL':
      return unitCards;

    case 'LiveSkillEffectTargetType_LIVE_SKILL_EFFECT_TARGET_TYPE_SELF':
      return unitCards.includes(sourceCard) ? [sourceCard] : [];

    case 'LiveSkillEffectTargetType_LIVE_SKILL_EFFECT_TARGET_TYPE_ATTRIBUTE': {
      // targetCount caps how many recipients this effect reaches - it is NOT a
      // minimum threshold. A card can still buff itself even if no other
      // matching-attribute member exists; fewer than targetCount matches just
      // means fewer recipients, not zero.
      const matching = unitCards.filter((c) => c.attributeType === target.cardAttributeType);
      return pickRecipients(matching, target.targetCount, unitCards, ranking);
    }

    case 'LiveSkillEffectTargetType_LIVE_SKILL_EFFECT_TARGET_TYPE_CHARACTER_GROUPING': {
      const memberIds = characterGroupings[target.characterGroupingId] || [];
      const matching = unitCards.filter((c) => memberIds.includes(c.characterId));
      return pickRecipients(matching, target.targetCount, unitCards, ranking);
    }

    default:
      return [];
  }
}

/**
 * @typedef {object} RecipientRanking
 * @property {string} effectType - the effect's datamine type (decides what is compared)
 * @property {Record<string,{performance:number,technique:number,sense:number}>} statsByCardId
 *           - each unit card's own stats (level + Bloom, before leader/board/passive bonuses)
 * @property {Record<string,number>} activeScoreUpByCardId - each card's active skill Score Up (permil)
 */

/**
 * What a capped effect compares when more members qualify than it can reach.
 * Rule from in-game play (user, 2026-11-23):
 *   - single-stat boost (Performance/Technique/Sense UP): highest value of that stat
 *   - all-stats boost: highest total stats
 *   - Score Support (active skill effect UP): highest active skill bonus
 *   - ties: the card earlier in the unit
 * ASSUMPTION: "stats" = the card's own stats (level + Bloom), the same base the
 * passive percentages are applied to. Not yet confirmed whether the game compares
 * these or the post-leader/board values - change it here if it turns out otherwise.
 * Returns null for effect types with no ranking rule (unit order then applies).
 */
export function rankingScore(card, ranking) {
  if (!ranking?.effectType) return null;
  const type = ranking.effectType;
  const stats = ranking.statsByCardId?.[card.cardId];
  if (type.endsWith('_PERFORMANCE_UP_PERMIL_UP')) return stats ? stats.performance : null;
  if (type.endsWith('_TECHNIQUE_UP_PERMIL_UP')) return stats ? stats.technique : null;
  if (type.endsWith('_SENSE_UP_PERMIL_UP')) return stats ? stats.sense : null;
  if (type.endsWith('_ALL_PARAMETER_UP_PERMIL_UP')) return stats ? stats.performance + stats.technique + stats.sense : null;
  if (type.endsWith('_LIVE_ACTIVE_SKILL_EFFECT_UP_PERMIL_UP')) return ranking.activeScoreUpByCardId?.[card.cardId] ?? null;
  return null;
}

/**
 * Chooses up to `count` recipients from `matching`: all of them when they fit,
 * otherwise the highest rankingScore, ties broken by unit position. Result is
 * returned in unit order.
 */
function pickRecipients(matching, count, unitCards, ranking) {
  if (matching.length <= count) return matching;
  const position = (c) => unitCards.indexOf(c);
  const scored = matching.map((c) => ({ c, score: rankingScore(c, ranking) }));
  if (scored.some((x) => x.score == null)) return matching.slice(0, count); // no rule / no data: unit order
  scored.sort((a, b) => b.score - a.score || position(a.c) - position(b.c));
  const chosen = new Set(scored.slice(0, count).map((x) => x.c));
  return matching.filter((c) => chosen.has(c));
}
