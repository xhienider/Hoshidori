/**
 * FAQ calculator math - pure functions, no DOM (UI lives in js/faqPage.js).
 *
 * Answers "is a lower difficulty better if I can't full combo the higher
 * one?" for one song, using the same per-note score law as the engine
 * (unitEngine.computeScoreTimeline):
 *   per-note score  proportional to  musicCoefficient * (1 + comboBonus)
 *   musicCoefficient = 1 + (liveScoreCoefficientPermil / 1000) * (level - 5)
 * The deck's power and the chart's total weight cancel out when two charts
 * of the same song are compared as ratios, so they are not needed here.
 *
 * Simplifications (shown to the player as "Estimate"): every hit note is
 * Perfect+, a combo break is one missed note that scores nothing and resets
 * combo to 0, breaks are spread evenly through the chart, and all notes are
 * weighted equally (per-type chart weights differ by a few percent at most).
 */
import { comboBonusAt } from './unitEngine.js';

/** Song-level score multiplier for a difficulty level. */
export function musicCoefficient(liveScoreCoefficientPermil, level) {
  return 1 + (Number(liveScoreCoefficientPermil) / 1000) * (Number(level) - 5);
}

/** Total combo-earning notes in a note_density perSecond array. */
export function noteCount(perSecond) {
  return (perSecond || []).reduce((sum, e) => sum + (e ? Number(e[0]) || 0 : 0), 0);
}

/**
 * Average per-note multiplier (1 + combo bonus) over a chart of `notes`
 * notes with `breaks` evenly spaced misses, normalized by the chart's own
 * note count so charts of different lengths compare fairly.
 */
export function averageComboFactor(notes, breaks = 0) {
  if (!notes) return 0;
  const missAt = new Set();
  for (let i = 1; i <= breaks; i++) missAt.add(Math.round((i * notes) / (breaks + 1)));
  let combo = 0;
  let sum = 0;
  for (let n = 1; n <= notes; n++) {
    if (missAt.has(n)) {
      combo = 0;
      continue;
    }
    sum += 1 + comboBonusAt(combo);
    combo++;
  }
  return sum / notes;
}

/** Relative score of one chart (song multiplier x average combo factor). */
export function chartFactor(song, density, difficulty, breaks = 0) {
  const level = song?.difficultyLevels?.[difficulty];
  const perSecond = density?.[difficulty]?.perSecond;
  if (level == null || !perSecond) return null;
  const notes = noteCount(perSecond);
  return {
    difficulty,
    level,
    notes,
    factor: musicCoefficient(song.liveScoreCoefficientPermil, level) * averageComboFactor(notes, breaks),
  };
}

/**
 * Compare a full combo on the easier chart against the harder chart with
 * `breaks` combo breaks. Percentages are relative to the easier full combo.
 * @returns {null | {easier, harderFc, harderBroken, harderFcPct, harderBrokenPct, gapPct}}
 */
export function compareDifficulties(song, density, harder, easier, breaks) {
  const easierFc = chartFactor(song, density, easier, 0);
  const harderFc = chartFactor(song, density, harder, 0);
  const harderBroken = chartFactor(song, density, harder, breaks);
  if (!easierFc || !harderFc || !harderBroken || !easierFc.factor) return null;
  const pct = (x) => (x.factor / easierFc.factor) * 100;
  return {
    easier: easierFc,
    harderFc,
    harderBroken,
    harderFcPct: pct(harderFc),
    harderBrokenPct: pct(harderBroken),
    gapPct: pct(harderBroken) - 100,
  };
}
