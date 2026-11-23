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
import {
  activationPointProfile,
  SPECIAL_WINDOW_SECONDS,
  perSecondCounts,
  singleBreakCostCurve,
  dangerZones,
  compareWithBreakMap,
} from './faqCalc.js';

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

  // Links between answers (<a href="#faq-<id>"> in faq.json): jump in place
  // instead of letting the browser change the hash, and clear any filter
  // that would hide the target question.
  list.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#faq-"]');
    if (!a) return;
    e.preventDefault();
    const id = a.getAttribute('href').slice('#faq-'.length);
    if (!faq.items.some((it) => it.id === id)) return;
    open.add(id);
    topic = 'all';
    query = '';
    search.value = '';
    for (const c of chips.children) c.classList.toggle('on', c.dataset.key === 'all');
    render();
    overlay.querySelector(`#faq-${CSS.escape(id)}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    setHash(id);
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
// Live calculator: break map - harder chart with combo breaks at real moments
// vs a full combo on the easier chart
// ---------------------------------------------------------------------------
const SVG_NS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs = {}) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}
const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

function buildDifficultyCalc() {
  const box = el('div', 'faq-calc');
  const row = el('div', 'faq-calc-row faq-calc-row-2');
  const songSel = el('select', 'faq-calc-select');
  songSel.id = 'faq-calc-song';
  const pairSel = el('select', 'faq-calc-select');
  pairSel.id = 'faq-calc-pair';
  for (const [hi, lo] of DIFFICULTY_PAIRS) {
    const o = el('option', null, `${cap(hi)} vs ${cap(lo)}`);
    o.value = `${hi}|${lo}`;
    pairSel.appendChild(o);
  }
  for (const [text, control] of [
    ['Song', songSel],
    ['Compare', pairSel],
  ]) {
    const wrap = el('div');
    const label = el('label', 'faq-calc-label', text);
    label.htmlFor = control.id;
    wrap.append(label, control);
    row.appendChild(wrap);
  }

  const hint = el('p', 'faq-map-hint', 'Tap the timeline where you usually break combo on the harder chart. Tap a marker to remove it.');
  const fig = el('div', 'faq-map');
  const svg = svgEl('svg', { role: 'img', 'aria-label': 'Notes per second on the harder chart, with special skill activation points and your combo breaks' });
  fig.appendChild(svg);
  const legend = el('div', 'faq-map-legend');
  legend.innerHTML =
    '<span><i class="faq-key faq-key-notes"></i>Notes per second</span>' +
    '<span><i class="faq-key faq-key-cost"></i>Cost of a break there</span>' +
    '<span><i class="faq-key faq-key-zone"></i>Densest stretches</span>' +
    '<span><i class="faq-key faq-key-point"></i>Special skill activation point</span>';

  const actions = el('div', 'faq-foot');
  const zoneBtn = el('button', 'presets-btn', 'One break in each dense stretch');
  zoneBtn.type = 'button';
  const clearBtn = el('button', 'presets-btn', 'Clear breaks');
  clearBtn.type = 'button';
  actions.append(zoneBtn, clearBtn);

  const verdict = el('div', 'faq-verdict', 'Loading songs…');
  const summary = el('p', 'faq-map-summary');
  const bars = el('div', 'faq-bars');
  const note = el(
    'p',
    'faq-calc-note',
    'Estimate: every other note Perfect+, same unit and skills, skills not weighted. A break costs the combo bonus on the notes after it until your combo climbs back, so mid-song breaks cost most and extra breaks in the same stretch cost little. Bars are zoomed in to show the gap.'
  );
  box.append(row, hint, fig, legend, actions, verdict, summary, bars, note);

  let songs = [];
  let current = null; // {song, density, hi, lo, counts, cost, zones}
  let breaks = []; // seconds, repeats allowed
  let seq = 0;

  function draw() {
    svg.replaceChildren();
    if (!current) return;
    const { counts, cost, zones, song } = current;
    const W = fig.clientWidth || 600;
    const H = fig.clientHeight || 170;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const padT = 22;
    const padB = 24;
    const L = counts.length;
    const bw = W / L;
    const maxN = Math.max(1, ...counts);
    const maxCost = Math.max(0.01, ...cost.filter((c) => c != null));
    const plotH = H - padT - padB;
    // cost shading + note bars
    for (let s = 0; s < L; s++) {
      if (cost[s] != null) {
        svg.appendChild(svgEl('rect', { x: s * bw, y: padT, width: Math.max(1, bw), height: plotH, class: 'faq-map-cost', 'fill-opacity': (0.02 + 0.55 * (cost[s] / maxCost) ** 2).toFixed(3) }));
      }
      const h = (counts[s] / maxN) * plotH;
      if (h > 0) svg.appendChild(svgEl('rect', { x: s * bw + bw * 0.15, y: padT + plotH - h, width: Math.max(1, bw * 0.7), height: h, class: 'faq-map-bar' }));
    }
    // dense stretches
    for (const z of zones) {
      svg.appendChild(svgEl('rect', { x: z.start * bw, y: padT + plotH + 3, width: (z.end - z.start) * bw, height: 4, rx: 2, class: 'faq-map-zone' }));
    }
    // special skill activation points
    (song.feverSeconds || []).forEach((t, i) => {
      const x = t * bw;
      svg.appendChild(svgEl('line', { x1: x, x2: x, y1: padT - 4, y2: padT + plotH, class: 'faq-map-point' }));
      const label = svgEl('text', { x, y: padT - 8, class: 'faq-map-point-label', 'text-anchor': 'middle' });
      label.textContent = String(i + 1);
      svg.appendChild(label);
    });
    // time axis ends
    const t0 = svgEl('text', { x: 2, y: H - 3, class: 'faq-map-axis' });
    t0.textContent = '0:00';
    const t1 = svgEl('text', { x: W - 2, y: H - 3, class: 'faq-map-axis', 'text-anchor': 'end' });
    t1.textContent = mmss(L);
    svg.append(t0, t1);
    // break markers
    const tally = new Map();
    for (const s of breaks) tally.set(s, (tally.get(s) || 0) + 1);
    for (const [s, k] of tally) {
      const x = (s + 0.5) * bw;
      const g = svgEl('g', { class: 'faq-map-break', 'data-second': String(s) });
      g.appendChild(svgEl('line', { x1: x, x2: x, y1: padT, y2: padT + plotH }));
      g.appendChild(svgEl('circle', { cx: x, cy: padT + 8, r: 8 }));
      const tx = svgEl('text', { x, y: padT + 12, 'text-anchor': 'middle' });
      tx.textContent = k > 1 ? String(k) : '×';
      g.appendChild(tx);
      const title = svgEl('title');
      title.textContent = `${k} break${k > 1 ? 's' : ''} at ${mmss(s)} - tap to remove one`;
      g.appendChild(title);
      svg.appendChild(g);
    }
  }

  function renderResult() {
    bars.replaceChildren();
    if (!current) return;
    const { song, density, hi, lo } = current;
    const r = compareWithBreakMap(song, density, hi, lo, breaks);
    if (!r) {
      verdict.textContent = 'This song doesn’t have both charts.';
      summary.textContent = '';
      return;
    }
    const H = cap(hi);
    const L = cap(lo);
    const n = r.harderBroken.breaksPlaced;
    const s = n === 1 ? '' : 's';
    verdict.textContent =
      n === 0
        ? `${H} full combo scores ${r.gapPct.toFixed(1)}% more than ${L}`
        : r.gapPct >= 0
          ? `${H} with ${n === 1 ? 'this break' : `these ${n} breaks`} still wins by ${r.gapPct.toFixed(1)}%`
          : `Play ${L}: ${H} with ${n === 1 ? 'this break' : `these ${n} breaks`} scores ${(-r.gapPct).toFixed(1)}% less`;
    summary.textContent =
      n === 0 ? 'No breaks placed yet.' : `${n === 1 ? 'This break costs' : `These ${n} breaks cost`} ${r.breakCostPct.toFixed(1)}% of your ${H} full-combo score.`;
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

  async function load() {
    const song = songs.find((x) => x.id === songSel.value);
    if (!song) return;
    const [hi, lo] = pairSel.value.split('|');
    const mine = ++seq;
    verdict.textContent = 'Loading chart…';
    const density = await loadDensity(song.id);
    if (mine !== seq) return;
    const counts = density ? perSecondCounts(density, hi) : null;
    if (!counts || song.difficultyLevels?.[lo] == null) {
      current = null;
      breaks = [];
      draw();
      bars.replaceChildren();
      summary.textContent = '';
      verdict.textContent = density ? 'This song doesn’t have both charts.' : 'No chart data for this song yet.';
      return;
    }
    current = { song, density, hi, lo, counts, cost: singleBreakCostCurve(density, hi), zones: dangerZones(counts) };
    breaks = [];
    draw();
    renderResult();
  }

  svg.addEventListener('click', (e) => {
    if (!current) return;
    const marker = e.target.closest('.faq-map-break');
    if (marker) {
      const sec = Number(marker.dataset.second);
      const i = breaks.lastIndexOf(sec);
      if (i >= 0) breaks.splice(i, 1);
    } else {
      const rect = svg.getBoundingClientRect();
      const sec = Math.floor(((e.clientX - rect.left) / rect.width) * current.counts.length);
      if (sec < 0 || sec >= current.counts.length) return;
      // snap to the nearest second that has notes (a break needs a note)
      let best = -1;
      for (let d = 0; d <= 3 && best < 0; d++) {
        if (current.counts[sec - d] > 0) best = sec - d;
        else if (current.counts[sec + d] > 0) best = sec + d;
      }
      if (best < 0) return;
      breaks.push(best);
    }
    draw();
    renderResult();
  });
  zoneBtn.onclick = () => {
    if (!current) return;
    breaks = current.zones.map((z) => z.peak);
    draw();
    renderResult();
  };
  clearBtn.onclick = () => {
    breaks = [];
    draw();
    renderResult();
  };
  const resize = new ResizeObserver(() => draw());
  resize.observe(fig);

  loadMusic()
    .then((music) => {
      songs = music.filter((x) => x.difficultyLevels).sort((a, b) => a.title.localeCompare(b.title));
      for (const x of songs) {
        const o = el('option', null, x.title);
        o.value = x.id;
        songSel.appendChild(o);
      }
      const preferred = songs.find((x) => x.id === 'm0049') || songs[0];
      if (preferred) songSel.value = preferred.id;
      load();
    })
    .catch((err) => {
      verdict.textContent = `Couldn’t load songs (${err.message}).`;
    });
  for (const c of [songSel, pairSel]) c.addEventListener('input', load);
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
