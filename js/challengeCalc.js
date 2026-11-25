// Challenge Live (the 100-floor "Live Stage" tower) - pure math, no DOM.
// Used by js/challengePage.js; data from data/live_tower.json (tools/extract_live_tower.py).
//
// What's known (PROJECT_STATUS "Challenge Live Stage"):
// - A floor is cleared by reaching its Target Score (clearScore) on ANY one of its songs, at any
//   difficulty the player chooses.
// - Bonus Members: +bonusPermil per bonus holomem among the 5 unit members; the leader does not
//   count; several bonus holomems stack (user, confirmed 2026-11-25). Stacking is taken as
//   ADDITIVE (+10% and +10% = x1.20) like event bonuses - an assumption.
// - The bonus is treated as a flat multiplier on the live score (user's call, 2026-11-25, not yet
//   checked against a results screen). In-game it shows as "+value" under the Unit Score.
// - S/A/B: the floor's unit rating compares the Unit Score (+ bonus value) with the floor's
//   thresholds. The "+value" is assumed to be ceil(Unit Score x bonus) - unverified.

export const STORAGE_KEY = 'hoshidori_challenge_v1';

export const DIFFICULTIES = ['easy', 'normal', 'hard', 'expert'];

/** Bonus holomems of `floor` present among the unit members' characterIds (leader excluded by
 *  the caller), each counted once even if two cards of one holomem were possible. */
export function bonusHolomemsIn(floor, unitCharacterIds) {
  const unit = new Set(unitCharacterIds);
  return floor.bonusCharacterIds.filter((id) => unit.has(id));
}

/** Total bonus (permil) for the unit on `floor`: additive per bonus holomem. */
export function floorBonusPermil(floor, unitCharacterIds) {
  return bonusHolomemsIn(floor, unitCharacterIds).length * floor.bonusPermil;
}

/** Score with the floor bonus applied (flat multiplier assumption). */
export function withBonus(score, bonusPermil) {
  if (score == null) return null;
  return Math.ceil((score * (1000 + bonusPermil)) / 1000);
}

/** The floor's unit rating for a (bonus-included) Unit Score: 'S' | 'A' | 'B' | '-' (below B). */
export function gradeFor(unitScore, thresholds) {
  if (unitScore == null) return null;
  if (unitScore >= thresholds.S) return 'S';
  if (unitScore >= thresholds.A) return 'A';
  if (unitScore >= thresholds.B) return 'B';
  return '-';
}

/**
 * Expected skill bonus for one second of simulateActiveTimeline() output. Each member whose
 * window is scheduled this second is on with probability activationChance (percent, already
 * including special-window Activation Rate add-ons) and the strongest one that's on wins, so
 *   E[max] = sum over members by bonus (high -> low) of b_i * p_i * prod_{j before i}(1 - p_j).
 * Score is linear in (1 + skill bonus) per second, so this gives the exact expected score under
 * the timeline's schedule (a failed roll is assumed not to shift the cooldown cycle).
 */
export function expectedSecondBonus(perMember) {
  const on = perMember
    .filter((m) => m.active && m.effectiveBonus > 0)
    .map((m) => ({ b: m.effectiveBonus, p: Math.min(1, Math.max(0, (m.activationChance ?? 0) / 100)) }))
    .sort((a, b) => b.b - a.b);
  let expected = 0;
  let noneHigher = 1;
  for (const { b, p } of on) {
    expected += b * p * noneHigher;
    noneHigher *= 1 - p;
  }
  return expected;
}

/** Copy of a timeline with maxBonus replaced by its expected value (for computeScoreTimeline /
 *  autoScore, which only read point.t, point.maxBonus and point.perMember). */
export function expectedTimeline(timeline) {
  return timeline.map((p) => ({ ...p, maxBonus: expectedSecondBonus(p.perMember) }));
}

/** Verdict tiers, best first. */
export const VERDICTS = {
  auto: { rank: 0, label: 'Clears on Auto', short: 'Auto' },
  fc: { rank: 1, label: 'Clears with a full combo', short: 'FC' },
  lucky: { rank: 2, label: 'Needs lucky skills', short: 'Luck' },
  no: { rank: 3, label: 'Out of reach', short: 'No' },
};

/**
 * Verdict for one song x difficulty option. `scores` = {auto, fc, max}: Auto with expected skills,
 * all-Perfect+ full combo with expected skills, and the full combo with every skill firing (the
 * Builder's Max). All before the floor bonus; `bonusPermil` is applied here.
 * Returns {key, score (the score the verdict rests on, with bonus), margin (vs target, fraction)}.
 */
export function optionVerdict(scores, bonusPermil, target) {
  const auto = withBonus(scores.auto, bonusPermil);
  const fc = withBonus(scores.fc, bonusPermil);
  const max = withBonus(scores.max, bonusPermil);
  let key = 'no';
  let score = max;
  if (auto >= target) [key, score] = ['auto', auto];
  else if (fc >= target) [key, score] = ['fc', fc];
  else if (max >= target) [key, score] = ['lucky', max];
  return { key, score, auto, fc, max, margin: target ? score / target - 1 : 0 };
}

/**
 * Best option for a floor among `options` = [{songId, difficulty, level, scores}]. Best verdict
 * tier first. Within the Auto tier the biggest margin wins (difficulty costs nothing on Auto);
 * within FC / Luck the EASIEST chart that reaches the tier wins (a full combo is easier there),
 * then the bigger margin. Returns null if no option has scores yet.
 */
export function bestOption(options, bonusPermil, target) {
  let best = null;
  for (const o of options) {
    if (!o.scores) continue;
    const v = optionVerdict(o.scores, bonusPermil, target);
    const cand = { ...o, verdict: v };
    if (!best || better(cand, best)) best = cand;
  }
  return best;
}

function better(a, b) {
  const ra = VERDICTS[a.verdict.key].rank;
  const rb = VERDICTS[b.verdict.key].rank;
  if (ra !== rb) return ra < rb;
  if (a.verdict.key === 'fc' || a.verdict.key === 'lucky') {
    if (a.level !== b.level) return a.level < b.level;
  }
  return a.verdict.margin > b.verdict.margin;
}

/** Index of the first floor (in `floors` order) whose verdict is worse than `key` (default:
 *  anything not clearable at all), or -1. `verdictByFloor` maps floor number -> verdict key. */
export function firstFloorWorseThan(floors, verdictByFloor, key = 'lucky') {
  const limit = VERDICTS[key].rank;
  return floors.findIndex((f) => verdictByFloor[f.number] && VERDICTS[verdictByFloor[f.number]].rank > limit);
}

// ---- saved page settings -------------------------------------------------------------------

export const DEFAULT_SETTINGS = { yellow: 'board', cleared: 0, filter: 'all' };

export function normalizeSettings(raw) {
  const s = { ...DEFAULT_SETTINGS, ...(raw && typeof raw === 'object' ? raw : {}) };
  if (!['board', 'max'].includes(s.yellow)) s.yellow = 'board';
  s.cleared = Math.max(0, Math.min(1000, Math.floor(Number(s.cleared) || 0)));
  if (!['all', 'open'].includes(s.filter)) s.filter = 'all';
  return s;
}
