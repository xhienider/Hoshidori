/**
 * Challenge Live page - every floor ("Stage") of the Live Stage tower, with which song and
 * difficulty lets the Builder's current unit reach the floor's Target Score.
 *
 * Standalone overlay like the Rank Calculator, but it scores the BUILDER'S team, so app.js
 * passes in everything team-specific as `ctx` (see openChallenge() in app.js):
 *   ready(), teamKey(), unitCharacterIds(), leaderCharacterId(), songById(id), characterName(id),
 *   evaluateSong(song, yellowMode) -> {unitScore, ...} | null   (no note density needed)
 *   scoreSong(evaluation, density) -> {difficulty: {level, auto, fc, max}}
 *   loadDensity(songId) -> Promise<density | null>
 * All the math is in js/challengeCalc.js; this file is DOM + scheduling only.
 *
 * Performance: the floor bonus is a flat multiplier, so each song x difficulty is scored once per
 * team and every floor's verdict is a cheap lookup. Unit Scores (no fetch) are worked out first so
 * every floor gets its S/A/B rating at once; the song scores then fill in while the browser is
 * idle, nearest unplayed floors first, a few note-density fetches at a time. Results are cached
 * on ctx.teamKey() + the Yellow setting, so reopening with the same team recomputes nothing.
 */
import {
  STORAGE_KEY,
  DIFFICULTIES,
  VERDICTS,
  bonusHolomemsIn,
  floorBonusPermil,
  withBonus,
  gradeFor,
  optionVerdict,
  bestOption,
  normalizeSettings,
} from './challengeCalc.js';

const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US'));
const pct = (f) => `${f >= 0 ? '+' : ''}${(f * 100).toFixed(1)}%`;
const DIFF_LABEL = { easy: 'Easy', normal: 'Normal', hard: 'Hard', expert: 'Expert' };
const FETCH_CONCURRENCY = 4;

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

let towerPromise = null;
function loadTower() {
  if (!towerPromise) {
    towerPromise = fetch('data/live_tower.json').then((r) => {
      if (!r.ok) throw new Error(`live_tower.json: HTTP ${r.status}`);
      return r.json();
    });
    towerPromise.catch(() => (towerPromise = null));
  }
  return towerPromise;
}

function readSettings() {
  try {
    return normalizeSettings(JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'));
  } catch {
    return normalizeSettings(null);
  }
}
function writeSettings(s) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, ...s }));
  } catch {
    /* settings just won't be remembered */
  }
}

// One cache per team + Yellow setting: songId -> evaluation, songId -> per-difficulty scores.
let cache = null;
function cacheFor(key) {
  if (!cache || cache.key !== key) cache = { key, evals: new Map(), scores: new Map() };
  return cache;
}

const idle = (fn) =>
  typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: 200 }) : setTimeout(() => fn({ timeRemaining: () => 12 }), 0);

export async function openChallengePage(ctx) {
  const overlay = el('div', 'compare-page-overlay challenge-page');
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';
  let job = 0; // bumped to cancel background work
  const close = () => {
    job++;
    overlay.remove();
    document.body.style.overflow = '';
  };

  const header = el('div', 'compare-page-header');
  header.appendChild(el('div', 'board-editor-title', 'Challenge Live'));
  const closeBtn = el('button', 'compare-page-close', '✕ Back to Builder');
  closeBtn.type = 'button';
  closeBtn.onclick = close;
  header.appendChild(closeBtn);
  overlay.appendChild(header);

  if (!ctx.ready()) {
    overlay.appendChild(el('div', 'empty-state', 'Select a leader and all 5 unit members in the Builder first.'));
    return;
  }

  let tower;
  try {
    tower = (await loadTower()).towers[0];
  } catch (err) {
    overlay.appendChild(el('div', 'empty-state', `Couldn’t load Challenge Live data (${err.message}).`));
    return;
  }
  if (!overlay.isConnected) return;

  const floors = tower.floors;
  const unitIds = ctx.unitCharacterIds();
  const leaderId = ctx.leaderCharacterId();
  let settings = readSettings();
  let expanded = null; // floor number shown in detail
  let c = cacheFor(`${ctx.teamKey()}|${settings.yellow}`);

  // ---- static parts -----------------------------------------------------------------------
  const note = el('div', 'ca-disclaimer');
  note.innerHTML = `
    For your <strong>current Builder team</strong>. Each Stage is cleared by reaching its Target
    Score on <strong>any one</strong> of its songs, at any difficulty. Bonus Members count only
    among your 5 unit members (not the leader) and stack.
    <strong>Auto</strong> and <strong>FC</strong> use each skill's activation chance (expected
    score); <strong>Max</strong> is a full combo with every skill firing, like the Builder's Max.
    Stages marked <span class="challenge-mandatory">Can't skip</span> are the game's rainbow
    Stages: greatly exceeding a Target can skip you ahead, but never past one of these (every
    5th Stage, and every Stage from 85 on). The bonus is applied as a flat score multiplier, which hasn't been checked against a results
    screen yet. <strong>Rating</strong> is the Stage's S/A/B unit rating from your Unit Score plus
    the bonus — compare it with the game's to check the site's numbers.`;
  overlay.appendChild(note);

  const controls = el('div', 'ca-controls challenge-controls');
  overlay.appendChild(controls);
  const status = el('div', 'challenge-status');
  overlay.appendChild(status);
  const main = el('div', 'ca-main');
  overlay.appendChild(main);
  const table = el('div', 'challenge-table');
  main.appendChild(table);

  function buildControls() {
    controls.innerHTML = '';

    const yellowGroup = el('div', 'challenge-control');
    yellowGroup.appendChild(el('div', 'ca-control-label', 'Yellow board bonus'));
    const seg = el('div', 'challenge-seg');
    for (const [key, label, title] of [
      ['board', 'Board Manager', "Each song's Yellow from your Board Manager boards"],
      ['max', 'Max 10%', 'Assume the 10% cap on every song'],
    ]) {
      const b = el('button', 'difficulty-btn' + (settings.yellow === key ? ' active' : ''), label);
      b.type = 'button';
      b.title = title;
      b.onclick = () => {
        if (settings.yellow === key) return;
        settings = { ...settings, yellow: key };
        writeSettings(settings);
        c = cacheFor(`${ctx.teamKey()}|${settings.yellow}`);
        buildControls();
        start();
      };
      seg.appendChild(b);
    }
    yellowGroup.appendChild(seg);
    controls.appendChild(yellowGroup);

    const clearedGroup = el('div', 'challenge-control');
    clearedGroup.appendChild(el('div', 'ca-control-label', 'Cleared up to Stage'));
    const input = el('input', 'challenge-input');
    input.type = 'number';
    input.min = '0';
    input.max = String(floors.length);
    input.value = String(settings.cleared);
    input.onchange = () => {
      settings = normalizeSettings({ ...settings, cleared: Math.min(floors.length, Number(input.value)) });
      input.value = String(settings.cleared);
      writeSettings(settings);
      render();
    };
    clearedGroup.appendChild(input);
    const hide = el('label', 'challenge-check');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = settings.filter === 'open';
    cb.onchange = () => {
      settings = { ...settings, filter: cb.checked ? 'open' : 'all' };
      writeSettings(settings);
      render();
    };
    hide.append(cb, document.createTextNode(' Hide cleared'));
    clearedGroup.appendChild(hide);
    controls.appendChild(clearedGroup);

    const jumpGroup = el('div', 'challenge-control');
    jumpGroup.appendChild(el('div', 'ca-control-label', 'Jump to'));
    const jumps = el('div', 'challenge-seg');
    const nextBtn = el('button', 'difficulty-btn', 'Next Stage');
    nextBtn.type = 'button';
    nextBtn.onclick = () => jumpTo(Math.min(floors.length, settings.cleared + 1));
    const wallBtn = el('button', 'difficulty-btn', 'First out of reach');
    wallBtn.type = 'button';
    wallBtn.title = 'First unplayed Stage that no song and difficulty can clear (once scored)';
    wallBtn.onclick = () => {
      const f = floors.find((fl) => fl.number > settings.cleared && floorBest(fl)?.verdict.key === 'no');
      if (f) jumpTo(f.number);
      else status.textContent = 'No unplayed Stage is out of reach among the Stages scored so far.';
    };
    jumps.append(nextBtn, wallBtn);
    jumpGroup.appendChild(jumps);
    controls.appendChild(jumpGroup);
  }

  function jumpTo(number) {
    expanded = number;
    if (settings.filter === 'open' && number <= settings.cleared) settings = { ...settings, filter: 'all' };
    prioritise(floors.find((f) => f.number === number));
    render();
    overlay.querySelector(`[data-floor="${number}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  // ---- per-floor results --------------------------------------------------------------------
  function floorOptions(f) {
    const opts = [];
    for (const songId of f.musicIds) {
      const scores = c.scores.get(songId);
      if (!scores) continue;
      for (const d of DIFFICULTIES) if (scores[d]) opts.push({ songId, difficulty: d, level: scores[d].level, scores: scores[d] });
    }
    return opts;
  }
  function floorBest(f) {
    return bestOption(floorOptions(f), floorBonusPermil(f, unitIds), f.clearScore);
  }
  function floorRating(f) {
    const bonus = floorBonusPermil(f, unitIds);
    let best = null;
    for (const songId of f.musicIds) {
      const ev = c.evals.get(songId);
      if (!ev) continue;
      const score = withBonus(ev.unitScore, bonus);
      if (!best || score > best.score) best = { score, grade: gradeFor(score, f.thresholds), songId };
    }
    return best;
  }
  const scoredSongs = (f) => f.musicIds.filter((id) => c.scores.has(id)).length;

  function verdictChip(key, margin) {
    const v = VERDICTS[key];
    const chip = el('span', `challenge-verdict cv-${key}`, v.label);
    if (margin != null) chip.appendChild(el('span', 'challenge-margin', ` ${pct(margin)}`));
    return chip;
  }
  function gradeChip(grade) {
    return el('span', `challenge-grade cg-${grade === '-' ? 'none' : grade}`, grade === '-' ? 'below B' : grade);
  }
  function songTitle(id) {
    return ctx.songById(id)?.title || id;
  }

  function renderHeaderRow() {
    const h = el('div', 'challenge-row challenge-head');
    for (const t of ['Stage', 'Target', 'Bonus Members', 'Rating', 'Best pick', 'Verdict']) h.appendChild(el('div', '', t));
    return h;
  }

  function renderFloor(f) {
    const cleared = f.number <= settings.cleared;
    const row = el('div', 'challenge-row' + (cleared ? ' is-cleared' : '') + (f.mandatory ? ' is-mandatory' : '') + (expanded === f.number ? ' is-open' : ''));
    row.dataset.floor = f.number;
    row.onclick = () => {
      expanded = expanded === f.number ? null : f.number;
      if (expanded) prioritise(f);
      render();
    };

    const stage = el('div', 'challenge-stage');
    stage.appendChild(el('span', 'challenge-stage-num', String(f.number)));
    if (f.mandatory) stage.appendChild(el('span', 'challenge-mandatory', "Can't skip")).title = 'Rainbow Stage: you must clear it yourself, even after a skip';
    row.appendChild(stage);

    row.appendChild(el('div', 'challenge-num', fmt(f.clearScore)));

    const bonusCell = el('div', 'challenge-bonus');
    const inUnit = new Set(bonusHolomemsIn(f, unitIds));
    for (const id of f.bonusCharacterIds) {
      const chip = el('span', 'challenge-holomem' + (inUnit.has(id) ? ' in-unit' : id === leaderId ? ' is-leader' : ''), ctx.characterName(id));
      if (id === leaderId && !inUnit.has(id)) chip.title = 'Your leader - the leader slot doesn’t count for the bonus';
      bonusCell.appendChild(chip);
    }
    const bonus = floorBonusPermil(f, unitIds);
    bonusCell.appendChild(el('span', 'challenge-bonus-total' + (bonus ? '' : ' none'), bonus ? `+${bonus / 10}%` : `+${f.bonusPermil / 10}% each`));
    row.appendChild(bonusCell);

    const ratingCell = el('div', 'challenge-rating');
    const rating = floorRating(f);
    if (rating) {
      ratingCell.appendChild(gradeChip(rating.grade));
      ratingCell.appendChild(el('span', 'challenge-sub', fmt(rating.score)));
    } else ratingCell.textContent = '…';
    row.appendChild(ratingCell);

    const best = floorBest(f);
    const pickCell = el('div', 'challenge-pick');
    const verdictCell = el('div', 'challenge-verdict-cell');
    const n = scoredSongs(f);
    if (best) {
      pickCell.appendChild(el('span', 'challenge-pick-song', songTitle(best.songId)));
      pickCell.appendChild(el('span', `challenge-diff cd-${best.difficulty}`, `${DIFF_LABEL[best.difficulty]} ${best.level}`));
      verdictCell.appendChild(verdictChip(best.verdict.key, best.verdict.margin));
      if (n < f.musicIds.length) verdictCell.appendChild(el('span', 'challenge-sub', ` ${n}/${f.musicIds.length} songs`));
    } else if (n === f.musicIds.length) {
      pickCell.textContent = '—';
      verdictCell.appendChild(el('span', 'challenge-sub', 'no chart data'));
    } else {
      pickCell.textContent = '…';
      verdictCell.appendChild(el('span', 'challenge-sub', 'scoring…'));
    }
    row.append(pickCell, verdictCell);
    return row;
  }

  function renderDetail(f) {
    const box = el('div', 'challenge-detail');
    const bonus = floorBonusPermil(f, unitIds);
    const info = el('div', 'challenge-detail-info');
    info.innerHTML = `
      <span>Target <strong>${fmt(f.clearScore)}</strong></span>
      <span>Your bonus <strong>${bonus ? `+${bonus / 10}%` : 'none'}</strong></span>
      <span>Rating S ≥ ${fmt(f.thresholds.S)} · A ≥ ${fmt(f.thresholds.A)} · B ≥ ${fmt(f.thresholds.B)}</span>
      ${f.mandatory ? '<span class="challenge-mandatory-note">Rainbow Stage — can’t be skipped, you’ll have to clear it yourself</span>' : ''}`;
    box.appendChild(info);
    if (f.rewards?.length) {
      box.appendChild(el('div', 'challenge-rewards', 'Rewards: ' + f.rewards.map((r) => `${r.name} ×${fmt(r.quantity)}`).join(' · ')));
    }

    const best = floorBest(f);
    const t = el('table', 'song-ranking-table challenge-songs');
    t.innerHTML = '<thead><tr><th>Song</th><th>Rating</th><th>Difficulty</th><th>Auto</th><th>FC</th><th>Max</th><th>Verdict</th></tr></thead>';
    const tb = el('tbody');
    for (const songId of f.musicIds) {
      const ev = c.evals.get(songId);
      const scores = c.scores.get(songId);
      const diffs = scores ? DIFFICULTIES.filter((d) => scores[d]) : [];
      const rows = Math.max(1, diffs.length);
      const first = el('tr');
      const songCell = el('td', 'challenge-song-cell', songTitle(songId));
      songCell.rowSpan = rows;
      if (ev && ev.yellowPercent != null) songCell.appendChild(el('div', 'challenge-sub', `Yellow ${ev.yellowPercent}%`));
      const rateCell = el('td');
      rateCell.rowSpan = rows;
      if (ev) {
        const us = withBonus(ev.unitScore, bonus);
        rateCell.append(gradeChip(gradeFor(us, f.thresholds)), el('div', 'challenge-sub', fmt(us)));
      } else rateCell.textContent = '…';
      first.append(songCell, rateCell);
      if (!diffs.length) {
        const td = el('td', 'challenge-sub', scores ? 'no chart data' : 'scoring…');
        td.colSpan = 5;
        first.appendChild(td);
        tb.appendChild(first);
        continue;
      }
      diffs.forEach((d, i) => {
        const tr = i === 0 ? first : el('tr');
        const s = scores[d];
        const v = optionVerdict(s, bonus, f.clearScore);
        if (best && best.songId === songId && best.difficulty === d) tr.className = 'is-best';
        const dc = el('td');
        dc.appendChild(el('span', `challenge-diff cd-${d}`, `${DIFF_LABEL[d]} ${s.level}`));
        const cell = (val) => el('td', 'num' + (val >= f.clearScore ? ' meets' : ''), fmt(val));
        const vc = el('td');
        vc.appendChild(verdictChip(v.key, v.margin));
        tr.append(dc, cell(v.auto), cell(v.fc), cell(v.max), vc);
        tb.appendChild(tr);
      });
    }
    t.appendChild(tb);
    box.appendChild(t);
    box.appendChild(
      el('div', 'estimate-note', 'Scores include your bonus. Green figures reach the Target Score. The best pick is the safest tier; within FC or Luck the easiest chart wins.')
    );
    return box;
  }

  let renderTimer = null;
  function scheduleRender() {
    if (renderTimer) return;
    renderTimer = setTimeout(() => {
      renderTimer = null;
      if (overlay.isConnected) render();
    }, 250);
  }

  function render() {
    const scrollTop = overlay.scrollTop;
    table.innerHTML = '';
    table.appendChild(renderHeaderRow());
    for (const f of floors) {
      if (settings.filter === 'open' && f.number <= settings.cleared && expanded !== f.number) continue;
      table.appendChild(renderFloor(f));
      if (expanded === f.number) table.appendChild(renderDetail(f));
    }
    overlay.scrollTop = scrollTop;
    updateStatus();
  }

  function updateStatus() {
    const songs = allSongs.length;
    const ev = allSongs.filter((id) => c.evals.has(id)).length;
    const sc = allSongs.filter((id) => c.scores.has(id)).length;
    const counts = { auto: 0, fc: 0, lucky: 0, no: 0 };
    for (const f of floors) {
      if (f.number <= settings.cleared) continue;
      const b = floorBest(f);
      if (b && scoredSongs(f) === f.musicIds.length) counts[b.verdict.key]++;
    }
    const left = floors.length - Math.min(settings.cleared, floors.length);
    const summary = `Unplayed Stages (${left}): ${counts.auto} on Auto · ${counts.fc} with a full combo · ${counts.lucky} need luck · ${counts.no} out of reach`;
    status.textContent = sc < songs ? `Scoring songs ${sc}/${songs}${ev < songs ? ` (ratings ${ev}/${songs})` : ''}… ${summary}` : summary;
  }

  // ---- background work ------------------------------------------------------------------------
  const allSongs = [];
  for (const f of floors) for (const id of f.musicIds) if (!allSongs.includes(id)) allSongs.push(id);
  let queue = []; // song ids still to score, in priority order

  function prioritise(f) {
    if (!f) return;
    const ids = f.musicIds.filter((id) => !c.scores.has(id));
    queue = [...ids, ...queue.filter((id) => !ids.includes(id))];
  }

  function start() {
    const my = ++job;
    // Song order: Stages from the next unplayed one upwards, then the cleared ones.
    const ordered = [...floors.filter((f) => f.number > settings.cleared), ...floors.filter((f) => f.number <= settings.cleared)];
    const order = [];
    for (const f of ordered) for (const id of f.musicIds) if (!order.includes(id)) order.push(id);

    // Phase 1: Unit Scores (and skill timelines) for every song - no fetch, done in idle slices.
    const toEval = order.filter((id) => !c.evals.has(id));
    const evalSlice = (deadline) => {
      if (my !== job) return;
      while (toEval.length && deadline.timeRemaining() > 2) {
        const id = toEval.shift();
        const song = ctx.songById(id);
        c.evals.set(id, song ? ctx.evaluateSong(song, settings.yellow) : null);
      }
      scheduleRender();
      if (toEval.length) idle(evalSlice);
      else startScoring(my, order);
    };
    render();
    idle(evalSlice);
  }

  function startScoring(my, order) {
    queue = order.filter((id) => !c.scores.has(id));
    if (expanded) prioritise(floors.find((f) => f.number === expanded));
    let running = 0;
    const pump = () => {
      if (my !== job) return;
      while (running < FETCH_CONCURRENCY && queue.length) {
        const id = queue.shift();
        if (c.scores.has(id)) continue;
        running++;
        ctx
          .loadDensity(id)
          .catch(() => null)
          .then((density) => {
            running--;
            if (my !== job) return;
            idle(() => {
              if (my !== job) return;
              const ev = c.evals.get(id);
              c.scores.set(id, ev && density ? ctx.scoreSong(ev, density) : {});
              scheduleRender();
              pump();
            });
          });
      }
      if (!running && !queue.length) scheduleRender();
    };
    pump();
  }

  buildControls();
  start();
}
