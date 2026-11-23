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
import { comboBonusAt, NOTE_WEIGHTS_PERFECT_PLUS } from './unitEngine.js';

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

/** Typical special skill window used for the activation-point table (5★ specials last 9–14 s). */
export const SPECIAL_WINDOW_SECONDS = 12;

/**
 * For each of a song's special skill activation points (music.json
 * `feverSeconds`): the combo when it fires (assuming a clean full combo up to
 * then), the notes inside a SPECIAL_WINDOW_SECONDS window, and the window's
 * relative value = sum over those notes of (1 + combo bonus). A special only
 * boosts the active skill that is on, so `value` is how much a special placed
 * there can earn relative to the other points, not an absolute score.
 * @returns {null | {points: {index, t, combo, notes, value, pctOfBest}[], best: number, worst: number}}
 */
export function activationPointProfile(song, density, difficulty, windowSeconds = SPECIAL_WINDOW_SECONDS) {
  const perSecond = density?.[difficulty]?.perSecond;
  const times = song?.feverSeconds;
  if (!perSecond || !times?.length) return null;
  const counts = perSecond.map((e) => (e ? Number(e[0]) || 0 : 0));
  const before = [0];
  for (const c of counts) before.push(before[before.length - 1] + c);
  const points = times.map((t, index) => {
    const start = Math.max(0, Math.floor(t));
    const end = Math.min(counts.length, start + windowSeconds);
    const combo = before[Math.min(start, counts.length)];
    let c = combo;
    let notes = 0;
    let value = 0;
    for (let s = start; s < end; s++) {
      for (let k = 0; k < counts[s]; k++) {
        value += 1 + comboBonusAt(c);
        c++;
        notes++;
      }
    }
    return { index: index + 1, t: Number(t), combo, notes, value };
  });
  const maxValue = Math.max(...points.map((p) => p.value)) || 1;
  for (const p of points) p.pctOfBest = (p.value / maxValue) * 100;
  const order = [...points].sort((a, b) => b.value - a.value);
  return { points, best: order[0].index, worst: order[order.length - 1].index };
}

// ---------------------------------------------------------------------------
// Break map: combo breaks (and Greats) placed in a chart, with real note weights
// ---------------------------------------------------------------------------
/** LiveNote.json: GREAT scores 800 permil of PERFECT (PERFECT and PERFECT_PLUS
 *  score the same). Only taps (T) and long starts (LS) have a GREAT row; flicks
 *  and long ends/relays/continuations are PERFECT or miss. A Great keeps the
 *  combo going (confirmed in-game by the user, 2026-11-23). */
export const GREAT_SCORE_RATIO = 0.8;
const GREAT_ELIGIBLE = new Set(['T', 'LS']);

/** Per-second note counts for one chart, or null. */
export function perSecondCounts(density, difficulty) {
  const perSecond = density?.[difficulty]?.perSecond;
  return perSecond ? perSecond.map((e) => (e ? Number(e[0]) || 0 : 0)) : null;
}

/**
 * The chart as a flat list of combo-earning notes in time order (within a
 * second, by type code order - the data has no finer timing): each with its
 * PERFECT weight, whether it can be judged Great, and its second.
 */
export function chartNotes(density, difficulty) {
  const perSecond = density?.[difficulty]?.perSecond;
  if (!perSecond) return null;
  const notes = [];
  const firstIndexOfSecond = [];
  perSecond.forEach((e, second) => {
    firstIndexOfSecond.push(notes.length);
    if (!e || !e[0]) return;
    const codes = e[1] || {};
    for (const code of Object.keys(codes).sort()) {
      const type = code.replace(/!$/, '');
      const weight = NOTE_WEIGHTS_PERFECT_PLUS[type] ?? 1000;
      for (let k = 0; k < codes[code]; k++) notes.push({ weight, eligible: GREAT_ELIGIBLE.has(type), second });
    }
  });
  firstIndexOfSecond.push(notes.length);
  return { notes, firstIndexOfSecond, eligibleCount: notes.filter((n) => n.eligible).length };
}

/**
 * Note indices hit by breaks placed at given seconds: the middle note(s) of
 * that second; several breaks in one second take consecutive notes there.
 */
export function breakNoteIndices(chart, breakSeconds) {
  const perSec = new Map();
  for (const s of breakSeconds) perSec.set(s, (perSec.get(s) || 0) + 1);
  const out = new Set();
  for (const [s, k] of perSec) {
    const start = chart.firstIndexOfSecond[s];
    const n = (chart.firstIndexOfSecond[s + 1] ?? start) - start;
    if (!n) continue;
    const take = Math.min(k, n);
    const first = start + Math.max(0, Math.floor((n - take) / 2));
    for (let i = 0; i < take; i++) out.add(first + i);
  }
  return out;
}

/** Indices of `greats` Great-eligible notes spread evenly through the chart. */
function greatNoteIndices(chart, greats) {
  const out = new Set();
  const g = Math.max(0, Math.min(Math.round(greats), chart.eligibleCount));
  if (!g) return out;
  const eligible = [];
  chart.notes.forEach((n, i) => n.eligible && eligible.push(i));
  for (let k = 0; k < g; k++) out.add(eligible[Math.floor(((k + 0.5) * eligible.length) / g)]);
  return out;
}

/** Weighted average of judgement x (1 + combo bonus) over the chart. */
function weightedFactor(chart, missAt, greatAt) {
  let combo = 0;
  let sum = 0;
  let total = 0;
  chart.notes.forEach((n, i) => {
    total += n.weight;
    if (missAt.has(i)) {
      combo = 0;
      return;
    }
    const judgement = greatAt.has(i) ? GREAT_SCORE_RATIO : 1;
    sum += n.weight * judgement * (1 + comboBonusAt(combo));
    combo++;
  });
  return total ? sum / total : 0;
}

/** Relative score of a chart with breaks at given seconds and `greats` Greats. */
export function chartFactorAt(song, density, difficulty, breakSeconds = [], greats = 0) {
  const level = song?.difficultyLevels?.[difficulty];
  const chart = chartNotes(density, difficulty);
  if (level == null || !chart) return null;
  const missAt = breakNoteIndices(chart, breakSeconds);
  const greatAt = greatNoteIndices(chart, greats);
  for (const i of missAt) greatAt.delete(i);
  return {
    difficulty,
    level,
    notes: chart.notes.length,
    eligibleForGreat: chart.eligibleCount,
    breaksPlaced: missAt.size,
    greatsPlaced: greatAt.size,
    factor: musicCoefficient(song.liveScoreCoefficientPermil, level) * weightedFactor(chart, missAt, greatAt),
  };
}

/**
 * Cost (% of that chart's full-combo score) of ONE break at each second,
 * assuming no other breaks. null for seconds with no notes.
 */
export function singleBreakCostCurve(density, difficulty) {
  const chart = chartNotes(density, difficulty);
  if (!chart) return null;
  const none = new Set();
  const fc = weightedFactor(chart, none, none);
  const seconds = chart.firstIndexOfSecond.length - 1;
  const out = [];
  for (let s = 0; s < seconds; s++) {
    if (chart.firstIndexOfSecond[s + 1] === chart.firstIndexOfSecond[s]) {
      out.push(null);
      continue;
    }
    out.push(((fc - weightedFactor(chart, breakNoteIndices(chart, [s]), none)) / fc) * 100);
  }
  return out;
}

/**
 * The densest stretches of a chart ("danger zones"): up to `max`
 * non-overlapping windows of `width` seconds with the most notes, returned as
 * {start, end, peak, notes} sorted by time; `peak` is the busiest second.
 */
export function dangerZones(counts, { width = 4, max = 4 } = {}) {
  if (!counts?.length) return [];
  const sums = [];
  for (let s = 0; s + width <= counts.length; s++) {
    let t = 0;
    for (let k = 0; k < width; k++) t += counts[s + k];
    sums.push({ start: s, notes: t });
  }
  sums.sort((a, b) => b.notes - a.notes);
  const zones = [];
  for (const w of sums) {
    if (zones.length >= max) break;
    if (zones.some((z) => w.start < z.end + 2 && w.start + width > z.start - 2)) continue;
    let peak = w.start;
    for (let k = 1; k < width; k++) if (counts[w.start + k] > counts[peak]) peak = w.start + k;
    zones.push({ start: w.start, end: w.start + width, peak, notes: w.notes });
  }
  return zones.sort((a, b) => a.start - b.start);
}

/**
 * Harder chart with breaks at real moments vs a full combo on the easier
 * chart. Percentages are relative to the easier full combo.
 */
export function compareWithBreakMap(song, density, harder, easier, breakSeconds, greatsHarder = 0, greatsEasier = 0) {
  const easierBase = chartFactorAt(song, density, easier, [], greatsEasier);
  const harderFc = chartFactorAt(song, density, harder, [], 0);
  const harderBroken = chartFactorAt(song, density, harder, breakSeconds, greatsHarder);
  if (!easierBase || !harderFc || !harderBroken || !easierBase.factor) return null;
  const pct = (x) => (x.factor / easierBase.factor) * 100;
  return {
    easier: easierBase,
    harderFc,
    harderBroken,
    harderFcPct: pct(harderFc),
    harderBrokenPct: pct(harderBroken),
    gapPct: pct(harderBroken) - 100,
    lossPct: ((harderFc.factor - harderBroken.factor) / harderFc.factor) * 100,
  };
}
