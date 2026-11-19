/**
 * Holomem Rank calculator - pure functions, no DOM. Used by js/rankPage.js.
 *
 * Data: data/rank_achievements.json (tools/extract_rank_achievements.py).
 *   - rankCurve    = [{ rank, exp }], exp = CUMULATIVE total EXP for that rank
 *                    (Rank 1 = 0, Rank 50 = 196). Read as cumulative from data
 *                    consistency - not yet screenshot-verified.
 *   - achievements = the 25 per-holomem achievements, same for every holomem:
 *                    { key, label ("{0}" = threshold), category, tiers: [{ threshold, exp }],
 *                      auto?: 'unlock' | 'rank', capReason? }
 *   - characters[characterId] = { name, groups, ownSong: { musicId, title },
 *                    caps: { key: highest threshold today's game content allows } }
 *
 * Rank EXP only comes from these achievements (MissionProgress
 * .rewardCharacterExpQuantity); nothing else in the datamine grants it.
 *
 * A player's record (localStorage[STORAGE_KEY]) stores, per holomem, how many
 * tiers of each achievement are done: { version, chars: { characterId: { key: tiersDone } } }.
 * The two `auto` achievements are never stored:
 *   - 'unlock' ("Unlock a holomem") is always done - you're rating a holomem you own.
 *   - 'rank'   ("Reach Holomem Rank 10/20/30") is derived from the rank the other
 *     EXP reaches; its own EXP can push the rank further, so it's iterated to a
 *     fixed point (monotonic, settles in at most 3 steps).
 */

export const STORAGE_KEY = 'hoshidori_rank_v1';
export const RECORD_VERSION = 1;

/** Sum of the EXP of the first `done` tiers. */
export function tierExp(achievement, done) {
  let exp = 0;
  for (let i = 0; i < Math.min(done, achievement.tiers.length); i++) exp += achievement.tiers[i].exp;
  return exp;
}

/** Highest total EXP an achievement can give. */
export const achievementMaxExp = (achievement) => tierExp(achievement, achievement.tiers.length);

/** How many tiers of an achievement the current game content allows for a holomem
 *  (all of them when the achievement has no content cap). */
export function possibleTiers(achievement, character) {
  const cap = character?.caps?.[achievement.key];
  if (cap === undefined || cap === null) return achievement.tiers.length;
  return achievement.tiers.filter((t) => t.threshold <= cap).length;
}

/** Rank reached with `exp` total EXP, plus progress toward the next rank. */
export function rankForExp(rankCurve, exp) {
  let i = 0;
  while (i + 1 < rankCurve.length && rankCurve[i + 1].exp <= exp) i++;
  const cur = rankCurve[i];
  const next = rankCurve[i + 1] || null;
  return {
    rank: cur.rank,
    exp,
    rankExp: cur.exp,
    nextRank: next ? next.rank : null,
    nextExp: next ? next.exp : null,
    toNext: next ? next.exp - exp : 0,
    progress: next ? (exp - cur.exp) / (next.exp - cur.exp) : 1,
    maxRank: rankCurve[rankCurve.length - 1].rank,
  };
}

/** Clamp a stored tier count to a valid integer for that achievement. */
function clampDone(achievement, value) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, achievement.tiers.length);
}

/** Tier counts for one holomem: stored manual tiers + derived auto tiers.
 *  `selections` = the record's chars[characterId] (may be undefined). */
export function computeCharacter(data, selections) {
  const done = {};
  let manualExp = 0;
  for (const a of data.achievements) {
    if (a.auto) continue;
    done[a.key] = clampDone(a, selections?.[a.key]);
    manualExp += tierExp(a, done[a.key]);
  }
  let autoExp = 0;
  for (const a of data.achievements) {
    if (a.auto === 'unlock') {
      done[a.key] = a.tiers.length;
      autoExp += tierExp(a, done[a.key]);
    }
  }
  const rankAch = data.achievements.find((a) => a.auto === 'rank');
  if (rankAch) {
    let n = 0;
    for (;;) {
      const rank = rankForExp(data.rankCurve, manualExp + autoExp + tierExp(rankAch, n)).rank;
      const reached = rankAch.tiers.filter((t) => t.threshold <= rank).length;
      if (reached <= n) break;
      n = reached;
    }
    done[rankAch.key] = n;
    autoExp += tierExp(rankAch, n);
  }
  const totalExp = manualExp + autoExp;
  return { done, totalExp, ...rankForExp(data.rankCurve, totalExp) };
}

/** Selections for one holomem with every achievement at `mode`:
 *  'possible' = as far as today's content allows, 'all' = every tier. */
export function fillSelections(data, characterId, mode) {
  const character = data.characters[characterId];
  const out = {};
  for (const a of data.achievements) {
    if (a.auto) continue;
    out[a.key] = mode === 'all' ? a.tiers.length : possibleTiers(a, character);
  }
  return out;
}

/** Best result for a holomem: everything today's content allows, and every tier. */
export function characterCeilings(data, characterId) {
  return {
    possible: computeCharacter(data, fillSelections(data, characterId, 'possible')),
    all: computeCharacter(data, fillSelections(data, characterId, 'all')),
  };
}

/** Tier count reached by a raw in-game progress value (e.g. 237 Lives -> 9 tiers). */
export function tiersForProgress(achievement, value) {
  const v = Number(value);
  if (!Number.isFinite(v)) return 0;
  return achievement.tiers.filter((t) => t.threshold <= v).length;
}

/** Validated record; drops unknown holomems/achievements and empty entries. */
export function normalizeRecord(raw, data) {
  const chars = {};
  const src = raw && typeof raw === 'object' && raw.chars && typeof raw.chars === 'object' ? raw.chars : {};
  for (const [characterId, sel] of Object.entries(src)) {
    if (!data.characters[characterId] || !sel || typeof sel !== 'object') continue;
    const clean = {};
    for (const a of data.achievements) {
      if (a.auto) continue;
      const n = clampDone(a, sel[a.key]);
      if (n) clean[a.key] = n;
    }
    if (Object.keys(clean).length) chars[characterId] = clean;
  }
  return { version: RECORD_VERSION, chars, updatedAt: raw?.updatedAt || null };
}

/** Sets one achievement's tier count in a record (removing empty entries). Mutates. */
export function setTiers(record, data, characterId, key, done) {
  const a = data.achievements.find((x) => x.key === key);
  if (!a || a.auto || !data.characters[characterId]) return record;
  const sel = (record.chars[characterId] ||= {});
  const n = clampDone(a, done);
  if (n) sel[key] = n;
  else delete sel[key];
  if (!Object.keys(sel).length) delete record.chars[characterId];
  return record;
}

/** Fills in the threshold for display: "Unlock {0} Holomem Boards." -> "Unlock 140 Holomem Boards." */
export function achievementLabel(achievement, character, value = 'N') {
  let label = achievement.label;
  if (achievement.key === 'own_song' && character?.ownSong?.title) {
    label = label.replace('their own song', `“${character.ownSong.title}”`);
  }
  const text = typeof value === 'number' ? value.toLocaleString('en-US') : value;
  return label.replace('{0}', text);
}
