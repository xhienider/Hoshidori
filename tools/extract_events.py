#!/usr/bin/env python3
"""
Regenerate data/events.json (the Builder's Event Points panel) from a datamine export.

    python3 tools/extract_events.py <datamine dir> [--old <previous datamine dir>] [--site <site root>]

What the game data gives (checked against Whistling Wind Walk, 2026-11-24):
- Events are `marathon_event-<kind>-NNN`. kind `relay` = Spotlight. kind `normal` is Point Rally,
  EXCEPT events that award `total_music_highest_score_reward` emblems, which are Score Challenge
  (ranked on the total of best scores). That split is an inference from the emblem names.
- Name: the poster text `la-poster-marathon_event-...-chapter-NN`. Spotlight posters end in
  "(<holomem>)" - one chapter per holomem; the holomem Bonus applies to the chapter's holomem.
- Start: EventStoryChapter.priority = YYMMDDNN (relay-004 = 26111401 -> 2026-11-14). Events with
  no story chapter have no start in the data; they're matched to the leftover pickup banners in
  order (marked "inferred").
- End: Condition `cd-event_end-marathon_event-...` (relay: endTime; normal: startTime = the moment
  the event ends). Times are converted to Singapore time (UTC+8), the user's timezone.
  `endAt` = the exact closing moment as ISO with +08:00 (relay endTime is the last second, so
  +1 s); every event so far closes at 19:00 SGT. Feeds the panel's countdown and Live Boost count.
  endAt is data-derived timing, so it is also filled in on verified events (nothing else on
  them is touched).
- NOT in the data: the RANKING end. Point Rally keeps the event (exchange) open after the ranking
  closes - Joyful Twinkle Night closes 10 Dec in the data, but its in-game screen says ranking
  until 4 Dec 18:59 SGT. Enter it by hand as `rankingEnd` (date) + `rankingEndAt` (close moment,
  ISO +08:00); the script keeps hand-entered values on every event.
- Banner: Gacha `gacha-pickup-normal-YYMMDD` with the event's start date; its name comes from
  LangGachaPoint ("Bright Autumn Trip Gacha Pt").
What it does NOT give (server-side): the banner's card list and the bonus percentages.
- Spotlight banner cards = each chapter holomem's 5-star card from the same release batch (the
  closest card numbers) - held for every Spotlight so far (0069-0073, 0081-0084, 0092-0095,
  0104-0108).
- Point Rally / Score Challenge banner cards = the 5-star cards new in this dump (needs --old),
  given to the newest event; the holomem Bonus goes to those cards' holomems (user, 2026-11-24).
- Default bonus sizes (user, 2026-11-24): Spotlight +50% / +50%, Point Rally +30% / +30%
  (Score Challenge assumed +30% / +30%). Confirm each event against its in-game bonus screen and
  set "verified": true - verified events are never changed by this script.
Existing entries are merged: verified events are left alone; for the rest, data-derived fields
are refreshed and hand-entered banner cards are kept unless the script found some.
"""
import argparse
import datetime as dt
import json
import os
import re
import sys

SGT = dt.timezone(dt.timedelta(hours=8))
DEFAULT_BONUS = {'spotlight': (50, 50), 'point_rally': (30, 30), 'score_challenge': (30, 30)}


def load(dirpath, name):
    with open(os.path.join(dirpath, name), encoding='utf-8') as f:
        return json.load(f)


def rows(dirpath, name):
    return [r.get('data', r) for r in load(dirpath, name)]


def lang(dirpath, name):
    return {r['id']: r.get('text') for r in rows(dirpath, name)}


def ms_to_sgt(ms):
    return dt.datetime.fromtimestamp(int(ms) / 1000, dt.timezone.utc).astimezone(SGT)


def serial(card_id):
    m = re.search(r'uniq-(\d+)', card_id)
    return int(m.group(1)) if m else -1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('datamine')
    ap.add_argument('--old', help='previous datamine dir (its Card.json defines which cards are new)')
    ap.add_argument('--site', default=os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
    a = ap.parse_args()
    dm, site = a.datamine, a.site

    members = json.load(open(os.path.join(site, 'data', 'members.json'), encoding='utf-8'))
    five = [c for c in members if c['rarity'].endswith('_5')]

    def holomem_by_name(name):
        n = name.strip().lower()
        for c in members:
            for k in (c.get('shortName'), c.get('characterName')):
                if k and k.lower() == n:
                    return c['characterId']
        for c in members:  # e.g. "Ina'nis" vs "Ninomae Ina'nis"
            if n in (c.get('characterName') or '').lower().split():
                return c['characterId']
        return None

    posters = lang(dm, 'LangPoster_Eng.json')
    chapters_lang = lang(dm, 'LangEventStoryChapter_Eng.json')
    gacha_names = lang(dm, 'LangGachaPoint_Eng.json')
    story_chapters = rows(dm, 'EventStoryChapter.json')
    conditions = rows(dm, 'Condition.json')
    emblem_text = open(os.path.join(dm, 'Emblem.json'), encoding='utf-8').read()

    events = {}
    for pid, text in posters.items():
        m = re.match(r'la-poster-(marathon_event-(normal|relay|mission)-(\d+))-chapter-(\d+)$', pid)
        if not m:
            continue
        eid, kind, _, ch = m.group(1), m.group(2), m.group(3), int(m.group(4))
        ev = events.setdefault(eid, {'id': eid, 'kind': kind, 'chapters': {}})
        ev['chapters'][ch] = text

    for ev in events.values():
        eid = ev['id']
        if ev['kind'] == 'relay':
            ev['type'] = 'spotlight'
        elif ev['kind'] == 'mission' or f'total_music_highest_score_reward-{eid}' in emblem_text:
            ev['type'] = 'score_challenge'
        else:
            ev['type'] = 'point_rally'
        first = ev['chapters'][min(ev['chapters'])]
        ev['name'] = re.sub(r'\s*\([^)]*\)\s*$', '', first) if ev['type'] == 'spotlight' else first
        ev['chapterList'] = []
        for ch in sorted(ev['chapters']):
            title = ev['chapters'][ch]
            hm = re.search(r'\(([^)]*)\)\s*$', title)
            ev['chapterList'].append({
                'chapter': ch,
                'holomem': holomem_by_name(hm.group(1)) if hm else None,
                'story': chapters_lang.get(f'la-event_story_chapter-{eid}-chapter-{ch:02d}'),
            })
        prios = [c['priority'] for c in story_chapters if c['id'].startswith(f'event_story_chapter-{eid}-')]
        ev['start'] = None
        if prios:
            s = str(min(prios))
            ev['start'] = f'20{s[0:2]}-{s[2:4]}-{s[4:6]}'
        ev['end'] = None
        ev['endAt'] = None
        for c in conditions:
            if c.get('groupId') == f'cd-event_end-{eid}' and c.get('type', '').endswith('TERM_DATETIME'):
                t = c.get('endTime') or c.get('startTime')
                if t:
                    d = ms_to_sgt(t)
                    if c.get('endTime'):
                        ev['endAt'] = (d + dt.timedelta(seconds=1)).isoformat()  # last second -> close moment
                    else:
                        ev['endAt'] = d.isoformat()
                    if c.get('startTime') and not c.get('endTime'):
                        d -= dt.timedelta(seconds=1)  # "after end" condition -> last moment of the event
                    ev['end'] = d.strftime('%Y-%m-%d')
        ev['inferred'] = []

    # Banners: pickup gachas carry their start date.
    banners = sorted({m.group(1) for k in gacha_names for m in [re.match(r'la-gacha_point-pickup-(\d{6})$', k)] if m})
    def banner_date(b):
        return f'20{b[0:2]}-{b[2:4]}-{b[4:6]}'
    used = set()
    for ev in events.values():
        ev['banner'] = None
        if ev['start']:
            b = ev['start'][2:].replace('-', '')
            if b in banners:
                ev['banner'] = b
                used.add(b)
    leftover = [b for b in banners if b not in used]
    for ev in sorted((e for e in events.values() if not e['start']), key=lambda e: e['id']):
        cands = [b for b in leftover if not ev['end'] or banner_date(b) <= ev['end']]
        if cands:
            b = cands[0]
            leftover.remove(b)
            ev['banner'], ev['start'] = b, banner_date(b)
            ev['inferred'].append('start/banner matched by order')

    # Banner cards.
    new_cards = []
    if a.old:
        old_ids = {r['id'] for r in rows(a.old, 'Card.json')}
        new_cards = [c['cardId'] for c in five if c['cardId'] not in old_ids]
    newest = max(events.values(), key=lambda e: (e['start'] or '', e['id']), default=None)
    for ev in events.values():
        cards = []
        if ev['type'] == 'spotlight':
            cand = {h: [c['cardId'] for c in five if c['characterId'] == h] for h in (x['holomem'] for x in ev['chapterList']) if h}
            if cand and all(cand.values()):
                best = None
                for anchor in next(iter(cand.values())):
                    pick = [min(v, key=lambda cid: abs(serial(cid) - serial(anchor))) for v in cand.values()]
                    spread = max(map(serial, pick)) - min(map(serial, pick))
                    if best is None or spread < best[0]:
                        best = (spread, pick)
                cards = sorted(best[1], key=serial)
                ev['inferred'].append('banner cards = chapter holomems\' closest-numbered 5-star cards')
        elif ev is newest and new_cards:
            cards = sorted(new_cards, key=serial)
            ev['inferred'].append('banner cards = 5-star cards new in this dump')
        ev['bannerCards'] = cards

    # Merge with the existing file.
    out_path = os.path.join(site, 'data', 'events.json')
    old = {}
    if os.path.exists(out_path):
        old = {e['id']: e for e in json.load(open(out_path, encoding='utf-8')).get('events', [])}
    by_char = {c['cardId']: c['characterId'] for c in members}
    result = []
    for ev in sorted(events.values(), key=lambda e: (e['start'] or '9999', e['id'])):
        prev = old.get(ev['id'], {})
        if prev.get('verified'):
            if 'endAt' not in prev:  # timing only; keep the key right after 'end'
                prev = {k2: v2 for k, v in prev.items() for k2, v2 in ([(k, v), ('endAt', ev['endAt'])] if k == 'end' else [(k, v)])}
            result.append(prev)
            continue
        member_pct, holomem_pct = DEFAULT_BONUS[ev['type']]
        banner_cards = ev['bannerCards'] or prev.get('bannerCards', [])
        if ev['type'] == 'spotlight':
            holomems = [x['holomem'] for x in ev['chapterList'] if x['holomem']]
        else:
            holomems = sorted({by_char[c] for c in banner_cards if c in by_char})
        result.append({
            'id': ev['id'],
            'name': ev['name'],
            'type': ev['type'],
            'start': ev['start'],
            'end': ev['end'],
            'endAt': ev['endAt'],
            'chapters': ev['chapterList'],
            'holomems': holomems,
            'banner': gacha_names.get(f'la-gacha_point-pickup-{ev["banner"]}', '').replace(' Gacha Pts', '').replace(' Gacha Pt', '') if ev['banner'] else None,
            'bannerCards': banner_cards,
            'memberBonusPercent': prev.get('memberBonusPercent', member_pct),
            'holomemBonusPercent': prev.get('holomemBonusPercent', holomem_pct),
            'verified': False,
            'inferred': ev['inferred'],
        })
        for key in ('rankingEnd', 'rankingEndAt'):  # hand-entered from the in-game screen - keep
            if prev.get(key):
                result[-1][key] = prev[key]
    doc = {
        'version': 2,
        '_comment': 'Generated by tools/extract_events.py, then checked by hand. Set "verified": true once an event\'s banner cards and bonus % match its in-game bonus screen - the script never changes verified events. type: point_rally | score_challenge | spotlight. Bonuses are per card. Spotlight: the holomem Bonus applies to the chapter being played; Point Rally / Score Challenge: to every banner card holomem.',
        'events': result,
    }
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(doc, f, ensure_ascii=False, indent=2)
        f.write('\n')
    for e in result:
        print(f"{e['id']:<28} {e['type']:<15} {e['start'] or '?':<10} {e['end'] or '?':<10} {len(e['bannerCards'])} cards  {e['name']}" + ('  [verified]' if e.get('verified') else ''))


if __name__ == '__main__':
    sys.exit(main())
