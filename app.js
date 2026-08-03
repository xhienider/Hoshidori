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
};

function maxLevelFor(card) {
  const levels = Object.keys(card.levelCurve).map(Number);
  return levels.length ? Math.max(...levels) : 80;
}

// ---------------------------------------------------------------------------
// Roster slot rendering
// ---------------------------------------------------------------------------

const rosterEl = document.getElementById('roster');
const songSlotEl = document.getElementById('song-slot');
const resultsEl = document.getElementById('results');

function renderRoster() {
  rosterEl.innerHTML = '';

  rosterEl.appendChild(renderSlot('leader', state.leader, true));
  const divider = document.createElement('div');
  divider.className = 'panel-label';
  divider.style.marginTop = '14px';
  divider.textContent = 'Unit';
  rosterEl.appendChild(divider);

  state.unit.forEach((slot, i) => {
    rosterEl.appendChild(renderSlot(i, slot, false));
  });
}

function renderSlot(key, slotState, isLeader) {
  const wrap = document.createElement('div');
  const card = slotState.cardId ? DATA.byId[slotState.cardId] : null;

  wrap.className = 'slot' + (isLeader ? ' leader-slot' : '') + (card ? '' : ' empty');
  wrap.innerHTML = '';

  const badge = document.createElement('div');
  badge.className = 'slot-badge ' + (card ? attrClass(card.attributeType) : 'attr-empty');
  badge.textContent = card ? attrLabel(card.attributeType)[0] : (isLeader ? 'L' : '+');
  wrap.appendChild(badge);

  const info = document.createElement('div');
  info.className = 'slot-info';

  const name = document.createElement('div');
  name.className = 'slot-name';
  if (card) {
    name.innerHTML = `${card.characterName} <span class="rarity-badge">${rarityLabel(card.rarity)}</span>`;
  } else {
    name.textContent = isLeader ? 'Choose leader' : 'Choose member';
  }
  info.appendChild(name);

  const sub = document.createElement('div');
  sub.className = 'slot-sub';
  sub.textContent = card ? card.cardSubtitle || '' : 'Click to select from roster';
  info.appendChild(sub);

  if (card) {
    const row = document.createElement('div');
    row.className = 'lvl-bloom-row';
    row.onclick = (e) => e.stopPropagation();

    const lvlLabel = document.createElement('span');
    lvlLabel.className = 'slot-sub';
    lvlLabel.textContent = 'Lv';
    row.appendChild(lvlLabel);

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
    row.appendChild(lvlInput);

    const bloomLabel = document.createElement('span');
    bloomLabel.className = 'slot-sub';
    bloomLabel.textContent = 'Bloom';
    row.appendChild(bloomLabel);

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
    row.appendChild(bloomInput);

    const boardBtn = document.createElement('button');
    boardBtn.className = 'board-btn';
    boardBtn.type = 'button';
    const hasBoard = !!DATA.boardCategories?.[card.characterId];
    const spent = boardPointsSpent(card.characterId);
    boardBtn.textContent = hasBoard ? `Board${spent ? ` (${spent})` : ''}` : 'Board \u2014';
    boardBtn.disabled = !hasBoard;
    boardBtn.onclick = (e) => {
      e.stopPropagation();
      openBoardEditor(card);
    };
    row.appendChild(boardBtn);

    info.appendChild(row);
  }

  wrap.appendChild(info);

  wrap.addEventListener('click', () => openPicker(slotState, isLeader));

  return wrap;
}

function clamp(v, lo, hi) {
  if (Number.isNaN(v)) return lo;
  return Math.max(lo, Math.min(hi, v));
}

function boardPointsSpent(characterId) {
  const sel = state.boardSelections[characterId];
  const charData = DATA.boardCategories?.[characterId];
  if (!sel || !charData) return 0;
  let total = 0;
  for (const [key, count] of Object.entries(sel)) {
    if (!count) continue;
    const nodes = charData.categories[key];
    if (!nodes) continue;
    total += nodes.slice(0, count).reduce((s, n) => s + n.cost, 0);
  }
  return total;
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
  if (!state.boardSelections[characterId]) state.boardSelections[characterId] = {};
  const sel = state.boardSelections[characterId];

  const overlay = document.createElement('div');
  overlay.className = 'picker-overlay';

  const box = document.createElement('div');
  box.className = 'picker-box board-editor-box';

  const header = document.createElement('div');
  header.className = 'picker-search';
  header.innerHTML = `<div class="board-editor-title">${charData.characterName} \u00b7 Holomem Board</div><div class="board-editor-subtitle">Leader (red) and Member (blue) areas only \u2014 node sizes vary, already reflected in the cost/value shown. All Member (green) and Content (yellow) areas aren't modeled yet; enter those as a manual bonus for now.</div>`;
  box.appendChild(header);

  const list = document.createElement('div');
  list.className = 'picker-list board-editor-list';

  const leaderNodes = [];
  const memberNodes = [];
  for (const key of Object.keys(charData.categories)) {
    const [area, type] = key.split('|');
    (area === 'leader' ? leaderNodes : memberNodes).push([key, type]);
  }

  /** Flattens all nodes across the given category entries into one positioned list. */
  const buildFlatNodes = (entries) => {
    const flat = [];
    for (const [key, type] of entries) {
      const nodes = charData.categories[key];
      nodes.forEach((n, index) => {
        flat.push({ key, type, index, x: n.x || 0, y: n.y || 0, cost: n.cost, value: n.value, grade: n.grade });
      });
    }
    return flat;
  };

  /** Renders one area (leader or member) as a spatial diagram matching its real board layout. */
  const renderDiagram = (title, hint, entries, colorVar) => {
    if (!entries.length) return;
    const groupLabel = document.createElement('div');
    groupLabel.className = 'board-group-label';
    groupLabel.innerHTML = `${title} <span class="board-group-hint">${hint}</span>`;
    list.appendChild(groupLabel);

    const flat = buildFlatNodes(entries);
    const xs = flat.map((n) => n.x);
    const ys = flat.map((n) => n.y);
    const minX = Math.min(0, ...xs);
    const maxX = Math.max(0, ...xs);
    const minY = Math.min(0, ...ys);
    const maxY = Math.max(0, ...ys);
    const spacing = 26;
    const pad = 20;
    const width = (maxX - minX) * spacing + pad * 2;
    const height = (maxY - minY) * spacing + pad * 2;
    // Screen Y increases downward, but board Y increases "up" (toward the
    // leader path) - flip so positive Y renders upward, matching the game.
    const toScreenX = (x) => pad + (x - minX) * spacing;
    const toScreenY = (y) => pad + (maxY - y) * spacing;

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('width', '100%');
    svg.classList.add('board-diagram');
    svg.style.maxHeight = Math.min(height, 220) + 'px';

    // Center marker
    const centerCircle = document.createElementNS(svgNS, 'circle');
    centerCircle.setAttribute('cx', toScreenX(0));
    centerCircle.setAttribute('cy', toScreenY(0));
    centerCircle.setAttribute('r', 5);
    centerCircle.setAttribute('class', 'board-diagram-center');
    svg.appendChild(centerCircle);

    for (const n of flat) {
      const count = sel[n.key] || 0;
      const unlocked = n.index < count;
      const circle = document.createElementNS(svgNS, 'circle');
      circle.setAttribute('cx', toScreenX(n.x));
      circle.setAttribute('cy', toScreenY(n.y));
      circle.setAttribute('r', n.grade >= 2 ? 8 : 6);
      circle.setAttribute('class', 'board-diagram-node' + (unlocked ? ' unlocked' : ''));
      circle.style.setProperty('--node-color', `var(${colorVar})`);
      const isPermil = n.type.includes('PERMIL');
      const valLabel = isPermil ? `+${(n.value / 10).toFixed(1)}%` : `+${n.value} pts`;
      const title = document.createElementNS(svgNS, 'title');
      title.textContent = `${BOARD_CATEGORY_LABELS[n.type] || n.type} \u00b7 ${valLabel} \u00b7 ${n.cost}pt \u00b7 ${n.grade >= 2 ? '2\u2605' : '1\u2605'}${unlocked ? ' (unlocked)' : ''}`;
      circle.appendChild(title);
      circle.addEventListener('click', () => {
        const current = sel[n.key] || 0;
        // Clicking an unlocked node re-locks it and everything past it in that
        // category; clicking a locked node unlocks up through it - same
        // sequential-by-cost model as the stepper, just interacted with spatially.
        sel[n.key] = n.index < current ? n.index : n.index + 1;
        refreshEditor();
      });
      svg.appendChild(circle);
    }

    list.appendChild(svg);

    const totalSpent = flat.reduce((s, n) => s + ((sel[n.key] || 0) > n.index ? n.cost : 0), 0);
    const legend = document.createElement('div');
    legend.className = 'board-diagram-legend';
    legend.textContent = `${totalSpent} pts spent in this area \u00b7 click a node to unlock/lock it`;
    list.appendChild(legend);
  };

  const connectSection = document.createElement('div');
  connectSection.className = 'connect-section';

  const totalEl = document.createElement('div');
  totalEl.className = 'board-total';

  function refreshEditor() {
    list.innerHTML = '';
    renderDiagram('\ud83d\udd34 Leader Area', '\u2014 applies to the whole unit', leaderNodes, '--red-node');
    renderDiagram('\ud83d\udd35 Member Area', '\u2014 applies to this character only', memberNodes, '--blue-node');
    totalEl.textContent = `${boardPointsSpent(characterId)} points allocated`;
    renderConnectSection();
    list.appendChild(connectSection);
    recompute();
    renderRoster();
  }

  function renderConnectSection() {
    connectSection.innerHTML = '';
    const heading = document.createElement('div');
    heading.className = 'board-group-label';
    heading.innerHTML = 'Connect Effects <span class="board-group-hint">\u2014 assign a connector character; her boost applies automatically to your highest-value unlocked nodes in the matching area</span>';
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
      connectorBtn.textContent = connectorCard ? connectorCard.characterName : 'Choose connector';
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
          const relevantAreas = slotType === 'center' ? ['leader', 'member'] : [slotType];
          const unlockedInArea = Object.entries(sel).filter(([key, count]) => {
            if (!count) return false;
            const [area] = key.split('|');
            return relevantAreas.includes(area);
          });
          const totalUnlocked = unlockedInArea.reduce((s, [, c]) => s + c, 0);
          const appliedCount = Math.min(totalUnlocked, info.nodeCount);

          const applyLine = document.createElement('div');
          applyLine.className = 'connect-budget-line';
          applyLine.textContent =
            appliedCount > 0
              ? `Auto-applied to your ${appliedCount} highest-value unlocked node${appliedCount === 1 ? '' : 's'} in the matching area`
              : 'Unlock some nodes in the matching area first \u2014 nothing to boost yet';
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
        const badge = document.createElement('div');
        badge.className = 'slot-badge ' + attrClass(m.attributeType);
        badge.style.width = '26px';
        badge.style.height = '26px';
        badge.style.fontSize = '11px';
        badge.textContent = attrLabel(m.attributeType)[0];
        item.appendChild(badge);
        const infoDiv = document.createElement('div');
        infoDiv.innerHTML = `<div class="picker-item-name">${m.characterName} <span class="rarity-badge">${rarityLabel(m.rarity)}</span></div><div class="picker-item-sub">${AREA_ICON[info.area] || ''} boosts ${info.area} nodes \u00b7 ${info.nodeCount} nodes \u00b7 +${(info.boostPermilLevel1/10).toFixed(0)}\u2013${(info.boostPermilLevel2/10).toFixed(0)}%</div>`;
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
    let pool = DATA.members;
    if (isLeader) pool = pool.filter((m) => m.leaderSkill);
    const matches = pool
      .filter((m) => !q || m.characterName?.toLowerCase().includes(q) || m.cardSubtitle?.toLowerCase().includes(q))
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

      const badge = document.createElement('div');
      badge.className = 'slot-badge ' + attrClass(m.attributeType);
      badge.style.width = '26px';
      badge.style.height = '26px';
      badge.style.fontSize = '11px';
      badge.textContent = attrLabel(m.attributeType)[0];
      item.appendChild(badge);

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
        renderRoster();
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
// Song select
// ---------------------------------------------------------------------------

function renderSongSlot() {
  songSlotEl.innerHTML = '';
  const song = state.songId ? DATA.songs.find((s) => s.id === state.songId) : null;

  const slot = document.createElement('div');
  slot.className = 'slot' + (song ? '' : ' empty');

  const badge = document.createElement('div');
  badge.className = 'slot-badge attr-empty';
  badge.textContent = '\u266a';
  slot.appendChild(badge);

  const info = document.createElement('div');
  info.className = 'slot-info';
  const name = document.createElement('div');
  name.className = 'slot-name';
  name.textContent = song ? song.title : 'Choose a song';
  info.appendChild(name);
  const sub = document.createElement('div');
  sub.className = 'slot-sub';
  sub.textContent = song
    ? `${Math.floor((song.playingSeconds || 0) / 60)}:${String((song.playingSeconds || 0) % 60).padStart(2, '0')} \u00b7 5 fever points`
    : 'Click to search from song list';
  info.appendChild(sub);
  slot.appendChild(info);

  slot.addEventListener('click', openSongPicker);
  songSlotEl.appendChild(slot);
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
        renderSongSlot();
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
    resultsEl.innerHTML = '<div class="empty-state">Select a leader and all 5 unit members to see results.</div>';
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
  const boardBonuses = computeBoardBonuses(state.boardSelections, DATA.boardCategories, slots);
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
  applyBoardBonuses(result, combinedBonuses);

  const scoreSupport = mergeScoreSupport(computeScoreSupport(result.passives), combinedBonuses.scoreSupportPermil);

  renderResults(result, leaderCard, unit, scoreSupport);
}

function renderResults(result, leaderCard, unit, scoreSupport) {
  resultsEl.innerHTML = '';

  resultsEl.appendChild(renderStatsPanel(result));

  const twoCol = document.createElement('div');
  twoCol.className = 'two-col';
  twoCol.appendChild(renderLeaderPanel(result, leaderCard));
  twoCol.appendChild(renderPassivesPanel(result, unit));
  resultsEl.appendChild(twoCol);

  resultsEl.appendChild(renderActivesPanel(result, unit, scoreSupport));
  resultsEl.appendChild(renderTimelinePanel(result, unit));
  resultsEl.appendChild(renderCoveragePanel(result, unit, scoreSupport));
  resultsEl.appendChild(renderPowerPanel(result, leaderCard, scoreSupport));
}

function renderStatsPanel(result) {
  const panel = document.createElement('div');
  panel.className = 'panel';
  const label = document.createElement('div');
  label.className = 'panel-label';
  label.textContent = 'Member Stats';
  panel.appendChild(label);

  const maxStat = Math.max(...result.memberStats.flatMap((m) => [m.stats.performance, m.stats.technique, m.stats.sense]));

  const table = document.createElement('table');
  table.className = 'stat-table';
  table.innerHTML = `<thead><tr><th>Member</th><th>Performance</th><th></th><th>Technique</th><th></th><th>Sense</th><th></th></tr></thead>`;
  const tbody = document.createElement('tbody');

  for (const m of result.memberStats) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${m.name}<div class="slot-sub">Lv${m.level}${m.bloom ? ` \u00b7 Bloom ${m.bloom}` : ''}</div></td>
      <td class="num">${m.stats.performance}</td>
      <td>${meterCell('perf', m.stats.performance, maxStat)}</td>
      <td class="num">${m.stats.technique}</td>
      <td>${meterCell('tech', m.stats.technique, maxStat)}</td>
      <td class="num">${m.stats.sense}</td>
      <td>${meterCell('sense', m.stats.sense, maxStat)}</td>
    `;
    tbody.appendChild(tr);
  }

  const totalTr = document.createElement('tr');
  totalTr.className = 'totals-row';
  totalTr.innerHTML = `
    <td>Total</td>
    <td class="num">${result.statTotals.performance}</td><td></td>
    <td class="num">${result.statTotals.technique}</td><td></td>
    <td class="num">${result.statTotals.sense}</td><td></td>
  `;
  tbody.appendChild(totalTr);

  table.appendChild(tbody);
  panel.appendChild(table);
  return panel;
}

function meterCell(kind, value, max) {
  const pct = max ? Math.round((value / max) * 100) : 0;
  return `<div class="meter ${kind}"><span style="width:${pct}%"></span></div>`;
}

function renderLeaderPanel(result, leaderCard) {
  const panel = document.createElement('div');
  panel.className = 'panel';
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

function renderPassivesPanel(result, unit) {
  const panel = document.createElement('div');
  panel.className = 'panel';
  const label = document.createElement('div');
  label.className = 'panel-label';
  label.textContent = 'Passive Skills';
  panel.appendChild(label);

  result.passives.forEach((p, i) => {
    const card = DATA.byId[unit[i].card.cardId];
    const anyApplies = p.effects.some((e) => e.applies);
    const div = document.createElement('div');
    div.className = 'effect-card' + (p.effects.length && !anyApplies ? ' inactive' : '');

    let inner = `<div class="effect-head"><span class="effect-name">${card.characterName}</span></div>`;
    if (!p.effects.length) {
      inner += '<div class="effect-detail">No passive skill</div>';
    }
    for (const e of p.effects) {
      const recipientNames = e.recipients.map((id) => DATA.byId[id]?.characterName?.split(' ')[0]).join(', ');
      inner += `
        <div class="effect-detail" style="margin-top:6px;">
          <span class="pill ${e.applies ? 'met' : 'unmet'}">${e.applies ? 'ACTIVE' : 'NO ELIGIBLE TARGET'}</span>
          ${effectLabel(e.type)} <span class="effect-value">+${(e.valuePermil / 10).toFixed(0)}%</span>
          ${e.applies ? `\u2192 ${recipientNames}` : ''}
        </div>`;
    }
    div.innerHTML = inner;
    panel.appendChild(div);
  });

  return panel;
}

function renderActivesPanel(result, unit, scoreSupport) {
  const panel = document.createElement('div');
  panel.className = 'panel';
  const label = document.createElement('div');
  label.className = 'panel-label';
  label.textContent = 'Active Skills';
  panel.appendChild(label);

  const table = document.createElement('table');
  table.className = 'stat-table';
  table.innerHTML = `<thead><tr><th>Member</th><th>Lv</th><th>Activation</th><th>Cooldown</th><th>Duration</th><th>Effect</th><th>Score Support</th></tr></thead>`;
  const tbody = document.createElement('tbody');

  result.actives.forEach((a, i) => {
    const card = DATA.byId[unit[i].card.cardId];
    const support = scoreSupport[card.cardId] || 0;
    const effectText = a.effects
      ?.map((e) => {
        const isPlainScoreUp = e.type.endsWith('_TYPE_SCORE_UP_PERMIL_UP');
        if (isPlainScoreUp && support) {
          return `${effectLabel(e.type)} +${e.valuePercent.toFixed(0)}% <span style="color:var(--orange)">+ ${support.toFixed(0)}%</span>`;
        }
        return `${effectLabel(e.type)} +${e.valuePercent.toFixed(0)}%`;
      })
      .join(', ') ?? '\u2014';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${card.characterName}</td>
      <td class="num">${a.level ?? '\u2014'}</td>
      <td class="num">${a.activationProbabilityPercent != null ? a.activationProbabilityPercent.toFixed(0) + '%' : '\u2014'}</td>
      <td class="num">${a.coolTimeSeconds != null ? a.coolTimeSeconds.toFixed(0) + 's' : '\u2014'}</td>
      <td class="num">${a.effectDurationSeconds != null ? a.effectDurationSeconds.toFixed(0) + 's' : '\u2014'}</td>
      <td>${effectText}</td>
      <td class="num">${support ? '+' + support.toFixed(0) + '%' : '\u2014'}</td>
    `;
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  panel.appendChild(table);
  return panel;
}

function renderTimelinePanel(result, unit) {
  const panel = document.createElement('div');
  panel.className = 'panel';
  const label = document.createElement('div');
  label.className = 'panel-label';
  label.textContent = 'Setlist Timeline \u00b7 Special Skills';
  panel.appendChild(label);

  const song = state.songId ? DATA.songs.find((s) => s.id === state.songId) : null;

  if (!song) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'Select a song above to map special skill activations to its fever points.';
    panel.appendChild(empty);
    return panel;
  }

  const specials = mapSpecialSkillsToSong(result.specials, song.feverSeconds);
  const duration = song.playingSeconds || Math.max(...song.feverSeconds) + 15;

  const wrap = document.createElement('div');
  wrap.className = 'timeline-wrap';

  const track = document.createElement('div');
  track.className = 'timeline-track';

  specials.forEach((s, i) => {
    const card = DATA.byId[unit[i].card.cardId];
    const pct = (s.activationTimeSeconds / duration) * 100;

    const mark = document.createElement('div');
    mark.className = 'fever-mark';
    mark.style.left = pct + '%';
    track.appendChild(mark);

    const feverLabel = document.createElement('div');
    feverLabel.className = 'fever-label';
    feverLabel.style.left = pct + '%';
    feverLabel.textContent = `${s.activationTimeSeconds.toFixed(1)}s`;
    track.appendChild(feverLabel);

    const memberLabel = document.createElement('div');
    memberLabel.className = 'fever-member';
    memberLabel.style.left = pct + '%';
    memberLabel.innerHTML = `${card.characterName.split(' ')[0]}<br><span style="color:var(--amber)">+${s.supportBonusPercent ?? '\u2014'}%</span> spt \u00b7 <span style="color:var(--cyan)">+${s.activationRateUpPercent ?? '\u2014'}%</span> act`;
    track.appendChild(memberLabel);
  });

  wrap.appendChild(track);

  const ends = document.createElement('div');
  ends.className = 'timeline-ends';
  ends.innerHTML = `<span>0:00</span><span>${song.title} \u00b7 ${Math.floor(duration / 60)}:${String(Math.round(duration % 60)).padStart(2, '0')}</span>`;
  wrap.appendChild(ends);

  panel.appendChild(wrap);
  return panel;
}

function renderCoveragePanel(result, unit, scoreSupport) {
  const panel = document.createElement('div');
  panel.className = 'panel';
  const label = document.createElement('div');
  label.className = 'panel-label';
  label.textContent = 'Bonus Coverage \u00b7 Second-by-Second';
  panel.appendChild(label);

  const song = state.songId ? DATA.songs.find((s) => s.id === state.songId) : null;
  if (!song) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'Select a song above to simulate active skill uptime across the track.';
    panel.appendChild(empty);
    return panel;
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

  const noBonusSeconds = timeline.filter((p) => p.t > 20 && p.maxBonus === 0).length;
  const noBonusDuringSpecial = timeline.filter((p) => p.noBonusDuringSpecial).length;
  const peakBonus = Math.max(...timeline.map((p) => p.maxBonus));
  const avgBonus = timeline.reduce((sum, p) => sum + p.maxBonus, 0) / timeline.length;

  const summary = document.createElement('div');
  summary.className = 'coverage-summary';
  summary.innerHTML = `
    <div class="coverage-stat"><div class="stat-num">${noBonusSeconds}</div><div class="stat-label">Seconds with no bonus (>20s in)</div></div>
    <div class="coverage-stat"><div class="stat-num">${noBonusDuringSpecial}</div><div class="stat-label">Special skill secs w/ no bonus</div></div>
    <div class="coverage-stat"><div class="stat-num">${peakBonus.toFixed(0)}%</div><div class="stat-label">Peak score bonus</div></div>
    <div class="coverage-stat"><div class="stat-num">${avgBonus.toFixed(0)}%</div><div class="stat-label">Average score bonus</div></div>
  `;
  panel.appendChild(summary);

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

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  headRow.innerHTML =
    '<th>Time</th>' +
    unitCards.map((c) => `<th>${c.characterName.split(' ')[0]}</th>`).join('') +
    '<th>Max</th>';
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
    rowHtml += `<td class="cell-max">${point.maxBonus > 0 ? point.maxBonus.toFixed(1) + '%' : '\u2014'}</td>`;
    tr.innerHTML = rowHtml;
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);

  // Reserve a layout slot for a future side-by-side song map (piano roll / waveform)
  // synced to this same per-second timeline.
  const layout = document.createElement('div');
  layout.className = 'coverage-layout';
  layout.appendChild(wrap);

  panel.appendChild(layout);
  return panel;
}

function renderPowerPanel(result, leaderCard, scoreSupport) {
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
  return panel;
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function main() {
  await loadData();
  renderRoster();
  renderSongSlot();
  recompute();
}

main().catch((err) => {
  resultsEl.innerHTML = `<div class="empty-state">Failed to load data: ${err.message}</div>`;
  console.error(err);
});
