#!/usr/bin/env python3
"""
Extract every Holomem Board node's MATERIAL cost (Cubes / Hexas per color),
position and effect text into data/board_materials.json - the data behind the
standalone Materials page (js/materialsPage.js).

Usage:
    python3 tools/extract_board_materials.py <datamine_dir> [<out.json>]

<datamine_dir> is the unzipped holodori-db-eng-diff-main folder. Output
defaults to data/board_materials.json relative to the repo root.

CONFIRMED STRUCTURE (2026-11-14, "main 13" datamine):
  - The whole board (Red + Blue + Green + Yellow + connector slots) is ONE grid
    of 154 nodes per layout. There are 4 layouts, tree-model-001..004
    (SkillTreeNodePosition.json), chosen per character by
    Character.json's skillTreeNodePositionGroupId. 001/003 (and 002/004)
    differ only in the Red area; 001 vs 002 mirror Blue/Yellow left/right.
    (board_categories.json's greenYellowVariant collapses 003->001 and
    004->002, which is right for Green/Yellow but NOT for Red - this file
    keeps the real model.)
  - A node's area is its groupId prefix: R- Red (leader), B- Blue (member),
    G- Green (ALL_MEMBER), Y- Yellow (content), S- connector slot (S-001 is
    the center; the other 3 are the Red/Blue/Yellow connect anchors, which
    cost nothing).
  - Costs (consumptions + consumptionSkillTreePointQuantity) depend only on
    the node's groupId - identical for every character (asserted below).
  - Effects are per layout, except a few groups that have extra rows with
    `characterIds` (the Green gen-boost nodes and some Yellow nodes): those
    are written as per-character overrides.

Materials (Item ids -> in-game names, from LangItem_Eng.json):
  item-skill_tree_leader-1/-2     Red Cube / Red Hexa
  item-skill_tree_card-1/-2       Blue Cube / Blue Hexa
  item-skill_tree_allmember-1/-2  Green Cube / Green Hexa
  item-skill_tree_content-1/-2    Yellow Cube / Yellow Hexa
"""
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

AREA_BY_PREFIX = {'R': 'red', 'B': 'blue', 'G': 'green', 'Y': 'yellow'}
MATERIALS = {
    'item-skill_tree_leader-1': ('red', 'cube'),
    'item-skill_tree_leader-2': ('red', 'hexa'),
    'item-skill_tree_card-1': ('blue', 'cube'),
    'item-skill_tree_card-2': ('blue', 'hexa'),
    'item-skill_tree_allmember-1': ('green', 'cube'),
    'item-skill_tree_allmember-2': ('green', 'hexa'),
    'item-skill_tree_content-1': ('yellow', 'cube'),
    'item-skill_tree_content-2': ('yellow', 'hexa'),
}
EFFECT_PREFIX = 'SkillTreeEffectType_SKILL_TREE_EFFECT_TYPE_'


def load(dm, name):
    with open(dm / name, encoding='utf-8') as f:
        return json.load(f)


def lang_map(dm, *names):
    out = {}
    for name in names:
        p = dm / name
        if p.exists():
            for row in load(dm, name):
                out[row['id']] = row['data'].get('text')
    return out


def effect_text(eff, lang):
    if not eff:
        return None
    text = lang.get(eff.get('descriptionLangId')) or lang.get(eff.get('nameLangId'))
    if not text:
        return eff['effectType'].replace(EFFECT_PREFIX, '')
    value = eff.get('value')
    if value is not None:
        v = int(value)
        text = text.replace('[value/10]', f'{v / 10:g}').replace('[value]', str(v))
    return text.replace('[character]', 'this holomem')


def effect_icon(eff):
    """Icon name convention used by images/board_icons/: the short effect
    type, plus -solo/-group/-all for the Yellow score-bonus nodes."""
    if not eff:
        return None
    short = eff['effectType'].replace(EFFECT_PREFIX, '')
    if short.startswith('LIVE_SCORE_BONUS_ADD_PERMIL_UP_BY_MUSIC'):
        m = re.search(r'music_singer_type-(solo|group|all)', eff['id'])
        if m:
            return f'{short}-{m.group(1)}'
    return short


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    dm = Path(sys.argv[1])
    repo = Path(__file__).resolve().parent.parent
    out_path = Path(sys.argv[2]) if len(sys.argv) > 2 else repo / 'data' / 'board_materials.json'

    effects = {e['id']: e['data'] for e in load(dm, 'SkillTreeEffect.json')}
    lang = lang_map(dm, 'LangGeneratedSkillTreeEffect_Eng.json', 'LangSkillTreeEffect_Eng.json')
    item_lang = lang_map(dm, 'LangItem_Eng.json')
    grp_lang = lang_map(dm, 'LangCharacterGrouping_Eng.json')
    characters = {c['id']: c['data'] for c in load(dm, 'Character.json')}

    # positions per layout
    positions = defaultdict(dict)
    for row in load(dm, 'SkillTreeNodePosition.json'):
        d = row['data']
        positions[d['groupId']][d['skillTreeNodeGroupId']] = (d.get('positionX', 0), d.get('positionY', 0))

    # node rows: one default row per group (no characterIds) + per-character rows
    default_row = {}
    char_rows = defaultdict(dict)  # groupId -> {characterId: row}
    cost_by_group = {}
    for row in load(dm, 'SkillTreeNode.json'):
        g = row['group_id']
        d = row['data']
        cost = (
            d.get('consumptionSkillTreePointQuantity', 0),
            tuple(sorted((c['resourceId'], int(c['quantity'])) for c in d.get('consumptions', []))),
        )
        if g in cost_by_group and cost_by_group[g] != cost:
            sys.exit(f'{g}: cost differs between rows ({cost_by_group[g]} vs {cost}) - per-character costs need handling')
        cost_by_group[g] = cost
        if d.get('characterIds'):
            for cid in d['characterIds']:
                char_rows[g][cid] = d
        else:
            default_row.setdefault(g, d)

    def first_row(g):
        return default_row.get(g) or next(iter(char_rows[g].values()), None)

    models = {}
    for model, pos in sorted(positions.items()):
        # classify connector slots by their neighbours' area
        at = {xy: g for g, xy in pos.items()}
        nodes = []
        for g, (x, y) in sorted(pos.items(), key=lambda t: t[0]):
            if g == 'S-001':
                continue  # center
            prefix = g[0]
            if prefix == 'S':
                neighbours = [at.get((x + dx, y + dy), '') for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))]
                areas = {AREA_BY_PREFIX[n[0]] for n in neighbours if n and n[0] in AREA_BY_PREFIX}
                if len(areas) != 1:
                    sys.exit(f'{model} {g}: cannot tell which area this connector belongs to ({areas})')
                nodes.append({'id': g, 'x': x, 'y': y, 'area': areas.pop(), 'kind': 'connector',
                              'grade': 1, 'points': 0, 'cost': {}})
                continue
            row = first_row(g)
            if row is None:
                sys.exit(f'{model} {g}: positioned node has no SkillTreeNode row')
            points, consumptions = cost_by_group[g]
            for item_id, _ in consumptions:
                if item_id not in MATERIALS:
                    sys.exit(f'{g}: unknown material {item_id}')
                if MATERIALS[item_id][0] != AREA_BY_PREFIX[prefix]:
                    sys.exit(f'{g}: {item_id} does not match area {AREA_BY_PREFIX[prefix]}')
            # groups that only have per-character rows (the Green gen-boost
            # nodes) get their effect from characterOverrides, not here
            eff = effects.get(default_row[g].get('skillTreeEffectId')) if g in default_row else None
            node = {
                'id': g,
                'x': x,
                'y': y,
                'area': AREA_BY_PREFIX[prefix],
                'kind': 'node',
                'grade': row.get('grade', 1),
                'points': points,
                'cost': {item_id: qty for item_id, qty in consumptions},
                'effect': effect_text(eff, lang),
                'icon': effect_icon(eff),
            }
            nodes.append(node)
        models[model] = nodes

    # per-character overrides (effect text only - costs are per group)
    overrides = defaultdict(dict)
    for g, rows in char_rows.items():
        for cid, d in rows.items():
            eff = effects.get(d.get('skillTreeEffectId'))
            overrides[cid][g] = {'effect': effect_text(eff, lang), 'icon': effect_icon(eff)}

    chars = {}
    for cid, c in sorted(characters.items()):
        model = c.get('skillTreeNodePositionGroupId')
        if not model:
            continue  # not playable / no board yet
        groups = c.get('regularCharacterGroupingIds') or []
        chars[cid] = {
            'name': c.get('nameEng') or cid,
            'model': model,
            'groups': [grp_lang.get(f'la-{gid}', gid) for gid in groups],
        }

    materials = {}
    for item_id, (color, tier) in MATERIALS.items():
        materials[item_id] = {
            'name': item_lang.get(f'la-{item_id.replace("item-", "item-", 1)}-name')
            or item_lang.get(f'la-{item_id}-name')
            or f'{color.title()} {tier.title()}',
            'color': color,
            'tier': tier,
        }

    out = {
        'materials': materials,
        'models': models,
        'characters': chars,
        'characterOverrides': {cid: overrides[cid] for cid in sorted(overrides) if cid in chars},
    }
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
        f.write('\n')

    totals = defaultdict(int)
    for n in models[next(iter(models))]:
        for k, v in n['cost'].items():
            totals[k] += v
    print(f'{len(chars)} characters, {len(models)} layouts, {len(models[next(iter(models))])} nodes each')
    print('full-board cost (one holomem):', {materials[k]['name']: v for k, v in totals.items()})


if __name__ == '__main__':
    main()
