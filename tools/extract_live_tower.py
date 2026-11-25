#!/usr/bin/env python3
"""
Regenerate data/live_tower.json (the Challenge Live page) from a datamine export.

    python3 tools/extract_live_tower.py <datamine dir> [--site <site root>]

Source tables (first seen in "main 14", 2026-11-25):
- LiveTower.json: one permanent tower, `live_tower-default-001` (startTime = 2026-11-25 05:00 SGT).
- LiveTowerStage.json: one row per floor ("Stage" in-game), 100 floors:
  - musicIds: the floor's candidate songs ("Set Pieces"). Reaching the Target Score on ANY one of
    them clears the floor (in-game help). The player picks the difficulty freely ("Take on the
    challenge at any difficulty you like!", tutorial text) - there is no difficulty field.
  - clearScore: the Target Score.
  - bonusCharacterIds + bonusCharacterScoreUpPermilUp: "Bonus Members". User-confirmed
    2026-11-25: the bonus is per holomem in the 5 unit members (the leader does NOT count) and
    stacks. Help text: the bonus shows as "+value" under the Unit Score and is not part of the
    Unit Score shown or recorded as a song's High Score.
  - liveDeckEvaluationValueBenchmarkThresholdS/A/B: Unit Score benchmarks for the floor's S/A/B
    unit rating. Setting.json liveTowerLiveDeckEvaluationValueBenchmark{S,A,B}PermilMultiply =
    1180 / 910 / 700 of a per-floor base, rounded to 500 (RequirementUnit) - e.g. floor 1 base
    610,000 -> 719,500 / 555,000 / 427,000. Stored as given; the base itself is not needed.
  - isSkipDisabled: the floor can't be skipped ("Rainbow-colored Stages are mandatory"). Players
    who greatly exceed the Target Score may skip other floors; the skip rule is not in the data.
  - clearRewards: resolved to display names via Item.json/LangItem_Eng.json (Red Diamonds for
    RESOURCE_TYPE_STONE_TOTAL, per LangResourceTypeDetail).
Floors are written sorted by number (the raw table is not in floor order).
"""
import argparse
import datetime as dt
import json
import os
import sys

SGT = dt.timezone(dt.timedelta(hours=8))


def load(dirpath, name):
    with open(os.path.join(dirpath, name), encoding='utf-8') as f:
        return json.load(f)


def rows(dirpath, name):
    return [r.get('data', r) for r in load(dirpath, name)]


def lang(dirpath, name):
    return {r['id']: r.get('text') for r in rows(dirpath, name)}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('datamine')
    ap.add_argument('--site', default=os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
    args = ap.parse_args()
    dm = args.datamine

    towers = rows(dm, 'LiveTower.json')
    stages = rows(dm, 'LiveTowerStage.json')
    settings = rows(dm, 'Setting.json')[0]

    items = {r['id']: r for r in rows(dm, 'Item.json')}
    item_names = lang(dm, 'LangItem_Eng.json')
    type_names = lang(dm, 'LangResourceTypeDetail_Eng.json')

    site_music = {s['id'] for s in json.load(open(os.path.join(args.site, 'data', 'music.json'), encoding='utf-8'))}
    site_chars = {c['characterId'] for c in json.load(open(os.path.join(args.site, 'data', 'members.json'), encoding='utf-8'))}

    def reward(r):
        rtype = r['resourceType'].replace('ResourceType_RESOURCE_TYPE_', '')
        rid = r.get('resourceId')
        if rtype == 'ITEM' and rid in items:
            name = item_names.get(items[rid].get('nameLangId')) or rid
        elif rtype == 'STONE_TOTAL':
            name = type_names.get('la-resource_type_detail-stone_total-name') or 'Diamonds'
        else:
            name = rid or rtype
        return {'type': rtype, 'id': rid, 'name': name, 'quantity': int(r['quantity'])}

    out_towers = []
    problems = []
    for t in sorted(towers, key=lambda t: t.get('priority', 0), reverse=True):
        floors = []
        for s in sorted((s for s in stages if s['liveTowerId'] == t['id']), key=lambda s: s['number']):
            for m in s['musicIds']:
                if m not in site_music:
                    problems.append(f"floor {s['number']}: song {m} not in music.json (run add_new_songs.py)")
            for c in s['bonusCharacterIds']:
                if c not in site_chars:
                    problems.append(f"floor {s['number']}: holomem {c} not in members.json")
            floors.append(
                {
                    'number': s['number'],
                    'musicIds': s['musicIds'],
                    'clearScore': int(s['clearScore']),
                    'thresholds': {
                        'S': int(s['liveDeckEvaluationValueBenchmarkThresholdS']),
                        'A': int(s['liveDeckEvaluationValueBenchmarkThresholdA']),
                        'B': int(s['liveDeckEvaluationValueBenchmarkThresholdB']),
                    },
                    'bonusCharacterIds': s['bonusCharacterIds'],
                    'bonusPermil': s['bonusCharacterScoreUpPermilUp'],
                    'mandatory': bool(s.get('isSkipDisabled')),
                    'rewards': [reward(r) for r in s.get('clearRewards', [])],
                }
            )
        nums = [f['number'] for f in floors]
        if nums != list(range(1, len(nums) + 1)):
            problems.append(f"{t['id']}: floor numbers are not 1..{len(nums)}")
        out_towers.append(
            {
                'id': t['id'],
                'type': t.get('type', '').replace('LiveTowerType_LIVE_TOWER_TYPE_', '').lower(),
                'start': dt.datetime.fromtimestamp(int(t['startTime']) / 1000, dt.timezone.utc).astimezone(SGT).isoformat(),
                'floors': floors,
            }
        )

    out = {
        'version': 1,
        'benchmarkPermil': {
            'S': settings.get('liveTowerLiveDeckEvaluationValueBenchmarkSPermilMultiply'),
            'A': settings.get('liveTowerLiveDeckEvaluationValueBenchmarkAPermilMultiply'),
            'B': settings.get('liveTowerLiveDeckEvaluationValueBenchmarkBPermilMultiply'),
        },
        'towers': out_towers,
    }
    path = os.path.join(args.site, 'data', 'live_tower.json')
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write('\n')
    total = sum(len(t['floors']) for t in out_towers)
    print(f'wrote {path}: {len(out_towers)} tower(s), {total} floors')
    for p in problems:
        print('WARNING:', p, file=sys.stderr)
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main())
