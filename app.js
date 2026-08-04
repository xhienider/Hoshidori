import { resolveMemberStats, getStatRoles, getSkillLevel, SKILL_LEVEL_TYPES } from './js/statEngine.js';
import { evaluateLeaderCondition, resolveEffectRecipients } from './js/skillEngine.js';
import {
  computeUnit,
  mapSpecialSkillsToSong,
  estimateOverallPower,
  estimatePassivePower,
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
  statsBlock.onclick = (e) => e.stopPropagation();

  const chip = document.createElement('div');
  chip.className = 'attr-chip ' + attrClass(card.attributeType);
  chip.textContent = attrLabel(card.attributeType);
  chip.style.marginTop = '0';
  statsBlock.appendChild(chip);

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
    openBoardEditor(card);
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

function openBoardEditor(card) {
  const characterId = card.characterId;
  const charData = DATA.boardCategories[characterId];
  if (!charData) return;
  if (!state.boardSelections[characterId]) state.boardSelections[characterId] = new Set();
  const sel = state.boardSelections[characterId];
  const boardIndex = buildBoardIndex(charData);

  // Only show the board area(s) that actually apply given this character's
  // current role(s) - Leader (red) only matters if she's actually the
  // leader; Member (blue) only matters if she's actually a performing unit
  // member. A character can be both at once (leader who's also in the unit),
  // in which case both stay visible.
  const isCurrentLeader = !!(state.leader.cardId && DATA.byId[state.leader.cardId]?.characterId === characterId);
  const isCurrentUnitMember = state.unit.some((u) => u.cardId && DATA.byId[u.cardId]?.characterId === characterId);
  const anyRole = isCurrentLeader || isCurrentUnitMember;
  const showLeaderArea = !anyRole || isCurrentLeader;
  const showMemberArea = !anyRole || isCurrentUnitMember;

  const overlay = document.createElement('div');
  overlay.className = 'picker-overlay';

  const box = document.createElement('div');
  box.className = 'picker-box board-editor-box';

  const header = document.createElement('div');
  header.className = 'picker-search';
  const areaLabel = showLeaderArea && showMemberArea
    ? 'Leader (red) and Member (blue) areas'
    : showLeaderArea
    ? 'Leader (red) area only \u2014 she\u2019s not currently a unit member, so Member (blue) nodes wouldn\u2019t apply'
    : 'Member (blue) area only \u2014 she\u2019s not currently the leader, so Leader (red) nodes wouldn\u2019t apply';
  header.innerHTML = `<div class="board-editor-title">${charData.characterName} \u00b7 Holomem Board</div><div class="board-editor-subtitle">${areaLabel} \u2014 node sizes vary, already reflected in the cost/value shown. Nodes unlock along the physical path: click a node adjacent to the center or another unlocked node to unlock it; locking a node also locks anything past it that becomes disconnected. All Member (green) and Content (yellow) areas aren't modeled yet; enter those as a manual bonus for now.</div>`;
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
    const spacing = 22;
    const pad = 20;
    const width = (maxX - minX) * spacing + pad * 2;
    const height = (maxY - minY) * spacing + pad * 2;
    const toScreenX = (x) => pad + (x - minX) * spacing;
    const toScreenY = (y) => pad + (maxY - y) * spacing; // +Y renders upward (toward leader path)

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('width', '100%');
    svg.classList.add('board-diagram');
    svg.style.maxHeight = Math.min(height, 340) + 'px';

    const centerCircle = document.createElementNS(svgNS, 'circle');
    centerCircle.setAttribute('cx', toScreenX(0));
    centerCircle.setAttribute('cy', toScreenY(0));
    centerCircle.setAttribute('r', 6);
    centerCircle.setAttribute('class', 'board-diagram-center');
    svg.appendChild(centerCircle);

    for (const n of allNodes) {
      const unlocked = sel.has(n.posKey);
      const el = document.createElementNS(svgNS, n.kind === 'connector' ? 'rect' : 'circle');
      const colorVar = n.kind === 'connector' ? '--text-faint' : n.area === 'leader' ? '--red-node' : '--blue-node';

      if (n.kind === 'connector') {
        const size = 8;
        el.setAttribute('x', toScreenX(n.x) - size / 2);
        el.setAttribute('y', toScreenY(n.y) - size / 2);
        el.setAttribute('width', size);
        el.setAttribute('height', size);
        el.setAttribute('rx', 1.5);
      } else {
        el.setAttribute('cx', toScreenX(n.x));
        el.setAttribute('cy', toScreenY(n.y));
        el.setAttribute('r', n.grade >= 2 ? 7 : 5.5);
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

    for (const slotType of ['center', 'leader', 'member']) {
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
        if (!info) return false; // must have some connect pattern, but any area is fine here
        if (q && !m.characterName?.toLowerCase().includes(q) && !m.cardSubtitle?.toLowerCase().includes(q)) return false;
        return true;
      }).slice(0, 60);

      if (!matches.length) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.textContent = 'No connect-eligible characters found.';
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
        infoDiv.innerHTML = `<div class="picker-item-name">${m.characterName} <span class="rarity-badge">${rarityLabel(m.rarity)}</span></div><div class="picker-item-sub">${m.cardSubtitle || ''}</div><div class="picker-item-sub">${AREA_ICON[info.area] || ''} boosts ${info.area} nodes \u00b7 ${info.nodeCount} nodes \u00b7 +${(info.boostPermilLevel1/10).toFixed(0)}\u2013${(info.boostPermilLevel2/10).toFixed(0)}%</div>`;
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

function recompute() {
  const leaderCard = state.leader.cardId ? DATA.byId[state.leader.cardId] : null;
  const unitFilled = state.unit.every((u) => u.cardId);

  if (!leaderCard || !unitFilled) {
    renderInfoRowIncomplete(leaderCard);
    coverageRowEl.innerHTML = '<div class="empty-state">Select a leader and all 5 unit members to see results.</div>';
    powerRowEl.innerHTML = '';
    return;
  }

  const unit = state.unit.map((u) => ({ card: DATA.byId[u.cardId], level: u.level, bloom: u.bloom }));
  const data = { members: DATA.cardPotentials, characterGroupings: DATA.characterGroupings };

  const result = computeUnit(
    { leaderCard, leaderLevel: state.leader.level, leaderBloom: state.leader.bloom, unit },
    data
  );

  // Holomem Board bonuses. Leader-area (red) nodes only apply from whichever
  // slot is actually the chosen leader this run - a character's stored
  // leader-node picks do nothing when she's placed as a plain unit member
  // instead, even under the same characterId. Member-area (blue) nodes only
  // apply from a slot that's actually performing.
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
  // A handful of Leader board nodes only apply "when included as a singer" on
  // the currently selected song - needs the song's real singer characterIds.
  const currentSong = state.songId ? DATA.songs.find((s) => s.id === state.songId) : null;
  const songSingerCharacterIds = currentSong?.characterIds || [];
  const boardBonuses = computeBoardBonuses(state.boardSelections, DATA.boardCategories, slots, songSingerCharacterIds);
  const connectBonuses = computeConnectBonuses(
    state.connectSelections,
    DATA.boardCategories,
    state.boardSelections,
    DATA.cardConnectInfo,
    DATA.byId,
    DATA.cardPotentials,
    slots
  );
  const combinedBonuses = mergeBoardBonuses(boardBonuses, connectBonuses);

  // Snapshot the real per-card base stats (level + bloom only) before board/
  // connect bonuses mutate result.memberStats in place. The in-game card
  // screen shows base + Blue (member) + Green (support, from ANY character's
  // board regardless of unit membership) - but never Red (leader), since
  // that's a live-performance buff to the whole unit, not the leader's own
  // stat. We can reproduce Blue (computed per-slot already); Green would need
  // board data for the player's entire roster, not just the 6 selected slots,
  // so it stays out of scope - the Parameters panel will still read slightly
  // low versus the game for anyone with Green nodes unlocked elsewhere.
  const memberOnlySlots = slots.map((s) => ({ ...s, isLeaderSlot: false }));
  const memberOnlyBoardBonuses = computeBoardBonuses(state.boardSelections, DATA.boardCategories, memberOnlySlots, songSingerCharacterIds);
  const memberOnlyConnectBonuses = computeConnectBonuses(
    state.connectSelections,
    DATA.boardCategories,
    state.boardSelections,
    DATA.cardConnectInfo,
    DATA.byId,
    DATA.cardPotentials,
    memberOnlySlots
  );
  const memberOnlyCombined = mergeBoardBonuses(memberOnlyBoardBonuses, memberOnlyConnectBonuses);
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

  renderInfoRow(result, leaderCard, unit, scoreSupport, baseStats);
  renderCoverageRow(result, unit, scoreSupport);
  renderPowerRow(result, leaderCard, scoreSupport);
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
  panel.innerHTML = `
    <div class="panel-label">Parameters</div>
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
    <div class="effect-detail" style="margin-top:6px;">Includes Member (blue) board node bonuses for this card. Excludes Leader (red) buffs (matches the in-game card screen) and Green support bonuses from other characters' boards \u2014 those depend on your whole roster, not just this unit.</div>
  `;
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
    const recipientNames = e.recipients.map((id) => DATA.byId[id]?.characterName?.split(' ')[0]).join(', ');
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
    unitCards.map((c) => `<th>${c.characterName.split(' ')[0]}</th>`).join('');
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
        const title = `${m.effectiveBonus.toFixed(1)}% score bonus @ ${m.activationChance}% activation chance${isWinner ? '' : ' \u2014 suppressed by a higher/earlier bonus this second'}`;
        rowHtml += `<td class="${cls}" style="border-color:${borderColor}" title="${title}">${m.effectiveBonus.toFixed(1)}% @ ${m.activationChance}%</td>`;
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

  const summary = document.createElement('div');
  summary.className = 'coverage-summary';
  summary.style.marginTop = '16px';
  summary.style.marginBottom = '0';
  summary.innerHTML = `
    <div class="coverage-stat"><div class="stat-num">${noBonusSeconds}</div><div class="stat-label">Secs with no bonus (&gt;20s in)</div></div>
    <div class="coverage-stat"><div class="stat-num">${noBonusDuringSpecial}</div><div class="stat-label">Special skill secs w/ no bonus</div></div>
    <div class="coverage-stat"><div class="stat-num">${peakBonus.toFixed(0)}%</div><div class="stat-label">Peak score bonus</div></div>
    <div class="coverage-stat"><div class="stat-num">${avgBonus.toFixed(0)}%</div><div class="stat-label">Average score bonus</div></div>
  `;
  coverageRowEl.appendChild(summary);
}

function renderPowerRow(result, leaderCard, scoreSupport) {
  powerRowEl.innerHTML = '';
  const panel = document.createElement('div');
  panel.className = 'panel';
  const label = document.createElement('div');
  label.className = 'panel-label';
  label.textContent = 'Overall Power \u00b7 Estimate';
  panel.appendChild(label);

  const leaderEffect = result.leader?.effects?.[0];
  let buffStat = 'all';
  if (leaderEffect?.type?.includes('TECHNIQUE')) buffStat = 'technique';
  else if (leaderEffect?.type?.includes('PERFORMANCE')) buffStat = 'performance';
  else if (leaderEffect?.type?.includes('SENSE')) buffStat = 'sense';

  const estimate = estimateOverallPower({
    statTotals: result.statTotals,
    leaderBuff: leaderEffect
      ? { buffStat, buffScorePercent: Number(leaderEffect.value) / 10, conditionMet: result.leader.conditionMet === true }
      : null,
    passivePowerEstimate: estimatePassivePower(result.passives, result.memberStats),
  });

  panel.innerHTML = `
    <div class="power-total">${estimate.total.toLocaleString()}</div>
    <div class="power-breakdown">
      <span>Member Parameter</span><span class="num">${estimate.memberParameter.toLocaleString()}</span>
      <span>Outfit Skill</span><span class="num">${estimate.outfitSkill.toLocaleString()}</span>
      <span>Passive Skill</span><span class="num">${estimate.passiveSkill.toLocaleString()}</span>
      <span>Holomem Board Bonus</span><span class="num">${estimate.boardBonus.toLocaleString()}</span>
      <span>Memory Bonus</span><span class="num">${estimate.memoryBonus.toLocaleString()}</span>
    </div>
    <div class="estimate-note">${estimate._note} Holomem Board and Memory bonuses still require manual input \u2014 currently shown as 0.</div>
  `;
  powerRowEl.appendChild(panel);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function main() {
  await loadData();
  renderSelectionRow();
  recompute();

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
