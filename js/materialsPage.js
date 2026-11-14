/**
 * Materials Tracker page - the player's real account boards (every holomem,
 * all 4 colors) and the Cubes / Hexas they've cost.
 *
 * Standalone on purpose (for now): it loads its own data
 * (data/board_materials.json) and keeps its own saved record under
 * localStorage[STORAGE_KEY], separate from the Team Builder's per-preset
 * boardSelections and the Board Manager's greenYellowBoardSelections.
 * Integration with those is a later step (see PROJECT_STATUS.md).
 *
 * All the math lives in js/materials.js; this file is DOM only.
 */
import {
  AREAS,
  AREA_LABELS,
  STORAGE_KEY,
  getCharacterBoard,
  summarizeCharacter,
  computeAccountTotals,
  toggleNode,
  setArea,
  applyPreset,
  presetDelta,
  normalizeAccount,
  genRank,
  sortCharacters,
  unlockedNodeCount,
  totalNodeCount,
} from './materials.js';

const AREA_COLOR_VAR = {
  red: '--red-node',
  blue: '--blue-node',
  green: '--green-node',
  yellow: '--yellow-node',
};
const SORT_KEY = 'hoshidori_materials_sort';
const SORT_OPTIONS = [
  ['name', 'A - Z', 'Alphabetical'],
  ['gen', 'Gen', 'By generation (Gen 0 \u2192 ReGLOSS), debut order within a gen'],
  ['holoboard', 'Holoboard', 'Most Holoboard nodes unlocked first'],
];
function readSort() {
  try {
    const v = localStorage.getItem(SORT_KEY);
    return SORT_OPTIONS.some(([k]) => k === v) ? v : 'name';
  } catch {
    return 'name';
  }
}
function writeSort(v) {
  try {
    localStorage.setItem(SORT_KEY, v);
  } catch {
    /* sort choice just won't be remembered */
  }
}

const fmt = (n) => Number(n || 0).toLocaleString('en-US');

let boardPresetsPromise = null;
/** Optional: data/board_presets.json. A missing/broken file just means no preset buttons. */
function loadBoardPresets() {
  if (!boardPresetsPromise) {
    boardPresetsPromise = fetch('data/board_presets.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j?.presets || {})
      .catch(() => ({}));
  }
  return boardPresetsPromise;
}

let boardMaterialsPromise = null;
function loadBoardMaterials() {
  if (!boardMaterialsPromise) {
    boardMaterialsPromise = fetch('data/board_materials.json').then((r) => {
      if (!r.ok) throw new Error(`board_materials.json: HTTP ${r.status}`);
      return r.json();
    });
  }
  return boardMaterialsPromise;
}

function readAccount(boardMaterials) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return normalizeAccount(raw ? JSON.parse(raw) : null, boardMaterials);
  } catch {
    return normalizeAccount(null, boardMaterials);
  }
}

function writeAccount(account) {
  account.updatedAt = new Date().toISOString();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(account));
    return true;
  } catch {
    return false;
  }
}

/** Material ids grouped by color, cube first. */
function materialIdsByColor(boardMaterials) {
  const out = {};
  for (const [id, m] of Object.entries(boardMaterials.materials)) {
    (out[m.color] ||= {})[m.tier] = id;
  }
  return out;
}

function costText(cost, boardMaterials) {
  const parts = Object.entries(cost || {}).map(([id, qty]) => `${fmt(qty)} ${boardMaterials.materials[id]?.name || id}`);
  return parts.length ? parts.join(' + ') : 'free';
}

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

export async function openMaterialsPage() {
  const overlay = el('div', 'gy-manager-page');
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';

  const header = el('div', 'compare-page-header');
  const titleWrap = el('div');
  titleWrap.appendChild(el('div', 'board-editor-title', 'Materials Tracker'));
  titleWrap.appendChild(
    el(
      'div',
      'board-editor-subtitle',
      'Copy each holomem’s unlocked nodes from the game once - no reset needed. Spent + what you hold = everything you’ve earned. Saved in this browser; use Export to back it up.'
    )
  );
  header.appendChild(titleWrap);
  const closeBtn = el('button', 'compare-page-close', '✕ Back to Builder');
  closeBtn.type = 'button';
  closeBtn.onclick = () => {
    overlay.remove();
    document.body.style.overflow = '';
  };
  header.appendChild(closeBtn);
  overlay.appendChild(header);

  let boardMaterials;
  let boardPresets = {};
  try {
    [boardMaterials, boardPresets] = await Promise.all([loadBoardMaterials(), loadBoardPresets()]);
  } catch (err) {
    overlay.appendChild(el('div', 'empty-state', `Couldn’t load board data (${err.message}).`));
    return;
  }

  const account = readAccount(boardMaterials);
  const byColor = materialIdsByColor(boardMaterials);
  const allChars = Object.entries(boardMaterials.characters)
    .map(([characterId, c]) => ({ characterId, ...c }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const allGroups = [...new Set(allChars.flatMap((c) => c.groups))].sort((a, b) => genRank(a) - genRank(b) || a.localeCompare(b));
  const nodeTotal = (characterId) => totalNodeCount(boardMaterials, characterId);

  let selectedCharacterId = null;
  let activeArea = 'red';
  let searchQuery = '';
  let groupFilter = '';
  let sortMode = readSort();
  let clearAllArmed = false;
  let statusMessage = '';

  const layout = el('div', 'gy-manager-layout materials-layout');
  overlay.appendChild(layout);
  const leftPanel = el('div', 'gy-char-panel');
  const midPanel = el('div', 'gy-diagram-panel');
  const rightPanel = el('div', 'gy-summary-panel');
  layout.append(leftPanel, midPanel, rightPanel);

  const save = () => {
    statusMessage = writeAccount(account) ? '' : 'Could not save - browser storage is unavailable. Use Export to keep your data.';
  };
  const unlockedOf = (characterId) => new Set(account.boards[characterId] || []);
  const setUnlocked = (characterId, set) => {
    const nodeIds = [...set];
    if (nodeIds.length) account.boards[characterId] = nodeIds.sort();
    else delete account.boards[characterId];
    save();
  };

  // ---------------- left: character list ----------------
  const listItemsEl = el('div', 'gy-char-list-items');
  function renderCharList() {
    listItemsEl.innerHTML = '';
    const q = searchQuery.trim().toLowerCase();
    const filtered = sortCharacters(allChars, sortMode, boardMaterials, account).filter(
      (c) => (!q || c.name.toLowerCase().includes(q)) && (!groupFilter || c.groups.includes(groupFilter))
    );
    if (!filtered.length) {
      listItemsEl.appendChild(el('div', 'empty-state', 'No holomems match.'));
      return;
    }
    for (const c of filtered) {
      const item = el('div', 'gy-char-item' + (c.characterId === selectedCharacterId ? ' active' : ''));
      item.appendChild(el('span', null, c.name));
      const done = unlockedNodeCount(boardMaterials, account, c.characterId);
      if (done) item.appendChild(el('span', 'mat-char-progress', `${done}/${nodeTotal(c.characterId)}`));
      item.onclick = () => {
        selectedCharacterId = c.characterId;
        renderAll();
      };
      listItemsEl.appendChild(item);
    }
  }
  function renderLeft() {
    leftPanel.innerHTML = '';
    const search = el('input', 'mini-input gy-char-search');
    search.type = 'text';
    search.placeholder = 'Search holomems…';
    search.value = searchQuery;
    search.oninput = () => {
      searchQuery = search.value;
      renderCharList();
    };
    const groupSelect = el('select', 'mini-input gy-gen-filter');
    groupSelect.appendChild(new Option('All Generations', ''));
    for (const g of allGroups) groupSelect.appendChild(new Option(g, g));
    groupSelect.value = groupFilter;
    groupSelect.onchange = () => {
      groupFilter = groupSelect.value;
      renderCharList();
    };
    const sortRow = el('div', 'mat-sort-row');
    sortRow.appendChild(el('span', 'mat-presets-label', 'Sort:'));
    for (const [key, label, title] of SORT_OPTIONS) {
      const btn = el('button', 'gy-tab-btn mat-sort-btn' + (sortMode === key ? ' active' : ''), label);
      btn.type = 'button';
      btn.title = title;
      btn.onclick = () => {
        sortMode = key;
        writeSort(key);
        for (const b of sortRow.querySelectorAll('.mat-sort-btn')) b.classList.toggle('active', b === btn);
        renderCharList();
      };
      sortRow.appendChild(btn);
    }
    leftPanel.append(search, groupSelect, sortRow, listItemsEl);
    renderCharList();
  }

  // ---------------- middle: board diagram ----------------
  function renderMiddle() {
    midPanel.innerHTML = '';
    if (!selectedCharacterId) {
      midPanel.appendChild(el('div', 'empty-state', 'Select a holomem on the left, then click the nodes she has unlocked in-game.'));
      return;
    }
    const board = getCharacterBoard(boardMaterials, selectedCharacterId);
    const unlocked = unlockedOf(selectedCharacterId);

    const tabs = el('div', 'gy-tabs');
    for (const area of AREAS) {
      const btn = el('button', 'gy-tab-btn mat-area-tab' + (activeArea === area ? ' active' : ''), AREA_LABELS[area]);
      btn.type = 'button';
      btn.style.setProperty('--node-color', `var(${AREA_COLOR_VAR[area]})`);
      btn.onclick = () => {
        activeArea = area;
        renderMiddle();
      };
      tabs.appendChild(btn);
    }
    midPanel.appendChild(tabs);

    const actions = el('div', 'mat-actions');
    const allBtn = el('button', 'presets-btn', `Unlock all ${AREA_LABELS[activeArea].split(' ')[0]}`);
    allBtn.type = 'button';
    allBtn.onclick = () => {
      setUnlocked(selectedCharacterId, setArea(board, unlockedOf(selectedCharacterId), activeArea, true));
      renderAll();
    };
    const clearBtn = el('button', 'presets-btn', `Clear ${AREA_LABELS[activeArea].split(' ')[0]}`);
    clearBtn.type = 'button';
    clearBtn.onclick = () => {
      setUnlocked(selectedCharacterId, setArea(board, unlockedOf(selectedCharacterId), activeArea, false));
      renderAll();
    };
    actions.append(allBtn, clearBtn);
    midPanel.appendChild(actions);

    const presets = boardPresets[activeArea] || [];
    if (presets.length) {
      const row = el('div', 'mat-actions mat-presets');
      row.appendChild(el('span', 'mat-presets-label', 'Presets:'));
      for (const preset of presets) {
        const delta = presetDelta(board, unlocked, preset.nodes);
        const btn = el('button', 'presets-btn' + (delta.added.length ? '' : ' mat-preset-done'), preset.name);
        btn.type = 'button';
        btn.title = delta.added.length
          ? `Adds ${delta.added.length} node${delta.added.length === 1 ? '' : 's'} (${costText(delta.cost, boardMaterials)}). Keeps what's already unlocked - use Clear first to start from scratch.`
          : 'Already fully unlocked on this board.';
        btn.onclick = () => {
          setUnlocked(selectedCharacterId, applyPreset(board, unlockedOf(selectedCharacterId), preset.nodes));
          renderAll();
        };
        row.appendChild(btn);
      }
      midPanel.appendChild(row);
    }

    const container = el('div', 'gy-diagram-container');
    midPanel.appendChild(container);
    const areaNodes = board.nodes.filter((n) => n.area === activeArea);
    const xs = areaNodes.map((n) => n.x).concat(0);
    const ys = areaNodes.map((n) => n.y).concat(0);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const spacing = 32;
    const pad = 24;
    const width = (maxX - minX) * spacing + pad * 2;
    const height = (maxY - minY) * spacing + pad * 2;
    const sx = (x) => pad + (x - minX) * spacing;
    const sy = (y) => pad + (maxY - y) * spacing;
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('width', '100%');
    svg.classList.add('board-diagram');
    svg.style.maxHeight = Math.min(height, 560) + 'px';

    const center = document.createElementNS(svgNS, 'circle');
    center.setAttribute('cx', sx(0));
    center.setAttribute('cy', sy(0));
    center.setAttribute('r', 8);
    center.setAttribute('class', 'board-diagram-center');
    svg.appendChild(center);

    for (const n of areaNodes) {
      const isOn = unlocked.has(n.id);
      const radius = n.kind === 'connector' ? 7 : n.grade >= 2 ? 13 : 10;
      const c = document.createElementNS(svgNS, 'circle');
      c.setAttribute('cx', sx(n.x));
      c.setAttribute('cy', sy(n.y));
      c.setAttribute('r', radius);
      c.setAttribute('class', 'board-diagram-node' + (isOn ? ' unlocked' : '') + (n.kind === 'connector' ? ' mat-connector' : ''));
      c.style.setProperty('--node-color', `var(${AREA_COLOR_VAR[n.area]})`);
      const title = document.createElementNS(svgNS, 'title');
      title.textContent =
        n.kind === 'connector'
          ? 'Connector slot (free - unlocked automatically when a path passes through)'
          : `${n.effect || n.id} · ${costText(n.cost, boardMaterials)} · ${n.points}pt · ${n.grade >= 2 ? '2★' : '1★'}${isOn ? ' (unlocked)' : ''}`;
      c.appendChild(title);
      c.addEventListener('click', () => {
        setUnlocked(selectedCharacterId, toggleNode(board, unlockedOf(selectedCharacterId), n.id));
        renderAll();
      });
      svg.appendChild(c);
      if (n.icon) {
        const size = radius * 1.5;
        const img = document.createElementNS(svgNS, 'image');
        img.setAttribute('href', `images/board_icons/${n.icon}.png`);
        img.setAttribute('x', sx(n.x) - size / 2);
        img.setAttribute('y', sy(n.y) - size / 2);
        img.setAttribute('width', size);
        img.setAttribute('height', size);
        img.setAttribute('class', 'board-diagram-icon' + (isOn ? ' unlocked' : ''));
        img.style.pointerEvents = 'none';
        svg.appendChild(img);
      }
    }
    container.appendChild(svg);

    const s = summarizeCharacter(board, unlocked)[activeArea];
    container.appendChild(
      el(
        'div',
        'board-diagram-legend',
        `${s.unlockedCount}/${s.totalCount} nodes · spent ${costText(s.spent.cost, boardMaterials)} · left ${costText(s.remaining.cost, boardMaterials)} · big = 2★ (Hexa) · click to unlock/lock (far nodes unlock the path)`
      )
    );
  }

  // ---------------- right: summaries ----------------
  function materialPair(cost, color) {
    const ids = byColor[color];
    return `${fmt(cost[ids.cube])} / ${fmt(cost[ids.hexa])}`;
  }

  function renderRight() {
    rightPanel.innerHTML = '';
    const totals = computeAccountTotals(boardMaterials, account);

    if (selectedCharacterId) {
      const board = getCharacterBoard(boardMaterials, selectedCharacterId);
      const summary = summarizeCharacter(board, unlockedOf(selectedCharacterId));
      rightPanel.appendChild(el('div', 'gy-summary-title', board.name));
      const t = el('table', 'mat-table');
      const head = t.createTHead().insertRow();
      for (const h of ['Board', 'Nodes', 'Spent (Cube / Hexa)', 'Left']) head.appendChild(el('th', null, h));
      const body = t.createTBody();
      let pts = 0;
      for (const area of AREAS) {
        const s = summary[area];
        pts += s.spent.points;
        const r = body.insertRow();
        const name = el('td', 'mat-color-cell', area[0].toUpperCase() + area.slice(1));
        name.style.setProperty('--node-color', `var(${AREA_COLOR_VAR[area]})`);
        r.appendChild(name);
        r.appendChild(el('td', 'num', `${s.unlockedCount}/${s.totalCount}`));
        r.appendChild(el('td', 'num', materialPair(s.spent.cost, area)));
        r.appendChild(el('td', 'num', materialPair(s.remaining.cost, area)));
      }
      rightPanel.appendChild(t);
      rightPanel.appendChild(el('div', 'estimate-note', `${fmt(pts)} board points spent on this holomem.`));
    }

    rightPanel.appendChild(el('div', 'board-group-label', 'Account Materials'));
    const t = el('table', 'mat-table');
    const head = t.createTHead().insertRow();
    for (const h of ['Material', 'Spent', 'Held', 'Total', 'To finish all']) head.appendChild(el('th', null, h));
    const body = t.createTBody();
    for (const area of AREAS) {
      for (const tier of ['cube', 'hexa']) {
        const id = byColor[area][tier];
        const m = boardMaterials.materials[id];
        const r = body.insertRow();
        const name = el('td', 'mat-color-cell', m.name);
        name.style.setProperty('--node-color', `var(${AREA_COLOR_VAR[area]})`);
        r.appendChild(name);
        r.appendChild(el('td', 'num', fmt(totals.spent[id])));
        const heldCell = el('td', 'num');
        const input = el('input', 'mini-input mat-held-input');
        input.type = 'number';
        input.min = '0';
        input.step = '1';
        input.value = account.held[id] ?? '';
        input.placeholder = '0';
        input.setAttribute('aria-label', `${m.name} held`);
        heldCell.appendChild(input);
        r.appendChild(heldCell);
        const totalCell = el('td', 'num', fmt((totals.spent[id] || 0) + (account.held[id] || 0)));
        r.appendChild(totalCell);
        const left = totals.remaining[id] || 0;
        const short = Math.max(0, left - (account.held[id] || 0));
        const leftCell = el('td', 'num', fmt(left));
        if (left > 0) {
          leftCell.title = short > 0 ? `Need ${fmt(short)} more than you hold` : 'You already hold enough';
          leftCell.appendChild(el('div', short > 0 ? 'mat-short' : 'mat-enough', short > 0 ? `short ${fmt(short)}` : 'covered'));
        }
        r.appendChild(leftCell);
        input.onchange = () => {
          const v = Math.max(0, Math.floor(Number(input.value)));
          if (input.value === '' || !Number.isFinite(v)) delete account.held[id];
          else account.held[id] = v;
          save();
          renderRight();
        };
      }
    }
    rightPanel.appendChild(t);

    const tracked = Object.keys(account.boards).length;
    rightPanel.appendChild(
      el(
        'div',
        'estimate-note',
        `${tracked}/${allChars.length} holomems entered · ${fmt(totals.points)} board points spent. "Held" is your current in-game item count; "Total" = spent + held. "To finish all" is what completing every board of every holomem would still cost.`
      )
    );

    rightPanel.appendChild(el('div', 'board-group-label', 'Backup'));
    const actions = el('div', 'mat-actions');
    const exportBtn = el('button', 'presets-btn', 'Export');
    exportBtn.type = 'button';
    exportBtn.onclick = () => {
      const blob = new Blob([JSON.stringify(account, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `hoshidori-materials-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    const importBtn = el('button', 'presets-btn', 'Import');
    importBtn.type = 'button';
    const fileInput = el('input');
    fileInput.type = 'file';
    fileInput.accept = 'application/json,.json';
    fileInput.hidden = true;
    importBtn.onclick = () => fileInput.click();
    fileInput.onchange = async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      try {
        const imported = normalizeAccount(JSON.parse(await file.text()), boardMaterials);
        account.boards = imported.boards;
        account.held = imported.held;
        save();
        statusMessage = statusMessage || `Imported ${Object.keys(imported.boards).length} holomems from ${file.name}.`;
      } catch {
        statusMessage = `${file.name} isn’t a valid Materials export.`;
      }
      renderAll();
    };
    const clearBtn = el('button', 'presets-btn' + (clearAllArmed ? ' mat-danger' : ''), clearAllArmed ? 'Click again to clear everything' : 'Clear all');
    clearBtn.type = 'button';
    clearBtn.onclick = () => {
      if (!clearAllArmed) {
        clearAllArmed = true;
        renderRight();
        return;
      }
      clearAllArmed = false;
      account.boards = {};
      account.held = {};
      save();
      renderAll();
    };
    actions.append(exportBtn, importBtn, clearBtn, fileInput);
    rightPanel.appendChild(actions);
    if (statusMessage) rightPanel.appendChild(el('div', 'estimate-note', statusMessage));
  }

  function renderAll() {
    clearAllArmed = false;
    renderCharList();
    renderMiddle();
    renderRight();
  }

  renderLeft();
  renderMiddle();
  renderRight();
}
