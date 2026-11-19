/**
 * Holomem Rank Calculator page - pick how far each per-holomem achievement
 * is done and see the Rank EXP and Holomem Rank it adds up to.
 *
 * Standalone, like the Materials Tracker: loads data/rank_achievements.json
 * (tools/extract_rank_achievements.py) and keeps its own record under
 * localStorage[STORAGE_KEY]. The only link to the Materials Tracker is a
 * read-only "use my board count" shortcut for the Holomem Boards achievement.
 *
 * All the math lives in js/rankCalc.js; this file is DOM only.
 */
import {
  STORAGE_KEY,
  computeCharacter,
  characterCeilings,
  fillSelections,
  normalizeRecord,
  setTiers,
  possibleTiers,
  tierExp,
  achievementMaxExp,
  achievementLabel,
  tiersForProgress,
} from './rankCalc.js';
import { STORAGE_KEY as MATERIALS_STORAGE_KEY, genRank } from './materials.js';

const SORT_KEY = 'hoshidori_rank_sort';
const SORT_OPTIONS = [
  ['name', 'A - Z', 'Alphabetical'],
  ['gen', 'Gen', 'By generation (Gen 0 → ReGLOSS), debut order within a gen'],
  ['rank', 'Rank', 'Highest Holomem Rank first'],
];
const CATEGORY_ORDER = ['Holomem', 'Live', 'Members & Boards', 'Park & Games'];
const BOARD_KEY = 'absolute_skill_tree_release_count';

const fmt = (n) => Number(n || 0).toLocaleString('en-US');

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

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

let rankDataPromise = null;
function loadRankData() {
  if (!rankDataPromise) {
    rankDataPromise = fetch('data/rank_achievements.json').then((r) => {
      if (!r.ok) throw new Error(`rank_achievements.json: HTTP ${r.status}`);
      return r.json();
    });
  }
  return rankDataPromise;
}

function readRecord(data) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return normalizeRecord(raw ? JSON.parse(raw) : null, data);
  } catch {
    return normalizeRecord(null, data);
  }
}
function writeRecord(record) {
  record.updatedAt = new Date().toISOString();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

/** Board slots the player has unlocked for a holomem in the Materials Tracker (read-only). */
function materialsBoardCount(characterId) {
  try {
    const raw = JSON.parse(localStorage.getItem(MATERIALS_STORAGE_KEY) || 'null');
    const ids = raw?.boards?.[characterId];
    return Array.isArray(ids) ? ids.length : 0;
  } catch {
    return 0;
  }
}

export async function openRankPage() {
  const overlay = el('div', 'gy-manager-page');
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';

  const header = el('div', 'compare-page-header');
  const titleWrap = el('div');
  titleWrap.appendChild(el('div', 'board-editor-title', 'Holomem Rank Calculator'));
  titleWrap.appendChild(
    el(
      'div',
      'board-editor-subtitle',
      'Pick how far each of a holomem’s achievements is done (in-game: Achievements → Holomem). Every tier gives Rank EXP; the total sets her Holomem Rank. Saved in this browser.'
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

  let data;
  try {
    data = await loadRankData();
  } catch (err) {
    overlay.appendChild(el('div', 'empty-state', `Couldn’t load rank data (${err.message}).`));
    return;
  }

  const record = readRecord(data);
  const allChars = Object.entries(data.characters).map(([characterId, c]) => ({ characterId, ...c }));
  const allGroups = [...new Set(allChars.flatMap((c) => c.groups))].sort((a, b) => genRank(a) - genRank(b) || a.localeCompare(b));
  const maxRank = data.rankCurve[data.rankCurve.length - 1].rank;
  const result = (characterId) => computeCharacter(data, record.chars[characterId]);

  let selectedCharacterId = null;
  let searchQuery = '';
  let groupFilter = '';
  let sortMode = readSort();
  let clearAllArmed = false;
  let statusMessage = '';

  const save = () => {
    statusMessage = writeRecord(record) ? '' : 'Could not save - browser storage is unavailable. Use Export to keep your data.';
  };

  const layout = el('div', 'gy-manager-layout rank-layout');
  overlay.appendChild(layout);
  const leftPanel = el('div', 'gy-char-panel');
  const midPanel = el('div', 'gy-diagram-panel');
  const rightPanel = el('div', 'gy-summary-panel');
  layout.append(leftPanel, midPanel, rightPanel);

  // ---------------- left: holomem list ----------------
  const listItemsEl = el('div', 'gy-char-list-items');
  function sortedChars() {
    const list = [...allChars];
    const byName = (a, b) => a.name.localeCompare(b.name);
    if (sortMode === 'gen') {
      const g = (c) => Math.min(99, ...c.groups.map(genRank));
      return list.sort((a, b) => g(a) - g(b) || a.characterId.localeCompare(b.characterId));
    }
    if (sortMode === 'rank') {
      const r = new Map(list.map((c) => [c.characterId, result(c.characterId).totalExp]));
      return list.sort((a, b) => r.get(b.characterId) - r.get(a.characterId) || byName(a, b));
    }
    return list.sort(byName);
  }
  function renderCharList() {
    listItemsEl.innerHTML = '';
    const q = searchQuery.trim().toLowerCase();
    const filtered = sortedChars().filter(
      (c) => (!q || c.name.toLowerCase().includes(q)) && (!groupFilter || c.groups.includes(groupFilter))
    );
    if (!filtered.length) {
      listItemsEl.appendChild(el('div', 'empty-state', 'No holomems match.'));
      return;
    }
    for (const c of filtered) {
      const item = el('div', 'gy-char-item' + (c.characterId === selectedCharacterId ? ' active' : ''));
      item.appendChild(el('span', null, c.name));
      if (record.chars[c.characterId]) item.appendChild(el('span', 'rank-badge', `R${result(c.characterId).rank}`));
      item.onclick = () => {
        selectedCharacterId = c.characterId;
        renderAll(false, false);
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

  // ---------------- middle: achievement list ----------------
  function tierSelect(a, character, done) {
    const sel = el('select', 'mini-input rank-tier-select');
    const possible = possibleTiers(a, character);
    sel.appendChild(new Option('— not started', '0'));
    a.tiers.forEach((t, i) => {
      const n = i + 1;
      const what = a.tiers.length === 1 ? 'Done' : fmt(t.threshold);
      let text = `${what}   (+${tierExp(a, n)} EXP)`;
      if (n > possible) text += ' · not in game yet';
      sel.appendChild(new Option(text, String(n)));
    });
    sel.value = String(done);
    sel.setAttribute('aria-label', achievementLabel(a, character));
    return sel;
  }

  function renderMiddle() {
    midPanel.innerHTML = '';
    if (!selectedCharacterId) {
      midPanel.appendChild(el('div', 'empty-state', 'Select a holomem on the left, then set how far each achievement is done.'));
      return;
    }
    const character = data.characters[selectedCharacterId];
    const res = result(selectedCharacterId);

    const actions = el('div', 'mat-actions');
    actions.appendChild(el('span', 'mat-presets-label', 'Set all:'));
    const bulk = [
      ['Possible today', 'Every tier the current game content allows', () => fillSelections(data, selectedCharacterId, 'possible')],
      ['Every tier', 'Every tier, including ones that need cards/songs not released yet', () => fillSelections(data, selectedCharacterId, 'all')],
      ['Clear', 'Reset this holomem to nothing done', () => ({})],
    ];
    for (const [label, title, make] of bulk) {
      const btn = el('button', 'presets-btn' + (label === 'Clear' ? ' mat-danger' : ''), label);
      btn.type = 'button';
      btn.title = title;
      btn.onclick = () => {
        const sel = make();
        if (Object.values(sel).some(Boolean)) record.chars[selectedCharacterId] = sel;
        else delete record.chars[selectedCharacterId];
        save();
        renderAll();
      };
      actions.appendChild(btn);
    }
    midPanel.appendChild(actions);

    const list = el('div', 'rank-ach-list');
    for (const cat of CATEGORY_ORDER) {
      const achs = data.achievements.filter((a) => a.category === cat);
      if (!achs.length) continue;
      const catExp = achs.reduce((s, a) => s + tierExp(a, res.done[a.key]), 0);
      const catMax = achs.reduce((s, a) => s + achievementMaxExp(a), 0);
      const label = el('div', 'board-group-label rank-cat-label');
      label.append(el('span', null, cat), el('span', 'rank-cat-exp', `${catExp} / ${catMax} EXP`));
      list.appendChild(label);

      for (const a of achs) {
        const done = res.done[a.key] || 0;
        const row = el('div', 'rank-row' + (done === a.tiers.length ? ' rank-row-done' : ''));
        const text = el('div', 'rank-row-text');
        const shown =
          a.tiers.length === 1 ? a.tiers[0].threshold : a.auto === 'rank' ? a.tiers.map((t) => t.threshold).join(' / ') : 'N';
        text.appendChild(el('div', 'rank-row-label', achievementLabel(a, character, shown)));
        const possible = possibleTiers(a, character);
        const metaBits = [`${a.tiers.length} tier${a.tiers.length > 1 ? 's' : ''}`];
        if (possible < a.tiers.length) metaBits.push(`${possible} possible today (${a.capReason || 'content'})`);
        const meta = el('div', 'rank-row-meta', metaBits.join(' · '));
        text.appendChild(meta);

        const control = el('div', 'rank-row-control');
        if (a.auto) {
          const t = done ? a.tiers[done - 1].threshold : null;
          control.appendChild(
            el('span', 'rank-auto', a.auto === 'rank' ? (t ? `Rank ${t} reached · auto` : 'auto') : 'counted · auto')
          );
          meta.textContent =
            a.auto === 'rank'
              ? 'Worked out from the rank the other EXP reaches'
              : 'Always counted - you own this holomem';
        } else {
          const sel = tierSelect(a, character, done);
          sel.onchange = () => {
            setTiers(record, data, selectedCharacterId, a.key, Number(sel.value));
            save();
            renderAll();
          };
          control.appendChild(sel);
          if (a.key === BOARD_KEY) {
            const slots = materialsBoardCount(selectedCharacterId);
            if (slots) {
              const use = el('button', 'board-btn rank-use-btn', `Use Materials (${slots})`);
              use.type = 'button';
              use.title = `The Materials Tracker has ${slots} board slots unlocked for her (connector slots included)`;
              use.onclick = () => {
                setTiers(record, data, selectedCharacterId, a.key, tiersForProgress(a, slots));
                save();
                renderAll();
              };
              control.appendChild(use);
            }
          }
        }
        row.append(text, control, el('div', 'rank-row-exp', `${tierExp(a, done)}/${achievementMaxExp(a)}`));
        list.appendChild(row);
      }
    }
    midPanel.appendChild(list);
  }

  // ---------------- right: summary ----------------
  function rankBlock(label, r, cls = '') {
    const box = el('div', 'rank-ceiling ' + cls);
    box.append(el('span', null, label), el('span', 'rank-ceiling-val', `${r.totalExp} EXP · Rank ${r.rank}`));
    return box;
  }

  function renderRight() {
    rightPanel.innerHTML = '';
    if (selectedCharacterId) {
      const character = data.characters[selectedCharacterId];
      const res = result(selectedCharacterId);
      const ceil = characterCeilings(data, selectedCharacterId);
      rightPanel.appendChild(el('div', 'gy-summary-title', character.name));

      const big = el('div', 'rank-big');
      big.append(el('div', 'rank-big-label', 'Holomem Rank'), el('div', 'rank-big-num', String(res.rank)));
      big.appendChild(el('div', 'rank-big-exp', `${res.totalExp} Rank EXP`));
      rightPanel.appendChild(big);

      const bar = el('div', 'rank-bar');
      const fill = el('div', 'rank-bar-fill');
      fill.style.width = `${Math.round(res.progress * 100)}%`;
      bar.appendChild(fill);
      rightPanel.appendChild(bar);
      rightPanel.appendChild(
        el(
          'div',
          'rank-next',
          res.nextRank
            ? `${res.toNext} EXP to Rank ${res.nextRank} (at ${res.nextExp} EXP)`
            : `Max rank (${maxRank}) reached`
        )
      );

      rightPanel.appendChild(el('div', 'board-group-label', 'Ceilings'));
      rightPanel.appendChild(rankBlock('Possible today', ceil.possible));
      rightPanel.appendChild(rankBlock('Every tier (incl. unreleased)', ceil.all));
      const left = ceil.possible.totalExp - res.totalExp;
      if (left > 0) {
        rightPanel.appendChild(el('div', 'rank-next', `${left} more EXP is available to her with today's content.`));
      }
    } else {
      rightPanel.appendChild(el('div', 'gy-summary-title', 'Holomem Rank'));
      rightPanel.appendChild(el('div', 'rank-next', 'Select a holomem to see her rank.'));
    }

    // Roster overview
    const entered = allChars.filter((c) => record.chars[c.characterId]);
    rightPanel.appendChild(el('div', 'board-group-label', 'Roster'));
    if (entered.length) {
      const ranks = entered.map((c) => result(c.characterId).rank);
      const avg = ranks.reduce((s, r) => s + r, 0) / ranks.length;
      rightPanel.appendChild(
        el(
          'div',
          'rank-next',
          `${entered.length}/${allChars.length} holomems entered · average Rank ${avg.toFixed(1)} · highest ${Math.max(...ranks)}`
        )
      );
    } else {
      rightPanel.appendChild(el('div', 'rank-next', 'No holomems entered yet.'));
    }

    rightPanel.appendChild(
      el(
        'div',
        'estimate-note',
        `Rank EXP comes only from these 25 per-holomem achievements (${data.achievements.reduce((s, a) => s + achievementMaxExp(a), 0)} EXP in all; Rank ${maxRank} needs ${data.rankCurve[data.rankCurve.length - 1].exp}). “Not in game yet” tiers need cards, outfits or songs that haven’t been released. The rank curve is read from the datamine as a running total and hasn’t been checked against an in-game EXP readout yet.`
      )
    );

    rightPanel.appendChild(el('div', 'board-group-label', 'Backup'));
    const actions = el('div', 'mat-actions');
    const exportBtn = el('button', 'presets-btn', 'Export');
    exportBtn.type = 'button';
    exportBtn.onclick = () => {
      const blob = new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `hoshidori-rank-${new Date().toISOString().slice(0, 10)}.json`;
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
        record.chars = normalizeRecord(JSON.parse(await file.text()), data).chars;
        save();
        statusMessage = statusMessage || `Imported ${Object.keys(record.chars).length} holomems from ${file.name}.`;
      } catch {
        statusMessage = `${file.name} isn’t a valid Rank Calculator export.`;
      }
      renderAll(true);
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
      record.chars = {};
      save();
      renderAll();
    };
    actions.append(exportBtn, importBtn, clearBtn, fileInput);
    rightPanel.appendChild(actions);
    if (statusMessage) rightPanel.appendChild(el('div', 'estimate-note', statusMessage));
  }

  function renderAll(keepStatus = false, keepScroll = true) {
    clearAllArmed = false;
    if (!keepStatus) statusMessage = statusMessage.startsWith('Could not save') ? statusMessage : '';
    const scroll = keepScroll ? midPanel.querySelector('.rank-ach-list')?.scrollTop || 0 : 0;
    renderCharList();
    renderMiddle();
    const listEl = midPanel.querySelector('.rank-ach-list');
    if (listEl) listEl.scrollTop = scroll;
    renderRight();
  }

  renderLeft();
  renderMiddle();
  renderRight();
}
