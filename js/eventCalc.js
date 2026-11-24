// Event point estimate - pure math, no DOM. Used by the Builder's Event Points
// panel (js/eventPage.js).
//
// Formula (community-derived, checked to the exact point against two in-game
// Spotlight multi results screens, 2026-11-23 - see PROJECT_STATUS "Event points"):
//   base   = 120 + ownScore/15000 [+ roomScore/divisor in multi]
//            divisor 60000 (Point Rally, Score Challenge) | 75000 (Spotlight)
//   EP     = ceil( ceil(base * (1 + earnedBonus)) * songLength * liveBoost * (2 if HoloPassport) )
//   badges = ceil(EP / 10)
// roomScore = the results screen's MULTI SCORE (all 5 players + Fever), so the
// multi rank thresholds below can be used directly as room scores.

import { NOTE_WEIGHTS_PERFECT_PLUS, SKILL_TREE_BONUS } from './unitEngine.js';

export const EVENT_TYPES = {
  point_rally: { label: 'Point Rally', roomDivisor: 60000 },
  score_challenge: { label: 'Score Challenge', roomDivisor: 60000 },
  spotlight: { label: 'Spotlight', roomDivisor: 75000 },
};

/** Live Boost -> event point multiplier ("Rewards ×N"), MarathonLiveRewardUpStaminaEffect. */
export const LIVE_BOOST_MULTIPLIER = [8, 16, 24, 30, 37, 42, 46, 50, 53, 56];

/** Score rank thresholds from LiveScoreEvaluationRank (same groups for every song). */
export const MULTI_RANKS = [
  ['S', 5e6], ['S+1', 6e6], ['S+2', 7.5e6], ['S+3', 10e6], ['S+4', 12.5e6],
  ['S+5', 15e6], ['S+6', 17.5e6], ['S+7', 20e6], ['S+8', 22.5e6], ['S+9', 25e6],
];
export const SOLO_RANKS = [
  ['C', 150000], ['B', 300000], ['A', 600000], ['S', 1e6], ['S+1', 1.2e6], ['S+2', 1.5e6],
  ['S+3', 2e6], ['S+4', 2.5e6], ['S+5', 3e6], ['S+6', 3.5e6], ['S+7', 4e6], ['S+8', 4.5e6], ['S+9', 5e6],
];

export function rankFor(score, ranks) {
  let label = ranks === MULTI_RANKS ? 'below S' : 'D';
  for (const [name, from] of ranks) if (score >= from) label = name;
  return label;
}

/** Bloom bonus (percent) by rarity and Bloom level 1-5 (Bloom 0 = 0), from the in-game table. */
export const BLOOM_BONUS = {
  3: [0, 1, 1, 2, 2, 3],
  4: [0, 6, 7, 8, 9, 10],
  5: [0, 15, 18, 22, 26, 30],
};

export function rarityOf(card) {
  const m = /RARITY_(\d)/.exec(card?.rarity || '');
  return m ? Number(m[1]) : 0;
}

/**
 * One unit card's event bonus (percent). Member and holomem bonuses are PER
 * CARD (confirmed in-game): a banner card adds memberBonus, a card of a bonus
 * holomem adds holomemBonus, and a bonus holomem's own banner card gets both.
 * holomemIds: Spotlight = the chapter being played; Point Rally / Score
 * Challenge = every banner card's holomem.
 */
export function cardEventBonus(card, bloom, event, holomemIds) {
  const rarity = rarityOf(card);
  const bloomPct = BLOOM_BONUS[rarity]?.[Math.max(0, Math.min(5, bloom || 0))] ?? 0;
  const memberPct = event && (event.bannerCards || []).includes(card?.cardId) ? event.memberBonusPercent || 0 : 0;
  const holomemPct = event && (holomemIds || []).includes(card?.characterId) ? event.holomemBonusPercent || 0 : 0;
  return { bloomPct, memberPct, holomemPct, total: bloomPct + memberPct + holomemPct };
}

/** Song-length bonus (percent). Highlight replaces it with a fixed value. */
export const HIGHLIGHT_BONUS = (boosts) => (boosts <= 1 ? 54 : boosts <= 3 ? 50 : 42);
export const LENGTH_COEFFICIENT_PERCENT = 0.526; // user testing: 0.5253% < x < 0.52632%
export function songLengthBonusPercent(playingSeconds, boosts, highlight) {
  if (highlight) return HIGHLIGHT_BONUS(boosts);
  const m = boosts <= 1 ? 1.3 : boosts <= 3 ? 1.2 : 1.0;
  const raw = (playingSeconds - 90) * LENGTH_COEFFICIENT_PERCENT * m;
  return raw <= 0 ? 0 : Math.ceil(raw - 1e-9);
}

/**
 * @param {{ownScore:number, roomScore?:number, multi:boolean, eventType:string,
 *          earnedBonusPercent:number, songLengthPercent:number, boosts:number, passport:boolean}} p
 */
export function eventPoints(p) {
  const divisor = EVENT_TYPES[p.eventType]?.roomDivisor ?? 60000;
  const base = 120 + p.ownScore / 15000 + (p.multi ? (p.roomScore || 0) / divisor : 0);
  const boosted = Math.ceil(base * (1 + p.earnedBonusPercent / 100) - 1e-9);
  const mult = (1 + p.songLengthPercent / 100) * LIVE_BOOST_MULTIPLIER[Math.max(1, Math.min(10, p.boosts)) - 1] * (p.passport ? 2 : 1);
  const points = Math.ceil(boosted * mult - 1e-6);
  return { base, points, badges: Math.ceil(points / 10 - 1e-9) };
}

/**
 * Auto Live score from the same inputs as computeScoreTimeline: every tap,
 * flick and hold start/end scores 800 (the AUTO judgement), ticks score 100,
 * and there is no combo bonus. Skill timeline as in the Max score (best case).
 */
const AUTO_WEIGHT = { T: 800, F: 800, LS: 800, LE: 800, LFE: 800, LR: 100, LC: 100 };
export function autoScore(timeline, noteDensityEntries, deckPower, liveScoreCoefficientPermil, difficultyLevel, totalChartWeight) {
  const musicCoefficient = 1 + (liveScoreCoefficientPermil / 1000) * (difficultyLevel - 5);
  const baseFactor = totalChartWeight > 0 ? (deckPower * 2.3 * musicCoefficient) / totalChartWeight : 0;
  let total = 0;
  for (const point of timeline) {
    const entry = noteDensityEntries[point.t];
    if (!entry || !entry[0] || !entry[1]) continue;
    const skill = (point.maxBonus || 0) / 100;
    for (const [code, count] of Object.entries(entry[1])) {
      const key = code.endsWith('!') ? code.slice(0, -1) : code;
      const w = AUTO_WEIGHT[key] ?? (NOTE_WEIGHTS_PERFECT_PLUS[key] ? 800 : 0);
      total += Math.ceil(baseFactor * w * (1 + skill) * (1 + SKILL_TREE_BONUS)) * count;
    }
  }
  return total;
}

/** The event running on `today` (YYYY-MM-DD): both dates known and today inside them; latest
 *  start wins if two overlap. Past (and undated) events are never shown. */
export function pickCurrentEvent(eventsData, today) {
  const live = (eventsData?.events || [])
    .filter((e) => e.start && e.end && e.start <= today && today <= e.end)
    .sort((a, b) => b.start.localeCompare(a.start));
  return live[0] || null;
}
