#!/usr/bin/env python3
"""
Extract the per-character Green-board "gen boost" nodes
(ALL_PARAMETER_UP_FOR_CHARACTER_GROUPING) from a datamine export into
data/green_yellow_board.json.

Usage:
    python3 tools/extract_green_grouping_nodes.py <datamine_dir> [<green_yellow_board.json>]

<datamine_dir> is the unzipped holodori-db-eng-diff-main folder (the one that
contains SkillTreeNode.json). The board file defaults to
data/green_yellow_board.json relative to the repo root.

WHY THIS EXISTS (confirmed 2026-11-14 against the "main 13" datamine AND in-game):
  The Green (ALL_MEMBER) layout is shared between characters (2 templates,
  tree-model-001/002), but the 3 gen-boost nodes G-008 / G-011 / G-021 are
  NOT: SkillTreeNode.json has one row per character for each of them (the
  row's `characterIds` names the owner), and each row's skillTreeEffectId
  names that character's own value and target grouping explicitly. An earlier
  extraction took a single row (Kobo's: 75/225/150 -> grp-indonesia-gen_3) as
  if it were the template value for everyone - that is what made it look like
  "the stored target doesn't match the displayed gen". It never was a dynamic
  resolution; the earlier read just used the wrong character's row.

  Values (all confirmed in-game):
    - gens with 3 members in-game : 75 / 225 / 150   (450 per board)
    - gens with 4+ members        : 50 / 150 / 100   (300 per board)
    - Fubuki (Gen 1 + GAMERS)     : 100 -> Gen 1 / 300 -> GAMERS / 200 -> Gen 1
  Targets are the character's own generation-level grouping (never the
  country-wide grp-indonesia). The boost also applies to the board owner
  herself (confirmed in-game). Each RECIPIENT is capped at 900 total across
  the whole roster (SkillTreeEffectValueLimit.json, limit "900").

What the script writes (idempotent - safe to re-run on every new datamine):
  - variants[*].cardGrouping : the 3 node positions/cost/grade (moved out of
    cardOther the first time this runs; value/target live per character below)
  - characterGroupingNodes   : { characterId: { "G-008": {value, targetGroupingId}, ... } }
  - groupingLabels           : { groupingId: display name } (e.g. "Gen 0", "GAMERS")
  - groupingValueLimit       : the per-recipient cap (900)
"""
import json
import re
import sys
from pathlib import Path

GROUPING_EFFECT = 'SkillTreeEffectType_SKILL_TREE_EFFECT_TYPE_ALL_PARAMETER_UP_FOR_CHARACTER_GROUPING'
ALL_MEMBER = 'SkillTreeNodeType_SKILL_TREE_NODE_TYPE_ALL_MEMBER'
TARGET_PREFIX = 'skill_tree_effect_target-character_grouping-'


def load(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    dm = Path(sys.argv[1])
    repo = Path(__file__).resolve().parent.parent
    board_path = Path(sys.argv[2]) if len(sys.argv) > 2 else repo / 'data' / 'green_yellow_board.json'

    effects = {e['id']: e['data'] for e in load(dm / 'SkillTreeEffect.json')}
    nodes = load(dm / 'SkillTreeNode.json')
    limits = load(dm / 'SkillTreeEffectValueLimit.json')
    lang = {}
    for fname in ('LangGeneratedSkillTreeEffectTarget_Eng.json', 'LangCharacterGrouping_Eng.json'):
        p = dm / fname
        if p.exists():
            for row in load(p):
                lang[row['id']] = row['data'].get('text')

    limit = next(
        (int(l['data']['limit']) for l in limits if l['data']['skillTreeEffectType'] == GROUPING_EFFECT),
        None,
    )

    per_char = {}
    group_ids = set()
    for row in nodes:
        d = row['data']
        if d.get('type') != ALL_MEMBER:
            continue
        eff = effects.get(d.get('skillTreeEffectId'))
        if not eff or eff['effectType'] != GROUPING_EFFECT:
            continue
        target = eff['skillTreeEffectTargetId']
        assert target.startswith(TARGET_PREFIX), target
        grouping_id = target[len(TARGET_PREFIX):]
        group_ids.add(row['group_id'])
        for cid in d.get('characterIds') or []:
            per_char.setdefault(cid, {})[row['group_id']] = {
                'value': int(eff['value']),
                'targetGroupingId': grouping_id,
            }

    labels = {}
    for cid_nodes in per_char.values():
        for n in cid_nodes.values():
            gid = n['targetGroupingId']
            labels[gid] = (
                lang.get(f'la-generated-skill_tree_effect_target-character_grouping-{gid}-description')
                or lang.get(f'la-{gid}')
                or gid
            )

    board = load(board_path)
    for vname, variant in board['variants'].items():
        other = variant.get('cardOther', [])
        moved = [n for n in other if n['nodeGroupId'] in group_ids]
        keep = [n for n in other if n['nodeGroupId'] not in group_ids]
        existing = {n['nodeGroupId']: n for n in variant.get('cardGrouping', [])}
        for n in moved:
            existing[n['nodeGroupId']] = {
                'nodeGroupId': n['nodeGroupId'],
                'x': n['x'],
                'y': n['y'],
                'grade': n['grade'],
                'cost': n['cost'],
                'effectType': GROUPING_EFFECT,
            }
        missing = group_ids - set(existing)
        if missing:
            sys.exit(f'{vname}: no position for gen-boost node(s) {sorted(missing)} - add them to cardGrouping by hand')
        variant['cardOther'] = keep
        variant['cardGrouping'] = sorted(existing.values(), key=lambda n: n['nodeGroupId'])

    board['characterGroupingNodes'] = dict(sorted(per_char.items()))
    board['groupingLabels'] = dict(sorted(labels.items()))
    board['groupingValueLimit'] = limit

    with open(board_path, 'w', encoding='utf-8') as f:
        json.dump(board, f, ensure_ascii=False, indent=2)
        f.write('\n')

    print(f'{len(per_char)} characters, nodes {sorted(group_ids)}, cap {limit}')
    for cid, ns in sorted(per_char.items()):
        print(' ', cid, ' '.join(f"{g}={n['value']}->{n['targetGroupingId']}" for g, n in sorted(ns.items())))


if __name__ == '__main__':
    main()
