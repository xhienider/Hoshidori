/**
 * Player FAQ page - short answers to common unit-building and scoring
 * questions, with the reasoning folded underneath each one.
 *
 * Standalone overlay like the Rank Calculator. Content lives in
 * data/faq.json (edit answers there, not here); the one live calculator's
 * math lives in js/faqCalc.js. This file is DOM only.
 *
 * Deep links: index.html#faq opens the FAQ, index.html#faq-<id> opens it
 * with that question expanded (the "Copy link" button produces these).
 * Answer HTML in faq.json is site-authored content and is inserted as-is.
 */
import { compareDifficulties, activationPointProfile, SPECIAL_WINDOW_SECONDS } from './faqCalc.js';

const BADGES = {
  confirmed: ['faq-b-confirmed', 'Confirmed', 'checked in-game'],
  data: ['faq-b-data', 'Game data', 'taken from the game’s own data'],
  estimate: ['faq-b-estimate', 'Estimate', 'worked out from formulas'],
  writing: ['faq-b-writing', 'Being written', ''],
};
const DIFFICULTY_PAIRS = [
  ['expert', 'hard'],
  ['hard', 'normal'],
  ['normal', 'easy'],
];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

let faqPromise = null;
let musicPromise = null;
const densityCache = {};

function loadJson(path) {
  return fetch(path).then((r) => {
    if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
    return r.json();
  });
}
const loadFaq = () => (faqPromise ??= loadJson('data/faq.json').catch((e) => ((faqPromise = null), Promise.reject(e))));
const loadMusic = () => (musicPromise ??= loadJson('data/music.json').catch((e) => ((musicPromise = null), Promise.reject(e))));
function loadDensity(songId) {
  if (!(songId in densityCache)) {
    densityCache[songId] = fetch(`data/note_density/${songId}.json`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  return densityCache[songId];
}

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function setHash(id) {
  try {
    history.replaceState(null, '', id ? `#faq-${id}` : '#faq');
  } catch {
    /* sandboxed or file:// - links just won't update */
  }
}
function clearHash() {
  try {
    history.replaceState(null, '', location.pathname + location.search);
  } catch {
    /* ignore */
  }
}

/** Opens the FAQ if the page was loaded with #faq or #faq-<id>. */
export function openFaqFromHash() {
  const m = /^#faq(?:-([a-z0-9-]+))?$/.exec(location.hash);
  if (m) openFaqPage(m[1] || null);
}

export async function openFaqPage(initialId = null) {
  if (document.querySelector('.faq-page')) return;
  const overlay = el('div', 'compare-page-overlay faq-page');
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';

  const close = () => {
    overlay.remove();
    document.body.style.overflow = '';
    document.removeEventListener('keydown', onKey);
    clearHash();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);

  const header = el('div', 'compare-page-header');
  const titleWrap = el('div');
  titleWrap.appendChild(el('div', 'board-editor-title', 'Player FAQ'));
  titleWrap.appendChild(
    el('div', 'board-editor-subtitle', 'Short answers to the questions players ask most. Tap a question for the reasoning and the exceptions.')
  );
  header.appendChild(titleWrap);
  const closeBtn = el('button', 'compare-page-close', '✕ Back to Builder');
  closeBtn.type = 'button';
  closeBtn.onclick = close;
  header.appendChild(closeBtn);
  overlay.appendChild(header);

  const body = el('div', 'faq-body');
  overlay.appendChild(body);

  let faq;
  try {
    faq = await loadFaq();
  } catch (err) {
    body.appendChild(el('div', 'empty-state', `Couldn’t load the FAQ (${err.message}).`));
    return;
  }

  const open = new Set(initialId ? [initialId] : []);
  let topic = 'all';
  let query = '';

  // ---- search + topic chips + legend ----
  const tools = el('div', 'faq-tools');
  const search = el('input', 'faq-search');
  search.type = 'search';
  search.placeholder = 'Search questions, e.g. bloom, coverage, yellow';
  search.setAttribute('aria-label', 'Search the FAQ');
  const chips = el('div', 'faq-chips');
  const topics = [{ key: 'all', label: 'All' }, ...faq.topics];
  for (const t of topics) {
    const chip = el('button', 'faq-chip', t.label);
    chip.type = 'button';
    chip.dataset.key = t.key;
    if (t.key === topic) chip.classList.add('on');
    chips.appendChild(chip);
  }
  tools.append(search, chips);
  body.appendChild(tools);

  const legend = el('div', 'faq-legend');
  for (const key of ['confirmed', 'data', 'estimate']) {
    const [cls, label, desc] = BADGES[key];
    const item = el('span');
    item.append(el('span', `faq-badge ${cls}`, label), document.createTextNode(` ${desc}`));
    legend.appendChild(item);
  }
  body.appendChild(legend);

  const list = el('div', 'faq-list');
  body.appendChild(list);
  body.appendChild(el('p', 'faq-footnote', `Answers from the Hoshidori engine and game data, updated ${faq.updated}.`));

  const toast = el('div', 'faq-toast');
  toast.setAttribute('role', 'status');
  overlay.appendChild(toast);
  let toastTimer = null;
  const showToast = (msg) => {
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 1800);
  };

  function cardFor(item) {
    const [cls, label] = BADGES[item.badge] || BADGES.estimate;
    const card = el('article', 'faq-card');
    card.id = `faq-${item.id}`;
    if (open.has(item.id)) card.classList.add('open');

    const q = el('button', 'faq-q');
    q.type = 'button';
    q.setAttribute('aria-expanded', String(open.has(item.id)));
    q.append(el('span', 'faq-caret', '▶'), el('span', 'faq-q-text', item.q), el('span', `faq-badge ${cls}`, label));
    card.appendChild(q);

    const short = el('div', 'faq-short');
    short.innerHTML = item.a;
    card.appendChild(short);

    const hasMore = item.why || item.how || item.when || item.calc || item.tryIt;
    if (hasMore) {
      const more = el('div', 'faq-more');
      if (item.calc === 'difficulty') more.appendChild(buildDifficultyCalc());
      if (item.calc === 'activation') more.appendChild(buildActivationCalc());
      for (const [key, title] of [
        ['why', 'Why'],
        ['how', 'How we worked it out'],
        ['when', 'When it changes'],
      ]) {
        if (!item[key]) continue;
        more.appendChild(el('h4', 'faq-h', title));
        const part = el('div', 'faq-part');
        part.innerHTML = key === 'when' ? `<p>${item[key]}</p>` : item[key];
        more.appendChild(part);
      }
      const foot = el('div', 'faq-foot');
      if (item.tryIt) {
        const tryBtn = el('button', 'presets-btn', 'Try it in the Builder');
        tryBtn.type = 'button';
        tryBtn.onclick = close;
        foot.appendChild(tryBtn);
      }
      const copyBtn = el('button', 'presets-btn', 'Copy link');
      copyBtn.type = 'button';
      copyBtn.onclick = () => {
        const url = `${location.origin}${location.pathname}#faq-${item.id}`;
        const done = () => showToast('Link copied');
        const fail = () => showToast(url);
        if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url).then(done, fail);
        else fail();
      };
      foot.appendChild(copyBtn);
      more.appendChild(foot);
      card.appendChild(more);
    }

    q.onclick = () => {
      const nowOpen = !card.classList.contains('open');
      card.classList.toggle('open', nowOpen);
      q.setAttribute('aria-expanded', String(nowOpen));
      if (nowOpen) {
        open.add(item.id);
        setHash(item.id);
      } else {
        open.delete(item.id);
        setHash(null);
      }
    };
    return card;
  }

  function render() {
    const s = query.trim().toLowerCase();
    const text = (it) => [it.q, it.a, it.why, it.how, it.when].filter(Boolean).join(' ').replace(/<[^>]+>/g, ' ').toLowerCase();
    const hits = faq.items.filter((it) => (topic === 'all' || it.topic === topic) && (!s || text(it).includes(s)));
    list.replaceChildren();
    if (!hits.length) {
      list.appendChild(el('p', 'faq-empty', 'No questions match. Try a shorter word.'));
      return;
    }
    for (const t of faq.topics) {
      const group = hits.filter((it) => it.topic === t.key);
      if (!group.length) continue;
      list.appendChild(el('h3', 'faq-group', t.label));
      for (const it of group) list.appendChild(cardFor(it));
    }
  }

  search.addEventListener('input', () => {
    query = search.value;
    render();
  });
  chips.addEventListener('click', (e) => {
    const chip = e.target.closest('.faq-chip');
    if (!chip) return;
    topic = chip.dataset.key;
    for (const c of chips.children) c.classList.toggle('on', c === chip);
    render();
  });

  render();
  if (initialId) {
    const target = overlay.querySelector(`#faq-${CSS.escape(initialId)}`);
    if (target) target.scrollIntoView({ block: 'start' });
    setHash(initialId);
  } else {
    setHash(null);
  }
}

// ---------------------------------------------------------------------------
// Live calculator: lower difficulty vs combo breaks on the harder chart
// ---------------------------------------------------------------------------
function buildDifficultyCalc() {
  const box = el('div', 'faq-calc');
  const row = el('div', 'faq-calc-row');

  const field = (labelText, control) => {
    const wrap = el('div');
    const label = el('label', 'faq-calc-label', labelText);
    label.htmlFor = control.id;
    wrap.append(label, control);
    return { wrap, label };
  };

  const songSel = el('select', 'faq-calc-select');
  songSel.id = 'faq-calc-song';
  const pairSel = el('select', 'faq-calc-select');
  pairSel.id = 'faq-calc-pair';
  for (const [hi, lo] of DIFFICULTY_PAIRS) {
    const o = el('option', null, `${cap(hi)} vs ${cap(lo)}`);
    o.value = `${hi}|${lo}`;
    pairSel.appendChild(o);
  }
  const breaks = el('input', 'faq-calc-range');
  breaks.id = 'faq-calc-breaks';
  breaks.type = 'range';
  breaks.min = '0';
  breaks.max = '12';
  breaks.value = '1';
  const breaksField = field('Combo breaks on the harder chart: 1', breaks);

  row.append(field('Song', songSel).wrap, field('Compare', pairSel).wrap, breaksField.wrap);
  const verdict = el('div', 'faq-verdict', 'Loading songs…');
  const bars = el('div', 'faq-bars');
  const note = el(
    'p',
    'faq-calc-note',
    'Estimate: every other note Perfect+, breaks spread evenly through the chart, same unit and skills. Scores are relative to a full combo on the easier chart; bars are zoomed in to show the gap.'
  );
  box.append(row, verdict, bars, note);

  let songs = [];
  let seq = 0;
  async function update() {
    const n = Number(breaks.value);
    breaksField.label.textContent = `Combo breaks on the harder chart: ${n}`;
    const song = songs.find((s) => s.id === songSel.value);
    if (!song) return;
    const [hi, lo] = pairSel.value.split('|');
    const mine = ++seq;
    verdict.textContent = 'Loading chart…';
    const density = await loadDensity(song.id);
    if (mine !== seq) return; // a newer selection is already loading
    const r = density ? compareDifficulties(song, density, hi, lo, n) : null;
    bars.replaceChildren();
    if (!r) {
      verdict.textContent = 'No chart data for this song yet.';
      return;
    }
    const H = cap(hi);
    const L = cap(lo);
    const gap = r.gapPct;
    const s = n === 1 ? '' : 's';
    verdict.textContent =
      n === 0
        ? `${H} full combo scores ${gap.toFixed(1)}% more than ${L}`
        : gap >= 0
          ? `${H} with ${n} break${s} still wins by ${gap.toFixed(1)}%`
          : `Play ${L}: ${H} with ${n} break${s} scores ${(-gap).toFixed(1)}% less`;
    const rows = [
      [`${L} FC (Lv ${r.easier.level})`, 100, 'faq-fill-easy'],
      [`${H} FC (Lv ${r.harderFc.level})`, r.harderFcPct, 'faq-fill-hard'],
      [`${H}, ${n} break${s}`, r.harderBrokenPct, 'faq-fill-broken'],
    ];
    const lowV = Math.min(...rows.map((x) => x[1])) - 3;
    const highV = Math.max(...rows.map((x) => x[1]));
    for (const [label, v, cls] of rows) {
      const bar = el('div', 'faq-bar');
      const track = el('span', 'faq-track');
      const fill = el('span', `faq-fill ${cls}`);
      fill.style.width = `${Math.max(4, ((v - lowV) / (highV - lowV || 1)) * 100)}%`;
      track.appendChild(fill);
      bar.append(el('span', 'faq-bar-label', label), track, el('span', 'faq-bar-value', `${v.toFixed(1)}%`));
      bars.appendChild(bar);
    }
  }

  loadMusic()
    .then((music) => {
      songs = music.filter((s) => s.difficultyLevels).sort((a, b) => a.title.localeCompare(b.title));
      for (const s of songs) {
        const o = el('option', null, s.title);
        o.value = s.id;
        songSel.appendChild(o);
      }
      const preferred = songs.find((s) => s.id === 'm0049') || songs[0];
      if (preferred) songSel.value = preferred.id;
      update();
    })
    .catch((err) => {
      verdict.textContent = `Couldn’t load songs (${err.message}).`;
    });
  for (const c of [songSel, pairSel, breaks]) c.addEventListener('input', update);
  return box;
}

// ---------------------------------------------------------------------------
// Live table: what each special skill activation point is worth in one song
// ---------------------------------------------------------------------------
function buildActivationCalc() {
  const box = el('div', 'faq-calc');
  const row = el('div', 'faq-calc-row faq-calc-row-2');
  const songSel = el('select', 'faq-calc-select');
  songSel.id = 'faq-act-song';
  const diffSel = el('select', 'faq-calc-select');
  diffSel.id = 'faq-act-diff';
  for (const d of ['expert', 'hard', 'normal', 'easy']) {
    const o = el('option', null, cap(d));
    o.value = d;
    diffSel.appendChild(o);
  }
  for (const [text, control] of [
    ['Song', songSel],
    ['Difficulty', diffSel],
  ]) {
    const wrap = el('div');
    const label = el('label', 'faq-calc-label', text);
    label.htmlFor = control.id;
    wrap.append(label, control);
    row.appendChild(wrap);
  }
  const verdict = el('div', 'faq-verdict', 'Loading songs…');
  const table = el('div', 'faq-act-table');
  const note = el(
    'p',
    'faq-calc-note',
    `Value = notes in the ${SPECIAL_WINDOW_SECONDS} seconds after each point, weighted by combo bonus, as a share of the best point. Combo assumes a clean full combo up to that point; under 100 switches off combo-100 specials’ activation-chance bonus. Members’ specials fire in unit order.`
  );
  box.append(row, verdict, table, note);

  let songs = [];
  let seq = 0;
  async function update() {
    const song = songs.find((s) => s.id === songSel.value);
    if (!song) return;
    const mine = ++seq;
    verdict.textContent = 'Loading chart…';
    const density = await loadDensity(song.id);
    if (mine !== seq) return;
    const r = density ? activationPointProfile(song, density, diffSel.value) : null;
    table.replaceChildren();
    if (!r) {
      verdict.textContent = 'No chart data for this song yet.';
      return;
    }
    const best = r.points[r.best - 1];
    const worst = r.points[r.worst - 1];
    const gap = worst.value ? (best.value / worst.value - 1) * 100 : 0;
    verdict.textContent = `Strongest: point ${r.best}, worth ${gap.toFixed(0)}% more than point ${r.worst}`;
    const head = el('div', 'faq-act-row faq-act-head');
    for (const h of ['Point', 'Time', 'Combo', 'Notes', 'Value']) head.appendChild(el('span', null, h));
    table.appendChild(head);
    for (const p of r.points) {
      const line = el('div', `faq-act-row${p.index === r.best ? ' faq-act-best' : ''}`);
      const mm = Math.floor(p.t / 60);
      const ss = String(Math.floor(p.t % 60)).padStart(2, '0');
      const combo = el('span', p.combo < 100 ? 'faq-act-low' : null, p.combo < 100 ? `${p.combo} (<100)` : String(p.combo));
      const valueCell = el('span', 'faq-act-value');
      const track = el('span', 'faq-track');
      const fill = el('span', `faq-fill ${p.index === r.best ? 'faq-fill-broken' : 'faq-fill-hard'}`);
      fill.style.width = `${Math.max(4, p.pctOfBest)}%`;
      track.appendChild(fill);
      valueCell.append(track, el('span', 'faq-bar-value', `${p.pctOfBest.toFixed(0)}%`));
      line.append(el('span', null, String(p.index)), el('span', null, `${mm}:${ss}`), combo, el('span', null, String(p.notes)), valueCell);
      table.appendChild(line);
    }
  }

  loadMusic()
    .then((music) => {
      songs = music.filter((s) => s.feverSeconds?.length).sort((a, b) => a.title.localeCompare(b.title));
      for (const s of songs) {
        const o = el('option', null, s.title);
        o.value = s.id;
        songSel.appendChild(o);
      }
      const preferred = songs.find((s) => s.id === 'm0049') || songs[0];
      if (preferred) songSel.value = preferred.id;
      update();
    })
    .catch((err) => {
      verdict.textContent = `Couldn’t load songs (${err.message}).`;
    });
  for (const c of [songSel, diffSel]) c.addEventListener('input', update);
  return box;
}
