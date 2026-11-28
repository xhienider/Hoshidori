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
  selectableEvents,
  eventEndMs,
  formatCountdown,
  liveBoostsUntilEnd,
  pointsFromBoosts,
  LIVE_BOOST_RECOVERY_MINUTES,
  LIVE_BOOST_HELD_MAX,
} from './eventCalc.js';

const STORAGE_KEY = 'hoshidori_event_v1';
// held / heldAt / nextIn: Live Boosts the player had at heldAt (ms) and the in-game timer to the
// next one then (minutes) - account-wide. soFar: event points already earned, per event id.
const DEFAULTS = { multi: true, boosts: 1, passport: false, highlight: false, source: 'auto', customScore: '', holomemId: null, eventId: null, held: '', heldAt: null, nextIn: '', soFar: {} };

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

// One ticker for the whole page: refreshes every countdown each second, and re-renders the panel
// when a Live Boost recovery lands (or the event closes) so the boost count and the
// "By event end" column stay current.
let ticker = null;
let lastPanel = null; // {container, ctx}
function tick() {
  const now = Date.now();
  const els = document.querySelectorAll('.ev-countdown[data-end]');
  if (!els.length) {
    clearInterval(ticker);
    ticker = null;
    return;
  }
  els.forEach((el) => {
    const left = Number(el.dataset.end) - now;
    el.textContent = left > 0 ? formatCountdown(left) : 'Event has ended';
    el.classList.toggle('ended', left <= 0);
  });
  const panel = lastPanel?.container;
  const sig = panel?.querySelector('[data-boost-sig]')?.dataset.boostSig;
  if (panel?.isConnected && sig && sig !== boostSignature(lastPanel.event, now)) renderEventPanel(panel, lastPanel.ctx);
}
function startTicker() {
  if (!ticker) ticker = setInterval(tick, 1000);
}

/** Live Boost state for an event at `now` (null when the event has no known end). */
function boostState(event, s, song, now) {
  const endMs = eventEndMs(event);
  if (endMs == null) return null;
  const held = Number(s.held) || 0;
  const heldAtMs = Number(s.heldAt) || now;
  const nextIn = s.nextIn === '' || s.nextIn == null ? null : Number(s.nextIn);
  const lastLiveMs = ((song?.playingSeconds || 0) + 30) * 1000; // the live must finish before the close
  return { endMs, ...liveBoostsUntilEnd({ held, heldAtMs, nextInMinutes: nextIn, endMs, lastLiveMs }) };
}
function boostSignature(event, now) {
  const b = lastPanel ? boostState(event, readSettings(), lastPanel.ctx.song, now) : null;
  return b ? `${b.total}|${b.endMs > now ? 1 : 0}` : '';
}

const timeFmt = (ms) =>
  new Date(ms).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * The event the Event Points panel is showing (the player's pick, else the first running /
 * upcoming one) - shared with the Builder's "Event Holomems" picker filter so both always
 * agree. Returns null until data/events.json has loaded (call loadEvents() and retry) or when
 * no event is running or announced. {event, status, holomemIds, bannerCards}; holomemIds =
 * every event holomem (all Spotlight chapters, or every banner card holomem otherwise).
 */
export function currentPanelEvent() {
  if (!eventsData) return null;
  const choices = selectableEvents(eventsData, todayIso());
  if (!choices.length) return null;
  const s = readSettings();
  const chosen = choices.find((c) => c.event.id === s.eventId) || choices[0];
  return { ...chosen, holomemIds: chosen.event.holomems || [], bannerCards: chosen.event.bannerCards || [] };
}
export { loadEvents };

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
  const choices = selectableEvents(eventsData, todayIso());
  if (!choices.length) {
    container.innerHTML = `<div class="panel-label">Event Points</div>
      <div class="ev-none">No event is running or announced right now. The event points estimate will appear here once the next event is announced.</div>`;
    return;
  }
  const chosen = choices.find((c) => c.event.id === s.eventId) || choices[0];
  const event = chosen.event;
  const isUpcoming = chosen.status === 'upcoming';
  const isSpotlight = event?.type === 'spotlight';
  const holomems = event?.holomems || [];
  const holomemId = holomems.includes(s.holomemId) ? s.holomemId : holomems[holomems.length - 1] || null;
  const bonusHolomems = isSpotlight ? (holomemId ? [holomemId] : []) : holomems;
  const eventType = EVENT_TYPES[event.type] ? event.type : 'point_rally';

  const now = Date.now();
  lastPanel = { container, ctx, event };
  const bs = boostState(event, s, ctx.song, now);
  const ended = bs ? bs.endMs <= now : false;
  // Upcoming events: the game data has no start time, so recoveries can't be counted yet.
  const showBoosts = bs && !isUpcoming && !ended;
  const soFar = Number(s.soFar?.[event.id]) || 0;

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
  // "By event end": points so far + every remaining Live Boost spent at the chosen boosts per
  // live (the leftover live priced at its own boost count - its song-length bonus differs).
  const pointsFor = (extra) => (b) =>
    eventPoints({ ...common, ...extra, boosts: b, songLengthPercent: songLengthBonusPercent(ctx.song.playingSeconds || 0, b, s.highlight) }).points;
  const endCell = (extra) => (showBoosts ? `<td class="n ev-end">${fmt(soFar + pointsFromBoosts(bs.total, boosts, pointsFor(extra)).points)}</td>` : '');
  const row = (label, scoreShown, extra) => {
    const r = eventPoints({ ...common, ...extra });
    return `<tr><td>${label}</td><td class="n">${fmt(scoreShown)}</td><td class="n ev-pts">${fmt(r.points)}</td><td class="n">${fmt(r.badges)}</td><td class="n">${fmt(r.points / boosts)}</td>${endCell(extra)}</tr>`;
  };
  const rowsHtml = s.multi
    ? MULTI_RANKS.map(([name, room]) => row(name, room, { multi: true, roomScore: room })).join('')
    : row(rankFor(ownScore, SOLO_RANKS), ownScore, { multi: false });

  // --- time left + Live Boosts block ---
  const plan = showBoosts ? pointsFromBoosts(bs.total, boosts, () => 0) : null;
  const clockHtml = bs
    ? `<div class="ev-clock"><span class="ev-clock-label">${ended ? '' : 'Ends in'}</span><span class="ev-countdown${ended ? ' ended' : ''}" data-end="${bs.endMs}">${ended ? 'Event has ended' : formatCountdown(bs.endMs - now)}</span><span class="ev-clock-at">${esc(timeFmt(bs.endMs))}</span></div>`
    : '';
  const heldAtNote = s.heldAt && s.held !== '' ? ` <span class="ev-dim">(entered ${esc(new Date(Number(s.heldAt)).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }))})</span>` : '';
  const boostsHtml = !bs || ended
    ? ''
    : `<div class="ev-boostplan" data-boost-sig="${showBoosts ? `${bs.total}|1` : ''}">
        <div class="ev-boostplan-inputs">
          <label class="ev-field">Live Boosts you hold now <input class="mini-input ev-held" inputmode="numeric" placeholder="0" value="${esc(s.held)}"></label>
          <label class="ev-field">Next boost in <input class="mini-input ev-nextin" inputmode="numeric" placeholder="${LIVE_BOOST_RECOVERY_MINUTES}" value="${esc(s.nextIn)}"> min</label>
          <label class="ev-field">Event points so far <input class="mini-input ev-sofar" inputmode="numeric" placeholder="0" value="${soFar ? soFar : ''}"></label>
        </div>
        ${
          showBoosts
            ? `<div class="ev-boostplan-total">Live Boosts until the end <b>${fmt(bs.total)}</b>
                 <span class="ev-dim">= ${fmt(bs.held)} held${heldAtNote} + ${fmt(bs.recoveries)} recoveries (1 every ${LIVE_BOOST_RECOVERY_MINUTES} min) · ${fmt(plan.lives)} live${plan.lives === 1 ? '' : 's'} of ${boosts}${plan.rest ? ` + 1 live of ${plan.rest}` : ''}</span></div>`
            : `<div class="ev-field-note">Live Boosts until the end show once the event starts.</div>`
        }
      </div>`;

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
  const eventSelect =
    choices.length > 1
      ? `<label class="ev-field">Event <select class="ev-event-pick">${choices
          .map((c) => `<option value="${esc(c.event.id)}"${c === chosen ? ' selected' : ''}>${esc(c.event.name)} (${c.status === 'live' ? 'running now' : `starts ${esc(c.event.start)}`})</option>`)
          .join('')}</select></label>`
      : '';
  const upcomingNote = isUpcoming
    ? `<div class="ev-field-note">Upcoming event (starts ${esc(event.start)}) — test your team for it ahead of time.</div>`
    : '';
  const eventHeader = `${eventSelect}<div class="ev-event"><span class="ev-event-name">${esc(event.name)}</span><span class="ev-event-meta">${esc(typeLabel)}${dates}${event.banner ? ` · banner: ${esc(event.banner)}` : ''}</span></div>
       ${clockHtml}
       ${upcomingNote}
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
    ${boostsHtml}
    <div class="scroll"><table class="ev-table">
      <tr><th>${s.multi ? 'Room rank' : 'Rank'}</th><th class="n">${s.multi ? 'Room score from' : 'Your score'}</th><th class="n">Event Pts</th><th class="n">Badges</th><th class="n">Pts per boost</th>${showBoosts ? `<th class="n" title="Points so far + every remaining Live Boost spent at ${boosts} per live">By event end</th>` : ''}</tr>
      ${rowsHtml}
    </table></div>
    <div class="estimate-note">${s.multi ? `Room score = the MULTI SCORE on the results screen (all 5 players plus Fever); each row uses the lowest score for that rank. ${esc(typeLabel)} divides it by ${fmt(EVENT_TYPES[eventType]?.roomDivisor ?? 60000)}. ` : ''}Your score: “Max” assumes every note Perfect+ and every skill firing on every cooldown; “Auto” scores notes the Auto way (no combo bonus) with the same skills, so real Auto runs land somewhat lower. Typing your real score from a results screen is most accurate. The formula itself matched real results screens to the exact point.${showBoosts ? ` “By event end” adds every Live Boost you can still spend at ${boosts} per live (natural recovery only, assuming you spend often enough that the bar never sits full at 10 — a full bar stops recovering) to your points so far.` : ''}</div>
  `;

  container.querySelectorAll('.ev-mode').forEach((b) => (b.onclick = () => rerender({ multi: b.dataset.multi === '1' })));
  container.querySelector('.ev-boosts').onchange = (e) => rerender({ boosts: Number(e.target.value) });
  container.querySelector('.ev-passport').onchange = (e) => rerender({ passport: e.target.checked });
  container.querySelector('.ev-highlight').onchange = (e) => rerender({ highlight: e.target.checked });
  container.querySelectorAll('input[name="ev-src"]').forEach((r) => (r.onchange = () => rerender({ source: r.value })));
  const customEl = container.querySelector('.ev-custom');
  customEl.onchange = () => rerender({ customScore: customEl.value.replace(/[^\d]/g, ''), source: 'custom' });
  container.querySelector('.ev-event-pick')?.addEventListener('change', (e) => rerender({ eventId: e.target.value }));
  container.querySelector('.ev-holomem')?.addEventListener('change', (e) => rerender({ holomemId: e.target.value }));
  const digits = (el) => el.value.replace(/[^\d]/g, '');
  const heldEl = container.querySelector('.ev-held');
  if (heldEl) heldEl.onchange = () => rerender({ held: digits(heldEl) === '' ? '' : String(Math.min(LIVE_BOOST_HELD_MAX, Number(digits(heldEl)))), heldAt: Date.now() });
  const nextEl = container.querySelector('.ev-nextin');
  if (nextEl) nextEl.onchange = () => rerender({ nextIn: digits(nextEl) === '' ? '' : String(Math.min(LIVE_BOOST_RECOVERY_MINUTES, Number(digits(nextEl)))), heldAt: Date.now() });
  const soFarEl = container.querySelector('.ev-sofar');
  if (soFarEl) soFarEl.onchange = () => rerender({ soFar: { ...(s.soFar || {}), [event.id]: Number(digits(soFarEl)) || 0 } });
  if (bs && !ended) startTicker();
}
