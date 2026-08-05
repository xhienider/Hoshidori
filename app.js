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
} from './js/unitEngine.js';

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
  'hololive 1st Generation / Gamers': 'Gen 1',
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
  boardSelections: {}, // characterId -> { "leader|EFFECT_TYPE" | "member|EFFECT_TYPE": countUnlocked }
  connectSelections: {}, // characterId -> { center?, leader?, member?: { connectorCardId, connectorBloom, allocations } }
  pickerFilters: {
    types: new Set(), // attributeType values; empty = no filter
    rarities: new Set(), // rarity numbers (3,4,5); empty = no filter
    generations: new Set(), // generation strings; empty = no filter
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
      'Node sizes vary and are already reflected in the cost/value shown. Nodes unlock along the physical path: click a node adjacent to the center or another unlocked node to unlock it; locking a node also locks anything past it that becomes disconnected. Green (support) and Yellow (content) areas aren\u2019t modeled yet \u2014 enter those as a manual bonus for now.'
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
          return; // path blocked - clicking does nothing
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
function computeFullResult(team) {
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
  const currentSong = team.songId ? DATA.songs.find((s) => s.id === team.songId) : null;
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

  // Full special-skill windows (not just the activation instant), so the highlight
  // can span the whole duration each member's special skill is active for.
  const specialWindows = song.feverSeconds
    .map((start, i) => ({ start, end: start + (result.specials[i]?.effectDurationSeconds || 0) }))
    .filter((w) => w.end > w.start);
  const feverSecondsRounded = new Set(song.feverSeconds.map((s) => Math.round(s)));
  const inAnySpecialWindow = (t) => specialWindows.some((w) => t >= w.start && t < w.end);

  const wrap = document.createElement('div');
  wrap.className = 'coverage-table-wrap';

  const table = document.createElement('table');
  table.className = 'coverage-table';
  table.style.tableLayout = 'fixed';

  // Match each member column's width to its card above, so the table lines up
  // visually with the selection/info grid. Time+Max together take the same
  // space as the leader's column above.
  const cardCols = document.querySelectorAll('#selection-row .member-col');
  const leaderColWidth = cardCols[0]?.getBoundingClientRect().width || 90;
  const memberColWidths = Array.from(cardCols)
    .slice(1)
    .map((el) => el.getBoundingClientRect().width);

  const colgroup = document.createElement('colgroup');
  const timeCol = document.createElement('col');
  timeCol.style.width = Math.round(leaderColWidth * 0.55) + 'px';
  colgroup.appendChild(timeCol);
  const maxCol = document.createElement('col');
  maxCol.style.width = Math.round(leaderColWidth * 0.45) + 'px';
  colgroup.appendChild(maxCol);
  memberColWidths.forEach((w) => {
    const c = document.createElement('col');
    c.style.width = w + 'px';
    colgroup.appendChild(c);
  });
  table.appendChild(colgroup);

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  headRow.innerHTML =
    '<th>Time</th><th>Max</th>' +
    unitCards.map((c) => `<th>${c.shortName}</th>`).join('');
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

    // The highest effective bonus this second suppresses the others (only the
    // strongest score bonus applies when multiple members are active at once).
    // Ties: earlier activation wins; same-second ties: earlier unit order wins.
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

  coverageRowEl.appendChild(wrap);

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

  const chosen = { a: null, b: null };
  const chosenSong = { a: null, b: null };

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

    const computedA = chosen.a ? computeFullResult(presetToTeamState(chosen.a)) : null;
    const computedB = chosen.b ? computeFullResult(presetToTeamState(chosen.b)) : null;

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
  }

  renderLayout();
}

async function main() {
  await loadData();
  renderSelectionRow();
  recompute();

  document.getElementById('presets-btn').addEventListener('click', openPresetsPanel);
  document.getElementById('compare-btn').addEventListener('click', openComparePage);

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
