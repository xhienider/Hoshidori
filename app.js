import { resolveMemberStats, getStatRoles, getSkillLevel, SKILL_LEVEL_TYPES } from './js/statEngine.js';
import { evaluateLeaderCondition, resolveEffectRecipients } from './js/skillEngine.js';
import {
  computeUnit,
  mapSpecialSkillsToSong,
  computeOverallPowerBreakdown,
  computeScoreSupport,
  simulateActiveTimeline,
  computeBoardBonuses,
  applyBoardBonuses,
  mergeScoreSupport,
  computeConnectBonuses,
  getConnectorInfo,
  mergeBoardBonuses,
  buildBoardIndex,
  boardPointsSpentFromSet,
  canUnlock,
  pruneDisconnected,
  findUnlockPath,
  findOptimalFrequencyNodes,
  planFrequencyNodeUnlock,
} from './js/unitEngine.js';
import { computeCharacterActivityScores, LAUNCH_ORDER_THRESHOLD } from './js/activityModel.js';

const COST_CALC_DATA = {"expTables": {"rarity_3": {"1": 0, "2": 40, "3": 100, "4": 190, "5": 310, "6": 460, "7": 650, "8": 880, "9": 1160, "10": 1500, "11": 1900, "12": 2400, "13": 3000, "14": 3700, "15": 4550, "16": 5550, "17": 6700, "18": 8050, "19": 9600, "20": 11400, "21": 13500, "22": 15900, "23": 18600, "24": 21600, "25": 24900, "26": 28550, "27": 32550, "28": 36900, "29": 41600, "30": 46650, "31": 52050, "32": 57850, "33": 64050, "34": 70650, "35": 77650, "36": 85050, "37": 92850, "38": 101050, "39": 109650, "40": 118650, "41": 128150, "42": 138150, "43": 148650, "44": 159650, "45": 171150, "46": 183150, "47": 195650, "48": 208650, "49": 222150, "50": 236150, "51": 250650, "52": 265650, "53": 281150, "54": 297150, "55": 313650, "56": 330650, "57": 348150, "58": 366150, "59": 384650, "60": 404150}, "rarity_4": {"1": 0, "2": 40, "3": 100, "4": 190, "5": 310, "6": 460, "7": 650, "8": 880, "9": 1160, "10": 1500, "11": 1900, "12": 2400, "13": 3000, "14": 3700, "15": 4550, "16": 5550, "17": 6700, "18": 8050, "19": 9600, "20": 11400, "21": 13500, "22": 15900, "23": 18600, "24": 21600, "25": 24900, "26": 28550, "27": 32550, "28": 36900, "29": 41600, "30": 46650, "31": 52050, "32": 57850, "33": 64050, "34": 70650, "35": 77650, "36": 85050, "37": 92850, "38": 101050, "39": 109650, "40": 118650, "41": 128150, "42": 138150, "43": 148650, "44": 159650, "45": 171150, "46": 183150, "47": 195650, "48": 208650, "49": 222150, "50": 236150, "51": 250650, "52": 265650, "53": 281150, "54": 297150, "55": 313650, "56": 330650, "57": 348150, "58": 366150, "59": 384650, "60": 404150, "61": 424650, "62": 446150, "63": 468650, "64": 492150, "65": 516650, "66": 542650, "67": 570150, "68": 599150, "69": 629650, "70": 661650}, "rarity_5": {"1": 0, "2": 40, "3": 100, "4": 190, "5": 310, "6": 460, "7": 650, "8": 880, "9": 1160, "10": 1500, "11": 1900, "12": 2400, "13": 3000, "14": 3700, "15": 4550, "16": 5550, "17": 6700, "18": 8050, "19": 9600, "20": 11400, "21": 13500, "22": 15900, "23": 18600, "24": 21600, "25": 24900, "26": 28550, "27": 32550, "28": 36900, "29": 41600, "30": 46650, "31": 52050, "32": 57850, "33": 64050, "34": 70650, "35": 77650, "36": 85050, "37": 92850, "38": 101050, "39": 109650, "40": 118650, "41": 128150, "42": 138150, "43": 148650, "44": 159650, "45": 171150, "46": 183150, "47": 195650, "48": 208650, "49": 222150, "50": 236150, "51": 250650, "52": 265650, "53": 281150, "54": 297150, "55": 313650, "56": 330650, "57": 348150, "58": 366150, "59": 384650, "60": 404150, "61": 424650, "62": 446150, "63": 468650, "64": 492150, "65": 516650, "66": 542650, "67": 570150, "68": 599150, "69": 629650, "70": 661650, "71": 695650, "72": 731650, "73": 769650, "74": 810150, "75": 853150, "76": 899150, "77": 948650, "78": 1001650, "79": 1059650, "80": 1122650}}, "spTraining": {"rarity_3_attribute_1": [{"newCap": 30, "materials": [{"name": "Cute Beads", "qty": 100}, {"name": "Hologold", "qty": 20000}]}, {"newCap": 40, "materials": [{"name": "Cute Beads", "qty": 200}, {"name": "Hologold", "qty": 60000}]}, {"newCap": 50, "materials": [{"name": "Cute Beads", "qty": 400}, {"name": "Cute Crystals", "qty": 100}, {"name": "Hologold", "qty": 120000}]}, {"newCap": 60, "materials": [{"name": "Cute Beads", "qty": 600}, {"name": "Cute Crystals", "qty": 200}, {"name": "Hologold", "qty": 200000}]}], "rarity_3_attribute_2": [{"newCap": 30, "materials": [{"name": "Pure Beads", "qty": 100}, {"name": "Hologold", "qty": 20000}]}, {"newCap": 40, "materials": [{"name": "Pure Beads", "qty": 200}, {"name": "Hologold", "qty": 60000}]}, {"newCap": 50, "materials": [{"name": "Pure Beads", "qty": 400}, {"name": "Pure Crystals", "qty": 100}, {"name": "Hologold", "qty": 120000}]}, {"newCap": 60, "materials": [{"name": "Pure Beads", "qty": 600}, {"name": "Pure Crystals", "qty": 200}, {"name": "Hologold", "qty": 200000}]}], "rarity_3_attribute_3": [{"newCap": 30, "materials": [{"name": "Happy Beads", "qty": 100}, {"name": "Hologold", "qty": 20000}]}, {"newCap": 40, "materials": [{"name": "Happy Beads", "qty": 200}, {"name": "Hologold", "qty": 60000}]}, {"newCap": 50, "materials": [{"name": "Happy Beads", "qty": 400}, {"name": "Happy Crystals", "qty": 100}, {"name": "Hologold", "qty": 120000}]}, {"newCap": 60, "materials": [{"name": "Happy Beads", "qty": 600}, {"name": "Happy Crystals", "qty": 200}, {"name": "Hologold", "qty": 200000}]}], "rarity_4_attribute_1": [{"newCap": 40, "materials": [{"name": "Cute Beads", "qty": 200}, {"name": "Hologold", "qty": 35000}]}, {"newCap": 50, "materials": [{"name": "Cute Beads", "qty": 400}, {"name": "Cute Crystals", "qty": 100}, {"name": "Hologold", "qty": 105000}]}, {"newCap": 60, "materials": [{"name": "Cute Beads", "qty": 600}, {"name": "Cute Crystals", "qty": 200}, {"name": "Hologold", "qty": 210000}]}, {"newCap": 70, "materials": [{"name": "Cute Beads", "qty": 800}, {"name": "Cute Crystals", "qty": 400}, {"name": "Hololium", "qty": 1}, {"name": "Hologold", "qty": 350000}]}], "rarity_4_attribute_2": [{"newCap": 40, "materials": [{"name": "Pure Beads", "qty": 200}, {"name": "Hologold", "qty": 35000}]}, {"newCap": 50, "materials": [{"name": "Pure Beads", "qty": 400}, {"name": "Pure Crystals", "qty": 100}, {"name": "Hologold", "qty": 105000}]}, {"newCap": 60, "materials": [{"name": "Pure Beads", "qty": 600}, {"name": "Pure Crystals", "qty": 200}, {"name": "Hologold", "qty": 210000}]}, {"newCap": 70, "materials": [{"name": "Pure Beads", "qty": 800}, {"name": "Pure Crystals", "qty": 400}, {"name": "Hololium", "qty": 1}, {"name": "Hologold", "qty": 350000}]}], "rarity_4_attribute_3": [{"newCap": 40, "materials": [{"name": "Happy Beads", "qty": 200}, {"name": "Hologold", "qty": 35000}]}, {"newCap": 50, "materials": [{"name": "Happy Beads", "qty": 400}, {"name": "Happy Crystals", "qty": 100}, {"name": "Hologold", "qty": 105000}]}, {"newCap": 60, "materials": [{"name": "Happy Beads", "qty": 600}, {"name": "Happy Crystals", "qty": 200}, {"name": "Hologold", "qty": 210000}]}, {"newCap": 70, "materials": [{"name": "Happy Beads", "qty": 800}, {"name": "Happy Crystals", "qty": 400}, {"name": "Hololium", "qty": 1}, {"name": "Hologold", "qty": 350000}]}], "rarity_5_attribute_1": [{"newCap": 50, "materials": [{"name": "Cute Beads", "qty": 300}, {"name": "Hologold", "qty": 75000}]}, {"newCap": 60, "materials": [{"name": "Cute Beads", "qty": 600}, {"name": "Cute Crystals", "qty": 150}, {"name": "Hologold", "qty": 225000}]}, {"newCap": 70, "materials": [{"name": "Cute Crystals", "qty": 600}, {"name": "Hololium", "qty": 1}, {"name": "Hologold", "qty": 450000}]}, {"newCap": 80, "materials": [{"name": "Cute Crystals", "qty": 1200}, {"name": "Hololium", "qty": 3}, {"name": "Hologold", "qty": 750000}]}], "rarity_5_attribute_2": [{"newCap": 50, "materials": [{"name": "Pure Beads", "qty": 300}, {"name": "Hologold", "qty": 75000}]}, {"newCap": 60, "materials": [{"name": "Pure Beads", "qty": 600}, {"name": "Pure Crystals", "qty": 150}, {"name": "Hologold", "qty": 225000}]}, {"newCap": 70, "materials": [{"name": "Pure Crystals", "qty": 600}, {"name": "Hololium", "qty": 1}, {"name": "Hologold", "qty": 450000}]}, {"newCap": 80, "materials": [{"name": "Pure Crystals", "qty": 1200}, {"name": "Hololium", "qty": 3}, {"name": "Hologold", "qty": 750000}]}], "rarity_5_attribute_3": [{"newCap": 50, "materials": [{"name": "Happy Beads", "qty": 300}, {"name": "Hologold", "qty": 75000}]}, {"newCap": 60, "materials": [{"name": "Happy Beads", "qty": 600}, {"name": "Happy Crystals", "qty": 150}, {"name": "Hologold", "qty": 225000}]}, {"newCap": 70, "materials": [{"name": "Happy Crystals", "qty": 600}, {"name": "Hololium", "qty": 1}, {"name": "Hologold", "qty": 450000}]}, {"newCap": 80, "materials": [{"name": "Happy Crystals", "qty": 1200}, {"name": "Hololium", "qty": 3}, {"name": "Hologold", "qty": 750000}]}]}};

const ATTR_LABELS = {
  CardAttributeType_CARD_ATTRIBUTE_TYPE_ATTRIBUTE_1: { label: 'Cute', cls: 'attr-cute' },
  CardAttributeType_CARD_ATTRIBUTE_TYPE_ATTRIBUTE_2: { label: 'Pure', cls: 'attr-pure' },
  CardAttributeType_CARD_ATTRIBUTE_TYPE_ATTRIBUTE_3: { label: 'Happy', cls: 'attr-happy' },
};

const EFFECT_LABELS = {
  LivePassiveSkillEffectType_LIVE_PASSIVE_SKILL_EFFECT_TYPE_ALL_PARAMETER_UP_PERMIL_UP: 'All Parameters Up',
  LivePassiveSkillEffectType_LIVE_PASSIVE_SKILL_EFFECT_TYPE_PERFORMANCE_UP_PERMIL_UP: 'Performance Up',
  LivePassiveSkillEffectType_LIVE_PASSIVE_SKILL_EFFECT_TYPE_TECHNIQUE_UP_PERMIL_UP: 'Technique Up',
  LivePassiveSkillEffectType_LIVE_PASSIVE_SKILL_EFFECT_TYPE_SENSE_UP_PERMIL_UP: 'Sense Up',
  LivePassiveSkillEffectType_LIVE_PASSIVE_SKILL_EFFECT_TYPE_LIVE_ACTIVE_SKILL_EFFECT_UP_PERMIL_UP: 'Score Support',
  LiveActiveSkillEffectType_LIVE_ACTIVE_SKILL_EFFECT_TYPE_SCORE_UP_PERMIL_UP: 'Score Up',
  LiveActiveSkillEffectType_LIVE_ACTIVE_SKILL_EFFECT_TYPE_SCORE_UP_EFFECT_UP_PERMIL_UP: 'Score Effect Up',
  LiveActiveSkillEffectType_LIVE_ACTIVE_SKILL_EFFECT_TYPE_LIVE_ACTIVE_SKILL_ACTIVATION_PROBABILITY_UP_PERMIL_UP: 'Activation Rate Up',
  LiveActiveSkillEffectType_LIVE_ACTIVE_SKILL_EFFECT_TYPE_LIFE_RECOVERY: 'Life Recovery',
  LiveActiveSkillEffectType_LIVE_ACTIVE_SKILL_EFFECT_TYPE_JUDGEMENT_ENHANCE: 'Judgement Enhance',
};

const AREA_ICON = { leader: '\ud83d\udd34', member: '\ud83d\udd35', center: '\ud83c\udfaf' };

/** Builds a small SVG grid icon previewing a connect effect's relative node pattern,
 *  mimicking the in-game "N Node Effect" preview graphic. */
function buildPatternIcon(pattern, colorVar) {
  if (!pattern?.length) return '';
  const norm = pattern.map((p) => ({ x: p.x || 0, y: p.y || 0 }));
  const xs = norm.map((p) => p.x).concat(0);
  const ys = norm.map((p) => p.y).concat(0);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const cell = 7;
  const gap = 1;
  const cols = maxX - minX + 1;
  const rows = maxY - minY + 1;
  const size = cell + gap;
  const width = cols * size + gap;
  const height = rows * size + gap;
  const cellX = (x) => gap + (x - minX) * size;
  // grid Y increases downward on screen; board "up" (+Y) should render toward the top
  const cellY = (y) => gap + (maxY - y) * size;

  let svg = `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" class="pattern-icon">`;
  for (let gx = minX; gx <= maxX; gx++) {
    for (let gy = minY; gy <= maxY; gy++) {
      svg += `<rect x="${cellX(gx)}" y="${cellY(gy)}" width="${cell}" height="${cell}" rx="1" class="pattern-cell-bg"/>`;
    }
  }
  for (const p of norm) {
    svg += `<rect x="${cellX(p.x)}" y="${cellY(p.y)}" width="${cell}" height="${cell}" rx="1" class="pattern-cell-fill" style="--node-color:var(${colorVar})"/>`;
  }
  svg += `<rect x="${cellX(0)}" y="${cellY(0)}" width="${cell}" height="${cell}" rx="1" class="pattern-cell-anchor"/>`;
  svg += '</svg>';
  return svg;
}

const CONDITION_LABELS = {
  LiveSkillTriggerType_LIVE_SKILL_TRIGGER_TYPE_DECK_CARD_ATTRIBUTE: (c) =>
    `${c.threshold}+ ${attrLabel(c.cardAttributeType)} members`,
  LiveSkillTriggerType_LIVE_SKILL_TRIGGER_TYPE_DECK_CARD_CHARACTER_GROUPING: (c) =>
    `${c.threshold}+ members from ${c.characterGroupingId}`,
  LiveSkillTriggerType_LIVE_SKILL_TRIGGER_TYPE_DECK_LEADER_CHARACTER: () => 'Specific leader required',
  LiveSkillTriggerType_LIVE_SKILL_TRIGGER_TYPE_DECK_LEADER_CHARACTER_GROUPING: (c) =>
    `Leader from ${c.characterGroupingId}`,
  LiveSkillTriggerType_LIVE_SKILL_TRIGGER_TYPE_COMBO_GTE: (c) => `${c.threshold}+ combo`,
  LiveSkillTriggerType_LIVE_SKILL_TRIGGER_TYPE_LIFE_GTE: (c) => `${c.threshold}+ life`,
  LiveSkillTriggerType_LIVE_SKILL_TRIGGER_TYPE_LIFE_LTE: (c) => `${c.threshold} or less life`,
  LiveSkillTriggerType_LIVE_SKILL_TRIGGER_TYPE_JUDGEMENT_TYPE_GTE: () => 'judgement-based',
  LiveSkillTriggerType_LIVE_SKILL_TRIGGER_TYPE_MUSIC_CHARACTER: () => 'song-specific',
};

/** A small "i" icon that reveals a text popup on click - used to keep
 *  disclaimer/limitation text out of the main flow without repeating full
 *  paragraphs everywhere it's relevant. Closes on click-outside or a second click. */
function createInfoIcon(text, imageSrc) {
  const wrap = document.createElement('span');
  wrap.className = 'info-icon-wrap';
  const icon = document.createElement('button');
  icon.type = 'button';
  icon.className = 'info-icon';
  icon.textContent = 'i';
  icon.setAttribute('aria-label', 'More info');
  wrap.appendChild(icon);

  let popup = null;
  const close = () => {
    if (popup) {
      popup.remove();
      popup = null;
    }
    document.removeEventListener('click', onOutsideClick);
  };
  const onOutsideClick = (e) => {
    if (!wrap.contains(e.target)) close();
  };
  icon.onclick = (e) => {
    e.stopPropagation();
    if (popup) {
      close();
      return;
    }
    popup = document.createElement('div');
    popup.className = 'info-popup' + (imageSrc ? ' info-popup-with-image' : '');
    if (imageSrc) {
      const img = document.createElement('img');
      img.className = 'info-popup-image';
      img.src = imageSrc;
      img.alt = 'Reference screenshot';
      img.loading = 'lazy';
      popup.appendChild(img);
    }
    const textEl = document.createElement('div');
    textEl.textContent = text;
    popup.appendChild(textEl);
    wrap.appendChild(popup);
    document.addEventListener('click', onOutsideClick);
  };

  return wrap;
}

const GENERATION_LABELS = {
  'DEV_IS ReGLOSS': 'ReGLOSS',
  'hololive 0th Generation': 'Gen 0',
  'hololive 1st Generation': 'Gen 1',
  'hololive 1st Generation / Gamers': 'Gen 1 \u00b7 Gamers',
  'hololive 2nd Generation': 'Gen 2',
  'hololive 3rd Generation': 'Gen 3',
  'hololive 4th Generation': 'Gen 4',
  'hololive 5th Generation': 'Gen 5',
  'hololive EN Advent': 'EN Advent',
  'hololive EN Myth': 'EN Myth',
  'hololive EN Promise': 'EN Promise',
  'hololive Gamers': 'Gamers',
  'hololive ID 1st Generation': 'ID Gen 1',
  'hololive ID 2nd Generation': 'ID Gen 2',
  'hololive ID 3rd Generation': 'ID Gen 3',
  'hololive holoX': 'holoX',
};
function genLabel(generation) {
  return GENERATION_LABELS[generation] || generation || null;
}

function attrLabel(type) {
  return ATTR_LABELS[type]?.label ?? '?';
}
function attrClass(type) {
  return ATTR_LABELS[type]?.cls ?? 'attr-empty';
}
function effectLabel(type) {
  return EFFECT_LABELS[type] ?? type?.split('_TYPE_')[1]?.replaceAll('_', ' ') ?? 'Effect';
}
function rarityNumber(rarity) {
  const m = rarity?.match(/RARITY_(\d)$/);
  return m ? Number(m[1]) : null;
}
/** Which of Performance/Technique/Sense is this card's highest permil stat -
 *  ties broken in Performance > Technique > Sense order (arbitrary but stable). */
function mainStatOf(card) {
  const { performancePermilMultiply: p, techniquePermilMultiply: t, sensePermilMultiply: s } = card;
  if (p >= t && p >= s) return 'performance';
  if (t >= s) return 'technique';
  return 'sense';
}
function rarityLabel(rarity) {
  const n = rarityNumber(rarity);
  return n ? `${n}\u2605` : '';
}

// Maps an activation-chance percent (0-100) to a border color, blue (low
// confidence) through to orange (high confidence), reusing the app's own palette.
function activationChanceColor(chance) {
  const t = Math.max(0, Math.min(100, chance ?? 0)) / 100;
  const low = [154, 214, 236]; // --blue-pale
  const high = [225, 90, 36]; // --orange
  const rgb = low.map((v, i) => Math.round(v + (high[i] - v) * t));
  return `rgb(${rgb.join(',')})`;
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

const DATA = {};

async function loadData() {
  const [members, cardPotentials, characterGroupings, songs, boardCategories, cardConnectInfo] = await Promise.all([
    fetch('data/members.json').then((r) => r.json()),
    fetch('data/card_potentials.json').then((r) => r.json()),
    fetch('data/character_groupings.json').then((r) => r.json()),
    fetch('data/music.json').then((r) => r.json()),
    fetch('data/board_categories.json').then((r) => r.json()),
    fetch('data/card_connect_info.json').then((r) => r.json()),
  ]);
  DATA.members = members;
  DATA.byId = Object.fromEntries(members.map((m) => [m.cardId, m]));
  DATA.cardPotentials = cardPotentials;
  DATA.characterGroupings = characterGroupings;
  DATA.songs = songs.filter((s) => s.feverSeconds && s.feverSeconds.length === 5);
  DATA.boardCategories = boardCategories;
  DATA.cardConnectInfo = cardConnectInfo;
}

// ---------------------------------------------------------------------------
// Note density (notes-per-second per song/difficulty) - lazy-loaded per song
// rather than bundled upfront, since the full set is ~1.4MB across all songs
// but a typical single-song file is only ~5-15KB. Not every song has data
// (only songs with a .sus chart available at data-build time do); missing
// entries cache as `null` so we don't refetch a 404 repeatedly.
// ---------------------------------------------------------------------------
const NOTE_DENSITY_CACHE = {}; // songId -> {easy:[...], normal:[...], hard:[...], expert:[...]} | null

/** Returns cached note-density data for a song if already loaded (sync), or
 *  kicks off a fetch and returns undefined - `onLoaded` (defaults to the
 *  global recompute()) runs once the fetch resolves, so callers with their
 *  own local render function (e.g. the Compare page) can pass that instead. */
function getNoteDensity(songId, onLoaded = recompute) {
  if (songId in NOTE_DENSITY_CACHE) return NOTE_DENSITY_CACHE[songId];
  fetch(`data/note_density/${songId}.json`)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
    .then((data) => {
      NOTE_DENSITY_CACHE[songId] = data;
      onLoaded(); // re-renders are cheap/idempotent; simplest to always refresh rather than track staleness
    });
  return undefined; // still loading
}

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------

const state = {
  leader: { cardId: null, level: 80, bloom: 0 },
  unit: [
    { cardId: null, level: 80, bloom: 0 },
    { cardId: null, level: 80, bloom: 0 },
    { cardId: null, level: 80, bloom: 0 },
    { cardId: null, level: 80, bloom: 0 },
    { cardId: null, level: 80, bloom: 0 },
  ],
  songId: null,
  difficulty: 'expert', // 'easy' | 'normal' | 'hard' | 'expert' - drives the note-density column in the coverage table
  boardSelections: {}, // characterId -> { "leader|EFFECT_TYPE" | "member|EFFECT_TYPE": countUnlocked }
  connectSelections: {}, // characterId -> { center?, leader?, member?: { connectorCardId, connectorBloom, allocations } }
  pickerFilters: {
    types: new Set(), // attributeType values; empty = no filter
    rarities: new Set(), // rarity numbers (3,4,5); empty = no filter
    generations: new Set(), // generation strings; empty = no filter
    mainStats: new Set(), // 'performance' | 'technique' | 'sense' (highest permil); empty = no filter
  },
  mobileAccordionExpanded: new Set(['leader']), // which slot keys are open on mobile
  manualMemoryBonusPercent: 0, // "Unit Stats X%" from the Memory Stand screen - % of Member Parameter only
  manualPowerUpBonusPercent: 0, // "Upgrade Bonus X%" from the Member training screen - % of (Member Parameter + Outfit Skill + Passive Skill + Memory Bonus)
};

const MOBILE_BREAKPOINT = '(max-width: 700px)';
function isMobileViewport() {
  return window.matchMedia(MOBILE_BREAKPOINT).matches;
}

function maxLevelFor(card) {
  const levels = Object.keys(card.levelCurve).map(Number);
  return levels.length ? Math.max(...levels) : 80;
}

// ---------------------------------------------------------------------------
// Roster slot rendering
// ---------------------------------------------------------------------------

const selectionRowEl = document.getElementById('selection-row');
const infoRowEl = document.getElementById('info-row');
const coverageRowEl = document.getElementById('coverage-row');
const powerRowEl = document.getElementById('power-row');

function renderSelectionRow() {
  selectionRowEl.innerHTML = '';

  const leaderCol = document.createElement('div');
  leaderCol.className = 'member-col leader-col';
  leaderCol.appendChild(renderSlot('leader', state.leader, true));
  selectionRowEl.appendChild(leaderCol);

  state.unit.forEach((slot, i) => {
    const col = document.createElement('div');
    col.className = 'member-col';
    col.appendChild(renderSlot(i, slot, false));
    selectionRowEl.appendChild(col);
  });
}

function renderSlot(key, slotState, isLeader) {
  const wrap = document.createElement('div');
  const card = slotState.cardId ? DATA.byId[slotState.cardId] : null;

  wrap.className = 'slot' + (isLeader ? ' leader-slot' : '') + (card ? ' filled' : ' empty');
  wrap.innerHTML = '';

  const name = document.createElement('div');
  name.className = 'slot-name';
  if (card) {
    name.innerHTML = `${card.characterName} <span class="rarity-badge">${rarityLabel(card.rarity)}</span>`;
  } else {
    name.textContent = isLeader ? 'Choose leader' : 'Choose member';
  }
  wrap.appendChild(name);

  const sub = document.createElement('div');
  sub.className = 'slot-sub';
  sub.textContent = card ? card.cardSubtitle || '' : 'Click to select from roster';
  wrap.appendChild(sub);

  if (!card) {
    const badge = document.createElement('div');
    badge.className = 'slot-badge attr-empty';
    badge.textContent = isLeader ? 'L' : '+';
    wrap.appendChild(badge);
    wrap.addEventListener('click', () => openPicker(slotState, isLeader));
    return wrap;
  }

  const bottomRow = document.createElement('div');
  bottomRow.className = 'slot-bottom-row';

  const statsBlock = document.createElement('div');
  statsBlock.className = 'slot-stats-block';

  const chipRow = document.createElement('div');
  chipRow.className = 'slot-chip-row';
  chipRow.style.marginTop = '0';

  const chip = document.createElement('div');
  chip.className = 'attr-chip ' + attrClass(card.attributeType);
  chip.textContent = attrLabel(card.attributeType);
  chipRow.appendChild(chip);

  const gen = genLabel(card.generation);
  if (gen) {
    const genChip = document.createElement('div');
    genChip.className = 'gen-chip';
    genChip.textContent = gen;
    chipRow.appendChild(genChip);
  }

  statsBlock.appendChild(chipRow);

  const lvlRow = document.createElement('div');
  lvlRow.className = 'slot-attr-row';
  const lvlLabel = document.createElement('span');
  lvlLabel.className = 'slot-sub';
  lvlLabel.textContent = 'Lv';
  lvlRow.appendChild(lvlLabel);
  const lvlInput = document.createElement('input');
  lvlInput.className = 'mini-input';
  lvlInput.type = 'number';
  lvlInput.min = 1;
  lvlInput.max = maxLevelFor(card);
  lvlInput.value = slotState.level;
  lvlInput.onclick = (e) => e.stopPropagation();
  lvlInput.onchange = () => {
    slotState.level = clamp(Number(lvlInput.value), 1, maxLevelFor(card));
    lvlInput.value = slotState.level;
    recompute();
  };
  lvlRow.appendChild(lvlInput);
  statsBlock.appendChild(lvlRow);

  const bloomRow = document.createElement('div');
  bloomRow.className = 'slot-attr-row';
  const bloomLabel = document.createElement('span');
  bloomLabel.className = 'slot-sub';
  bloomLabel.textContent = 'Bloom';
  bloomRow.appendChild(bloomLabel);
  const bloomInput = document.createElement('input');
  bloomInput.className = 'mini-input';
  bloomInput.type = 'number';
  bloomInput.min = 0;
  bloomInput.max = 5;
  bloomInput.value = slotState.bloom;
  bloomInput.onclick = (e) => e.stopPropagation();
  bloomInput.onchange = () => {
    slotState.bloom = clamp(Number(bloomInput.value), 0, 5);
    bloomInput.value = slotState.bloom;
    recompute();
  };
  bloomRow.appendChild(bloomInput);
  statsBlock.appendChild(bloomRow);

  bottomRow.appendChild(statsBlock);

  const portrait = document.createElement('img');
  portrait.className = 'slot-portrait';
  portrait.src = `images/cards/${card.cardId}.webp`;
  portrait.alt = card.characterName;
  portrait.loading = 'lazy';
  bottomRow.appendChild(portrait);

  wrap.appendChild(bottomRow);

  const boardBtn = document.createElement('button');
  boardBtn.className = 'board-btn slot-board-btn';
  boardBtn.type = 'button';
  const hasBoard = !!DATA.boardCategories?.[card.characterId];
  const spent = boardPointsSpent(card.characterId);
  boardBtn.textContent = hasBoard ? `Board${spent ? ` (${spent})` : ''}` : 'Board \u2014';
  boardBtn.disabled = !hasBoard;
  boardBtn.onclick = (e) => {
    e.stopPropagation();
    openBoardEditor(card, isLeader);
  };
  wrap.appendChild(boardBtn);

  if (!isLeader) {
    const swapRow = document.createElement('div');
    swapRow.className = 'slot-swap-row';
    const leftBtn = document.createElement('button');
    leftBtn.type = 'button';
    leftBtn.className = 'slot-swap-btn';
    leftBtn.textContent = '\u2190';
    leftBtn.title = 'Move left';
    leftBtn.disabled = key === 0;
    leftBtn.onclick = (e) => {
      e.stopPropagation();
      [state.unit[key - 1], state.unit[key]] = [state.unit[key], state.unit[key - 1]];
      renderSelectionRow();
      recompute();
    };
    swapRow.appendChild(leftBtn);

    const rightBtn = document.createElement('button');
    rightBtn.type = 'button';
    rightBtn.className = 'slot-swap-btn';
    rightBtn.textContent = '\u2192';
    rightBtn.title = 'Move right';
    rightBtn.disabled = key === state.unit.length - 1;
    rightBtn.onclick = (e) => {
      e.stopPropagation();
      [state.unit[key], state.unit[key + 1]] = [state.unit[key + 1], state.unit[key]];
      renderSelectionRow();
      recompute();
    };
    swapRow.appendChild(rightBtn);

    wrap.appendChild(swapRow);
  }

  wrap.addEventListener('click', () => openPicker(slotState, isLeader));

  return wrap;
}

function clamp(v, lo, hi) {
  if (Number.isNaN(v)) return lo;
  return Math.max(lo, Math.min(hi, v));
}

function boardPointsSpent(characterId) {
  const unlockedSet = state.boardSelections[characterId];
  const charData = DATA.boardCategories?.[characterId];
  if (!unlockedSet || !charData) return 0;
  const index = buildBoardIndex(charData);
  return boardPointsSpentFromSet(index, unlockedSet);
}

const BOARD_CATEGORY_LABELS = {
  ALL_PARAMETER_UP: 'All Parameters',
  PERFORMANCE_UP: 'Performance',
  TECHNIQUE_UP: 'Technique',
  SENSE_UP: 'Sense',
  ALL_PARAMETER_UP_PERMIL_UP: 'All Parameters %',
  PERFORMANCE_UP_PERMIL_UP: 'Performance %',
  TECHNIQUE_UP_PERMIL_UP: 'Technique %',
  SENSE_UP_PERMIL_UP: 'Sense %',
  LIVE_ACTIVE_SKILL_ACTIVATION_PROBABILITY_UP_PERMIL_UP: 'Active Skill Activation Rate',
  LIVE_ACTIVE_SKILL_COOL_TIME_SHORTEN_PERMIL_UP: 'Active Skill Cooldown Shorten',
  LIVE_ACTIVE_SKILL_EFFECT_UP_PERMIL_UP: 'Score Support',
};

function openBoardEditor(card, isLeaderSlotContext) {
  const characterId = card.characterId;
  const charData = DATA.boardCategories[characterId];
  if (!charData) return;
  if (!state.boardSelections[characterId]) state.boardSelections[characterId] = new Set();
  const sel = state.boardSelections[characterId];
  const boardIndex = buildBoardIndex(charData);

  // Which board area shows is based purely on which Board button was
  // clicked - Leader (red) from the leader slot, Member (blue) from a unit
  // slot - consistently, even for a character who happens to be both at
  // once. No dual-display exception: opening from one slot never shows the
  // other area, since that area's nodes don't apply from this context anyway.
  const showLeaderArea = isLeaderSlotContext;
  const showMemberArea = !isLeaderSlotContext;

  const overlay = document.createElement('div');
  overlay.className = 'picker-overlay';

  const box = document.createElement('div');
  box.className = 'picker-box board-editor-box';

  const header = document.createElement('div');
  header.className = 'picker-search';
  const areaLabel = showLeaderArea ? 'Leader (red) area' : 'Member (blue) area';
  header.innerHTML = `<div class="board-editor-title">${charData.characterName} \u00b7 Holomem Board</div><div class="board-editor-subtitle">${areaLabel}</div>`;
  header.querySelector('.board-editor-subtitle').appendChild(
    createInfoIcon(
      'Node sizes vary and are already reflected in the cost/value shown. Click any node to unlock it \u2014 if it isn\u2019t adjacent to an already-unlocked node yet, every node on the path back to the center unlocks automatically along with it. Locking a node also locks anything past it that becomes disconnected. Green (support) and Yellow (content) areas aren\u2019t modeled yet \u2014 enter those as a manual bonus for now.'
    )
  );
  box.appendChild(header);

  const list = document.createElement('div');
  list.className = 'picker-list board-editor-list';

  /** Renders the whole board (leader + member + connectors) as one connected spatial diagram. */
  const renderCombinedDiagram = () => {
    const leaderAnchor = charData.anchors?.leader;
    const memberAnchor = charData.anchors?.member;
    const allNodes = [];
    for (const [posKey, node] of boardIndex.entries()) {
      if (posKey === '0,0') continue; // already shown as the dedicated center marker
      const [x, y] = posKey.split(',').map(Number);
      if (node.kind === 'effect') {
        if (node.area === 'leader' && !showLeaderArea) continue;
        if (node.area === 'member' && !showMemberArea) continue;
      } else if (node.kind === 'connector') {
        const isLeaderAnchor = leaderAnchor && x === leaderAnchor.x && y === leaderAnchor.y;
        const isMemberAnchor = memberAnchor && x === memberAnchor.x && y === memberAnchor.y;
        if (isLeaderAnchor && !showLeaderArea) continue;
        if (isMemberAnchor && !showMemberArea) continue;
        if (!isLeaderAnchor && !isMemberAnchor) continue; // e.g. content(yellow) anchor - out of scope
      }
      allNodes.push({ posKey, x, y, ...node });
    }

    const xs = allNodes.map((n) => n.x).concat(0);
    const ys = allNodes.map((n) => n.y).concat(0);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const spacing = 32;
    const pad = 24;
    const width = (maxX - minX) * spacing + pad * 2;
    const height = (maxY - minY) * spacing + pad * 2;
    const toScreenX = (x) => pad + (x - minX) * spacing;
    const toScreenY = (y) => pad + (maxY - y) * spacing; // +Y renders upward (toward leader path)

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('width', '100%');
    svg.classList.add('board-diagram');
    svg.style.maxHeight = Math.min(height, 440) + 'px';

    const centerCircle = document.createElementNS(svgNS, 'circle');
    centerCircle.setAttribute('cx', toScreenX(0));
    centerCircle.setAttribute('cy', toScreenY(0));
    centerCircle.setAttribute('r', 8);
    centerCircle.setAttribute('class', 'board-diagram-center');
    svg.appendChild(centerCircle);

    for (const n of allNodes) {
      const unlocked = sel.has(n.posKey);
      const el = document.createElementNS(svgNS, n.kind === 'connector' ? 'rect' : 'circle');
      const colorVar = n.kind === 'connector' ? '--text-faint' : n.area === 'leader' ? '--red-node' : '--blue-node';
      const radius = n.grade >= 2 ? 13 : 10;

      if (n.kind === 'connector') {
        const size = 10;
        el.setAttribute('x', toScreenX(n.x) - size / 2);
        el.setAttribute('y', toScreenY(n.y) - size / 2);
        el.setAttribute('width', size);
        el.setAttribute('height', size);
        el.setAttribute('rx', 1.5);
      } else {
        el.setAttribute('cx', toScreenX(n.x));
        el.setAttribute('cy', toScreenY(n.y));
        el.setAttribute('r', radius);
      }
      el.setAttribute('class', 'board-diagram-node' + (unlocked ? ' unlocked' : ''));
      el.style.setProperty('--node-color', `var(${colorVar})`);

      const title = document.createElementNS(svgNS, 'title');
      if (n.kind === 'connector') {
        title.textContent = `Connector node \u00b7 ${n.cost}pt \u00b7 no direct effect${unlocked ? ' (unlocked)' : ''}`;
      } else {
        const isPermil = n.type.includes('PERMIL');
        const valLabel = isPermil ? `+${(n.value / 10).toFixed(1)}%` : `+${n.value} pts`;
        const singerNote = n.requiresSinger ? ' \u00b7 only when this character is a singer on the selected song' : '';
        title.textContent = `${BOARD_CATEGORY_LABELS[n.type] || n.type} \u00b7 ${valLabel} \u00b7 ${n.cost}pt \u00b7 ${n.grade >= 2 ? '2\u2605' : '1\u2605'}${unlocked ? ' (unlocked)' : ''}${singerNote}`;
        if (n.requiresSinger) el.classList.add('board-diagram-node-singer');
      }
      el.appendChild(title);

      el.addEventListener('click', () => {
        if (unlocked) {
          sel.delete(n.posKey);
          const pruned = pruneDisconnected(sel);
          sel.clear();
          for (const p of pruned) sel.add(p);
        } else if (canUnlock(sel, n.x, n.y)) {
          sel.add(n.posKey);
        } else {
          // Not directly adjacent to an unlocked node yet - auto-unlock the
          // whole chain back to the center so this node becomes reachable.
          const path = findUnlockPath(boardIndex, n.x, n.y);
          if (!path) return; // no valid path exists (shouldn't happen for real board data)
          for (const posKey of path) sel.add(posKey);
        }
        refreshEditor();
      });
      svg.appendChild(el);

      if (n.kind === 'effect') {
        const iconSize = radius * 1.5;
        const img = document.createElementNS(svgNS, 'image');
        img.setAttributeNS('http://www.w3.org/1999/xlink', 'href', `images/board_icons/${n.type}.png`);
        img.setAttribute('href', `images/board_icons/${n.type}.png`);
        img.setAttribute('x', toScreenX(n.x) - iconSize / 2);
        img.setAttribute('y', toScreenY(n.y) - iconSize / 2);
        img.setAttribute('width', iconSize);
        img.setAttribute('height', iconSize);
        img.setAttribute('class', 'board-diagram-icon' + (unlocked ? ' unlocked' : ''));
        img.style.pointerEvents = 'none';
        svg.appendChild(img);
      }
    }

    list.appendChild(svg);

    const hasSingerNode = allNodes.some((n) => n.requiresSinger);
    const legend = document.createElement('div');
    legend.className = 'board-diagram-legend';
    legend.textContent = `${boardPointsSpentFromSet(boardIndex, sel)} pts spent \u00b7 squares are path connectors (no direct effect) \u00b7 click a node to unlock/lock it${hasSingerNode ? ' \u00b7 dashed border = only applies when this character is a singer on the selected song' : ''}`;
    list.appendChild(legend);
  };

  const connectSection = document.createElement('div');
  connectSection.className = 'connect-section';

  const totalEl = document.createElement('div');
  totalEl.className = 'board-total';

  function refreshEditor() {
    list.innerHTML = '';
    renderCombinedDiagram();
    totalEl.textContent = `${boardPointsSpent(characterId)} points allocated`;
    renderConnectSection();
    list.appendChild(connectSection);
    recompute();
    renderSelectionRow();
  }

  function renderConnectSection() {
    connectSection.innerHTML = '';
    const heading = document.createElement('div');
    heading.className = 'board-group-label';
    heading.innerHTML = 'Connect Effects <span class="board-group-hint">\u2014 assign a connector character; her boost applies automatically to whichever of your unlocked nodes fall in her exact pattern</span>';
    connectSection.appendChild(heading);

    if (!state.connectSelections[characterId]) state.connectSelections[characterId] = {};
    const config = state.connectSelections[characterId];

    const SLOT_META = {
      center: { label: '\ud83c\udfaf Center' },
      leader: { label: '\ud83d\udd34 Leader' },
      member: { label: '\ud83d\udd35 Member' },
    };

    const visibleSlotTypes = ['center', showLeaderArea ? 'leader' : 'member'];
    for (const slotType of visibleSlotTypes) {
      const setup = config[slotType];
      const meta = SLOT_META[slotType];

      const row = document.createElement('div');
      row.className = 'connect-slot-row';

      const head = document.createElement('div');
      head.className = 'connect-slot-head';
      const connectorCard = setup?.connectorCardId ? DATA.byId[setup.connectorCardId] : null;
      head.innerHTML = `<span class="connect-slot-label">${meta.label}</span>`;

      const connectorBtn = document.createElement('button');
      connectorBtn.type = 'button';
      connectorBtn.className = 'board-btn';
      connectorBtn.textContent = connectorCard
        ? `${connectorCard.characterName}${connectorCard.cardSubtitle ? ' \u00b7 ' + connectorCard.cardSubtitle : ''}`
        : 'Choose connector';
      connectorBtn.onclick = () => openConnectorPicker(slotType, characterId);
      head.appendChild(connectorBtn);

      if (connectorCard) {
        const connInfo = DATA.cardConnectInfo[connectorCard.cardId];
        if (connInfo?.pattern) {
          const patternWrap = document.createElement('span');
          patternWrap.className = 'pattern-icon-wrap inline';
          patternWrap.innerHTML = buildPatternIcon(
            connInfo.pattern,
            connInfo.area === 'leader' ? '--red-node' : connInfo.area === 'member' ? '--blue-node' : '--orange'
          );
          head.appendChild(patternWrap);
        }
      }

      if (connectorCard) {
        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'board-btn';
        clearBtn.textContent = '\u2715';
        clearBtn.onclick = () => {
          delete config[slotType];
          refreshEditor();
        };
        head.appendChild(clearBtn);
      }
      row.appendChild(head);

      if (connectorCard) {
        const bloomRow = document.createElement('div');
        bloomRow.className = 'connect-bloom-row';
        bloomRow.innerHTML = `<span class="slot-sub">Connector Bloom</span>`;
        const bloomInput = document.createElement('input');
        bloomInput.className = 'mini-input';
        bloomInput.type = 'number';
        bloomInput.min = 0;
        bloomInput.max = 5;
        bloomInput.value = setup.connectorBloom || 0;
        bloomInput.onchange = () => {
          setup.connectorBloom = clamp(Number(bloomInput.value), 0, 5);
          bloomInput.value = setup.connectorBloom;
          refreshEditor();
        };
        bloomRow.appendChild(bloomInput);

        const info = getConnectorInfo(connectorCard, setup.connectorBloom || 0, DATA.cardConnectInfo, DATA.cardPotentials);
        if (info) {
          const infoSpan = document.createElement('span');
          infoSpan.className = 'connect-info';
          infoSpan.textContent = `${info.nodeCount} node effect \u00b7 +${(info.boostPermil / 10).toFixed(0)}% (Lv${info.level})`;
          bloomRow.appendChild(infoSpan);
        }
        row.appendChild(bloomRow);

        if (info) {
          const anchor = charData.anchors?.[slotType];
          let hitCount = 0;
          let totalCells = info.pattern?.length || 0;
          if (anchor && anchor.x != null && info.pattern) {
            for (const offset of info.pattern) {
              const px = anchor.x + (offset.x || 0);
              const py = anchor.y + (offset.y || 0);
              const posKey = `${px},${py}`;
              const node = boardIndex.get(posKey);
              if (node && node.kind === 'effect' && sel.has(posKey)) hitCount++;
            }
          }

          const applyLine = document.createElement('div');
          applyLine.className = 'connect-budget-line';
          applyLine.textContent =
            hitCount > 0
              ? `Boosts ${hitCount} of your unlocked node${hitCount === 1 ? '' : 's'} that fall in her pattern (${totalCells} total cells, some may land on empty space)`
              : anchor?.x == null
              ? 'No connect point resolvable in this area for this character'
              : 'None of her pattern cells hit an unlocked node yet';
          row.appendChild(applyLine);
        }
      }

      connectSection.appendChild(row);
    }
  }

  function openConnectorPicker(slotType, receivingCharacterId) {
    const pOverlay = document.createElement('div');
    pOverlay.className = 'picker-overlay';
    const pBox = document.createElement('div');
    pBox.className = 'picker-box';
    const searchWrap = document.createElement('div');
    searchWrap.className = 'picker-search';
    const input = document.createElement('input');
    input.placeholder = 'Search for a connector\u2026';
    searchWrap.appendChild(input);
    pBox.appendChild(searchWrap);
    const pList = document.createElement('div');
    pList.className = 'picker-list';
    pBox.appendChild(pList);
    const pClose = document.createElement('div');
    pClose.className = 'picker-close';
    pClose.textContent = 'CLOSE';
    pClose.onclick = () => pOverlay.remove();
    pBox.appendChild(pClose);

    const eligibleArea = slotType; // used only for the info hint below, not as a filter
    function renderPList(query) {
      pList.innerHTML = '';
      const q = query.trim().toLowerCase();
      const matches = DATA.members.filter((m) => {
        const info = DATA.cardConnectInfo[m.cardId];
        if (!info) return false;
        if (q && !m.characterName?.toLowerCase().includes(q) && !m.cardSubtitle?.toLowerCase().includes(q)) return false;
        return true;
      }).slice(0, 60);

      if (!matches.length) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        if (q) {
          const matchingCards = DATA.members.filter(
            (m) => m.characterName?.toLowerCase().includes(q) || m.cardSubtitle?.toLowerCase().includes(q)
          );
          empty.textContent = matchingCards.length
            ? `No card matching "${query.trim()}" has a Connect Effect.`
            : `No character matching "${query.trim()}" found.`;
        } else {
          empty.textContent = 'No connect-eligible characters found.';
        }
        pList.appendChild(empty);
        return;
      }
      for (const m of matches) {
        const info = DATA.cardConnectInfo[m.cardId];
        const item = document.createElement('div');
        item.className = 'picker-item';
        const portrait = document.createElement('img');
        portrait.className = 'picker-item-portrait';
        portrait.src = `images/cards/${m.cardId}.webp`;
        portrait.alt = m.characterName;
        portrait.loading = 'lazy';
        item.appendChild(portrait);
        const infoDiv = document.createElement('div');
        infoDiv.innerHTML = `<div class="picker-item-name">${m.characterName} <span class="rarity-badge">${rarityLabel(m.rarity)}</span></div><div class="picker-item-sub">${m.cardSubtitle || ''}</div><div class="picker-item-sub">${info.nodeCount}-node pattern \u00b7 +${(info.boostPermilLevel1/10).toFixed(0)}\u2013${(info.boostPermilLevel2/10).toFixed(0)}%</div>`;
        item.appendChild(infoDiv);
        const patternWrap = document.createElement('div');
        patternWrap.className = 'pattern-icon-wrap';
        patternWrap.innerHTML = buildPatternIcon(info.pattern, info.area === 'leader' ? '--red-node' : info.area === 'member' ? '--blue-node' : '--orange');
        item.appendChild(patternWrap);
        item.onclick = () => {
          if (!state.connectSelections[receivingCharacterId]) state.connectSelections[receivingCharacterId] = {};
          state.connectSelections[receivingCharacterId][slotType] = {
            connectorCardId: m.cardId,
            connectorBloom: 0,
          };
          pOverlay.remove();
          refreshEditor();
        };
        pList.appendChild(item);
      }
    }
    input.addEventListener('input', () => renderPList(input.value));
    renderPList('');
    pOverlay.appendChild(pBox);
    pOverlay.addEventListener('click', (e) => { if (e.target === pOverlay) pOverlay.remove(); });
    document.body.appendChild(pOverlay);
    input.focus();
  }

  refreshEditor();
  box.appendChild(list);
  box.appendChild(totalEl);

  const close = document.createElement('div');
  close.className = 'picker-close';
  close.textContent = 'DONE';
  close.onclick = () => overlay.remove();
  box.appendChild(close);

  overlay.appendChild(box);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  document.body.appendChild(overlay);
}

// ---------------------------------------------------------------------------
// Picker overlay
// ---------------------------------------------------------------------------

function openPicker(slotState, isLeader) {
  const overlay = document.createElement('div');
  overlay.className = 'picker-overlay';

  const box = document.createElement('div');
  box.className = 'picker-box';

  const searchWrap = document.createElement('div');
  searchWrap.className = 'picker-search';
  const input = document.createElement('input');
  input.placeholder = isLeader ? 'Search for a leader\u2026' : 'Search for a unit member\u2026';
  searchWrap.appendChild(input);
  box.appendChild(searchWrap);

  box.appendChild(renderFilterBar(() => renderList(input.value)));

  const list = document.createElement('div');
  list.className = 'picker-list';
  box.appendChild(list);

  const close = document.createElement('div');
  close.className = 'picker-close';
  close.textContent = 'CLOSE';
  close.onclick = () => overlay.remove();
  box.appendChild(close);

  function renderList(query) {
    list.innerHTML = '';
    const q = query.trim().toLowerCase();
    const f = state.pickerFilters;
    let pool = DATA.members;
    if (isLeader) pool = pool.filter((m) => m.leaderSkill);
    const matches = pool
      .filter((m) => !q || m.characterName?.toLowerCase().includes(q) || m.cardSubtitle?.toLowerCase().includes(q))
      .filter((m) => !f.types.size || f.types.has(m.attributeType))
      .filter((m) => !f.rarities.size || f.rarities.has(rarityNumber(m.rarity)))
      .filter((m) => !f.generations.size || f.generations.has(m.generation))
      .filter((m) => !f.mainStats.size || f.mainStats.has(mainStatOf(m)))
      .slice(0, 60);

    if (!matches.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'No matches';
      list.appendChild(empty);
      return;
    }

    for (const m of matches) {
      const item = document.createElement('div');
      item.className = 'picker-item';

      const portrait = document.createElement('img');
      portrait.className = 'picker-item-portrait';
      portrait.src = `images/cards/${m.cardId}.webp`;
      portrait.alt = m.characterName;
      portrait.loading = 'lazy';
      item.appendChild(portrait);

      const info = document.createElement('div');
      const name = document.createElement('div');
      name.className = 'picker-item-name';
      name.innerHTML = `${m.characterName} <span class="rarity-badge">${rarityLabel(m.rarity)}</span>`;
      info.appendChild(name);
      const sub = document.createElement('div');
      sub.className = 'picker-item-sub';
      sub.textContent = m.cardSubtitle || '';
      info.appendChild(sub);
      item.appendChild(info);

      item.onclick = () => {
        slotState.cardId = m.cardId;
        slotState.level = Math.min(slotState.level, maxLevelFor(m));
        overlay.remove();
        renderSelectionRow();
        recompute();
      };
      list.appendChild(item);
    }
  }

  input.addEventListener('input', () => renderList(input.value));
  renderList('');

  overlay.appendChild(box);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  document.body.appendChild(overlay);
  input.focus();
}

/** Builds the persistent Type/Rarity/Generation filter bar shared by the
 *  leader/member picker. Reads and writes directly to state.pickerFilters,
 *  and calls onChange whenever a filter is toggled. */
function renderFilterBar(onChange) {
  const bar = document.createElement('div');
  bar.className = 'filter-bar';

  const f = state.pickerFilters;

  const typeGroup = document.createElement('div');
  typeGroup.className = 'filter-group';
  typeGroup.innerHTML = '<span class="filter-group-label">Type</span>';
  for (const type of [
    'CardAttributeType_CARD_ATTRIBUTE_TYPE_ATTRIBUTE_2', // Pure
    'CardAttributeType_CARD_ATTRIBUTE_TYPE_ATTRIBUTE_3', // Happy
    'CardAttributeType_CARD_ATTRIBUTE_TYPE_ATTRIBUTE_1', // Cute
  ]) {
    const chipLabel = attrLabel(type);
    const chipClass = attrClass(type);
    const chip = document.createElement('label');
    chip.className = `filter-checkbox ${chipClass}`;
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = f.types.has(type);
    cb.onchange = () => {
      cb.checked ? f.types.add(type) : f.types.delete(type);
      onChange();
    };
    chip.appendChild(cb);
    chip.appendChild(document.createTextNode(chipLabel));
    typeGroup.appendChild(chip);
  }
  bar.appendChild(typeGroup);

  const rarityGroup = document.createElement('div');
  rarityGroup.className = 'filter-group';
  rarityGroup.innerHTML = '<span class="filter-group-label">Rarity</span>';
  for (const r of [5, 4, 3]) {
    const chip = document.createElement('label');
    chip.className = 'filter-checkbox';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = f.rarities.has(r);
    cb.onchange = () => {
      cb.checked ? f.rarities.add(r) : f.rarities.delete(r);
      onChange();
    };
    chip.appendChild(cb);
    chip.appendChild(document.createTextNode(`${r}\u2605`));
    rarityGroup.appendChild(chip);
  }
  bar.appendChild(rarityGroup);

  const statGroup = document.createElement('div');
  statGroup.className = 'filter-group';
  statGroup.innerHTML = '<span class="filter-group-label">Main Stat</span>';
  for (const stat of [
    { key: 'performance', label: 'Perf' },
    { key: 'technique', label: 'Tech' },
    { key: 'sense', label: 'Sense' },
  ]) {
    const chip = document.createElement('label');
    chip.className = 'filter-checkbox';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = f.mainStats.has(stat.key);
    cb.onchange = () => {
      cb.checked ? f.mainStats.add(stat.key) : f.mainStats.delete(stat.key);
      onChange();
    };
    chip.appendChild(cb);
    chip.appendChild(document.createTextNode(stat.label));
    statGroup.appendChild(chip);
  }
  bar.appendChild(statGroup);

  const allGenerations = [...new Set(DATA.members.map((m) => m.generation).filter(Boolean))];
  const genGroup = document.createElement('div');
  genGroup.className = 'filter-group filter-group-dropdown';
  const genLabel = document.createElement('span');
  genLabel.className = 'filter-group-label';
  genLabel.textContent = 'Generation';
  genGroup.appendChild(genLabel);

  const genBtn = document.createElement('button');
  genBtn.type = 'button';
  genBtn.className = 'filter-dropdown-btn';
  const updateGenBtnLabel = () => {
    genBtn.textContent = f.generations.size ? `${f.generations.size} selected` : 'All generations';
  };
  updateGenBtnLabel();
  genGroup.appendChild(genBtn);

  const genPanel = document.createElement('div');
  genPanel.className = 'filter-dropdown-panel';
  genPanel.style.display = 'none';
  for (const gen of allGenerations) {
    const opt = document.createElement('label');
    opt.className = 'filter-dropdown-option';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = f.generations.has(gen);
    cb.onchange = () => {
      cb.checked ? f.generations.add(gen) : f.generations.delete(gen);
      updateGenBtnLabel();
      onChange();
    };
    opt.appendChild(cb);
    opt.appendChild(document.createTextNode(gen));
    genPanel.appendChild(opt);
  }
  genGroup.appendChild(genPanel);

  genBtn.onclick = (e) => {
    e.stopPropagation();
    genPanel.style.display = genPanel.style.display === 'none' ? 'block' : 'none';
  };
  document.addEventListener('click', (e) => {
    if (!genGroup.contains(e.target)) genPanel.style.display = 'none';
  });

  bar.appendChild(genGroup);

  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'filter-clear-btn';
  clearBtn.textContent = 'Clear filters';
  clearBtn.onclick = () => {
    f.types.clear();
    f.rarities.clear();
    f.generations.clear();
    f.mainStats.clear();
    onChange();
    // Re-render the bar itself so checkboxes visually reset too.
    bar.replaceWith(renderFilterBar(onChange));
  };
  bar.appendChild(clearBtn);

  return bar;
}

// ---------------------------------------------------------------------------
// Song select
// ---------------------------------------------------------------------------

/** Resolves a list of characterIds to display names via the loaded card roster
 *  (many cards share a characterId, so any match works). */
function resolveSingerNames(characterIds) {
  if (!characterIds?.length) return '';
  return characterIds
    .map((id) => DATA.members.find((m) => m.characterId === id)?.characterName)
    .filter(Boolean)
    .join(', ');
}

function renderSongSlot() {
  const song = state.songId ? DATA.songs.find((s) => s.id === state.songId) : null;

  const slot = document.createElement('div');
  slot.className = 'slot' + (song ? '' : ' empty');

  if (!song) {
    const badge = document.createElement('div');
    badge.className = 'slot-badge attr-empty';
    badge.textContent = '\u266a';
    slot.appendChild(badge);
  }

  const info = document.createElement('div');
  info.className = 'slot-info';
  const name = document.createElement('div');
  name.className = 'slot-name';
  name.textContent = song ? song.title : 'Choose a song';
  info.appendChild(name);

  if (song) {
    const durationLine = document.createElement('div');
    durationLine.className = 'slot-sub';
    durationLine.textContent = `${Math.floor((song.playingSeconds || 0) / 60)}:${String((song.playingSeconds || 0) % 60).padStart(2, '0')}`;
    info.appendChild(durationLine);

    const singers = resolveSingerNames(song.characterIds);
    if (singers) {
      const singerLine = document.createElement('div');
      singerLine.className = 'attr-chip song-singer-chip';
      singerLine.textContent = singers;
      info.appendChild(singerLine);
    }
  } else {
    const sub = document.createElement('div');
    sub.className = 'slot-sub';
    sub.textContent = 'Click to search from song list';
    info.appendChild(sub);
  }

  slot.appendChild(info);

  slot.addEventListener('click', openSongPicker);
  return slot;
}

function openSongPicker() {
  const overlay = document.createElement('div');
  overlay.className = 'picker-overlay';

  const box = document.createElement('div');
  box.className = 'picker-box';

  const searchWrap = document.createElement('div');
  searchWrap.className = 'picker-search';
  const input = document.createElement('input');
  input.placeholder = 'Search for a song\u2026';
  searchWrap.appendChild(input);
  box.appendChild(searchWrap);

  const list = document.createElement('div');
  list.className = 'picker-list';
  box.appendChild(list);

  const close = document.createElement('div');
  close.className = 'picker-close';
  close.textContent = 'CLOSE';
  close.onclick = () => overlay.remove();
  box.appendChild(close);

  function renderList(query) {
    list.innerHTML = '';
    const q = query.trim().toLowerCase();
    const matches = DATA.songs.filter((s) => !q || s.title?.toLowerCase().includes(q)).slice(0, 80);

    if (!matches.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'No matches';
      list.appendChild(empty);
      return;
    }

    for (const s of matches) {
      const item = document.createElement('div');
      item.className = 'picker-item';

      const badge = document.createElement('div');
      badge.className = 'slot-badge attr-empty';
      badge.style.width = '26px';
      badge.style.height = '26px';
      badge.style.fontSize = '11px';
      badge.textContent = '\u266a';
      item.appendChild(badge);

      const info = document.createElement('div');
      const name = document.createElement('div');
      name.className = 'picker-item-name';
      name.textContent = s.title;
      info.appendChild(name);
      const sub = document.createElement('div');
      sub.className = 'picker-item-sub';
      const secs = s.playingSeconds || 0;
      sub.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
      info.appendChild(sub);
      item.appendChild(info);

      item.onclick = () => {
        state.songId = s.id;
        overlay.remove();
        recompute();
      };
      list.appendChild(item);
    }
  }

  input.addEventListener('input', () => renderList(input.value));
  renderList('');

  overlay.appendChild(box);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  document.body.appendChild(overlay);
  input.focus();
}

// ---------------------------------------------------------------------------
// Compute + render results
// ---------------------------------------------------------------------------

/** Pure computation core - takes a team-state-shaped object (matching what a
 *  preset stores: leader, unit, boardSelections, connectSelections, songId)
 *  and returns everything needed to render results, without touching global
 *  `state` or any DOM. Used by both the main page's recompute() and the
 *  Compare feature, so both stay consistent with a single source of truth. */
function computeFullResult(team, songOverride) {
  const leaderCard = team.leader.cardId ? DATA.byId[team.leader.cardId] : null;
  const unitFilled = team.unit.every((u) => u.cardId);
  if (!leaderCard || !unitFilled) return null;

  const unit = team.unit.map((u) => ({ card: DATA.byId[u.cardId], level: u.level, bloom: u.bloom }));
  const data = { members: DATA.cardPotentials, characterGroupings: DATA.characterGroupings };

  const result = computeUnit(
    { leaderCard, leaderLevel: team.leader.level, leaderBloom: team.leader.bloom, unit },
    data
  );

  const slots = unit.map((u) => ({
    characterId: u.card.characterId,
    cardId: u.card.cardId,
    isUnitMember: true,
    isLeaderSlot: u.card.characterId === leaderCard.characterId,
  }));
  const leaderAlsoInUnit = slots.some((s) => s.isLeaderSlot);
  if (!leaderAlsoInUnit) {
    slots.push({ characterId: leaderCard.characterId, cardId: leaderCard.cardId, isUnitMember: false, isLeaderSlot: true });
  }
  // Which song determines singer-conditional Leader board nodes: an explicit
  // override (Compare page's own per-side song choice) takes priority over
  // the team's own saved songId (used everywhere else, including main page).
  const currentSong = songOverride !== undefined ? songOverride : team.songId ? DATA.songs.find((s) => s.id === team.songId) : null;
  const songSingerCharacterIds = currentSong?.characterIds || [];
  const boardBonuses = computeBoardBonuses(team.boardSelections, DATA.boardCategories, slots, songSingerCharacterIds);
  const connectBonuses = computeConnectBonuses(
    team.connectSelections,
    DATA.boardCategories,
    team.boardSelections,
    DATA.cardConnectInfo,
    DATA.byId,
    DATA.cardPotentials,
    slots
  );
  const combinedBonuses = mergeBoardBonuses(boardBonuses, connectBonuses);

  const memberOnlySlots = slots.map((s) => ({ ...s, isLeaderSlot: false }));
  const memberOnlyBoardBonuses = computeBoardBonuses(team.boardSelections, DATA.boardCategories, memberOnlySlots, songSingerCharacterIds);
  const memberOnlyConnectBonuses = computeConnectBonuses(
    team.connectSelections,
    DATA.boardCategories,
    team.boardSelections,
    DATA.cardConnectInfo,
    DATA.byId,
    DATA.cardPotentials,
    memberOnlySlots
  );
  const memberOnlyCombined = mergeBoardBonuses(memberOnlyBoardBonuses, memberOnlyConnectBonuses);
  const pureBaseStats = result.memberStats.map((m) => ({ cardId: m.cardId, stats: { ...m.stats } }));
  const baseStats = result.memberStats.map((m) => {
    const stats = { ...m.stats };
    const permil = memberOnlyCombined.statPermil[m.cardId];
    if (permil) {
      stats.performance = Math.round(stats.performance * (1 + permil.performance / 1000));
      stats.technique = Math.round(stats.technique * (1 + permil.technique / 1000));
      stats.sense = Math.round(stats.sense * (1 + permil.sense / 1000));
    }
    const flat = memberOnlyCombined.statFlat[m.cardId];
    if (flat) {
      stats.performance += flat.performance;
      stats.technique += flat.technique;
      stats.sense += flat.sense;
    }
    return { cardId: m.cardId, stats };
  });

  applyBoardBonuses(result, combinedBonuses);

  const scoreSupport = mergeScoreSupport(computeScoreSupport(result.passives), combinedBonuses.scoreSupportPermil);

  return { leaderCard, unit, result, scoreSupport, baseStats, pureBaseStats, song: currentSong };
}

function recompute() {
  const computed = computeFullResult(state);

  if (!computed) {
    const leaderCard = state.leader.cardId ? DATA.byId[state.leader.cardId] : null;
    renderInfoRowIncomplete(leaderCard);
    coverageRowEl.innerHTML = '<div class="empty-state">Select a leader and all 5 unit members to see results.</div>';
    powerRowEl.innerHTML = '';
    return;
  }

  const { leaderCard, unit, result, scoreSupport, baseStats, pureBaseStats } = computed;
  renderInfoRow(result, leaderCard, unit, scoreSupport, baseStats);
  renderCoverageRow(result, unit, scoreSupport);
  renderPowerRow(result, leaderCard, scoreSupport, pureBaseStats);
}

/** Leader column content when the team isn't complete yet - song picking and a
 *  basic leader-skill description (without condition-met status, which needs
 *  the full unit) should still work while the rest of the columns wait. */
function renderInfoRowIncomplete(leaderCard) {
  infoRowEl.className = 'member-grid info-row';
  infoRowEl.innerHTML = '';

  const leaderCol = document.createElement('div');
  leaderCol.className = 'member-col leader-col';

  const skillPanel = document.createElement('div');
  skillPanel.className = 'panel-sm';
  const skillLabel = document.createElement('div');
  skillLabel.className = 'panel-label';
  skillLabel.textContent = 'Leader Skill';
  skillPanel.appendChild(skillLabel);
  if (leaderCard?.leaderSkill) {
    const condText = leaderCard.leaderSkill.condition
      ? CONDITION_LABELS[leaderCard.leaderSkill.condition.type]?.(leaderCard.leaderSkill.condition) ?? 'Conditional'
      : 'Always active';
    const effectsHtml = leaderCard.leaderSkill.effects
      .map((e) => `<div class="effect-head"><span class="effect-name">${effectLabel(e.type)}</span><span class="effect-value">+${(Number(e.value) / 10).toFixed(0)}%</span></div>`)
      .join('');
    const card = document.createElement('div');
    card.className = 'effect-card';
    card.innerHTML = `<span class="pill situational">COMPLETE UNIT TO CHECK</span><div class="effect-detail" style="margin-top:6px;">${condText}</div><div style="margin-top:8px;">${effectsHtml}</div>`;
    skillPanel.appendChild(card);
  } else {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = leaderCard ? 'No leader skill on this card.' : 'Choose a leader to see her skill.';
    skillPanel.appendChild(empty);
  }
  leaderCol.appendChild(skillPanel);

  const songPanel = document.createElement('div');
  songPanel.className = 'panel-sm';
  const songLabel = document.createElement('div');
  songLabel.className = 'panel-label';
  songLabel.textContent = 'Song';
  songPanel.appendChild(songLabel);
  songPanel.appendChild(renderSongSlot());
  leaderCol.appendChild(songPanel);

  infoRowEl.appendChild(leaderCol);

  for (let i = 0; i < 5; i++) {
    const col = document.createElement('div');
    col.className = 'member-col';
    const panel = document.createElement('div');
    panel.className = 'panel-sm';
    panel.innerHTML = '<div class="empty-state">Select this member to see her stats.</div>';
    col.appendChild(panel);
    infoRowEl.appendChild(col);
  }
}

function renderInfoRow(result, leaderCard, unit, scoreSupport, baseStats) {
  infoRowEl.innerHTML = '';

  if (isMobileViewport()) {
    infoRowEl.className = 'info-accordion';
    renderInfoRowMobile(result, leaderCard, unit, scoreSupport, baseStats);
    return;
  }

  infoRowEl.className = ''; // no longer a single grid - holds 3 aligned sub-grid rows instead

  const maxStat = Math.max(...baseStats.flatMap((m) => [m.stats.performance, m.stats.technique, m.stats.sense]));

  // Row A: Leader Skill + Parameters, stretched to equal height across the row.
  const rowA = document.createElement('div');
  rowA.className = 'member-grid info-subrow row-stretch';
  rowA.appendChild(renderLeaderSkillCard(result, leaderCard));
  unit.forEach((u, i) => rowA.appendChild(renderMemberStatsCard(baseStats[i], maxStat)));
  infoRowEl.appendChild(rowA);

  // Row B: Song + Passive Skill, top-aligned (heights can differ).
  const rowB = document.createElement('div');
  rowB.className = 'member-grid info-subrow row-top';
  const songPanel = document.createElement('div');
  songPanel.className = 'panel-sm leader-accent';
  const songLabel = document.createElement('div');
  songLabel.className = 'panel-label';
  songLabel.textContent = 'Song';
  songPanel.appendChild(songLabel);
  songPanel.appendChild(renderSongSlot());
  rowB.appendChild(songPanel);
  unit.forEach((u, i) => rowB.appendChild(renderMemberPassiveCard(result.passives[i], u.card)));
  infoRowEl.appendChild(rowB);

  // Row C: (empty under leader) + Active Skill, top-aligned.
  const rowC = document.createElement('div');
  rowC.className = 'member-grid info-subrow row-top';
  rowC.appendChild(document.createElement('div'));
  unit.forEach((u, i) => rowC.appendChild(renderMemberActiveCard(result.actives[i], u.card, scoreSupport)));
  infoRowEl.appendChild(rowC);
}

/** Mobile layout: one accordion item per slot (leader + 5 members), each
 *  holding everything about that person in one place - portrait, stats,
 *  passive, active (or Leader Skill + Song for the leader). Grouping by
 *  member instead of by card-type avoids the disconnected-sections problem
 *  that plain grid-reflow causes at narrow widths. */
function renderInfoRowMobile(result, leaderCard, unit, scoreSupport, baseStats) {
  infoRowEl.innerHTML = '';
  const maxStat = Math.max(...baseStats.flatMap((m) => [m.stats.performance, m.stats.technique, m.stats.sense]));

  const makeAccordionItem = (key, portraitCard, titleText, subtitleText, bodyBuilder) => {
    const item = document.createElement('div');
    item.className = 'accordion-item';

    const expanded = state.mobileAccordionExpanded.has(key);

    const header = document.createElement('div');
    header.className = 'accordion-header';
    header.innerHTML = `
      <img class="accordion-portrait" src="images/cards/${portraitCard.cardId}.webp" alt="${portraitCard.characterName}" loading="lazy">
      <div class="accordion-header-info">
        <div class="accordion-header-name">${titleText}</div>
        <div class="slot-sub">${subtitleText}</div>
      </div>
      <span class="accordion-chevron">${expanded ? '\u2212' : '+'}</span>
    `;
    header.onclick = () => {
      expanded ? state.mobileAccordionExpanded.delete(key) : state.mobileAccordionExpanded.add(key);
      renderInfoRowMobile(result, leaderCard, unit, scoreSupport, baseStats);
    };
    item.appendChild(header);

    if (expanded) {
      const body = document.createElement('div');
      body.className = 'accordion-body';
      bodyBuilder(body);
      item.appendChild(body);
    }

    return item;
  };

  infoRowEl.appendChild(
    makeAccordionItem('leader', leaderCard, leaderCard.characterName, 'Leader', (body) => {
      body.appendChild(renderLeaderSkillCard(result, leaderCard));
      const songPanel = document.createElement('div');
      songPanel.className = 'panel-sm leader-accent';
      const songLabel = document.createElement('div');
      songLabel.className = 'panel-label';
      songLabel.textContent = 'Song';
      songPanel.appendChild(songLabel);
      songPanel.appendChild(renderSongSlot());
      body.appendChild(songPanel);
    })
  );

  unit.forEach((u, i) => {
    infoRowEl.appendChild(
      makeAccordionItem(`unit-${i}`, u.card, u.card.characterName, u.card.cardSubtitle || '', (body) => {
        body.appendChild(renderMemberStatsCard(baseStats[i], maxStat));
        body.appendChild(renderMemberPassiveCard(result.passives[i], u.card));
        body.appendChild(renderMemberActiveCard(result.actives[i], u.card, scoreSupport));
      })
    );
  });
}

function renderMemberStatsCard(memberStat, maxStat) {
  const panel = document.createElement('div');
  panel.className = 'panel-sm';

  const label = document.createElement('div');
  label.className = 'panel-label';
  label.textContent = 'Parameters';
  label.appendChild(
    createInfoIcon(
      'Includes Member (blue) board bonuses for this card. Excludes Leader (red) buffs, matching the in-game card screen, and Green support bonuses from other characters\u2019 boards, since those depend on your whole roster rather than this unit.'
    )
  );
  panel.appendChild(label);

  const statsHtml = document.createElement('div');
  statsHtml.innerHTML = `
    <div class="member-stat-row">
      <span class="member-stat-label">PERF</span>
      <div class="meter perf"><span style="width:${maxStat ? Math.round((memberStat.stats.performance / maxStat) * 100) : 0}%"></span></div>
      <span class="member-stat-num">${memberStat.stats.performance}</span>
    </div>
    <div class="member-stat-row">
      <span class="member-stat-label">TECH</span>
      <div class="meter tech"><span style="width:${maxStat ? Math.round((memberStat.stats.technique / maxStat) * 100) : 0}%"></span></div>
      <span class="member-stat-num">${memberStat.stats.technique}</span>
    </div>
    <div class="member-stat-row">
      <span class="member-stat-label">SENSE</span>
      <div class="meter sense"><span style="width:${maxStat ? Math.round((memberStat.stats.sense / maxStat) * 100) : 0}%"></span></div>
      <span class="member-stat-num">${memberStat.stats.sense}</span>
    </div>
  `;
  while (statsHtml.firstChild) panel.appendChild(statsHtml.firstChild);

  return panel;
}

function renderLeaderSkillCard(result, leaderCard) {
  const panel = document.createElement('div');
  panel.className = 'panel-sm leader-accent';
  const label = document.createElement('div');
  label.className = 'panel-label';
  label.textContent = 'Leader Skill';
  panel.appendChild(label);

  if (!result.leader) {
    panel.innerHTML += '<div class="empty-state">No leader skill on this card.</div>';
    return panel;
  }

  const card = document.createElement('div');
  const met = result.leader.conditionMet;
  card.className = 'effect-card' + (met === false ? ' inactive' : '');

  const condText = result.leader.condition
    ? CONDITION_LABELS[result.leader.condition.type]?.(result.leader.condition) ?? 'Conditional'
    : 'Always active';

  const pillClass = met === true ? 'met' : met === false ? 'unmet' : 'situational';
  const pillText = met === true ? 'CONDITION MET' : met === false ? 'CONDITION NOT MET' : 'SITUATIONAL';

  let effectsHtml = '';
  for (const e of result.leader.effects) {
    effectsHtml += `<div class="effect-head"><span class="effect-name">${effectLabel(e.type)}</span><span class="effect-value">+${(Number(e.value) / 10).toFixed(0)}%</span></div>`;
  }
  if (!result.leader.effects.length) {
    effectsHtml = '<div class="effect-detail">No effect (condition not met)</div>';
  }

  card.innerHTML = `
    <span class="pill ${pillClass}">${pillText}</span>
    <div class="effect-detail" style="margin-top:6px;">${condText}</div>
    <div style="margin-top:8px;">${effectsHtml}</div>
  `;
  panel.appendChild(card);
  return panel;
}

function renderMemberPassiveCard(passiveResult, card) {
  const panel = document.createElement('div');
  panel.className = 'panel-sm';
  const label = document.createElement('div');
  label.className = 'panel-label';
  label.textContent = 'Passive Skill';
  panel.appendChild(label);

  const anyApplies = passiveResult.effects.some((e) => e.applies);
  const div = document.createElement('div');
  div.className = 'effect-card' + (passiveResult.effects.length && !anyApplies ? ' inactive' : '');

  let inner = '';
  if (!passiveResult.effects.length) {
    inner = '<div class="effect-detail">No passive skill</div>';
  }
  if (passiveResult.condition) {
    const condText = CONDITION_LABELS[passiveResult.condition.type]?.(passiveResult.condition) ?? 'Conditional';
    inner += `<div class="effect-detail">Requires ${condText}</div>`;
  }
  for (const e of passiveResult.effects) {
    const recipientNames = e.recipients.map((id) => DATA.byId[id]?.shortName).join(', ');
    const pillClass = e.applies ? 'met' : e.conditionMet === false ? 'unmet' : 'situational';
    const pillText = e.applies ? 'ACTIVE' : e.conditionMet === false ? 'CONDITION NOT MET' : 'NO TARGET';
    inner += `
      <div class="passive-effect-block">
        <span class="pill ${pillClass}">${pillText}</span>
        <div class="effect-head" style="margin-top:6px;">
          <span class="effect-name">${effectLabel(e.type)}</span>
          <span class="effect-value">+${(e.valuePermil / 10).toFixed(0)}%</span>
        </div>
        ${e.applies ? `<div class="effect-detail">\u2192 ${recipientNames}</div>` : ''}
      </div>`;
  }
  div.innerHTML = inner;
  panel.appendChild(div);
  return panel;
}

function renderMemberActiveCard(activeResult, card, scoreSupport) {
  const panel = document.createElement('div');
  panel.className = 'panel-sm';
  const label = document.createElement('div');
  label.className = 'panel-label';
  label.textContent = 'Active Skill';
  panel.appendChild(label);

  const support = scoreSupport[card.cardId] || 0;
  const effectText = activeResult.effects
    ?.map((e) => {
      const isPlainScoreUp = e.type.endsWith('_TYPE_SCORE_UP_PERMIL_UP');
      if (isPlainScoreUp && support) {
        return `${effectLabel(e.type)} +${e.valuePercent.toFixed(0)}% <span style="color:var(--orange)">+ ${support.toFixed(0)}%</span>`;
      }
      return `${effectLabel(e.type)} +${e.valuePercent.toFixed(0)}%`;
    })
    .join(', ') ?? '\u2014';

  const div = document.createElement('div');
  div.className = 'effect-card';
  let conditionLine = '';
  if (activeResult.enhancedCondition) {
    const condText = CONDITION_LABELS[activeResult.enhancedCondition.type]?.(activeResult.enhancedCondition) ?? 'Conditional';
    const met = activeResult.enhancedConditionMet;
    const pillClass = met === true ? 'met' : met === 'assumed' ? 'situational' : 'unmet';
    const pillText = met === true ? 'MET' : met === 'assumed' ? 'ASSUMED MET' : 'NOT MET';
    const valueNote =
      met === true
        ? 'boosted value shown'
        : met === 'assumed'
        ? 'boosted value assumed for simulation'
        : 'base value shown \u2014 would be higher if met';
    conditionLine = `<div class="effect-detail" style="margin-bottom:6px;"><span class="pill ${pillClass}">${pillText}</span> ${condText} \u2014 ${valueNote}</div>`;
  }
  div.innerHTML = `
    ${conditionLine}
    <div class="active-skill-grid">
      <span>Lv</span><span class="num">${activeResult.level ?? '\u2014'}</span>
      <span>Activation</span><span class="num">${activeResult.activationProbabilityPercent != null ? activeResult.activationProbabilityPercent.toFixed(0) + '%' : '\u2014'}</span>
      <span>Cooldown</span><span class="num">${activeResult.coolTimeSeconds != null ? activeResult.coolTimeSeconds.toFixed(0) + 's' : '\u2014'}</span>
      <span>Duration</span><span class="num">${activeResult.effectDurationSeconds != null ? activeResult.effectDurationSeconds.toFixed(0) + 's' : '\u2014'}</span>
    </div>
    <div class="effect-detail" style="margin-top:6px;">${effectText}</div>
  `;
  panel.appendChild(div);
  return panel;
}

/** Builds the full second-by-second coverage table as a standalone DOM
 *  fragment (not appended anywhere) - shared by the main page and the
 *  Compare page's per-team tabs, so both use the exact same proven logic.
 *  `referenceColEls`, if given, are used to match column widths to the
 *  selection cards above (main page only); omitted entirely falls back to
 *  sensible defaults, which is what Compare's tabbed view uses. */
const DIFFICULTIES = ['easy', 'normal', 'hard', 'expert'];

/** Small Easy/Normal/Hard/Expert toggle driving the coverage table's note-
 *  density column. Global (state.difficulty), not per-song - shared by the
 *  main builder and the Compare page since both read the same state field. */
function renderDifficultyPicker(container, onChange) {
  const row = document.createElement('div');
  row.className = 'difficulty-picker';
  for (const diff of DIFFICULTIES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'difficulty-btn' + (state.difficulty === diff ? ' active' : '');
    btn.textContent = diff[0].toUpperCase() + diff.slice(1);
    btn.onclick = () => {
      if (state.difficulty === diff) return;
      state.difficulty = diff;
      onChange();
    };
    row.appendChild(btn);
  }
  container.appendChild(row);
}

const NOTE_TYPE_LABELS = {
  T: 'tap',
  F: 'flick',
  LS: 'long start',
  LE: 'long end',
  LFE: 'long flick end',
  LR: 'long relay',
  LC: 'long hold',
};
function decodeNoteTypeBreakdown(typesObj) {
  if (!typesObj) return '';
  return Object.entries(typesObj)
    .map(([code, count]) => {
      const critical = code.endsWith('!');
      const base = critical ? code.slice(0, -1) : code;
      const label = NOTE_TYPE_LABELS[base] || base;
      return `${count} ${critical ? 'critical ' : ''}${label}`;
    })
    .join(', ');
}

function buildCoverageTable(timeline, unitCards, song, referenceColEls, noteDensityEntries) {
  const feverSecondsRounded = new Set(song.feverSeconds.map((s) => Math.round(s)));
  const specialWindows = song.feverSeconds
    .map((start, i) => ({ start, end: start + (timeline._specials?.[i]?.effectDurationSeconds || 0) }))
    .filter((w) => w.end > w.start);
  const inAnySpecialWindow = (t) => specialWindows.some((w) => t >= w.start && t < w.end);

  const wrap = document.createElement('div');
  wrap.className = 'coverage-table-wrap';

  const table = document.createElement('table');
  table.className = 'coverage-table';
  table.style.tableLayout = 'fixed';

  const leaderColWidth = referenceColEls?.[0]?.getBoundingClientRect().width || 90;
  const memberColWidths = referenceColEls
    ? Array.from(referenceColEls).slice(1).map((el) => el.getBoundingClientRect().width)
    : unitCards.map(() => 110);

  const colgroup = document.createElement('colgroup');
  const timeCol = document.createElement('col');
  timeCol.style.width = Math.round(leaderColWidth * 0.55) + 'px';
  colgroup.appendChild(timeCol);
  const maxCol = document.createElement('col');
  maxCol.style.width = Math.round(leaderColWidth * 0.45) + 'px';
  colgroup.appendChild(maxCol);
  const showNotesColumn = noteDensityEntries !== null;
  if (showNotesColumn) {
    const notesCol = document.createElement('col');
    notesCol.style.width = Math.round(leaderColWidth * 0.4) + 'px';
    colgroup.appendChild(notesCol);
  }
  memberColWidths.forEach((w) => {
    const c = document.createElement('col');
    c.style.width = w + 'px';
    colgroup.appendChild(c);
  });
  table.appendChild(colgroup);

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  const notesHeader = showNotesColumn ? '<th title="Notes this second (hover a value for the type breakdown)">Notes</th>' : '';
  headRow.innerHTML = '<th>Time</th><th>Max</th>' + notesHeader + unitCards.map((c) => `<th>${c.shortName}</th>`).join('');
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const point of timeline) {
    const tr = document.createElement('tr');
    const isFeverStart = feverSecondsRounded.has(point.t);
    if (isFeverStart) tr.classList.add('fever-row');
    else if (inAnySpecialWindow(point.t)) tr.classList.add('fever-window');
    if (point.t > 20 && point.maxBonus === 0) tr.classList.add('no-bonus-row');

    const mm = Math.floor(point.t / 60);
    const ss = String(point.t % 60).padStart(2, '0');
    let rowHtml = `<td>${mm}:${ss}${isFeverStart ? ' \u2605' : ''}</td>`;
    rowHtml += `<td class="cell-max">${point.maxBonus > 0 ? point.maxBonus.toFixed(1) + '%' : '\u2014'}</td>`;

    if (showNotesColumn) {
      const entry = noteDensityEntries === undefined ? undefined : noteDensityEntries[point.t];
      if (noteDensityEntries === undefined) {
        rowHtml += '<td class="cell-notes-loading">\u2026</td>';
      } else if (!entry || entry[0] === 0) {
        rowHtml += '<td class="cell-notes"></td>';
      } else {
        const breakdown = decodeNoteTypeBreakdown(entry[1]);
        const title = breakdown ? `${entry[0]} notes: ${breakdown}` : `${entry[0]} notes`;
        rowHtml += `<td class="cell-notes" title="${title}">${entry[0]}</td>`;
      }
    }

    for (const m of point.perMember) {
      if (m.active) {
        const isWinner = m.cardId === point.winnerCardId;
        const cls = isWinner ? 'cell-active cell-winner' : 'cell-active cell-suppressed';
        const borderColor = activationChanceColor(m.activationChance);
        const title = `${m.baseBonus.toFixed(1)}% + ${m.totalSupportBonus.toFixed(1)}% score support @ ${m.activationChance}% activation chance${isWinner ? '' : ' \u2014 suppressed by a higher/earlier bonus this second'}`;
        rowHtml += `<td class="${cls}" style="border-color:${borderColor}" title="${title}">${m.baseBonus.toFixed(1)}% + ${m.totalSupportBonus.toFixed(1)}% @ ${m.activationChance}%</td>`;
      } else {
        rowHtml += '<td>\u2014</td>';
      }
    }
    tr.innerHTML = rowHtml;
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

/** "Recommend Frequency Nodes" panel: on click, brute-forces the 0-3-per-
 *  member "Activation Frequency UP" node tiers that maximize this team's
 *  active-skill coverage of the selected song, previews current-vs-
 *  recommended node counts and the board-point cost to get there, and lets
 *  the user apply it in one click - reusing the same unlock-path logic a
 *  manual board click would use, just automated across all 5 boards at once.
 *  Nothing is changed until "Apply to Boards" is pressed.
 *
 *  An optional "Prioritize fever windows" checkbox switches the optimizer to
 *  lexicographic mode: fully cover the song's 5 fever/Special-Skill windows
 *  first, and only maximize the rest of the song's coverage as a tiebreak -
 *  same fever-window definition buildCoverageTable already uses elsewhere
 *  (each fever timestamp + that slot's Special Skill effect duration). */
function renderFrequencyNodePanel(unit, song, duration, specialResults) {
  const wrap = document.createElement('div');
  wrap.className = 'panel-sm';
  wrap.style.marginTop = '16px';

  const label = document.createElement('div');
  label.className = 'panel-label';
  label.textContent = 'Activation Frequency Nodes';
  wrap.appendChild(label);

  const feverRow = document.createElement('label');
  feverRow.style.display = 'flex';
  feverRow.style.alignItems = 'center';
  feverRow.style.gap = '6px';
  feverRow.style.margin = '4px 0 10px';
  feverRow.style.fontSize = '13px';
  feverRow.style.color = 'var(--text-dim)';
  const feverCheckbox = document.createElement('input');
  feverCheckbox.type = 'checkbox';
  feverCheckbox.checked = true;
  feverRow.appendChild(feverCheckbox);
  feverRow.appendChild(document.createTextNode('Prioritize fever windows (cover those first, then the rest of the song)'));
  wrap.appendChild(feverRow);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'board-btn';
  btn.textContent = 'Recommend Frequency Nodes';
  wrap.appendChild(btn);

  const resultBox = document.createElement('div');
  resultBox.style.marginTop = '10px';
  wrap.appendChild(resultBox);

  btn.addEventListener('click', () => {
    const activeSkills = unit.map((u) => {
      const level = getSkillLevel(u.card, u.bloom, DATA.cardPotentials, SKILL_LEVEL_TYPES.ACTIVE);
      const levelData = u.card.activeSkill?.[String(level)];
      return levelData
        ? { coolTimeSeconds: levelData.coolTimeMs / 1000, effectDurationSeconds: levelData.effectDurationMs / 1000 }
        : { coolTimeSeconds: null, effectDurationSeconds: null };
    });

    const songDuration = song.playingSeconds || duration;

    // Fever windows: each of the song's 5 fever timestamps paired with that
    // slot's Special Skill effect duration - identical definition to
    // buildCoverageTable's own specialWindows, so "fever" means the same
    // thing everywhere in the app.
    const feverWindows = feverCheckbox.checked
      ? (song.feverSeconds || [])
          .map((start, i) => [start, start + (specialResults?.[i]?.effectDurationSeconds || 0)])
          .filter(([s, e]) => e > s)
      : [];

    const rec = findOptimalFrequencyNodes(activeSkills, songDuration, feverWindows);
    if (!rec) {
      resultBox.innerHTML = '<div class="empty-state">Could not compute a recommendation for this team.</div>';
      return;
    }

    const perMember = unit.map((u, i) => {
      const characterId = u.card.characterId;
      const charData = DATA.boardCategories[characterId];
      const boardIndex = charData ? buildBoardIndex(charData) : null;
      const currentSet = state.boardSelections[characterId] || new Set();
      const plan = boardIndex
        ? planFrequencyNodeUnlock(boardIndex, currentSet, rec.tiers[i])
        : { targetCount: rec.tiers[i], currentCount: 0, nodesToUnlock: [], nodesToLock: [], additionalPointCost: 0, pointsRefunded: 0, alreadySufficient: true };
      return { u, characterId, plan };
    });

    const totalAdditionalCost = perMember.reduce((sum, m) => sum + m.plan.additionalPointCost, 0);
    const totalRefunded = perMember.reduce((sum, m) => sum + m.plan.pointsRefunded, 0);
    const anyChanges = perMember.some((m) => m.plan.nodesToUnlock.length > 0 || m.plan.nodesToLock.length > 0);

    const rows = perMember
      .map(({ u, plan }) => {
        const changeCell =
          plan.currentCount === plan.targetCount
            ? `${plan.targetCount}/3 (no change)`
            : `${plan.currentCount}/3 \u2192 ${plan.targetCount}/3`;
        const costCell = plan.additionalPointCost
          ? `+${plan.additionalPointCost} pts`
          : plan.pointsRefunded
          ? `\u2212${plan.pointsRefunded} pts`
          : '\u2014';
        return `<tr><td>${u.card.shortName}</td><td>${changeCell}</td><td class="qty">${costCell}</td></tr>`;
      })
      .join('');

    const gapPill = rec.isFullCoverage
      ? '<span class="pill met">100% COVERAGE</span>'
      : `<span class="pill situational">${rec.coveragePercent.toFixed(1)}% COVERAGE</span>`;
    const gapNote = rec.isFullCoverage
      ? 'No gaps across the full track.'
      : `${rec.gaps.length} gap${rec.gaps.length === 1 ? '' : 's'} remain \u2014 this is the best achievable ceiling for this exact team at these skill levels.`;

    let feverLine = '';
    if (feverWindows.length) {
      const feverPill = rec.isFullFeverCoverage
        ? '<span class="pill met">100% SPECIAL SKILL COVERAGE</span>'
        : `<span class="pill unmet">${rec.feverCoveragePercent.toFixed(1)}% SPECIAL SKILL COVERAGE</span>`;
      feverLine = `<div class="effect-detail" style="margin-bottom:4px;">${feverPill} <span style="margin-left:8px;">across the song's 5 fever windows (${rec.feverTotalSeconds.toFixed(1)}s total) \u2014 prioritized ahead of overall coverage.</span></div>`;
    }

    const costSummary = [
      totalAdditionalCost ? `<strong>${totalAdditionalCost}</strong> additional board points` : null,
      totalRefunded ? `<strong>${totalRefunded}</strong> points refunded from locking unneeded nodes` : null,
    ]
      .filter(Boolean)
      .join(' \u00b7 ') || 'no board point changes needed';

    resultBox.innerHTML = `
      ${feverLine}
      <div class="effect-detail" style="margin-bottom:8px;">${gapPill} <span style="margin-left:8px;">${gapNote}</span></div>
      <table class="cost-calc-mat-table">
        <thead><tr><th>Member</th><th>Nodes</th><th>Cost</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="effect-detail" style="margin-top:8px;">${costSummary}</div>
    `;

    if (anyChanges) {
      const applyBtn = document.createElement('button');
      applyBtn.type = 'button';
      applyBtn.className = 'board-btn';
      applyBtn.style.marginTop = '10px';
      applyBtn.textContent = 'Apply to Boards';
      applyBtn.addEventListener('click', () => {
        for (const { characterId, plan } of perMember) {
          if (!plan.nodesToUnlock.length && !plan.nodesToLock.length) continue;
          if (!state.boardSelections[characterId]) state.boardSelections[characterId] = new Set();
          for (const posKey of plan.nodesToUnlock) state.boardSelections[characterId].add(posKey);
          for (const posKey of plan.nodesToLock) state.boardSelections[characterId].delete(posKey);
        }
        recompute();
        renderSelectionRow();
      });
      resultBox.appendChild(applyBtn);
    } else {
      const note = document.createElement('div');
      note.className = 'effect-detail';
      note.style.marginTop = '6px';
      note.textContent = 'Boards are already at the recommended configuration \u2014 nothing to apply.';
      resultBox.appendChild(note);
    }
  });

  return wrap;
}

function renderCoverageRow(result, unit, scoreSupport) {
  coverageRowEl.innerHTML = '';
  coverageRowEl.className = 'panel';

  const label = document.createElement('div');
  label.className = 'panel-label';
  label.textContent = 'Bonus Coverage \u00b7 Second-by-Second';
  coverageRowEl.appendChild(label);

  const song = state.songId ? DATA.songs.find((s) => s.id === state.songId) : null;

  if (!song) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'Select a song above to simulate active skill uptime across the track.';
    coverageRowEl.appendChild(empty);
    return;
  }

  renderDifficultyPicker(coverageRowEl, recompute);

  const unitCards = unit.map((u) => u.card);
  const duration = song.playingSeconds || Math.max(...song.feverSeconds) + 15;

  const timeline = simulateActiveTimeline({
    activeResults: result.actives,
    specialResults: result.specials,
    unitCards,
    scoreSupport,
    feverSeconds: song.feverSeconds,
    durationSeconds: duration,
  });
  timeline._specials = result.specials; // stashed for buildCoverageTable's special-window highlighting

  const noteDensityBySong = getNoteDensity(song.id);
  const noteDensityEntries = noteDensityBySong === undefined ? undefined : noteDensityBySong === null ? null : noteDensityBySong[state.difficulty] ?? null;

  const cardCols = document.querySelectorAll('#selection-row .member-col');
  coverageRowEl.appendChild(buildCoverageTable(timeline, unitCards, song, cardCols, noteDensityEntries));

  // Full-width horizontal summary, below the table.
  const noBonusSeconds = timeline.filter((p) => p.t > 20 && p.maxBonus === 0).length;
  const noBonusDuringSpecial = timeline.filter((p) => p.noBonusDuringSpecial).length;
  const peakBonus = Math.max(...timeline.map((p) => p.maxBonus));
  const avgBonus = timeline.reduce((sum, p) => sum + p.maxBonus, 0) / timeline.length;
  const noBonusPercent = (noBonusSeconds / duration) * 100;
  const noBonusDuringSpecialPercent = (noBonusDuringSpecial / duration) * 100;

  const summary = document.createElement('div');
  summary.className = 'coverage-summary';
  summary.style.marginTop = '16px';
  summary.style.marginBottom = '0';
  summary.innerHTML = `
    <div class="coverage-stat"><div class="stat-num">${noBonusSeconds} <span class="stat-num-sub">(${noBonusPercent.toFixed(0)}%)</span></div><div class="stat-label">Secs with no bonus (&gt;20s in)</div></div>
    <div class="coverage-stat"><div class="stat-num">${noBonusDuringSpecial} <span class="stat-num-sub">(${noBonusDuringSpecialPercent.toFixed(0)}%)</span></div><div class="stat-label">Special skill secs w/ no bonus</div></div>
    <div class="coverage-stat"><div class="stat-num">${peakBonus.toFixed(0)}%</div><div class="stat-label">Peak score bonus</div></div>
    <div class="coverage-stat"><div class="stat-num">${avgBonus.toFixed(0)}%</div><div class="stat-label">Average score bonus</div></div>
  `;
  coverageRowEl.appendChild(summary);

  coverageRowEl.appendChild(renderFrequencyNodePanel(unit, song, duration, result.specials));

  // Per-member stats: how much of the song each member's skill was actually
  // up, how often that uptime got suppressed by someone else's bigger bonus,
  // and an expected-value figure (her typical bonus when active, weighted by
  // how likely she is to actually trigger).
  const memberLabel = document.createElement('div');
  memberLabel.className = 'panel-label';
  memberLabel.style.marginTop = '18px';
  memberLabel.textContent = 'Per-Member Stats';
  coverageRowEl.appendChild(memberLabel);

  const memberStatsWrap = document.createElement('div');
  memberStatsWrap.className = 'member-coverage-stats';

  for (const u of unitCards) {
    const activeSeconds = [];
    let suppressedCount = 0;
    for (const point of timeline) {
      const m = point.perMember.find((pm) => pm.cardId === u.cardId);
      if (m?.active) {
        activeSeconds.push(m);
        if (m.cardId !== point.winnerCardId) suppressedCount++;
      }
    }
    const coveragePercent = (activeSeconds.length / duration) * 100;
    const suppressedPercent = activeSeconds.length ? (suppressedCount / activeSeconds.length) * 100 : 0;
    // Per-second expected value (bonus x chance, THEN averaged) rather than
    // averaging bonus and chance separately - activation chance is boosted
    // during a Special Skill (fever) window, same seconds where the bonus
    // itself is often also boosted by that window's score support. Averaging
    // them separately loses that correlation and understates the expected value.
    const expectedValue = activeSeconds.length
      ? activeSeconds.reduce((s, m) => s + m.effectiveBonus * (m.activationChance / 100), 0) / activeSeconds.length
      : 0;

    const card = document.createElement('div');
    card.className = 'member-coverage-card';
    card.innerHTML = `
      <div class="member-coverage-name">${u.shortName}</div>
      <div class="member-coverage-row"><span>Coverage</span><span class="num">${coveragePercent.toFixed(0)}%</span></div>
      <div class="member-coverage-row"><span>Suppressed</span><span class="num">${suppressedPercent.toFixed(0)}%</span></div>
      <div class="member-coverage-row"><span>Expected bonus \u00d7 chance</span><span class="num">${expectedValue.toFixed(1)}%</span></div>
    `;
    memberStatsWrap.appendChild(card);
  }
  coverageRowEl.appendChild(memberStatsWrap);
}

function renderPowerRow(result, leaderCard, scoreSupport, baseStats) {
  powerRowEl.innerHTML = '';
  const panel = document.createElement('div');
  panel.className = 'panel';
  const label = document.createElement('div');
  label.className = 'panel-label';
  label.textContent = 'Overall Power';
  panel.appendChild(label);

  const breakdown = computeOverallPowerBreakdown(result, baseStats);
  // Memory Bonus ("Unit Stats X%" on the Memory Stand screen) - a % of
  // Member Parameter only, not the whole subtotal.
  const memoryBonus = Math.round(breakdown.memberParameter * (state.manualMemoryBonusPercent / 100));
  // Member Power-Up Bonus ("Upgrade Bonus X%" on the Member training screen)
  // - a % of Member Parameter + Outfit Skill + Passive Skill + Holomem Board
  // Bonus + Memory Bonus (everything else computed so far).
  const subtotalBeforePowerUp =
    breakdown.memberParameter + breakdown.outfitSkill + breakdown.passiveSkill + breakdown.holomemBoardBonus + memoryBonus;
  const powerUpBonus = Math.round(subtotalBeforePowerUp * (state.manualPowerUpBonusPercent / 100));

  const total = subtotalBeforePowerUp + powerUpBonus;

  const totalEl = document.createElement('div');
  totalEl.className = 'power-total';
  totalEl.textContent = total.toLocaleString();
  panel.appendChild(totalEl);

  const grid = document.createElement('div');
  grid.className = 'power-breakdown';

  const addRow = (label, valueNode, infoIcon) => {
    const labelEl = document.createElement('span');
    labelEl.textContent = label;
    if (infoIcon) labelEl.appendChild(infoIcon);
    grid.appendChild(labelEl);
    grid.appendChild(valueNode);
  };

  const makeNum = (n) => {
    const el = document.createElement('span');
    el.className = 'num';
    el.textContent = n.toLocaleString();
    return el;
  };
  addRow('Member Parameter', makeNum(breakdown.memberParameter));
  addRow('Outfit Skill', makeNum(breakdown.outfitSkill));
  addRow('Passive Skill', makeNum(breakdown.passiveSkill));
  addRow('Holomem Board Bonus', makeNum(breakdown.holomemBoardBonus));

  const makePercentInput = (value, computedValue, onChange) => {
    const wrap = document.createElement('span');
    wrap.className = 'power-percent-wrap';
    const el = document.createElement('input');
    el.type = 'number';
    el.className = 'mini-input power-manual-input';
    el.min = 0;
    el.step = 0.01;
    el.value = value;
    el.onclick = (e) => e.stopPropagation();
    el.onchange = () => {
      onChange(clamp(Number(el.value) || 0, 0, 1000));
      recompute();
    };
    wrap.appendChild(el);
    const pct = document.createElement('span');
    pct.className = 'power-percent-sign';
    pct.textContent = '%';
    wrap.appendChild(pct);
    const computed = document.createElement('span');
    computed.className = 'num power-percent-computed';
    computed.textContent = `= +${computedValue.toLocaleString()}`;
    wrap.appendChild(computed);
    return wrap;
  };
  addRow(
    'Memory Bonus',
    makePercentInput(state.manualMemoryBonusPercent, memoryBonus, (v) => (state.manualMemoryBonusPercent = v)),
    createInfoIcon(
      'Enter the "Unit Stats" percentage shown on the Memory Stand screen (Memory tab).',
      'images/help/memory_bonus_reference.webp'
    )
  );
  addRow(
    'Member Power-Up Bonus',
    makePercentInput(state.manualPowerUpBonusPercent, powerUpBonus, (v) => (state.manualPowerUpBonusPercent = v)),
    createInfoIcon(
      'Enter the "Upgrade Bonus" percentage shown on the Member training screen (Level Up / SP Training / Bloom tab).',
      'images/help/power_up_bonus_reference.webp'
    )
  );

  panel.appendChild(grid);

  const note = document.createElement('div');
  note.className = 'estimate-note';
  note.textContent =
    'Member Parameter, Outfit Skill, Passive Skill, and Holomem Board Bonus are computed directly from real game data. Green (support) board bonuses aren\u2019t included in Holomem Board Bonus yet. Memory Bonus is the "Unit Stats %" from the Memory Stand screen, applied to Member Parameter only. Member Power-Up Bonus is the "Upgrade Bonus %" from the Member training screen, applied to Member Parameter + Outfit Skill + Passive Skill + Holomem Board Bonus + Memory Bonus. Enter both manually above.';
  panel.appendChild(note);

  powerRowEl.appendChild(panel);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

const PRESETS_STORAGE_KEY = 'hoshidori_presets';

function loadPresetsFromStorage() {
  try {
    const raw = localStorage.getItem(PRESETS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function savePresetsToStorage(presets) {
  try {
    localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(presets));
    return true;
  } catch {
    return false; // e.g. storage disabled/full
  }
}

/** Every filled slot's characterId (leader + unit), deduplicated - the set of
 *  characters whose board/connect selections are relevant to save/restore. */
function getTeamCharacterIds() {
  const ids = new Set();
  const leaderCard = state.leader.cardId ? DATA.byId[state.leader.cardId] : null;
  if (leaderCard) ids.add(leaderCard.characterId);
  for (const u of state.unit) {
    const card = u.cardId ? DATA.byId[u.cardId] : null;
    if (card) ids.add(card.characterId);
  }
  return [...ids];
}

function buildPresetFromCurrentState(name) {
  const characterData = {};
  for (const characterId of getTeamCharacterIds()) {
    characterData[characterId] = {
      boardSelections: [...(state.boardSelections[characterId] || [])],
      connectSelections: state.connectSelections[characterId] || null,
    };
  }
  return {
    name,
    savedAt: Date.now(),
    leader: { ...state.leader },
    unit: state.unit.map((u) => ({ ...u })),
    songId: state.songId,
    manualMemoryBonusPercent: state.manualMemoryBonusPercent,
    manualPowerUpBonusPercent: state.manualPowerUpBonusPercent,
    characterData,
  };
}

function applyPreset(preset) {
  state.leader = { ...preset.leader };
  state.unit = preset.unit.map((u) => ({ ...u }));
  state.songId = preset.songId ?? null;
  state.manualMemoryBonusPercent = preset.manualMemoryBonusPercent ?? 0;
  state.manualPowerUpBonusPercent = preset.manualPowerUpBonusPercent ?? 0;
  for (const [characterId, data] of Object.entries(preset.characterData || {})) {
    state.boardSelections[characterId] = new Set(data.boardSelections || []);
    if (data.connectSelections) state.connectSelections[characterId] = data.connectSelections;
  }
  renderSelectionRow();
  recompute();
}

function openPresetsPanel() {
  const overlay = document.createElement('div');
  overlay.className = 'picker-overlay';

  const box = document.createElement('div');
  box.className = 'picker-box presets-box';

  const header = document.createElement('div');
  header.className = 'picker-search';
  header.innerHTML = `<div class="board-editor-title">Presets</div><div class="board-editor-subtitle">Saves the current leader, unit, their levels/bloom, and their board + connect effect selections.</div>`;
  box.appendChild(header);

  const saveRow = document.createElement('div');
  saveRow.className = 'preset-save-row';
  const nameInput = document.createElement('input');
  nameInput.placeholder = 'Name this team\u2026';
  nameInput.maxLength = 60;
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'board-btn';
  saveBtn.textContent = 'Save current team';
  saveBtn.onclick = () => {
    const name = nameInput.value.trim();
    if (!name) {
      nameInput.focus();
      return;
    }
    const hasAnyone = state.leader.cardId || state.unit.some((u) => u.cardId);
    if (!hasAnyone) return;
    const presets = loadPresetsFromStorage();
    presets.unshift(buildPresetFromCurrentState(name));
    const ok = savePresetsToStorage(presets);
    if (!ok) {
      statusMsg.textContent = 'Could not save \u2014 your browser storage may be full or disabled.';
      return;
    }
    nameInput.value = '';
    statusMsg.textContent = '';
    renderList();
  };
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveBtn.click();
  });
  saveRow.appendChild(nameInput);
  saveRow.appendChild(saveBtn);
  box.appendChild(saveRow);

  const statusMsg = document.createElement('div');
  statusMsg.className = 'effect-detail';
  statusMsg.style.padding = '0 14px';
  box.appendChild(statusMsg);

  const list = document.createElement('div');
  list.className = 'picker-list';
  box.appendChild(list);

  function renderList() {
    list.innerHTML = '';
    const presets = loadPresetsFromStorage();
    if (!presets.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'No saved presets yet.';
      list.appendChild(empty);
      return;
    }
    presets.forEach((preset, i) => {
      const row = document.createElement('div');
      row.className = 'preset-row';

      const leaderCard = preset.leader?.cardId ? DATA.byId[preset.leader.cardId] : null;
      const memberNames = preset.unit
        .map((u) => (u.cardId ? DATA.byId[u.cardId]?.shortName : null))
        .filter(Boolean)
        .join(', ');
      const date = new Date(preset.savedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

      const info = document.createElement('div');
      info.className = 'preset-row-info';
      info.innerHTML = `<div class="preset-row-name">${preset.name}</div><div class="picker-item-sub">Leader: ${leaderCard?.shortName ?? '\u2014'} \u00b7 ${memberNames || 'no members'}</div><div class="picker-item-sub">${date}</div>`;
      row.appendChild(info);

      const actions = document.createElement('div');
      actions.className = 'preset-row-actions';

      const loadBtn = document.createElement('button');
      loadBtn.type = 'button';
      loadBtn.className = 'board-btn';
      loadBtn.textContent = 'Load';
      loadBtn.onclick = () => {
        applyPreset(preset);
        overlay.remove();
      };
      actions.appendChild(loadBtn);

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'board-btn';
      deleteBtn.textContent = 'Delete';
      deleteBtn.onclick = () => {
        const fresh = loadPresetsFromStorage();
        fresh.splice(i, 1);
        savePresetsToStorage(fresh);
        renderList();
      };
      actions.appendChild(deleteBtn);

      row.appendChild(actions);
      list.appendChild(row);
    });
  }
  renderList();

  const close = document.createElement('div');
  close.className = 'picker-close';
  close.textContent = 'CLOSE';
  close.onclick = () => overlay.remove();
  box.appendChild(close);

  overlay.appendChild(box);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  document.body.appendChild(overlay);
  nameInput.focus();
}

/** Presets store board/connect data nested under characterData[id], while
 *  computeFullResult expects the flat, directly-keyed shape state itself
 *  uses (boardSelections as Sets, connectSelections as a direct map) -
 *  convert between the two, same logic as applyPreset() uses for the main page. */
function presetToTeamState(preset) {
  const boardSelections = {};
  const connectSelections = {};
  for (const [characterId, data] of Object.entries(preset.characterData || {})) {
    boardSelections[characterId] = new Set(data.boardSelections || []);
    if (data.connectSelections) connectSelections[characterId] = data.connectSelections;
  }
  return {
    leader: preset.leader,
    unit: preset.unit,
    songId: preset.songId ?? null,
    boardSelections,
    connectSelections,
  };
}

/** Builds a compact single-line summary of a preset's leader + unit, used in
 *  both the preset-picker sub-list and the compare page's column headers. */
function presetSummaryLine(preset) {
  const leaderCard = preset.leader?.cardId ? DATA.byId[preset.leader.cardId] : null;
  const memberNames = preset.unit
    .map((u) => (u.cardId ? DATA.byId[u.cardId]?.shortName : null))
    .filter(Boolean)
    .join(', ');
  return `Leader: ${leaderCard?.shortName ?? '\u2014'} \u00b7 ${memberNames || 'no members'}`;
}

/** Builds one team column for the compare page: leader on top, 5 members
 *  stacked vertically below, each showing portrait + name + subtitle. */
function renderCompareTeamColumn(side, preset, computed, onChoosePreset) {
  const col = document.createElement('div');
  col.className = 'compare-team-col compare-side-' + side;

  if (!preset) {
    const chooseBtn = document.createElement('button');
    chooseBtn.type = 'button';
    chooseBtn.className = 'board-btn compare-choose-btn';
    chooseBtn.textContent = `Choose Preset ${side === 'a' ? '1' : '2'}`;
    chooseBtn.onclick = onChoosePreset;
    col.appendChild(chooseBtn);
    return col;
  }

  const changeBtn = document.createElement('button');
  changeBtn.type = 'button';
  changeBtn.className = 'compare-change-btn';
  changeBtn.textContent = `${preset.name} (change)`;
  changeBtn.onclick = onChoosePreset;
  col.appendChild(changeBtn);

  if (!computed) {
    const warn = document.createElement('div');
    warn.className = 'empty-state';
    warn.textContent = 'Missing leader or unit.';
    col.appendChild(warn);
    return col;
  }

  const makeMemberRow = (card, roleLabel) => {
    const row = document.createElement('div');
    row.className = 'compare-member-row';
    const portrait = document.createElement('img');
    portrait.className = 'compare-member-portrait';
    portrait.src = `images/cards/${card.cardId}.webp`;
    portrait.alt = card.characterName;
    portrait.loading = 'lazy';
    const info = document.createElement('div');
    info.className = 'compare-member-info';
    info.innerHTML = `<div class="compare-member-name">${card.characterName}</div><div class="compare-member-role">${roleLabel}</div>`;
    if (side === 'a') {
      row.appendChild(portrait);
      row.appendChild(info);
    } else {
      row.appendChild(info);
      row.appendChild(portrait);
    }
    return row;
  };

  col.appendChild(makeMemberRow(computed.leaderCard, 'Leader'));
  const divider = document.createElement('div');
  divider.className = 'compare-team-divider';
  col.appendChild(divider);
  for (const u of computed.unit) {
    col.appendChild(makeMemberRow(u.card, u.card.cardSubtitle || ''));
  }

  return col;
}

function computeComparePower(preset, computed) {
  const breakdown = computeOverallPowerBreakdown(computed.result, computed.pureBaseStats);
  const memoryBonus = Math.round(breakdown.memberParameter * ((preset.manualMemoryBonusPercent || 0) / 100));
  const subtotal =
    breakdown.memberParameter + breakdown.outfitSkill + breakdown.passiveSkill + breakdown.holomemBoardBonus + memoryBonus;
  const powerUpBonus = Math.round(subtotal * ((preset.manualPowerUpBonusPercent || 0) / 100));
  const total = subtotal + powerUpBonus;
  return { ...breakdown, memoryBonus, powerUpBonus, total };
}

function computeCompareCoverage(computed, song) {
  if (!song) return null;
  const duration = song.playingSeconds || Math.max(...song.feverSeconds) + 15;
  const unitCards = computed.unit.map((u) => u.card);
  const timeline = simulateActiveTimeline({
    activeResults: computed.result.actives,
    specialResults: computed.result.specials,
    unitCards,
    scoreSupport: computed.scoreSupport,
    feverSeconds: song.feverSeconds,
    durationSeconds: duration,
  });
  const noBonusSeconds = timeline.filter((p) => p.t > 20 && p.maxBonus === 0).length;
  const noBonusDuringSpecial = timeline.filter((p) => p.noBonusDuringSpecial).length;
  const peakBonus = Math.max(...timeline.map((p) => p.maxBonus));
  const avgBonus = timeline.reduce((sum, p) => sum + p.maxBonus, 0) / timeline.length;

  const perMember = unitCards.map((u) => {
    const activeSeconds = [];
    let suppressedCount = 0;
    for (const point of timeline) {
      const m = point.perMember.find((pm) => pm.cardId === u.cardId);
      if (m?.active) {
        activeSeconds.push(m);
        if (m.cardId !== point.winnerCardId) suppressedCount++;
      }
    }
    const coveragePercent = (activeSeconds.length / duration) * 100;
    const suppressedPercent = activeSeconds.length ? (suppressedCount / activeSeconds.length) * 100 : 0;
    const expectedValue = activeSeconds.length
      ? activeSeconds.reduce((s, m) => s + m.effectiveBonus * (m.activationChance / 100), 0) / activeSeconds.length
      : 0;
    return { name: u.shortName, coveragePercent, suppressedPercent, expectedValue };
  });

  return { duration, noBonusSeconds, noBonusDuringSpecial, peakBonus, avgBonus, perMember, songTitle: song.title };
}

/** A single scoreboard-style row: value A on the left, label centered, value
 *  B on the right - the "in-between" comparison format the layout calls for,
 *  rather than two separate side-by-side blocks. */
function compareRow(label, valueA, valueB, highlightHigher) {
  const row = document.createElement('div');
  row.className = 'compare-row';
  const aEl = document.createElement('span');
  aEl.className = 'compare-row-value compare-row-value-a';
  const bEl = document.createElement('span');
  bEl.className = 'compare-row-value compare-row-value-b';
  aEl.textContent = valueA;
  bEl.textContent = valueB;
  if (highlightHigher) {
    const numA = parseFloat(String(valueA).replace(/[^0-9.-]/g, ''));
    const numB = parseFloat(String(valueB).replace(/[^0-9.-]/g, ''));
    if (!Number.isNaN(numA) && !Number.isNaN(numB) && numA !== numB) {
      (numA > numB ? aEl : bEl).classList.add('compare-row-value-winner');
    }
  }
  const labelEl = document.createElement('span');
  labelEl.className = 'compare-row-label';
  labelEl.textContent = label;
  row.appendChild(aEl);
  row.appendChild(labelEl);
  row.appendChild(bEl);
  return row;
}

function renderCompareMiddle(preset1, computed1, preset2, computed2, songA, songB, onChangeSongA, onChangeSongB) {
  const middle = document.createElement('div');
  middle.className = 'compare-middle-col';

  // Overall Power
  const powerPanel = document.createElement('div');
  powerPanel.className = 'panel compare-mid-panel';
  const powerLabel = document.createElement('div');
  powerLabel.className = 'panel-label';
  powerLabel.textContent = 'Overall Power';
  powerPanel.appendChild(powerLabel);

  const powerA = computeComparePower(preset1, computed1);
  const powerB = computeComparePower(preset2, computed2);

  const totalRow = document.createElement('div');
  totalRow.className = 'compare-row compare-row-total';
  totalRow.innerHTML = `<span class="compare-row-value compare-row-value-a ${powerA.total >= powerB.total ? 'compare-row-value-winner' : ''}">${powerA.total.toLocaleString()}</span><span class="compare-row-label">Total</span><span class="compare-row-value compare-row-value-b ${powerB.total > powerA.total ? 'compare-row-value-winner' : ''}">${powerB.total.toLocaleString()}</span>`;
  powerPanel.appendChild(totalRow);

  powerPanel.appendChild(compareRow('Member Parameter', powerA.memberParameter.toLocaleString(), powerB.memberParameter.toLocaleString(), true));
  powerPanel.appendChild(compareRow('Outfit Skill', powerA.outfitSkill.toLocaleString(), powerB.outfitSkill.toLocaleString(), true));
  powerPanel.appendChild(compareRow('Passive Skill', powerA.passiveSkill.toLocaleString(), powerB.passiveSkill.toLocaleString(), true));
  powerPanel.appendChild(compareRow('Holomem Board Bonus', powerA.holomemBoardBonus.toLocaleString(), powerB.holomemBoardBonus.toLocaleString(), true));
  powerPanel.appendChild(compareRow('Memory Bonus', powerA.memoryBonus.toLocaleString(), powerB.memoryBonus.toLocaleString(), true));
  powerPanel.appendChild(compareRow('Member Power-Up Bonus', powerA.powerUpBonus.toLocaleString(), powerB.powerUpBonus.toLocaleString(), true));
  middle.appendChild(powerPanel);

  // Coverage - each side picks its OWN song independently. Pick the same
  // song on both sides to compare two teams head-to-head; pick different
  // songs to see how (even the same) team's coverage shifts across tracks.
  const coveragePanel = document.createElement('div');
  coveragePanel.className = 'panel compare-mid-panel';
  const coverageLabel = document.createElement('div');
  coverageLabel.className = 'panel-label';
  coverageLabel.textContent = 'Coverage Statistics';
  coveragePanel.appendChild(coverageLabel);

  const songRow = document.createElement('div');
  songRow.className = 'compare-row compare-song-row';
  const songBtnA = document.createElement('button');
  songBtnA.type = 'button';
  songBtnA.className = 'board-btn compare-song-btn-a';
  songBtnA.textContent = songA ? `${songA.title} (change)` : 'Choose a song';
  songBtnA.onclick = onChangeSongA;
  const songLabelEl = document.createElement('span');
  songLabelEl.className = 'compare-row-label';
  songLabelEl.textContent = 'Song';
  const songBtnB = document.createElement('button');
  songBtnB.type = 'button';
  songBtnB.className = 'board-btn compare-song-btn-b';
  songBtnB.textContent = songB ? `${songB.title} (change)` : 'Choose a song';
  songBtnB.onclick = onChangeSongB;
  songRow.appendChild(songBtnA);
  songRow.appendChild(songLabelEl);
  songRow.appendChild(songBtnB);
  coveragePanel.appendChild(songRow);

  const covA = songA ? computeCompareCoverage(computed1, songA) : null;
  const covB = songB ? computeCompareCoverage(computed2, songB) : null;

  if (!covA && !covB) {
    const warn = document.createElement('div');
    warn.className = 'empty-state';
    warn.textContent = 'Choose a song for each side above to simulate coverage.';
    coveragePanel.appendChild(warn);
  } else {
    const pct = (n, d) => `${n} (${((n / d) * 100).toFixed(0)}%)`;
    coveragePanel.appendChild(
      compareRow(
        'Secs with no bonus (>20s in)',
        covA ? pct(covA.noBonusSeconds, covA.duration) : '\u2014',
        covB ? pct(covB.noBonusSeconds, covB.duration) : '\u2014',
        false
      )
    );
    coveragePanel.appendChild(
      compareRow(
        'Special skill secs w/ no bonus',
        covA ? pct(covA.noBonusDuringSpecial, covA.duration) : '\u2014',
        covB ? pct(covB.noBonusDuringSpecial, covB.duration) : '\u2014',
        false
      )
    );
    coveragePanel.appendChild(
      compareRow('Peak score bonus', covA ? covA.peakBonus.toFixed(0) + '%' : '\u2014', covB ? covB.peakBonus.toFixed(0) + '%' : '\u2014', true)
    );
    coveragePanel.appendChild(
      compareRow('Average score bonus', covA ? covA.avgBonus.toFixed(0) + '%' : '\u2014', covB ? covB.avgBonus.toFixed(0) + '%' : '\u2014', true)
    );

    const memberHeader = document.createElement('div');
    memberHeader.className = 'compare-member-stats-header';
    memberHeader.textContent = 'Per-Member';
    coveragePanel.appendChild(memberHeader);

    const maxLen = Math.max(covA?.perMember.length || 0, covB?.perMember.length || 0);
    for (let i = 0; i < maxLen; i++) {
      const ma = covA?.perMember[i];
      const mb = covB?.perMember[i];
      const group = document.createElement('div');
      group.className = 'compare-member-stat-group';

      const groupHeader = document.createElement('div');
      groupHeader.className = 'compare-performer-header';
      const nameA = ma?.name ?? '\u2014';
      const nameB = mb?.name ?? '\u2014';
      const sameCharacter = ma && mb && nameA === nameB;
      groupHeader.innerHTML = sameCharacter
        ? `<span class="compare-performer-slot">Performer ${i + 1}</span><span class="compare-performer-names">${nameA}</span>`
        : `<span class="compare-performer-slot">Performer ${i + 1}</span><span class="compare-performer-names">${nameA} <span class="compare-performer-vs">vs</span> ${nameB}</span>`;
      group.appendChild(groupHeader);

      group.appendChild(compareRow('Coverage', ma ? ma.coveragePercent.toFixed(0) + '%' : '\u2014', mb ? mb.coveragePercent.toFixed(0) + '%' : '\u2014', true));
      group.appendChild(compareRow('Suppressed', ma ? ma.suppressedPercent.toFixed(0) + '%' : '\u2014', mb ? mb.suppressedPercent.toFixed(0) + '%' : '\u2014', false));
      group.appendChild(compareRow('Expected', ma ? ma.expectedValue.toFixed(1) + '%' : '\u2014', mb ? mb.expectedValue.toFixed(1) + '%' : '\u2014', true));
      coveragePanel.appendChild(group);
    }
  }
  middle.appendChild(coveragePanel);

  return middle;
}

function openComparePage() {
  const overlay = document.createElement('div');
  overlay.className = 'compare-page-overlay';
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';

  const header = document.createElement('div');
  header.className = 'compare-page-header';
  header.innerHTML = `<div class="board-editor-title">Compare Presets</div>`;
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'compare-page-close';
  closeBtn.textContent = '\u2715 Back to Builder';
  closeBtn.onclick = () => {
    overlay.remove();
    document.body.style.overflow = '';
  };
  header.appendChild(closeBtn);
  overlay.appendChild(header);

  const layout = document.createElement('div');
  layout.className = 'compare-3col-layout';
  overlay.appendChild(layout);

  const secBySecSection = document.createElement('div');
  secBySecSection.className = 'panel compare-secbysec-panel';
  overlay.appendChild(secBySecSection);

  const chosen = { a: null, b: null };
  const chosenSong = { a: null, b: null };
  let activeTab = 'a';

  function renderSecBySec(computedA, computedB) {
    secBySecSection.innerHTML = '';
    const label = document.createElement('div');
    label.className = 'panel-label';
    label.textContent = 'Bonus Coverage \u00b7 Second-by-Second';
    secBySecSection.appendChild(label);

    if (!chosen.a || !chosen.b) {
      const msg = document.createElement('div');
      msg.className = 'empty-state';
      msg.textContent = 'Choose both presets to see second-by-second coverage.';
      secBySecSection.appendChild(msg);
      return;
    }

    const tabs = document.createElement('div');
    tabs.className = 'compare-tabs';
    for (const side of ['a', 'b']) {
      const tabBtn = document.createElement('button');
      tabBtn.type = 'button';
      tabBtn.className = 'compare-tab' + (activeTab === side ? ' compare-tab-active' : '');
      tabBtn.textContent = chosen[side].name;
      tabBtn.onclick = () => {
        activeTab = side;
        renderSecBySec(computedA, computedB);
      };
      tabs.appendChild(tabBtn);
    }
    secBySecSection.appendChild(tabs);

    const song = chosenSong[activeTab];
    const computed = activeTab === 'a' ? computedA : computedB;
    if (!song) {
      const msg = document.createElement('div');
      msg.className = 'empty-state';
      msg.textContent = `Choose a song for ${chosen[activeTab].name} above (in Coverage Statistics) to see its second-by-second table.`;
      secBySecSection.appendChild(msg);
      return;
    }

    const unitCards = computed.unit.map((u) => u.card);
    const duration = song.playingSeconds || Math.max(...song.feverSeconds) + 15;
    const timeline = simulateActiveTimeline({
      activeResults: computed.result.actives,
      specialResults: computed.result.specials,
      unitCards,
      scoreSupport: computed.scoreSupport,
      feverSeconds: song.feverSeconds,
      durationSeconds: duration,
    });
    timeline._specials = computed.result.specials;

    renderDifficultyPicker(secBySecSection, () => renderSecBySec(computedA, computedB));
    const noteDensityBySong = getNoteDensity(song.id, () => renderSecBySec(computedA, computedB));
    const noteDensityEntries =
      noteDensityBySong === undefined ? undefined : noteDensityBySong === null ? null : noteDensityBySong[state.difficulty] ?? null;

    secBySecSection.appendChild(buildCoverageTable(timeline, unitCards, song, undefined, noteDensityEntries));
  }

  function openSongSubPicker(side, onPicked) {
    const subOverlay = document.createElement('div');
    subOverlay.className = 'picker-overlay';
    const subBox = document.createElement('div');
    subBox.className = 'picker-box';
    const subHeader = document.createElement('div');
    subHeader.className = 'picker-search';
    const searchInput = document.createElement('input');
    searchInput.placeholder = 'Search for a song\u2026';
    subHeader.appendChild(searchInput);
    subBox.appendChild(subHeader);

    const list = document.createElement('div');
    list.className = 'picker-list';
    subBox.appendChild(list);

    function renderSongList(query) {
      list.innerHTML = '';
      const q = query.trim().toLowerCase();
      const matches = DATA.songs.filter((s) => !q || s.title?.toLowerCase().includes(q)).slice(0, 60);
      if (!matches.length) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.textContent = 'No matches.';
        list.appendChild(empty);
        return;
      }
      for (const s of matches) {
        const item = document.createElement('div');
        item.className = 'picker-item';
        item.innerHTML = `<div class="picker-item-name">${s.title}</div>`;
        item.onclick = () => {
          chosenSong[side] = s;
          subOverlay.remove();
          onPicked();
        };
        list.appendChild(item);
      }
    }
    searchInput.addEventListener('input', () => renderSongList(searchInput.value));
    renderSongList('');

    const subClose = document.createElement('div');
    subClose.className = 'picker-close';
    subClose.textContent = 'CLOSE';
    subClose.onclick = () => subOverlay.remove();
    subBox.appendChild(subClose);
    subOverlay.appendChild(subBox);
    subOverlay.addEventListener('click', (e) => {
      if (e.target === subOverlay) subOverlay.remove();
    });
    document.body.appendChild(subOverlay);
    searchInput.focus();
  }

  function openPresetSubPicker(onChoose) {
    const subOverlay = document.createElement('div');
    subOverlay.className = 'picker-overlay';
    const subBox = document.createElement('div');
    subBox.className = 'picker-box';
    const subHeader = document.createElement('div');
    subHeader.className = 'picker-search';
    subHeader.innerHTML = `<div class="board-editor-title">Choose a Preset</div>`;
    subBox.appendChild(subHeader);

    const list = document.createElement('div');
    list.className = 'picker-list';
    const presets = loadPresetsFromStorage();
    if (!presets.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'No saved presets yet \u2014 save one from the Presets button first.';
      list.appendChild(empty);
    }
    presets.forEach((preset) => {
      const row = document.createElement('div');
      row.className = 'preset-row';
      const info = document.createElement('div');
      info.className = 'preset-row-info';
      info.innerHTML = `<div class="preset-row-name">${preset.name}</div><div class="picker-item-sub">${presetSummaryLine(preset)}</div>`;
      row.appendChild(info);
      const pickBtn = document.createElement('button');
      pickBtn.type = 'button';
      pickBtn.className = 'board-btn';
      pickBtn.textContent = 'Choose';
      pickBtn.onclick = () => {
        onChoose(preset);
        subOverlay.remove();
      };
      row.appendChild(pickBtn);
      list.appendChild(row);
    });
    subBox.appendChild(list);
    const subClose = document.createElement('div');
    subClose.className = 'picker-close';
    subClose.textContent = 'CLOSE';
    subClose.onclick = () => subOverlay.remove();
    subBox.appendChild(subClose);
    subOverlay.appendChild(subBox);
    subOverlay.addEventListener('click', (e) => {
      if (e.target === subOverlay) subOverlay.remove();
    });
    document.body.appendChild(subOverlay);
  }

  function renderLayout() {
    layout.innerHTML = '';

    const computedA = chosen.a ? computeFullResult(presetToTeamState(chosen.a), chosenSong.a) : null;
    const computedB = chosen.b ? computeFullResult(presetToTeamState(chosen.b), chosenSong.b) : null;

    layout.appendChild(
      renderCompareTeamColumn('a', chosen.a, computedA, () =>
        openPresetSubPicker((p) => {
          chosen.a = p;
          renderLayout();
        })
      )
    );

    if (chosen.a && chosen.b && computedA && computedB) {
      layout.appendChild(
        renderCompareMiddle(
          chosen.a,
          computedA,
          chosen.b,
          computedB,
          chosenSong.a,
          chosenSong.b,
          () => openSongSubPicker('a', renderLayout),
          () => openSongSubPicker('b', renderLayout)
        )
      );
    } else {
      const placeholder = document.createElement('div');
      placeholder.className = 'compare-middle-col';
      const msg = document.createElement('div');
      msg.className = 'empty-state';
      msg.textContent = 'Choose both presets to see the comparison.';
      placeholder.appendChild(msg);
      layout.appendChild(placeholder);
    }

    layout.appendChild(
      renderCompareTeamColumn('b', chosen.b, computedB, () =>
        openPresetSubPicker((p) => {
          chosen.b = p;
          renderLayout();
        })
      )
    );

    renderSecBySec(computedA, computedB);
  }

  renderLayout();
}

const COST_CALC_RARITIES = [
  { key: 'rarity_3', label: '3\u2605', maxLevel: 60 },
  { key: 'rarity_4', label: '4\u2605', maxLevel: 70 },
  { key: 'rarity_5', label: '5\u2605', maxLevel: 80 },
];
const COST_CALC_ATTRS = [
  { key: 'attribute_1', label: 'Cute', cls: 'attr-cute' },
  { key: 'attribute_2', label: 'Pure', cls: 'attr-pure' },
  { key: 'attribute_3', label: 'Happy', cls: 'attr-happy' },
];

function openCostCalculator() {
  const overlay = document.createElement('div');
  overlay.className = 'picker-overlay';

  const box = document.createElement('div');
  box.className = 'picker-box cost-calc-box';

  const header = document.createElement('div');
  header.className = 'picker-search';
  header.innerHTML = `<div class="board-editor-title">Cost Calculator</div><div class="board-editor-subtitle">Level and SP Training costs for any rarity/attribute combination \u2014 not tied to a specific card.</div>`;
  box.appendChild(header);

  const body = document.createElement('div');
  body.className = 'cost-calc-body';
  box.appendChild(body);

  const close = document.createElement('div');
  close.className = 'picker-close';
  close.textContent = 'CLOSE';
  close.onclick = () => overlay.remove();
  box.appendChild(close);

  overlay.appendChild(box);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  document.body.appendChild(overlay);

  const cc = { rarity: 'rarity_5', attr: 'attribute_1', lvlFrom: 1, lvlTo: 80, exchangeAmount: 0 };

  function maxLevel() {
    return COST_CALC_RARITIES.find((r) => r.key === cc.rarity).maxLevel;
  }

  function render() {
    body.innerHTML = '';

    // Rarity pills
    const raritySection = document.createElement('div');
    raritySection.className = 'cost-calc-section';
    const rarityLabel = document.createElement('div');
    rarityLabel.className = 'board-group-label';
    rarityLabel.textContent = 'Card Rarity';
    raritySection.appendChild(rarityLabel);
    const rarityRow = document.createElement('div');
    rarityRow.className = 'cost-calc-pill-row';
    COST_CALC_RARITIES.forEach((r) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cost-calc-pill' + (cc.rarity === r.key ? ' cost-calc-pill-active-rar' : '');
      btn.textContent = r.label;
      btn.onclick = () => {
        cc.rarity = r.key;
        const max = maxLevel();
        cc.lvlFrom = Math.min(cc.lvlFrom, max);
        cc.lvlTo = Math.min(cc.lvlTo, max);
        render();
      };
      rarityRow.appendChild(btn);
    });
    raritySection.appendChild(rarityRow);
    body.appendChild(raritySection);

    // Attribute pills
    const attrSection = document.createElement('div');
    attrSection.className = 'cost-calc-section';
    const attrLabelEl = document.createElement('div');
    attrLabelEl.className = 'board-group-label';
    attrLabelEl.textContent = 'Attribute';
    attrSection.appendChild(attrLabelEl);
    const attrRow = document.createElement('div');
    attrRow.className = 'cost-calc-pill-row';
    COST_CALC_ATTRS.forEach((a) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cost-calc-pill' + (cc.attr === a.key ? ' cost-calc-pill-active ' + a.cls : '');
      btn.textContent = a.label;
      btn.onclick = () => {
        cc.attr = a.key;
        render();
      };
      attrRow.appendChild(btn);
    });
    attrSection.appendChild(attrRow);
    body.appendChild(attrSection);

    // Level range
    const levelSection = document.createElement('div');
    levelSection.className = 'cost-calc-section';
    const levelLabel = document.createElement('div');
    levelLabel.className = 'board-group-label';
    levelLabel.textContent = 'Level Range';
    levelSection.appendChild(levelLabel);
    const levelGrid = document.createElement('div');
    levelGrid.className = 'cost-calc-range-grid';
    const max = maxLevel();

    const makeLevelField = (labelText, value, onChange) => {
      const field = document.createElement('div');
      field.className = 'cost-calc-range-field';
      const lbl = document.createElement('label');
      lbl.textContent = labelText;
      field.appendChild(lbl);
      const input = document.createElement('input');
      input.type = 'range';
      input.min = 1;
      input.max = max;
      input.value = value;
      input.oninput = () => onChange(Number(input.value));
      field.appendChild(input);
      const valEl = document.createElement('div');
      valEl.className = 'cost-calc-range-value';
      valEl.textContent = value + (labelText.includes('Target') ? ` (max ${max})` : '');
      field.appendChild(valEl);
      return field;
    };
    levelGrid.appendChild(
      makeLevelField('Current Level', cc.lvlFrom, (v) => {
        cc.lvlFrom = Math.min(v, cc.lvlTo);
        render();
      })
    );
    levelGrid.appendChild(
      makeLevelField('Target Level', cc.lvlTo, (v) => {
        cc.lvlTo = Math.max(v, cc.lvlFrom);
        render();
      })
    );
    levelSection.appendChild(levelGrid);
    body.appendChild(levelSection);

    // Results
    const resultsSection = document.createElement('div');
    resultsSection.className = 'cost-calc-section';
    const resultsLabel = document.createElement('div');
    resultsLabel.className = 'board-group-label';
    resultsLabel.textContent = 'Results';
    resultsSection.appendChild(resultsLabel);

    const expTable = COST_CALC_DATA.expTables[cc.rarity];
    const expFrom = expTable[String(cc.lvlFrom)] || 0;
    const expTo = expTable[String(cc.lvlTo)] || 0;
    const expNeeded = Math.max(0, expTo - expFrom);

    const heroGrid = document.createElement('div');
    heroGrid.className = 'cost-calc-hero-grid cost-calc-hero-grid-single';
    heroGrid.innerHTML = `
      <div class="cost-calc-stat"><div class="cost-calc-stat-num">${expNeeded.toLocaleString()}</div><div class="cost-calc-stat-lbl">EXP needed</div></div>
    `;
    resultsSection.appendChild(heroGrid);

    const stepCaption = document.createElement('div');
    stepCaption.className = 'cost-calc-step-caption';
    stepCaption.textContent = 'SP Training materials (level cap steps crossed)';
    resultsSection.appendChild(stepCaption);

    const steps = COST_CALC_DATA.spTraining[cc.rarity + '_' + cc.attr] || [];
    const crossedSteps = steps.filter((s) => s.newCap > cc.lvlFrom && s.newCap <= cc.lvlTo);

    if (!crossedSteps.length) {
      const note = document.createElement('div');
      note.className = 'empty-state';
      note.textContent = 'No level cap steps crossed in this range \u2014 no SP Training needed.';
      resultsSection.appendChild(note);
    } else {
      const totals = {};
      crossedSteps.forEach((s) => {
        s.materials.forEach((m) => {
          totals[m.name] = (totals[m.name] || 0) + m.qty;
        });
      });

      // Find the Crystal/Beads pair for this attribute, if present, so the
      // exchange slider can trade directly-farmed Crystals for Beads + Mega
      // Sphere Coins (Material Exchange Shop rate: 1 Crystal = 3 Beads + 20
      // Sphere Coins).
      const crystalName = Object.keys(totals).find((n) => n.endsWith('Crystals'));
      const beadsName = crystalName ? crystalName.replace('Crystals', 'Beads') : null;
      const baseCrystals = crystalName ? totals[crystalName] : 0;
      const baseBeads = beadsName ? totals[beadsName] || 0 : 0;

      cc.exchangeAmount = clamp(cc.exchangeAmount, 0, baseCrystals);
      const adjustedCrystals = baseCrystals - cc.exchangeAmount;
      const adjustedBeads = baseBeads + cc.exchangeAmount * 3;
      const sphereCoins = cc.exchangeAmount * 20;

      const displayTotals = { ...totals };
      if (crystalName) displayTotals[crystalName] = adjustedCrystals;
      if (beadsName) displayTotals[beadsName] = adjustedBeads;
      else if (crystalName && cc.exchangeAmount > 0) displayTotals[crystalName.replace('Crystals', 'Beads')] = cc.exchangeAmount * 3;
      if (sphereCoins > 0) displayTotals['Mega Sphere Coins'] = sphereCoins;

      const table = document.createElement('table');
      table.className = 'cost-calc-mat-table';
      table.innerHTML =
        '<thead><tr><th>Material</th><th style="text-align:right">Quantity</th></tr></thead><tbody>' +
        Object.entries(displayTotals)
          .filter(([, qty]) => qty > 0)
          .map(([name, qty]) => `<tr><td>${name}</td><td class="qty">${qty.toLocaleString()}</td></tr>`)
          .join('') +
        '</tbody>';
      resultsSection.appendChild(table);

      if (crystalName) {
        const sliderWrap = document.createElement('div');
        sliderWrap.className = 'cost-calc-exchange-slider-wrap';
        const sliderLabel = document.createElement('div');
        sliderLabel.className = 'cost-calc-note';
        sliderLabel.innerHTML = `Farm directly vs. exchange for <b>${crystalName}</b> (Material Exchange Shop, 1 Crystal = 3 Beads + 20 Mega Sphere Coins):`;
        sliderWrap.appendChild(sliderLabel);

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = 0;
        slider.max = baseCrystals;
        slider.value = cc.exchangeAmount;
        slider.className = 'cost-calc-exchange-slider';
        slider.oninput = () => {
          cc.exchangeAmount = Number(slider.value);
          render();
        };
        sliderWrap.appendChild(slider);

        const sliderReadout = document.createElement('div');
        sliderReadout.className = 'cost-calc-exchange-readout';
        sliderReadout.innerHTML = `<span>${adjustedCrystals.toLocaleString()} farmed directly</span><span>${cc.exchangeAmount.toLocaleString()} via exchange (+${(cc.exchangeAmount * 3).toLocaleString()} Beads, +${sphereCoins.toLocaleString()} Sphere Coins)</span>`;
        sliderWrap.appendChild(sliderReadout);

        resultsSection.appendChild(sliderWrap);
      }

      const stepList = document.createElement('div');
      stepList.className = 'cost-calc-note';
      stepList.style.marginTop = '8px';
      stepList.textContent = 'Steps: ' + crossedSteps.map((s) => `cap \u2192 ${s.newCap}`).join(', ');
      resultsSection.appendChild(stepList);
    }

    body.appendChild(resultsSection);
  }

  render();
}

/** Normalizes every filterable attribute for one card into a flat, queryable
 *  shape, using each skill's base (level 1) values for consistent comparison
 *  across cards regardless of a specific bloom context. Computed once per
 *  card and cached by the Card Viewer, not recomputed per-filter-change. */
function computeCardFilterData(card) {
  const perf = card.performancePermilMultiply;
  const tech = card.techniquePermilMultiply;
  const sense = card.sensePermilMultiply;
  const mainStat = mainStatOf(card);

  const passiveLvl1 = card.passiveSkill?.['1'];
  const passive = {
    hasCondition: !!passiveLvl1?.condition,
    conditionType: passiveLvl1?.condition?.type || null,
    effects: (passiveLvl1?.effects || []).map((e) => ({
      type: e.type,
      valuePermil: Number(e.value),
      recipientType: e.target?.type || null,
      recipientAttribute: e.target?.cardAttributeType || null,
      recipientGrouping: e.target?.characterGroupingId || null,
      recipientCount: e.target?.targetCount ?? null,
    })),
  };

  const specialLvl1 = card.specialSkill?.['1'];
  const specialConditionType = specialLvl1?.additionalCondition?.type || null;
  const special = {
    durationSeconds: specialLvl1 ? specialLvl1.effectDurationMs / 1000 : null,
    hasScoreSupport: (specialLvl1?.effects || []).some((e) => e.type.includes('SCORE_UP_EFFECT_UP')),
    hasActivationRateBonus: (specialLvl1?.additionalEffects || []).some((e) => e.type.includes('ACTIVATION_PROBABILITY')),
    hasComboCondition: specialConditionType?.includes('COMBO') || false,
    hasLifeCondition: specialConditionType?.includes('LIFE') || false,
    hasTypeCondition: specialConditionType?.includes('ATTRIBUTE') || false,
    hasGenerationCondition: specialConditionType?.includes('CHARACTER_GROUPING') || false,
  };

  const leaderData = card.leaderSkill;
  const leader = {
    hasCondition: !!leaderData?.condition,
    conditionType: leaderData?.condition?.type || null,
    effects: (leaderData?.effects || []).map((e) => ({ type: e.type, valuePermil: Number(e.value) })),
  };

  const activeLvl1 = card.activeSkill?.['1'];
  const active = {
    durationSeconds: activeLvl1 ? activeLvl1.effectDurationMs / 1000 : null,
    intervalSeconds: activeLvl1 ? activeLvl1.coolTimeMs / 1000 : null,
    chancePercent: activeLvl1 ? activeLvl1.activationProbabilityPermil / 10 : null,
    effects: (activeLvl1?.effects || []).map((e) => ({ type: e.type, valuePermil: Number(e.value) })),
    hasComboCondition: activeLvl1?.enhancedCondition?.type?.includes('COMBO') || false,
    hasLifeCondition: activeLvl1?.enhancedCondition?.type?.includes('LIFE') || false,
  };

  const connectInfo = DATA.cardConnectInfo?.[card.cardId];
  const patternCells = new Set((connectInfo?.pattern || []).map((p) => `${p.x || 0},${p.y || 0}`));
  const connect = {
    isEligible: !!connectInfo,
    area: connectInfo?.area || null,
    nodeCount: connectInfo?.nodeCount ?? null,
    boostPercent: connectInfo ? connectInfo.boostPermilLevel1 / 10 : null,
    patternCells,
  };

  return {
    card,
    mainStat,
    passive,
    special,
    leader,
    active,
    connect,
  };
}

const CARD_VIEWER_STATE = {
  view: 'card',
  search: '',
  filters: {
    types: new Set(),
    rarities: new Set(),
    generations: new Set(),
    mainStats: new Set(),
    passiveHasCondition: null,
    passiveRecipientTypes: new Set(),
    passiveBonusTypes: new Set(),
    specialDurationMin: null,
    specialDurationMax: null,
    specialHasActivationRate: null,
    specialHasCombo: null,
    specialHasLife: null,
    specialHasTypeCondition: null,
    specialHasGenerationCondition: null,
    leaderHasCondition: null,
    leaderBonusTypes: new Set(),
    activeDurationMin: null,
    activeDurationMax: null,
    activeChanceMin: null,
    activeChanceMax: null,
    activeIntervalMin: null,
    activeIntervalMax: null,
    activeHasCombo: null,
    activeHasLife: null,
    connectPatternCells: new Set(), // "x,y" strings the user has checked on the pattern grid
    connectBonusMin: null,
    connectBonusMax: null,
  },
};

function cardMatchesStandardFilters(card, f) {
  if (f.types.size && !f.types.has(card.attributeType)) return false;
  if (f.rarities.size && !f.rarities.has(rarityNumber(card.rarity))) return false;
  if (f.generations.size && !f.generations.has(card.generation)) return false;
  if (f.mainStats.size && !f.mainStats.has(mainStatOf(card))) return false;
  return true;
}

function inRange(value, min, max) {
  if (value == null) return min == null && max == null;
  if (min != null && value < min) return false;
  if (max != null && value > max) return false;
  return true;
}

function cardMatchesAllFilters(d, f) {
  if (!cardMatchesStandardFilters(d.card, f)) return false;

  if (f.passiveHasCondition != null && d.passive.hasCondition !== f.passiveHasCondition) return false;
  if (f.passiveRecipientTypes.size && !d.passive.effects.some((e) => f.passiveRecipientTypes.has(e.recipientType))) return false;
  if (f.passiveBonusTypes.size && !d.passive.effects.some((e) => f.passiveBonusTypes.has(e.type))) return false;

  if (!inRange(d.special.durationSeconds, f.specialDurationMin, f.specialDurationMax)) return false;
  if (f.specialHasActivationRate != null && d.special.hasActivationRateBonus !== f.specialHasActivationRate) return false;
  if (f.specialHasCombo != null && d.special.hasComboCondition !== f.specialHasCombo) return false;
  if (f.specialHasLife != null && d.special.hasLifeCondition !== f.specialHasLife) return false;
  if (f.specialHasTypeCondition != null && d.special.hasTypeCondition !== f.specialHasTypeCondition) return false;
  if (f.specialHasGenerationCondition != null && d.special.hasGenerationCondition !== f.specialHasGenerationCondition) return false;

  if (f.leaderHasCondition != null && d.leader.hasCondition !== f.leaderHasCondition) return false;
  if (f.leaderBonusTypes.size && !d.leader.effects.some((e) => f.leaderBonusTypes.has(e.type))) return false;

  if (!inRange(d.active.durationSeconds, f.activeDurationMin, f.activeDurationMax)) return false;
  if (!inRange(d.active.chancePercent, f.activeChanceMin, f.activeChanceMax)) return false;
  if (!inRange(d.active.intervalSeconds, f.activeIntervalMin, f.activeIntervalMax)) return false;
  if (f.activeHasCombo != null && d.active.hasComboCondition !== f.activeHasCombo) return false;
  if (f.activeHasLife != null && d.active.hasLifeCondition !== f.activeHasLife) return false;

  if (f.connectPatternCells.size) {
    if (!d.connect.isEligible) return false;
    for (const cell of f.connectPatternCells) {
      if (!d.connect.patternCells.has(cell)) return false;
    }
  }
  if (!inRange(d.connect.boostPercent, f.connectBonusMin, f.connectBonusMax)) return false;

  return true;
}

const MUSIC_VIEWER_STATE = {
  search: '',
  sort: { column: null, direction: 1 },
  filters: {
    releaseTypes: new Set(),
    durationMin: null,
    durationMax: null,
    releaseDateAfter: null,
    releaseDateBefore: null,
    atLaunchOnly: false,
    hasUnlockCost: null,
    hasMvUrl: null,
    singers: new Set(),
  },
};

function songMatchesFilters(song, f, singerNamesById) {
  if (f.releaseTypes.size && !f.releaseTypes.has(song.releaseType)) return false;
  if (!inRange(song.playingSeconds, f.durationMin, f.durationMax)) return false;
  if (f.atLaunchOnly) {
    if (song.releaseDate !== '2022-12-31') return false;
  } else {
    if (f.releaseDateAfter && (!song.releaseDate || song.releaseDate < f.releaseDateAfter)) return false;
    if (f.releaseDateBefore && (!song.releaseDate || song.releaseDate > f.releaseDateBefore)) return false;
  }
  if (f.hasUnlockCost != null && !!song.unlockCost !== f.hasUnlockCost) return false;
  if (f.hasMvUrl != null && !!song.mvUrl !== f.hasMvUrl) return false;
  if (f.singers.size && !song.characterIds.some((cid) => f.singers.has(cid))) return false;
  return true;
}

const CHARACTER_ACTIVITY_STATE = {
  search: '',
  sort: { column: 'final', direction: 1 }, // ascending by default = most "due" first
  weights: { wCard: 0.59, wGen: 0.15, halfLifeDays: 30 }, // wSong derived as 1 - wCard
};

/** "Character Activity" - a just-for-fun heuristic guessing which characters
 *  are most "due" for a new card/song, from card-release recency, song
 *  recency, and a generation-mate contagion effect. NOT a validated
 *  prediction - weights are exposed as sliders specifically so it reads as
 *  the toy it is, not a forecast. See js/activityModel.js for the model. */
function openCharacterActivityView() {
  const overlay = document.createElement('div');
  overlay.className = 'compare-page-overlay';
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';

  const header = document.createElement('div');
  header.className = 'compare-page-header';
  header.innerHTML = `<div class="board-editor-title">Character Activity \u{1F52E}</div>`;
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'compare-page-close';
  closeBtn.textContent = '\u2715 Back to Builder';
  closeBtn.onclick = () => {
    overlay.remove();
    document.body.style.overflow = '';
  };
  header.appendChild(closeBtn);
  overlay.appendChild(header);

  const disclaimer = document.createElement('div');
  disclaimer.className = 'ca-disclaimer';
  disclaimer.innerHTML = `
    <strong>Just for fun \u{1F52E}</strong> \u2014 this is a made-up heuristic guessing which characters are
    "due" for a new card or song, based on how recently they've gotten one (plus a bit of
    generation peer pressure). It's not based on real dev plans or any historical accuracy check.
    Drag the sliders and watch the ranking shuffle \u2014 that's the whole point.
  `;
  overlay.appendChild(disclaimer);

  const controls = document.createElement('div');
  controls.className = 'ca-controls';
  overlay.appendChild(controls);

  const main = document.createElement('div');
  main.className = 'ca-main';
  overlay.appendChild(main);

  const ca = CHARACTER_ACTIVITY_STATE;
  const NOW = Date.now();

  function makeSlider(labelText, min, max, step, value, onInput, formatValue) {
    const group = document.createElement('div');
    group.className = 'ca-control-group';
    const labelRow = document.createElement('div');
    labelRow.className = 'ca-control-label';
    const valueSpan = document.createElement('span');
    valueSpan.textContent = formatValue(value);
    labelRow.innerHTML = `<span>${labelText}</span>`;
    labelRow.appendChild(valueSpan);
    group.appendChild(labelRow);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = min;
    input.max = max;
    input.step = step;
    input.value = value;
    input.oninput = () => {
      const v = Number(input.value);
      valueSpan.textContent = formatValue(v);
      onInput(v);
      renderMain();
    };
    group.appendChild(input);
    return group;
  }

  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'board-btn';
  resetBtn.textContent = 'Reset weights';
  resetBtn.onclick = () => {
    ca.weights = { wCard: 0.59, wGen: 0.15, halfLifeDays: 30 };
    renderControls();
    renderMain();
  };

  function renderControls() {
    controls.innerHTML = '';
    controls.appendChild(
      makeSlider('Card \u2194 Song emphasis', 0, 1, 0.01, ca.weights.wCard, (v) => (ca.weights.wCard = v), (v) => `${Math.round(v * 100)}% card / ${Math.round((1 - v) * 100)}% song`)
    );
    controls.appendChild(
      makeSlider('Generation peer pressure', 0, 0.6, 0.01, ca.weights.wGen, (v) => (ca.weights.wGen = v), (v) => `${Math.round(v * 100)}%`)
    );
    controls.appendChild(
      makeSlider('Song recency half-life', 7, 180, 1, ca.weights.halfLifeDays, (v) => (ca.weights.halfLifeDays = v), (v) => `${v} days`)
    );
    controls.appendChild(resetBtn);
  }

  function renderMain() {
    main.innerHTML = '';

    const searchWrap = document.createElement('div');
    searchWrap.className = 'cv-search-wrap';
    const searchInput = document.createElement('input');
    searchInput.placeholder = 'Search character\u2026';
    searchInput.value = ca.search;
    searchInput.oninput = () => {
      ca.search = searchInput.value;
      renderMain();
    };
    searchWrap.appendChild(searchInput);
    main.appendChild(searchWrap);

    const scores = computeCharacterActivityScores(DATA.members, DATA.songs, {
      wCard: ca.weights.wCard,
      wSong: 1 - ca.weights.wCard,
      wGen: ca.weights.wGen,
      halfLifeDays: ca.weights.halfLifeDays,
      nowMs: NOW,
    });

    const q = ca.search.trim().toLowerCase();
    const filtered = q ? scores.filter((r) => r.name.toLowerCase().includes(q)) : scores;

    const toolbar = document.createElement('div');
    toolbar.className = 'cv-toolbar';
    const countEl = document.createElement('div');
    countEl.className = 'cv-count';
    countEl.textContent = `${filtered.length} of ${scores.length} characters`;
    toolbar.appendChild(countEl);
    main.appendChild(toolbar);

    const SORT_COLUMNS = [
      { key: 'name', label: 'Character', getValue: (r) => r.name.toLowerCase() },
      { key: 'generation', label: 'Generation', getValue: (r) => r.generation },
      { key: 'card', label: 'Last Card', getValue: (r) => r.lastCardOrder },
      { key: 'song', label: 'Last Song', getValue: (r) => r.lastSongDateMs ?? -1 },
      { key: 'final', label: 'Saturation', getValue: (r) => r.finalScore },
    ];

    filtered.sort((a, b) => {
      const col = SORT_COLUMNS.find((c) => c.key === ca.sort.column);
      const av = col.getValue(a);
      const bv = col.getValue(b);
      if (av < bv) return -1 * ca.sort.direction;
      if (av > bv) return 1 * ca.sort.direction;
      return 0;
    });

    const list = document.createElement('div');
    list.className = 'ca-list';
    const headerRow = document.createElement('div');
    headerRow.className = 'ca-list-row ca-list-header';
    headerRow.appendChild(document.createElement('span')); // rank column, no header text
    for (const col of SORT_COLUMNS) {
      const span = document.createElement('span');
      span.className = 'mv-sortable-header';
      const isActive = ca.sort.column === col.key;
      span.textContent = col.label + (isActive ? (ca.sort.direction === 1 ? ' \u25b2' : ' \u25bc') : '');
      span.onclick = () => {
        if (ca.sort.column === col.key) {
          ca.sort.direction *= -1;
        } else {
          ca.sort.column = col.key;
          ca.sort.direction = 1;
        }
        renderMain();
      };
      headerRow.appendChild(span);
    }
    list.appendChild(headerRow);

    filtered.forEach((r, i) => {
      const row = document.createElement('div');
      row.className = 'ca-list-row';
      const cardDisplay = !r.lastCardOrder
        ? '\u2014'
        : r.lastCardOrder <= LAUNCH_ORDER_THRESHOLD
        ? 'At Launch'
        : `#${r.lastCardOrder}`;
      let songDisplay = '\u2014';
      if (r.lastSongDateMs != null) {
        const iso = new Date(r.lastSongDateMs).toISOString().slice(0, 10);
        songDisplay = iso === '2022-12-31' ? 'At Launch' : iso;
      }
      const satPercent = Math.round(r.finalScore * 100);
      const hue = Math.round(120 - r.finalScore * 120); // 120=green (due) -> 0=red (recently covered)
      row.innerHTML = `
        <span class="ca-rank">${i + 1}</span>
        <span class="ca-name">${r.name}</span>
        <span>${r.generation}</span>
        <span>${cardDisplay}</span>
        <span>${songDisplay}</span>
        <span class="ca-sat-cell">
          <span class="ca-sat-bar-track"><span class="ca-sat-bar-fill" style="width:${satPercent}%; background:hsl(${hue},65%,45%);"></span></span>
          <span class="ca-sat-num">${satPercent}%</span>
        </span>
      `;
      list.appendChild(row);
    });
    main.appendChild(list);
  }

  renderControls();
  renderMain();
}

function openMusicViewer() {
  const overlay = document.createElement('div');
  overlay.className = 'compare-page-overlay';
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';

  const header = document.createElement('div');
  header.className = 'compare-page-header';
  header.innerHTML = `<div class="board-editor-title">Music</div>`;
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'compare-page-close';
  closeBtn.textContent = '\u2715 Back to Builder';
  closeBtn.onclick = () => {
    overlay.remove();
    document.body.style.overflow = '';
  };
  header.appendChild(closeBtn);
  overlay.appendChild(header);

  const layout = document.createElement('div');
  layout.className = 'cv-layout';
  overlay.appendChild(layout);

  const sidebar = document.createElement('div');
  sidebar.className = 'cv-sidebar';
  layout.appendChild(sidebar);

  const main = document.createElement('div');
  main.className = 'cv-main';
  layout.appendChild(main);

  const mv = MUSIC_VIEWER_STATE;
  const charNameById = {};
  for (const m of DATA.members) charNameById[m.characterId] = m.characterName;
  const singerIdsInUse = [...new Set(DATA.songs.flatMap((s) => s.characterIds))].sort((a, b) =>
    (charNameById[a] || a).localeCompare(charNameById[b] || b)
  );

  function renderSidebar() {
    sidebar.innerHTML = '';

    const searchWrap = document.createElement('div');
    searchWrap.className = 'cv-search-wrap';
    const searchInput = document.createElement('input');
    searchInput.placeholder = 'Search song title\u2026';
    searchInput.value = mv.search;
    searchInput.oninput = () => {
      mv.search = searchInput.value;
      renderMain();
    };
    searchWrap.appendChild(searchInput);
    sidebar.appendChild(searchWrap);

    const makeCheckboxGroup = (title, options, selectedSet, getKey, getLabel) => {
      const group = document.createElement('div');
      group.className = 'cv-filter-group';
      const label = document.createElement('div');
      label.className = 'cv-filter-group-label';
      label.textContent = title;
      group.appendChild(label);
      const row = document.createElement('div');
      row.className = 'cv-filter-chip-row';
      for (const opt of options) {
        const key = getKey(opt);
        const chip = document.createElement('label');
        chip.className = 'filter-checkbox';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = selectedSet.has(key);
        cb.onchange = () => {
          cb.checked ? selectedSet.add(key) : selectedSet.delete(key);
          renderMain();
        };
        chip.appendChild(cb);
        chip.appendChild(document.createTextNode(getLabel(opt)));
        row.appendChild(chip);
      }
      group.appendChild(row);
      sidebar.appendChild(group);
    };

    makeCheckboxGroup(
      'Release Type',
      ['Reward', 'Preset (default unlocked)', 'Shop'],
      mv.filters.releaseTypes,
      (t) => t,
      (t) => t
    );

    const makeTriState = (title, currentValue, onChange) => {
      const group = document.createElement('div');
      group.className = 'cv-filter-group';
      const label = document.createElement('div');
      label.className = 'cv-filter-group-label';
      label.textContent = title;
      group.appendChild(label);
      const row = document.createElement('div');
      row.className = 'cv-tri-row';
      for (const opt of [
        { key: null, label: 'Any' },
        { key: true, label: 'Yes' },
        { key: false, label: 'No' },
      ]) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cv-tri-btn' + (currentValue === opt.key ? ' cv-tri-btn-active' : '');
        btn.textContent = opt.label;
        btn.onclick = () => {
          onChange(opt.key);
          renderMain();
          renderSidebar();
        };
        row.appendChild(btn);
      }
      group.appendChild(row);
      sidebar.appendChild(group);
    };
    makeTriState('Has Unlock Cost', mv.filters.hasUnlockCost, (v) => (mv.filters.hasUnlockCost = v));
    makeTriState('Has YouTube Link', mv.filters.hasMvUrl, (v) => (mv.filters.hasMvUrl = v));

    const durationGroup = document.createElement('div');
    durationGroup.className = 'cv-filter-group';
    durationGroup.innerHTML = '<div class="cv-filter-group-label">Duration</div>';
    const durRow = document.createElement('div');
    durRow.className = 'cv-filter-range-row';
    const durMin = document.createElement('input');
    durMin.type = 'number';
    durMin.placeholder = 'min';
    durMin.value = mv.filters.durationMin ?? '';
    durMin.onchange = () => {
      mv.filters.durationMin = durMin.value === '' ? null : Number(durMin.value);
      renderMain();
    };
    durRow.appendChild(durMin);
    durRow.appendChild(document.createTextNode('\u2013'));
    const durMax = document.createElement('input');
    durMax.type = 'number';
    durMax.placeholder = 'max';
    durMax.value = mv.filters.durationMax ?? '';
    durMax.onchange = () => {
      mv.filters.durationMax = durMax.value === '' ? null : Number(durMax.value);
      renderMain();
    };
    durRow.appendChild(durMax);
    durRow.appendChild(document.createTextNode('s'));
    durationGroup.appendChild(durRow);
    sidebar.appendChild(durationGroup);

    const dateGroup = document.createElement('div');
    dateGroup.className = 'cv-filter-group';
    dateGroup.innerHTML = '<div class="cv-filter-group-label">Release Date</div>';
    const dateRow = document.createElement('div');
    dateRow.className = 'cv-filter-range-row';
    const dateAfter = document.createElement('input');
    dateAfter.type = 'date';
    dateAfter.value = mv.filters.releaseDateAfter || '';
    dateAfter.disabled = mv.filters.atLaunchOnly;
    dateAfter.onchange = () => {
      mv.filters.releaseDateAfter = dateAfter.value || null;
      renderMain();
    };
    dateRow.appendChild(dateAfter);
    dateGroup.appendChild(dateRow);
    const dateRow2 = document.createElement('div');
    dateRow2.className = 'cv-filter-range-row';
    dateRow2.style.marginTop = '6px';
    const dateBefore = document.createElement('input');
    dateBefore.type = 'date';
    dateBefore.value = mv.filters.releaseDateBefore || '';
    dateBefore.disabled = mv.filters.atLaunchOnly;
    dateBefore.onchange = () => {
      mv.filters.releaseDateBefore = dateBefore.value || null;
      renderMain();
    };
    dateRow2.appendChild(dateBefore);
    dateGroup.appendChild(dateRow2);
    const atLaunchChip = document.createElement('label');
    atLaunchChip.className = 'filter-checkbox';
    atLaunchChip.style.marginTop = '8px';
    const atLaunchCb = document.createElement('input');
    atLaunchCb.type = 'checkbox';
    atLaunchCb.checked = mv.filters.atLaunchOnly;
    atLaunchCb.onchange = () => {
      mv.filters.atLaunchOnly = atLaunchCb.checked;
      renderMain();
      renderSidebar();
    };
    atLaunchChip.appendChild(atLaunchCb);
    atLaunchChip.appendChild(document.createTextNode('At Launch only'));
    dateGroup.appendChild(atLaunchChip);
    sidebar.appendChild(dateGroup);

    makeCheckboxGroup(
      'Singer',
      singerIdsInUse,
      mv.filters.singers,
      (cid) => cid,
      (cid) => charNameById[cid] || cid
    );

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'filter-clear-btn';
    clearBtn.textContent = 'Clear filters';
    clearBtn.onclick = () => {
      mv.filters.releaseTypes.clear();
      mv.filters.durationMin = null;
      mv.filters.durationMax = null;
      mv.filters.releaseDateAfter = null;
      mv.filters.releaseDateBefore = null;
      mv.filters.atLaunchOnly = false;
      mv.filters.hasUnlockCost = null;
      mv.filters.hasMvUrl = null;
      mv.filters.singers.clear();
      renderSidebar();
      renderMain();
    };
    sidebar.appendChild(clearBtn);
  }

  function renderMain() {
    main.innerHTML = '';

    const toolbar = document.createElement('div');
    toolbar.className = 'cv-toolbar';
    const countEl = document.createElement('div');
    countEl.className = 'cv-count';
    toolbar.appendChild(countEl);
    main.appendChild(toolbar);

    const q = mv.search.trim().toLowerCase();
    const filtered = DATA.songs.filter((s) => {
      if (!songMatchesFilters(s, mv.filters, charNameById)) return false;
      if (q && !s.title.toLowerCase().includes(q)) return false;
      return true;
    });
    countEl.textContent = `${filtered.length} of ${DATA.songs.length} songs`;

    const SORT_COLUMNS = [
      { key: 'title', label: 'Title', getValue: (s) => s.title.toLowerCase() },
      { key: 'duration', label: 'Duration', getValue: (s) => s.playingSeconds },
      { key: 'singers', label: 'Singers', getValue: (s) => s.characterIds.map((cid) => charNameById[cid] || cid).join(', ').toLowerCase() },
      { key: 'releaseDate', label: 'Release Date', getValue: (s) => s.releaseDate || '' },
      { key: 'releaseType', label: 'Type', getValue: (s) => s.releaseType || '' },
      { key: 'unlockCost', label: 'Unlock Cost', getValue: (s) => s.unlockCost?.quantity ?? -1 },
      { key: 'mv', label: 'MV', getValue: (s) => (s.mvUrl ? 1 : 0) },
    ];

    if (mv.sort.column) {
      const col = SORT_COLUMNS.find((c) => c.key === mv.sort.column);
      filtered.sort((a, b) => {
        const av = col.getValue(a);
        const bv = col.getValue(b);
        if (av < bv) return -1 * mv.sort.direction;
        if (av > bv) return 1 * mv.sort.direction;
        return 0;
      });
    }

    const list = document.createElement('div');
    list.className = 'mv-list';
    const headerRow = document.createElement('div');
    headerRow.className = 'mv-list-row mv-list-header';
    for (const col of SORT_COLUMNS) {
      const span = document.createElement('span');
      span.className = 'mv-sortable-header';
      const isActive = mv.sort.column === col.key;
      span.textContent = col.label + (isActive ? (mv.sort.direction === 1 ? ' \u25b2' : ' \u25bc') : '');
      span.onclick = () => {
        if (mv.sort.column === col.key) {
          mv.sort.direction *= -1;
        } else {
          mv.sort.column = col.key;
          mv.sort.direction = 1;
        }
        renderMain();
      };
      headerRow.appendChild(span);
    }
    list.appendChild(headerRow);

    for (const s of filtered) {
      const row = document.createElement('div');
      row.className = 'mv-list-row';
      const mins = Math.floor(s.playingSeconds / 60);
      const secs = s.playingSeconds % 60;
      const singerNames = s.characterIds.map((cid) => charNameById[cid] || cid).join(', ');
      const releaseDateDisplay = s.releaseDate === '2022-12-31' ? 'At Launch' : s.releaseDate || '\u2014';
      row.innerHTML = `
        <span class="mv-title">${s.title}</span>
        <span>${mins}:${String(secs).padStart(2, '0')}</span>
        <span>${singerNames}</span>
        <span>${releaseDateDisplay}</span>
        <span>${s.releaseType || '\u2014'}</span>
        <span>${s.unlockCost ? `${s.unlockCost.quantity}x ${s.unlockCost.item}` : '\u2014'}</span>
        <span>${s.mvUrl ? `<a href="${s.mvUrl}" target="_blank" rel="noopener" class="mv-yt-link">Watch</a>` : '\u2014'}</span>
      `;
      list.appendChild(row);
    }
    main.appendChild(list);
  }

  renderSidebar();
  renderMain();
}

function openCardViewer() {
  const overlay = document.createElement('div');
  overlay.className = 'compare-page-overlay';
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';

  const header = document.createElement('div');
  header.className = 'compare-page-header';
  header.innerHTML = `<div class="board-editor-title">Card Viewer</div>`;
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'compare-page-close';
  closeBtn.textContent = '\u2715 Back to Builder';
  closeBtn.onclick = () => {
    overlay.remove();
    document.body.style.overflow = '';
  };
  header.appendChild(closeBtn);
  overlay.appendChild(header);

  const layout = document.createElement('div');
  layout.className = 'cv-layout';
  overlay.appendChild(layout);

  const sidebar = document.createElement('div');
  sidebar.className = 'cv-sidebar';
  layout.appendChild(sidebar);

  const main = document.createElement('div');
  main.className = 'cv-main';
  layout.appendChild(main);

  const cv = CARD_VIEWER_STATE;
  const allCardData = DATA.members.map((card) => computeCardFilterData(card));

  function renderSidebar() {
    sidebar.innerHTML = '';

    const searchWrap = document.createElement('div');
    searchWrap.className = 'cv-search-wrap';
    const searchInput = document.createElement('input');
    searchInput.placeholder = 'Search name or subtitle\u2026';
    searchInput.value = cv.search;
    searchInput.oninput = () => {
      cv.search = searchInput.value;
      renderMain();
    };
    searchWrap.appendChild(searchInput);
    sidebar.appendChild(searchWrap);

    const makeCheckboxGroup = (title, options, selectedSet, getKey, getLabel) => {
      const group = document.createElement('div');
      group.className = 'cv-filter-group';
      const label = document.createElement('div');
      label.className = 'cv-filter-group-label';
      label.textContent = title;
      group.appendChild(label);
      const row = document.createElement('div');
      row.className = 'cv-filter-chip-row';
      for (const opt of options) {
        const key = getKey(opt);
        const chip = document.createElement('label');
        chip.className = 'filter-checkbox';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = selectedSet.has(key);
        cb.onchange = () => {
          cb.checked ? selectedSet.add(key) : selectedSet.delete(key);
          renderMain();
        };
        chip.appendChild(cb);
        chip.appendChild(document.createTextNode(getLabel(opt)));
        row.appendChild(chip);
      }
      group.appendChild(row);
      sidebar.appendChild(group);
    };

    makeCheckboxGroup(
      'Type',
      ['CardAttributeType_CARD_ATTRIBUTE_TYPE_ATTRIBUTE_1', 'CardAttributeType_CARD_ATTRIBUTE_TYPE_ATTRIBUTE_2', 'CardAttributeType_CARD_ATTRIBUTE_TYPE_ATTRIBUTE_3'],
      cv.filters.types,
      (t) => t,
      (t) => attrLabel(t)
    );
    makeCheckboxGroup(
      'Rarity',
      [5, 4, 3],
      cv.filters.rarities,
      (r) => r,
      (r) => `${r}\u2605`
    );
    makeCheckboxGroup(
      'Main Stat',
      ['performance', 'technique', 'sense'],
      cv.filters.mainStats,
      (s) => s,
      (s) => s[0].toUpperCase() + s.slice(1)
    );
    const generations = [...new Set(DATA.members.map((m) => m.generation))].sort();
    makeCheckboxGroup(
      'Generation',
      generations,
      cv.filters.generations,
      (g) => g,
      (g) => genLabel(g) || g
    );

    const makeTriState = (title, currentValue, onChange) => {
      const group = document.createElement('div');
      group.className = 'cv-filter-group';
      const label = document.createElement('div');
      label.className = 'cv-filter-group-label';
      label.textContent = title;
      group.appendChild(label);
      const row = document.createElement('div');
      row.className = 'cv-tri-row';
      for (const opt of [
        { key: null, label: 'Any' },
        { key: true, label: 'Yes' },
        { key: false, label: 'No' },
      ]) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cv-tri-btn' + (currentValue === opt.key ? ' cv-tri-btn-active' : '');
        btn.textContent = opt.label;
        btn.onclick = () => {
          onChange(opt.key);
          renderMain();
          renderSidebar();
        };
        row.appendChild(btn);
      }
      group.appendChild(row);
      sidebar.appendChild(group);
    };

    const makeRange = (title, unit, minVal, maxVal, onChangeMin, onChangeMax) => {
      const group = document.createElement('div');
      group.className = 'cv-filter-group';
      const label = document.createElement('div');
      label.className = 'cv-filter-group-label';
      label.textContent = title;
      group.appendChild(label);
      const row = document.createElement('div');
      row.className = 'cv-filter-range-row';
      const minInput = document.createElement('input');
      minInput.type = 'number';
      minInput.placeholder = 'min';
      minInput.value = minVal ?? '';
      minInput.onchange = () => {
        onChangeMin(minInput.value === '' ? null : Number(minInput.value));
        renderMain();
      };
      row.appendChild(minInput);
      row.appendChild(document.createTextNode('\u2013'));
      const maxInput = document.createElement('input');
      maxInput.type = 'number';
      maxInput.placeholder = 'max';
      maxInput.value = maxVal ?? '';
      maxInput.onchange = () => {
        onChangeMax(maxInput.value === '' ? null : Number(maxInput.value));
        renderMain();
      };
      row.appendChild(maxInput);
      if (unit) row.appendChild(document.createTextNode(unit));
      group.appendChild(row);
      sidebar.appendChild(group);
    };

    const BONUS_TYPE_OPTIONS = [
      'LivePassiveSkillEffectType_LIVE_PASSIVE_SKILL_EFFECT_TYPE_ALL_PARAMETER_UP_PERMIL_UP',
      'LivePassiveSkillEffectType_LIVE_PASSIVE_SKILL_EFFECT_TYPE_PERFORMANCE_UP_PERMIL_UP',
      'LivePassiveSkillEffectType_LIVE_PASSIVE_SKILL_EFFECT_TYPE_TECHNIQUE_UP_PERMIL_UP',
      'LivePassiveSkillEffectType_LIVE_PASSIVE_SKILL_EFFECT_TYPE_SENSE_UP_PERMIL_UP',
      'LivePassiveSkillEffectType_LIVE_PASSIVE_SKILL_EFFECT_TYPE_LIVE_ACTIVE_SKILL_EFFECT_UP_PERMIL_UP',
    ];
    const RECIPIENT_TYPE_OPTIONS = [
      'LiveSkillEffectTargetType_LIVE_SKILL_EFFECT_TARGET_TYPE_ATTRIBUTE',
      'LiveSkillEffectTargetType_LIVE_SKILL_EFFECT_TARGET_TYPE_CHARACTER_GROUPING',
      'LiveSkillEffectTargetType_LIVE_SKILL_EFFECT_TARGET_TYPE_SELF',
    ];
    const RECIPIENT_TYPE_LABELS = {
      LiveSkillEffectTargetType_LIVE_SKILL_EFFECT_TARGET_TYPE_ATTRIBUTE: 'PARAMETER',
      LiveSkillEffectTargetType_LIVE_SKILL_EFFECT_TARGET_TYPE_CHARACTER_GROUPING: 'GENERATION',
      LiveSkillEffectTargetType_LIVE_SKILL_EFFECT_TARGET_TYPE_SELF: 'SELF',
    };
    const recipientShortLabel = (t) => RECIPIENT_TYPE_LABELS[t] ?? t;

    const passiveHeader = document.createElement('div');
    passiveHeader.className = 'cv-section-header';
    passiveHeader.textContent = 'Passive Skill';
    sidebar.appendChild(passiveHeader);
    makeTriState('Has Condition', cv.filters.passiveHasCondition, (v) => (cv.filters.passiveHasCondition = v));
    makeCheckboxGroup('Recipient Type', RECIPIENT_TYPE_OPTIONS, cv.filters.passiveRecipientTypes, (t) => t, recipientShortLabel);
    makeCheckboxGroup('Bonus Type', BONUS_TYPE_OPTIONS, cv.filters.passiveBonusTypes, (t) => t, effectLabel);

    const specialHeader = document.createElement('div');
    specialHeader.className = 'cv-section-header';
    specialHeader.textContent = 'Special Skill';
    sidebar.appendChild(specialHeader);
    makeRange(
      'Duration',
      's',
      cv.filters.specialDurationMin,
      cv.filters.specialDurationMax,
      (v) => (cv.filters.specialDurationMin = v),
      (v) => (cv.filters.specialDurationMax = v)
    );
    makeTriState('Has Activation Rate Bonus', cv.filters.specialHasActivationRate, (v) => (cv.filters.specialHasActivationRate = v));
    makeTriState('Has Combo Condition', cv.filters.specialHasCombo, (v) => (cv.filters.specialHasCombo = v));
    makeTriState('Has Life Condition', cv.filters.specialHasLife, (v) => (cv.filters.specialHasLife = v));
    makeTriState('Has Type Condition', cv.filters.specialHasTypeCondition, (v) => (cv.filters.specialHasTypeCondition = v));
    makeTriState('Has Generation Condition', cv.filters.specialHasGenerationCondition, (v) => (cv.filters.specialHasGenerationCondition = v));

    const leaderHeader = document.createElement('div');
    leaderHeader.className = 'cv-section-header';
    leaderHeader.textContent = 'Outfit (Leader) Skill';
    sidebar.appendChild(leaderHeader);
    makeTriState('Has Condition', cv.filters.leaderHasCondition, (v) => (cv.filters.leaderHasCondition = v));
    makeCheckboxGroup('Bonus Type', BONUS_TYPE_OPTIONS, cv.filters.leaderBonusTypes, (t) => t, effectLabel);

    const activeHeader = document.createElement('div');
    activeHeader.className = 'cv-section-header';
    activeHeader.textContent = 'Active Skill';
    sidebar.appendChild(activeHeader);
    makeRange(
      'Duration',
      's',
      cv.filters.activeDurationMin,
      cv.filters.activeDurationMax,
      (v) => (cv.filters.activeDurationMin = v),
      (v) => (cv.filters.activeDurationMax = v)
    );
    makeRange(
      'Chance',
      '%',
      cv.filters.activeChanceMin,
      cv.filters.activeChanceMax,
      (v) => (cv.filters.activeChanceMin = v),
      (v) => (cv.filters.activeChanceMax = v)
    );
    makeRange(
      'Interval',
      's',
      cv.filters.activeIntervalMin,
      cv.filters.activeIntervalMax,
      (v) => (cv.filters.activeIntervalMin = v),
      (v) => (cv.filters.activeIntervalMax = v)
    );
    makeTriState('Has Combo Condition', cv.filters.activeHasCombo, (v) => (cv.filters.activeHasCombo = v));
    makeTriState('Has Life Condition', cv.filters.activeHasLife, (v) => (cv.filters.activeHasLife = v));

    const connectHeader = document.createElement('div');
    connectHeader.className = 'cv-section-header';
    connectHeader.textContent = 'Connect Effect';
    sidebar.appendChild(connectHeader);

    const patternGroup = document.createElement('div');
    patternGroup.className = 'cv-filter-group';
    const patternLabel = document.createElement('div');
    patternLabel.className = 'cv-filter-group-label';
    patternLabel.textContent = 'Pattern (click cells the connector must cover)';
    patternGroup.appendChild(patternLabel);

    const patternGrid = document.createElement('div');
    patternGrid.className = 'cv-pattern-grid';
    // Grid renders top-to-bottom in DOM order, but the game's convention is
    // +Y = up (same flip as buildPatternIcon), so iterate y from high to low.
    for (let y = 3; y >= -3; y--) {
      for (let x = -3; x <= 3; x++) {
        const key = `${x},${y}`;
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'cv-pattern-cell' + (x === 0 && y === 0 ? ' cv-pattern-cell-anchor' : '');
        if (cv.filters.connectPatternCells.has(key)) cell.classList.add('cv-pattern-cell-active');
        cell.onclick = () => {
          cv.filters.connectPatternCells.has(key) ? cv.filters.connectPatternCells.delete(key) : cv.filters.connectPatternCells.add(key);
          cell.classList.toggle('cv-pattern-cell-active');
          renderMain();
        };
        patternGrid.appendChild(cell);
      }
    }
    patternGroup.appendChild(patternGrid);
    const patternNote = document.createElement('div');
    patternNote.className = 'cv-filter-range-row';
    patternNote.style.marginTop = '6px';
    patternNote.textContent = 'Center = connector anchor';
    patternGroup.appendChild(patternNote);
    sidebar.appendChild(patternGroup);

    makeRange(
      'Bonus',
      '%',
      cv.filters.connectBonusMin,
      cv.filters.connectBonusMax,
      (v) => (cv.filters.connectBonusMin = v),
      (v) => (cv.filters.connectBonusMax = v)
    );

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'filter-clear-btn';
    clearBtn.textContent = 'Clear filters';
    clearBtn.onclick = () => {
      cv.filters.types.clear();
      cv.filters.rarities.clear();
      cv.filters.generations.clear();
      cv.filters.mainStats.clear();
      cv.filters.passiveHasCondition = null;
      cv.filters.passiveRecipientTypes.clear();
      cv.filters.passiveBonusTypes.clear();
      cv.filters.specialDurationMin = null;
      cv.filters.specialDurationMax = null;
      cv.filters.specialHasActivationRate = null;
      cv.filters.specialHasCombo = null;
      cv.filters.specialHasLife = null;
      cv.filters.specialHasTypeCondition = null;
      cv.filters.specialHasGenerationCondition = null;
      cv.filters.leaderHasCondition = null;
      cv.filters.leaderBonusTypes.clear();
      cv.filters.activeDurationMin = null;
      cv.filters.activeDurationMax = null;
      cv.filters.activeChanceMin = null;
      cv.filters.activeChanceMax = null;
      cv.filters.activeIntervalMin = null;
      cv.filters.activeIntervalMax = null;
      cv.filters.activeHasCombo = null;
      cv.filters.activeHasLife = null;
      cv.filters.connectPatternCells.clear();
      cv.filters.connectBonusMin = null;
      cv.filters.connectBonusMax = null;
      renderSidebar();
      renderMain();
    };
    sidebar.appendChild(clearBtn);
  }

  function renderMain() {
    main.innerHTML = '';

    const toolbar = document.createElement('div');
    toolbar.className = 'cv-toolbar';
    const countEl = document.createElement('div');
    countEl.className = 'cv-count';
    toolbar.appendChild(countEl);
    const viewToggle = document.createElement('div');
    viewToggle.className = 'cv-view-toggle';
    for (const v of ['card', 'list']) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cv-view-btn' + (cv.view === v ? ' cv-view-btn-active' : '');
      btn.textContent = v === 'card' ? 'Card View' : 'List View';
      btn.onclick = () => {
        cv.view = v;
        renderMain();
      };
      viewToggle.appendChild(btn);
    }
    toolbar.appendChild(viewToggle);
    main.appendChild(toolbar);

    const q = cv.search.trim().toLowerCase();
    const filtered = allCardData.filter((d) => {
      if (!cardMatchesAllFilters(d, cv.filters)) return false;
      if (q && !(d.card.characterName.toLowerCase().includes(q) || d.card.cardSubtitle?.toLowerCase().includes(q))) return false;
      return true;
    });
    countEl.textContent = `${filtered.length} of ${allCardData.length} cards`;

    const resultsWrap = document.createElement('div');
    resultsWrap.className = cv.view === 'card' ? 'cv-card-grid' : 'cv-list';
    main.appendChild(resultsWrap);

    if (cv.view === 'card') {
      for (const d of filtered) resultsWrap.appendChild(renderCardViewerTile(d));
    } else {
      resultsWrap.appendChild(renderCardViewerListHeader());
      for (const d of filtered) resultsWrap.appendChild(renderCardViewerListRow(d));
    }
  }

  renderSidebar();
  renderMain();
}

function openCardDetailsPopup(d) {
  const card = d.card;
  const overlay = document.createElement('div');
  overlay.className = 'picker-overlay';
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  const box = document.createElement('div');
  box.className = 'picker-box cv-details-box';

  const maxLevel = maxLevelFor(card);
  const stats = resolveMemberStats(card, maxLevel, 0, DATA.cardPotentials);

  const condText = (condition) => (condition ? CONDITION_LABELS[condition.type]?.(condition) ?? 'Conditional' : 'Always active');
  const recipientText = (e) => {
    if (e.recipientType === 'LiveSkillEffectTargetType_LIVE_SKILL_EFFECT_TARGET_TYPE_SELF') return 'Self';
    if (e.recipientType === 'LiveSkillEffectTargetType_LIVE_SKILL_EFFECT_TARGET_TYPE_ATTRIBUTE')
      return `Up to ${e.recipientCount} ${attrLabel(e.recipientAttribute)} member${e.recipientCount === 1 ? '' : 's'}`;
    if (e.recipientType === 'LiveSkillEffectTargetType_LIVE_SKILL_EFFECT_TARGET_TYPE_CHARACTER_GROUPING')
      return `Up to ${e.recipientCount} members from ${e.recipientGrouping}`;
    if (e.recipientType === 'LiveSkillEffectTargetType_LIVE_SKILL_EFFECT_TARGET_TYPE_ALL') return 'All members';
    return '\u2014';
  };

  const activeLvl1 = card.activeSkill?.['1'];
  const specialLvl1 = card.specialSkill?.['1'];

  box.innerHTML = `
    <div class="picker-search">
      <div class="cv-details-header">
        <img class="cv-details-portrait" src="images/cards/${card.cardId}.webp" alt="${card.characterName}" loading="lazy">
        <div>
          <div class="board-editor-title">${card.characterName}</div>
          <div class="board-editor-subtitle">${card.cardSubtitle || ''}</div>
          <div class="cv-tile-chips" style="justify-content:flex-start; margin-top:8px;">
            <span class="attr-chip ${attrClass(card.attributeType)}">${attrLabel(card.attributeType)}</span>
            <span class="gen-chip">${genLabel(card.generation) || ''}</span>
            <span class="rarity-badge">${rarityLabel(card.rarity)}</span>
          </div>
        </div>
      </div>
    </div>
    <div class="cv-details-body">
      <div class="cv-details-section">
        <div class="cv-section-header" style="margin-top:0; padding-top:0; border-top:none;">Parameters (Lv${maxLevel}, Bloom 0)</div>
        <div class="cv-details-stat-row"><span>PERF</span><b>${stats.performance}</b></div>
        <div class="cv-details-stat-row"><span>TECH</span><b>${stats.technique}</b></div>
        <div class="cv-details-stat-row"><span>SENSE</span><b>${stats.sense}</b></div>
      </div>

      <div class="cv-details-section">
        <div class="cv-section-header">Outfit (Leader) Skill</div>
        <div class="cv-details-note">Condition: ${condText(card.leaderSkill?.condition)}</div>
        ${(card.leaderSkill?.effects || []).map((e) => `<div class="cv-details-effect">${effectLabel(e.type)} <b>+${Number(e.value) / 10}%</b></div>`).join('') || '<div class="cv-details-note">No effect data</div>'}
      </div>

      <div class="cv-details-section">
        <div class="cv-section-header">Passive Skill</div>
        <div class="cv-details-note">Condition: ${condText(d.passive.hasCondition ? card.passiveSkill?.['1']?.condition : null)}</div>
        ${d.passive.effects.map((e) => `<div class="cv-details-effect">${effectLabel(e.type)} <b>+${e.valuePermil / 10}%</b> \u2192 ${recipientText(e)}</div>`).join('') || '<div class="cv-details-note">No effect data</div>'}
      </div>

      <div class="cv-details-section">
        <div class="cv-section-header">Active Skill</div>
        ${
          activeLvl1
            ? `
          <div class="cv-details-note">Cooldown: ${activeLvl1.coolTimeMs / 1000}s &middot; Activation: ${activeLvl1.activationProbabilityPermil / 10}% &middot; Duration: ${activeLvl1.effectDurationMs / 1000}s</div>
          ${(activeLvl1.effects || []).map((e) => `<div class="cv-details-effect">${effectLabel(e.type)} <b>+${Number(e.value) / 10}%</b></div>`).join('')}
          ${activeLvl1.enhancedCondition ? `<div class="cv-details-note" style="margin-top:6px;">Enhanced if: ${condText(activeLvl1.enhancedCondition)}</div>` : ''}
          ${(activeLvl1.enhancedEffects || []).map((e) => `<div class="cv-details-effect">${effectLabel(e.type)} <b>+${Number(e.value) / 10}%</b> (enhanced)</div>`).join('')}
        `
            : '<div class="cv-details-note">No active skill</div>'
        }
      </div>

      <div class="cv-details-section">
        <div class="cv-section-header">Special Skill</div>
        ${
          specialLvl1
            ? `
          <div class="cv-details-note">Duration: ${specialLvl1.effectDurationMs / 1000}s</div>
          ${(specialLvl1.effects || []).map((e) => `<div class="cv-details-effect">${effectLabel(e.type)} <b>+${Number(e.value) / 10}%</b></div>`).join('')}
          ${(specialLvl1.additionalEffects || []).map((e) => `<div class="cv-details-effect">${effectLabel(e.type)} <b>+${Number(e.value) / 10}%</b></div>`).join('')}
          ${specialLvl1.additionalCondition ? `<div class="cv-details-note" style="margin-top:6px;">Condition: ${condText(specialLvl1.additionalCondition)}</div>` : ''}
        `
            : '<div class="cv-details-note">No special skill</div>'
        }
      </div>

      <div class="cv-details-section">
        <div class="cv-section-header">Connect Effect</div>
        ${
          d.connect.isEligible
            ? `
          <div class="cv-details-connect-row">
            ${buildPatternIcon(DATA.cardConnectInfo[card.cardId].pattern, d.connect.area === 'leader' ? '--attr-cute' : '--attr-pure')}
            <div class="cv-details-note">Bonus: <b>+${d.connect.boostPercent}%</b> &middot; Area: ${d.connect.area}</div>
          </div>
        `
            : '<div class="cv-details-note">Not connect-eligible</div>'
        }
      </div>
    </div>
    <div class="picker-close">CLOSE</div>
  `;
  box.querySelector('.picker-close').onclick = () => overlay.remove();

  overlay.appendChild(box);
  document.body.appendChild(overlay);
}

function renderCardViewerTile(d) {
  const card = d.card;
  const tile = document.createElement('div');
  tile.className = 'cv-tile cv-tile-clickable';
  tile.innerHTML = `
    <img class="cv-tile-portrait" src="images/cards/${card.cardId}.webp" alt="${card.characterName}" loading="lazy">
    <div class="cv-tile-name">${card.characterName}</div>
    <div class="cv-tile-sub">${card.cardSubtitle || ''}</div>
    <div class="cv-tile-chips">
      <span class="attr-chip ${attrClass(card.attributeType)}">${attrLabel(card.attributeType)}</span>
      <span class="gen-chip">${genLabel(card.generation) || ''}</span>
      <span class="rarity-badge">${rarityLabel(card.rarity)}</span>
    </div>
    <div class="cv-tile-stat">Main: ${d.mainStat[0].toUpperCase() + d.mainStat.slice(1)}</div>
  `;
  tile.onclick = () => openCardDetailsPopup(d);
  return tile;
}

function renderCardViewerListHeader() {
  const row = document.createElement('div');
  row.className = 'cv-list-row cv-list-header';
  row.innerHTML = `<span>Character</span><span>Type</span><span>Gen</span><span>Rarity</span><span>Main Stat</span>`;
  return row;
}

function renderCardViewerListRow(d) {
  const card = d.card;
  const row = document.createElement('div');
  row.className = 'cv-list-row cv-tile-clickable';
  row.innerHTML = `
    <span class="cv-list-name">${card.characterName} <span class="cv-list-sub">${card.cardSubtitle || ''}</span></span>
    <span class="attr-chip ${attrClass(card.attributeType)}">${attrLabel(card.attributeType)}</span>
    <span>${genLabel(card.generation) || ''}</span>
    <span class="rarity-badge">${rarityLabel(card.rarity)}</span>
    <span>${d.mainStat[0].toUpperCase() + d.mainStat.slice(1)}</span>
  `;
  row.onclick = () => openCardDetailsPopup(d);
  return row;
}

async function main() {
  await loadData();
  renderSelectionRow();
  recompute();

  document.getElementById('presets-btn').addEventListener('click', openPresetsPanel);
  document.getElementById('compare-btn').addEventListener('click', openComparePage);
  document.getElementById('cost-calc-btn').addEventListener('click', openCostCalculator);
  document.getElementById('card-viewer-btn').addEventListener('click', openCardViewer);
  document.getElementById('music-viewer-btn').addEventListener('click', openMusicViewer);
  document.getElementById('activity-btn').addEventListener('click', openCharacterActivityView);

  // Re-render when crossing the mobile breakpoint (resize, orientation change,
  // or devtools responsive mode) so the layout mode always matches viewport width.
  window.matchMedia(MOBILE_BREAKPOINT).addEventListener('change', () => {
    renderSelectionRow();
    recompute();
  });
}

main().catch((err) => {
  coverageRowEl.innerHTML = `<div class="empty-state">Failed to load data: ${err.message}</div>`;
  console.error(err);
});

// Exposed for headless smoke-testing only (see /tmp/smoke_test.mjs) - harmless
// in production since this file is the page's root module and nothing else
// imports it.
export { state, DATA, recompute, renderSelectionRow, computeFullResult };
