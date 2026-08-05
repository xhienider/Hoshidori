// statEngine.js
// Core member-stat calculation, replacing the spreadsheet's 6-bucket
// "Parameter Chart" approximation with exact per-card math derived from
// the datamined Card.json / CardLevel.json / CardPotential.json tables.
//
// Formula (validated against the live Simulations sheet, see chat history):
//   base   = CardLevel(card.cardLevelGroupId, level).parameterBaseValue
//   bonus  = sum of ALL_PARAMETER_UP_PERMIL_UP potential steps unlocked at
//            the given bloom level (varies by rarity — NOT a flat 1.1x)
//   stat_X = ceil( base * card.<X>PermilMultiply / 1000 * (1 + bonus/1000) )

/**
 * @param {object} card - a member record from members.json
 * @param {Map<string, Map<number, object>>} levelCurveIndex - card.levelCurve is
 *        already embedded per-card in members.json, so this isn't strictly
 *        needed if you pass card.levelCurve directly (see below).
 */

/** Sum of ALL_PARAMETER_UP_PERMIL_UP potential bonuses unlocked up to `bloomLevel`. */
export function getParameterBonusPermil(card, bloomLevel, cardPotentials) {
  const steps = cardPotentials[card.cardPotentialGroupId] || [];
  let bonus = 0;
  for (const step of steps) {
    if (
      step.upgradeCount <= bloomLevel &&
      step.effectType === 'CardPotentialEffectType_CARD_POTENTIAL_EFFECT_TYPE_ALL_PARAMETER_UP_PERMIL_UP'
    ) {
      bonus += Number(step.value);
    }
  }
  return bonus; // e.g. 100 = +10%
}

/** Which skill level (1 or 2) is unlocked for a given skill type at this bloom level. */
export function getSkillLevel(card, bloomLevel, cardPotentials, skillEffectType) {
  const steps = cardPotentials[card.cardPotentialGroupId] || [];
  const unlocked = steps.some(
    (s) => s.upgradeCount <= bloomLevel && s.effectType === skillEffectType
  );
  return unlocked ? 2 : 1;
}

export const SKILL_LEVEL_TYPES = {
  ACTIVE: 'CardPotentialEffectType_CARD_POTENTIAL_EFFECT_TYPE_ACTIVE_SKILL_LEVEL_UP',
  PASSIVE: 'CardPotentialEffectType_CARD_POTENTIAL_EFFECT_TYPE_PASSIVE_SKILL_LEVEL_UP',
  SPECIAL: 'CardPotentialEffectType_CARD_POTENTIAL_EFFECT_TYPE_SPECIAL_SKILL_LEVEL_UP',
  TREE_CONNECT: 'CardPotentialEffectType_CARD_POTENTIAL_EFFECT_TYPE_SKILL_TREE_CONNECT_EFFECT_LEVEL_UP',
};

/**
 * Resolve a member's Performance / Technique / Sense stats at a given level + bloom.
 * @param {object} card - member record (from members.json)
 * @param {number} level
 * @param {number} bloomLevel
 * @param {object} cardPotentials - card_potentials.json
 * @returns {{performance:number, technique:number, sense:number}}
 */
export function resolveMemberStats(card, level, bloomLevel, cardPotentials) {
  const levelData = card.levelCurve[String(level)];
  if (!levelData) {
    throw new Error(`No level curve data for ${card.cardId} at level ${level}`);
  }
  const base = Number(levelData.parameterBaseValue);
  const bonusPermil = getParameterBonusPermil(card, bloomLevel, cardPotentials);
  const mult = 1 + bonusPermil / 1000;

  // The game appears to round the base (pre-bloom) stat to a whole number
  // FIRST, then apply the bloom multiplier and round again - not a single
  // combined rounding at the end. Confirmed against Suisei's real Lv80/Bloom2
  // card: single-ceil undershoots Technique/Sense by 1; double-ceil matches
  // all three stats exactly.
  const performance = Math.ceil(Math.ceil((base * card.performancePermilMultiply) / 1000) * mult);
  const technique = Math.ceil(Math.ceil((base * card.techniquePermilMultiply) / 1000) * mult);
  const sense = Math.ceil(Math.ceil((base * card.sensePermilMultiply) / 1000) * mult);

  return { performance, technique, sense };
}

/** Which of Performance/Technique/Sense is this card's Main/Sec/Off stat (by permil rank). */
export function getStatRoles(card) {
  const stats = [
    { name: 'performance', permil: card.performancePermilMultiply },
    { name: 'technique', permil: card.techniquePermilMultiply },
    { name: 'sense', permil: card.sensePermilMultiply },
  ].sort((a, b) => b.permil - a.permil);
  return {
    main: stats[0].name,
    sec: stats[1].name,
    off: stats[2].name,
  };
}
