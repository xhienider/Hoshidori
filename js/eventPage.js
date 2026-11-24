// Event Points panel (Builder, under the score cards). UI only - the math is in
// js/eventCalc.js. The current event comes from data/events.json, which the
// maintainer updates each event (the game data has no event setup; it's sent
// by the server). Player settings are kept in localStorage.

import {
  EVENT_TYPES,
  LIVE_BOOST_MULTIPLIER,
  MULTI_RANKS,
  SOLO_RANKS,
  rankFor,
  cardEventBonus,
  songLengthBonusPercent,
  eventPoints,
  pickCurrentEvent,
} from './eventCalc.js';

const STORAGE_KEY = 'hoshidori_event_v1';
const DEFAULTS = { multi: true, boosts: 1, passport: false, highlight: false, source: 'auto', customScore: '', holomemId: null };

let eventsPromise = null;
let eventsData = null;
function loadEvents() {
  if (!eventsPromise) {
    eventsPromise = fetch('data/events.json')
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((d) => (eventsData = d || { events: [] }));
  }
  return eventsPromise;
}

function readSettings() {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}) };
  } catch {
    return { ...DEFAULTS };
  }
}
function saveSettings(s) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable - settings just won't persist */
  }
}

const fmt = (n) => Math.round(n).toLocaleString();
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * @param {HTMLElement} container - emptied and filled
 * @param {{unit:{card:object,bloom:number}[], song:object, maxScore:number, autoScore:number|null,
 *          characterName:(id:string)=>string}} ctx
 */
export function renderEventPanel(container, ctx) {
  if (!eventsData) {
    container.innerHTML = '<div class="panel-label">Event Points</div><div class="estimate-note">Loading event…</div>';
    loadEvents().then(() => container.isConnected && renderEventPanel(container, ctx));
    return;
  }

  const s = readSettings();
  const event = pickCurrentEvent(eventsData, todayIso());
  if (!event) {
    container.innerHTML = `<div class="panel-label">Event Points</div>
      <div class="ev-none">No event is running right now. The event points estimate will appear here when the next event starts.</div>`;
    return;
  }
  const isSpotlight = event?.type === 'spotlight';
  const holomems = event?.holomems || [];
  const holomemId = holomems.includes(s.holomemId) ? s.holomemId : holomems[holomems.length - 1] || null;
  const bonusHolomems = isSpotlight ? (holomemId ? [holomemId] : []) : holomems;
  const eventType = EVENT_TYPES[event.type] ? event.type : 'point_rally';

  const rerender = (patch) => {
    saveSettings({ ...s, ...patch });
    renderEventPanel(container, ctx);
  };

  // --- bonus per card ---
  const perCard = ctx.unit.map((u) => ({ card: u.card, ...cardEventBonus(u.card, u.bloom, event, bonusHolomems) }));
  const earned = perCard.reduce((sum, c) => sum + c.total, 0);

  // --- own score ---
  const custom = Number(String(s.customScore).replace(/[^\d]/g, '')) || 0;
  const scores = { auto: ctx.autoScore, max: ctx.maxScore, custom };
  const source = s.source === 'custom' && !custom ? 'auto' : s.source === 'auto' && ctx.autoScore == null ? 'max' : s.source;
  const ownScore = scores[source] || 0;

  // --- song length / Highlight ---
  const boosts = Math.max(1, Math.min(10, Number(s.boosts) || 1));
  const lengthPct = songLengthBonusPercent(ctx.song.playingSeconds || 0, boosts, s.highlight);
  const songSingers = ctx.song.characterIds || [];
  const singsIt = !bonusHolomems.length || bonusHolomems.some((id) => songSingers.includes(id));

  const common = { ownScore, eventType, earnedBonusPercent: earned, songLengthPercent: lengthPct, boosts, passport: s.passport };

  // --- rows ---
  let rowsHtml;
  if (s.multi) {
    rowsHtml = MULTI_RANKS.map(([name, room]) => {
      const r = eventPoints({ ...common, multi: true, roomScore: room });
      return `<tr><td>${name}</td><td class="n">${fmt(room)}</td><td class="n ev-pts">${fmt(r.points)}</td><td class="n">${fmt(r.badges)}</td><td class="n">${fmt(r.points / boosts)}</td></tr>`;
    }).join('');
  } else {
    const r = eventPoints({ ...common, multi: false });
    rowsHtml = `<tr><td>${rankFor(ownScore, SOLO_RANKS)}</td><td class="n">${fmt(ownScore)}</td><td class="n ev-pts">${fmt(r.points)}</td><td class="n">${fmt(r.badges)}</td><td class="n">${fmt(r.points / boosts)}</td></tr>`;
  }

  const cardRows = perCard
    .map((c) => {
      const parts = [];
      if (c.memberPct) parts.push(`Member +${c.memberPct}%`);
      if (c.holomemPct) parts.push(`holomem +${c.holomemPct}%`);
      parts.push(`Bloom +${c.bloomPct}%`);
      return `<div class="ev-card"><span class="ev-card-name">${esc(c.card?.shortName || c.card?.characterName || '?')}</span><span class="ev-card-parts">${parts.join(' · ')}</span><span class="ev-card-total">+${c.total}%</span></div>`;
    })
    .join('');

  const typeLabel = EVENT_TYPES[eventType]?.label || eventType;
  const dates = event?.start ? ` · ${esc(event.start)} – ${esc(event.end || '?')}` : '';
  const eventHeader = `<div class="ev-event"><span class="ev-event-name">${esc(event.name)}</span><span class="ev-event-meta">${esc(typeLabel)}${dates}${event.banner ? ` · banner: ${esc(event.banner)}` : ''}</span></div>
       ${event.verified ? '' : `<div class="ev-warn">Not yet checked against this event’s in-game bonus screen: banner cards and bonus sizes (Member +${event.memberBonusPercent}%, holomem +${event.holomemBonusPercent}%) are worked out from the game data.</div>`}`;

  const holomemSelect =
    isSpotlight && holomems.length > 1
      ? `<label class="ev-field">Chapter <select class="ev-holomem">${holomems
          .map((id) => `<option value="${id}"${id === holomemId ? ' selected' : ''}>${esc(ctx.characterName(id))}</option>`)
          .join('')}</select></label>`
      : '';

  const highlightWarn =
    s.highlight && !singsIt
      ? `<div class="ev-warn">Highlight only picks songs sung by ${esc(bonusHolomems.map(ctx.characterName).join(', '))}; this song isn’t one, so its score is just a stand-in.</div>`
      : '';

  const scoreOpt = (key, label, value) =>
    `<label class="ev-radio"><input type="radio" name="ev-src" value="${key}"${source === key ? ' checked' : ''}${value == null ? ' disabled' : ''}> ${label}${value != null && key !== 'custom' ? ` <b>${fmt(value)}</b>` : ''}</label>`;

  container.innerHTML = `
    <div class="panel-label">Event Points</div>
    ${eventHeader}
    <div class="ev-grid">
      <div class="ev-bonus">
        ${holomemSelect}
        <div class="ev-cards">${cardRows}</div>
        <div class="ev-bonus-total">Bonus Total <b>+${earned}%</b></div>
      </div>
      <div class="ev-controls">
        <div class="ev-seg"><button class="ev-mode${s.multi ? '' : ' on'}" data-multi="0">Solo</button><button class="ev-mode${s.multi ? ' on' : ''}" data-multi="1">Multi</button></div>
        <label class="ev-field">Live Boosts <select class="ev-boosts">${LIVE_BOOST_MULTIPLIER.map((m, i) => `<option value="${i + 1}"${i + 1 === boosts ? ' selected' : ''}>${i + 1} (×${m})</option>`).join('')}</select></label>
        <label class="ev-check"><input type="checkbox" class="ev-passport"${s.passport ? ' checked' : ''}> HoloPassport (×2)</label>
        <label class="ev-check"><input type="checkbox" class="ev-highlight"${s.highlight ? ' checked' : ''}> Highlight song</label>
        <div class="ev-field-note">Song-length bonus: <b>+${lengthPct}%</b>${s.highlight ? ' (Highlight)' : ` (${ctx.song.playingSeconds || 0} s)`}</div>
        <div class="ev-field">Your score
          ${scoreOpt('auto', 'Auto', ctx.autoScore)}
          ${scoreOpt('max', 'Max', ctx.maxScore)}
          <label class="ev-radio"><input type="radio" name="ev-src" value="custom"${source === 'custom' ? ' checked' : ''}> My score <input class="mini-input ev-custom" inputmode="numeric" placeholder="e.g. 2086000" value="${esc(s.customScore)}"></label>
        </div>
      </div>
    </div>
    ${highlightWarn}
    <div class="scroll"><table class="ev-table">
      <tr><th>${s.multi ? 'Room rank' : 'Rank'}</th><th class="n">${s.multi ? 'Room score from' : 'Your score'}</th><th class="n">Event Pts</th><th class="n">Badges</th><th class="n">Pts per boost</th></tr>
      ${rowsHtml}
    </table></div>
    <div class="estimate-note">${s.multi ? `Room score = the MULTI SCORE on the results screen (all 5 players plus Fever); each row uses the lowest score for that rank. ${esc(typeLabel)} divides it by ${fmt(EVENT_TYPES[eventType]?.roomDivisor ?? 60000)}. ` : ''}Your score: “Max” assumes every note Perfect+ and every skill firing on every cooldown; “Auto” scores notes the Auto way (no combo bonus) with the same skills, so real Auto runs land somewhat lower. Typing your real score from a results screen is most accurate. The formula itself matched real results screens to the exact point.</div>
  `;

  container.querySelectorAll('.ev-mode').forEach((b) => (b.onclick = () => rerender({ multi: b.dataset.multi === '1' })));
  container.querySelector('.ev-boosts').onchange = (e) => rerender({ boosts: Number(e.target.value) });
  container.querySelector('.ev-passport').onchange = (e) => rerender({ passport: e.target.checked });
  container.querySelector('.ev-highlight').onchange = (e) => rerender({ highlight: e.target.checked });
  container.querySelectorAll('input[name="ev-src"]').forEach((r) => (r.onchange = () => rerender({ source: r.value })));
  const customEl = container.querySelector('.ev-custom');
  customEl.onchange = () => rerender({ customScore: customEl.value.replace(/[^\d]/g, ''), source: 'custom' });
  container.querySelector('.ev-holomem')?.addEventListener('change', (e) => rerender({ holomemId: e.target.value }));
}
