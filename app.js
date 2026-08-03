import { resolveMemberStats, getStatRoles, getSkillLevel, SKILL_LEVEL_TYPES } from './js/statEngine.js';
import { evaluateLeaderCondition, resolveEffectRecipients } from './js/skillEngine.js';
import {
  computeUnit,
  mapSpecialSkillsToSong,
  estimateOverallPower,
  estimatePassivePower,
  computeScoreSupport,
  simulateActiveTimeline,
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

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

const DATA = {};

async function loadData() {
  const [members, cardPotentials, characterGroupings, songs] = await Promise.all([
    fetch('data/members.json').then((r) => r.json()),
    fetch('data/card_potentials.json').then((r) => r.json()),
    fetch('data/character_groupings.json').then((r) => r.json()),
    fetch('data/music.json').then((r) => r.json()),
  ]);
  DATA.members = members;
  DATA.byId = Object.fromEntries(members.map((m) => [m.cardId, m]));
  DATA.cardPotentials = cardPotentials;
  DATA.characterGroupings = characterGroupings;
  DATA.songs = songs.filter((s) => s.feverSeconds && s.feverSeconds.length === 5);
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
};

function maxLevelFor(card) {
  const levels = Object.keys(card.levelCurve).map(Number);
  return levels.length ? Math.max(...levels) : 80;
}

// ---------------------------------------------------------------------------
// Roster slot rendering
// ---------------------------------------------------------------------------

const rosterEl = document.getElementById('roster');
const songSelectEl = document.getElementById('song-select');
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
  name.textContent = card ? card.characterName : (isLeader ? 'Choose leader' : 'Choose member');
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
      name.textContent = m.characterName;
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

function renderSongSelect() {
  songSelectEl.innerHTML = '<option value="">Select a song\u2026</option>';
  for (const s of DATA.songs) {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.title;
    songSelectEl.appendChild(opt);
  }
  songSelectEl.onchange = () => {
    state.songId = songSelectEl.value || null;
    recompute();
  };
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

  renderResults(result, leaderCard, unit);
}

function renderResults(result, leaderCard, unit) {
  resultsEl.innerHTML = '';

  resultsEl.appendChild(renderStatsPanel(result));

  const twoCol = document.createElement('div');
  twoCol.className = 'two-col';
  twoCol.appendChild(renderLeaderPanel(result, leaderCard));
  twoCol.appendChild(renderPassivesPanel(result, unit));
  resultsEl.appendChild(twoCol);

  resultsEl.appendChild(renderActivesPanel(result, unit));
  resultsEl.appendChild(renderTimelinePanel(result, unit));
  resultsEl.appendChild(renderCoveragePanel(result, unit));
  resultsEl.appendChild(renderPowerPanel(result, leaderCard));
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

function renderActivesPanel(result, unit) {
  const panel = document.createElement('div');
  panel.className = 'panel';
  const label = document.createElement('div');
  label.className = 'panel-label';
  label.textContent = 'Active Skills';
  panel.appendChild(label);

  const scoreSupport = computeScoreSupport(result.passives);

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

function renderCoveragePanel(result, unit) {
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
  const scoreSupport = computeScoreSupport(result.passives);
  const duration = song.playingSeconds || Math.max(...song.feverSeconds) + 15;

  const timeline = simulateActiveTimeline({
    activeResults: result.actives,
    specialResults: result.specials,
    unitCards,
    scoreSupport,
    feverSeconds: song.feverSeconds,
    durationSeconds: duration,
  });

  // Summary stats, mirroring the sheet's BONUS SCORE SUMMARY section
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

  const rows = document.createElement('div');
  rows.className = 'coverage-rows';

  unitCards.forEach((card, i) => {
    const row = document.createElement('div');
    row.className = 'coverage-row';

    const name = document.createElement('div');
    name.className = 'coverage-row-name';
    name.textContent = card.characterName;
    row.appendChild(name);

    const track = document.createElement('div');
    track.className = 'coverage-row-track';

    // Merge consecutive seconds into segments, splitting whenever the bonus or
    // activation chance changes (e.g. entering/leaving a special skill overlap
    // window mid-activation), so each segment's tooltip stays accurate.
    let segStart = null;
    let segBonus = null;
    let segActivation = null;

    const flushSegment = (endT) => {
      const seg = document.createElement('div');
      seg.className = 'coverage-segment';
      const widthPct = Math.max(((endT - segStart) / duration) * 100, 0.4);
      seg.style.left = (segStart / duration) * 100 + '%';
      seg.style.width = widthPct + '%';
      const label = `${segBonus.toFixed(1)}% @ ${segActivation}%`;
      seg.title = `${segBonus.toFixed(1)}% score bonus @ ${segActivation}% activation chance`;
      if (widthPct > 7) {
        seg.textContent = label;
      }
      track.appendChild(seg);
    };

    for (let t = 0; t <= timeline.length; t++) {
      const point = t < timeline.length ? timeline[t].perMember[i] : null;
      const isActive = !!point?.active;

      if (isActive && segStart === null) {
        segStart = t;
        segBonus = point.effectiveBonus;
        segActivation = point.activationChance;
      } else if (isActive && (point.effectiveBonus !== segBonus || point.activationChance !== segActivation)) {
        flushSegment(t);
        segStart = t;
        segBonus = point.effectiveBonus;
        segActivation = point.activationChance;
      } else if (!isActive && segStart !== null) {
        flushSegment(t);
        segStart = null;
      }
    }

    for (const fs of song.feverSeconds) {
      const line = document.createElement('div');
      line.className = 'coverage-fever-line';
      line.style.left = (fs / duration) * 100 + '%';
      track.appendChild(line);
    }

    row.appendChild(track);
    rows.appendChild(row);
  });

  panel.appendChild(rows);

  const axis = document.createElement('div');
  axis.className = 'coverage-axis';
  const axisSpacer = document.createElement('div');
  axis.appendChild(axisSpacer);
  const axisTrack = document.createElement('div');
  axisTrack.className = 'coverage-axis-track';
  const markCount = 6;
  for (let m = 0; m <= markCount; m++) {
    const t = Math.round((duration / markCount) * m);
    const mark = document.createElement('div');
    mark.className = 'coverage-axis-mark';
    mark.style.left = (t / duration) * 100 + '%';
    mark.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    axisTrack.appendChild(mark);
  }
  axis.appendChild(axisTrack);
  panel.appendChild(axis);

  return panel;
}

function renderPowerPanel(result, leaderCard) {
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
  renderSongSelect();
  recompute();
}

main().catch((err) => {
  resultsEl.innerHTML = `<div class="empty-state">Failed to load data: ${err.message}</div>`;
  console.error(err);
});
