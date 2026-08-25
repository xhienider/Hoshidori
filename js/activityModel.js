// "Character Activity" heuristic - NOT a validated prediction, just a fun
// what-if exercise. Estimates how recently each character has gotten a new
// card and/or song, then produces a combined "saturation score" (higher =
// more recently covered = presumably less due for the next banner/event)
// from three tunable weighted signals:
//   1. Card recency  - proxy via each character's highest Card `order` value
//      (order has no literal release date, but is a monotonically assigned
//      sequence number - cross-checked against the known most-recently-added
//      cards and it tracks them correctly).
//   2. Song recency  - real dates via each character's most recent song's
//      releaseDate, exponentially decayed by a configurable half-life.
//   3. Generation contagion - a character's score is pulled toward the
//      average of their generation-mates' own (personal) scores, modeling
//      "banners/events often batch by generation or sub-unit".
// Weights and half-life are exposed as parameters specifically so this can
// be explored interactively, not presented as calibrated against real data.

const MS_PER_DAY = 86400000;

// Cards with `order` <= this were all part of the game's initial launch
// content, not staggered releases - order only carries genuine recency
// signal ABOVE this threshold. Mirrors the same pattern already handled for
// songs (many share a generic "2022-12-31 At Launch" releaseDate rather than
// individual dates).
export const LAUNCH_ORDER_THRESHOLD = 162;

/** Splits a (possibly compound, e.g. "hololive 1st Generation / Gamers")
 *  generation string into its individual group keys, so dual-affiliation
 *  characters count toward contagion in BOTH of their groups. */
function splitGenerationKeys(generation) {
  return (generation || '').split('/').map((g) => g.trim()).filter(Boolean);
}

/**
 * @param {object[]} members - DATA.members (card entries, each with
 *        characterId, characterName, generation, order)
 * @param {object[]} songs - DATA.songs (each with characterIds, releaseDate)
 * @param {{wCard?:number, wSong?:number, wGen?:number, halfLifeDays?:number, nowMs?:number}} [options]
 *        wCard + wSong should sum to ~1 (they blend the two personal
 *        signals); wGen is a separate 0-1 blend applied on top against the
 *        generation-mate average. Defaults: 0.5 / 0.35(->normalized) / 0.15 / 30 days.
 * @returns {{
 *   characterId:string, name:string, generation:string,
 *   lastCardOrder:number, lastSongDateMs:number|null,
 *   cardRecencyScore:number, songRecencyScore:number,
 *   personalScore:number, genContagion:number, finalScore:number
 * }[]} one entry per unique character, NOT sorted - caller sorts as needed
 */
export function computeCharacterActivityScores(members, songs, options = {}) {
  const wCard = options.wCard ?? 0.5;
  const wSong = options.wSong ?? 0.35;
  const wGen = options.wGen ?? 0.15;
  const halfLifeDays = options.halfLifeDays ?? 30;
  const nowMs = options.nowMs ?? Date.now();

  // --- per-character identity + highest card order ---
  const charInfo = new Map(); // characterId -> {name, generation}
  const lastCardOrder = new Map(); // characterId -> max order seen
  for (const m of members) {
    if (!charInfo.has(m.characterId)) {
      charInfo.set(m.characterId, { name: m.characterName, generation: m.generation });
    }
    if (typeof m.order === 'number') {
      const cur = lastCardOrder.get(m.characterId) ?? 0;
      if (m.order > cur) lastCardOrder.set(m.characterId, m.order);
    }
  }
  const maxOrder = Math.max(1, ...[...lastCardOrder.values()]);

  // --- per-character most recent (already-released) song date ---
  const lastSongDateMs = new Map(); // characterId -> ms timestamp
  for (const s of songs || []) {
    if (!s.releaseDate) continue;
    const t = Date.parse(`${s.releaseDate}T00:00:00Z`);
    if (Number.isNaN(t) || t > nowMs) continue; // skip unparseable or not-yet-released
    for (const cid of s.characterIds || []) {
      if (!charInfo.has(cid)) continue;
      const cur = lastSongDateMs.get(cid);
      if (cur == null || t > cur) lastSongDateMs.set(cid, t);
    }
  }

  // --- personal scores (card + song, no generation effect yet) ---
  const personalScore = new Map();
  const cardRecencyScore = new Map();
  const songRecencyScore = new Map();
  for (const cid of charInfo.keys()) {
    const order = lastCardOrder.get(cid) ?? 0;
    // Only order values past the launch batch carry real recency signal -
    // everything at/below the threshold is treated as tied at "launch"
    // (score 0), same as a character with no post-launch card at all.
    const cardScore =
      order > LAUNCH_ORDER_THRESHOLD && maxOrder > LAUNCH_ORDER_THRESHOLD
        ? (order - LAUNCH_ORDER_THRESHOLD) / (maxOrder - LAUNCH_ORDER_THRESHOLD)
        : 0;
    const songMs = lastSongDateMs.get(cid);
    const daysSince = songMs == null ? Infinity : (nowMs - songMs) / MS_PER_DAY;
    const songScore = Number.isFinite(daysSince) ? Math.pow(0.5, daysSince / halfLifeDays) : 0;
    cardRecencyScore.set(cid, cardScore);
    songRecencyScore.set(cid, songScore);
    personalScore.set(cid, wCard * cardScore + wSong * songScore);
  }

  // --- generation contagion: pull each score toward gen-mates' average ---
  const genMembers = new Map(); // genKey -> Set(characterId)
  const charGenKeys = new Map(); // characterId -> genKey[]
  for (const [cid, info] of charInfo) {
    const keys = splitGenerationKeys(info.generation);
    charGenKeys.set(cid, keys);
    for (const k of keys) {
      if (!genMembers.has(k)) genMembers.set(k, new Set());
      genMembers.get(k).add(cid);
    }
  }

  const results = [];
  for (const [cid, info] of charInfo) {
    const mateScores = [];
    for (const gkey of charGenKeys.get(cid)) {
      for (const mate of genMembers.get(gkey)) {
        if (mate !== cid) mateScores.push(personalScore.get(mate));
      }
    }
    const genContagion = mateScores.length ? mateScores.reduce((a, b) => a + b, 0) / mateScores.length : 0;
    const finalScore = (1 - wGen) * personalScore.get(cid) + wGen * genContagion;

    results.push({
      characterId: cid,
      name: info.name,
      generation: info.generation,
      lastCardOrder: lastCardOrder.get(cid) ?? 0,
      lastSongDateMs: lastSongDateMs.get(cid) ?? null,
      cardRecencyScore: cardRecencyScore.get(cid),
      songRecencyScore: songRecencyScore.get(cid),
      personalScore: personalScore.get(cid),
      genContagion,
      finalScore,
    });
  }

  return results;
}
