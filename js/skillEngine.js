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
 * @returns {object[]} the cards that receive the effect (empty array = condition not met)
 */
export function resolveEffectRecipients(target, sourceCard, unitCards, characterGroupings) {
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
      return matching.slice(0, target.targetCount);
    }

    case 'LiveSkillEffectTargetType_LIVE_SKILL_EFFECT_TARGET_TYPE_CHARACTER_GROUPING': {
      const memberIds = characterGroupings[target.characterGroupingId] || [];
      const matching = unitCards.filter((c) => memberIds.includes(c.characterId));
      return matching.slice(0, target.targetCount);
    }

    default:
      return [];
  }
}
