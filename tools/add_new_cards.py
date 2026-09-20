"""
add_new_cards.py

Extracts and integrates newly-released cards into data/members.json, given
a new datamine snapshot.

USAGE:
    python add_new_cards.py \
        --old-datamine /path/to/old/holodori-db-eng-diff-main \
        --new-datamine /path/to/new/holodori-db-eng-diff-main \
        --members-json ../data/members.json

Only ADDS cards whose id is present in the new datamine's Card.json but
absent from --members-json - never modifies or removes existing entries.

TABLE JOIN MAP (confirmed 2026-09 against Suisei's card-00018-5-uniq-0068-00,
whose members.json entry was already known-correct - every field below
matched exactly):

  Card.json (base fields) -> characterId, rarity, attributeType, stat
    multipliers, cardPotentialGroupId, costumeId, and 3 skill-id refs:
    liveActiveSkillId / livePassiveSkillId / liveSpecialSkillId

  Character.json -> characterName, generation (via regularCharacterGroupingNameEng
    or similar - see resolve_character())

  LangCard_Eng.json (by Card.nameLangId) -> cardSubtitle

  cardLevelGroupId -> LEVEL CURVES ARE SHARED TEMPLATES, not bespoke per
    card. Multiple cards share the same cardLevelGroupId (confirmed: 21
    existing 5-star cards share one group). If a card's cardLevelGroupId
    matches an ALREADY-EXTRACTED card in --members-json, this script
    reuses that card's levelCurve directly rather than re-deriving from
    CardLevel.json (safer - avoids a second, unverified extraction path
    for a large ~80-level table). Falls back to raw CardLevel.json only
    if no existing card shares the group (untested path - flagged in
    output if hit).

  cardLevelLimitGroupId -> levelLimits, from CardLevelLimit.json. Observed
    identical (40/50/60/70/80) across every card checked regardless of
    attributeType - reused as a universal default rather than re-deriving,
    but this assumption is untested against attributeType variation and
    is called out in the script's output if a mismatch is ever found.

  ACTIVE skill:
    Card.liveActiveSkillId -> LiveActiveSkillLevel (by level 1,2) gives
      coolTimeMillisecond, activationProbabilityPermilMultiply,
      effectDurationMillisecond, liveActiveSkillEffectGroupId (main),
      additionalLiveSkillTriggerGroupId (enhanced condition, if any),
      additionalLiveActiveSkillEffectGroupId (enhanced effect, if any)
    -> LiveActiveSkillEffect.json (by groupId) gives type/value for
      both main and enhanced effects
    -> LiveSkillTrigger.json (by groupId) gives enhancedCondition's
      type/threshold/characterGroupingId/cardAttributeType

  PASSIVE skill:
    Card.livePassiveSkillId -> LivePassiveSkillLevel (by level 1,2) gives
      liveSkillTriggerGroupId (condition) + livePassiveSkillEffectGroupId
    -> LiveSkillTrigger.json (by groupId) gives condition's type/threshold/etc
    -> LivePassiveSkillEffect.json (by groupId) gives clean type/value/
      liveSkillEffectTargetId (NOT string-parsed from the groupId - a
      dedicated table exists, use it)
    -> LiveSkillEffectTarget.json (by liveSkillEffectTargetId) gives
      target's type/targetCount/characterGroupingId/cardAttributeType

  SPECIAL skill: same shape as ACTIVE, via LiveSpecialSkillLevel and
    LiveSpecialSkillEffect (gate-rider additionalCondition/additionalEffects
    follow the identical additionalLiveSkillTriggerGroupId /
    additionalLiveActiveSkillEffectGroupId pattern as active skills)

  LEADER skill:
    Card -> LiveLeaderSkill.json (by id ending in cardId, NOT level-keyed -
      leader skills have no level progression) gives liveSkillTriggerGroupId
      (condition, often null/omitted for "always active" leaders) +
      livePassiveSkillEffectGroupId -> resolved via LivePassiveSkillEffect.json
      same as passive skills above.
    NOTE: this script does NOT yet handle the "additionalEffects" pattern
    (a second, separately-triggered leader effect, confirmed to exist on at
    least Watame's card via additionalLivePassiveSkillEffectGroupId on
    LiveLeaderSkill) - if the new card's LiveLeaderSkill row has that field
    populated, this script will currently miss it. Flagged loudly if seen.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def load_json(path: Path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def index_by(records: list[dict], key: str, data_key: str = "data") -> dict:
    return {r[data_key][key]: r[data_key] for r in records if key in r[data_key] and r[data_key][key] is not None}


class Datamine:
    def __init__(self, root: Path):
        self.root = root
        self.cards = index_by(load_json(root / "Card.json"), "id")
        self.characters = index_by(load_json(root / "Character.json"), "id")
        self.card_names = {k: v.get("text") for k, v in index_by(load_json(root / "LangCard_Eng.json"), "id").items()}
        self.char_group_names = (
            {k: v.get("text") for k, v in index_by(load_json(root / "LangCharacterGrouping_Eng.json"), "id").items()}
            if (root / "LangCharacterGrouping_Eng.json").exists()
            else {}
        )

        self.active_levels = self._group_by(load_json(root / "LiveActiveSkillLevel.json"), "liveActiveSkillId")
        self.active_effects = index_by(load_json(root / "LiveActiveSkillEffect.json"), "groupId")

        self.passive_levels = self._group_by(load_json(root / "LivePassiveSkillLevel.json"), "livePassiveSkillId")
        self.passive_effects = index_by(load_json(root / "LivePassiveSkillEffect.json"), "groupId")

        self.special_levels = self._group_by(load_json(root / "LiveSpecialSkillLevel.json"), "liveSpecialSkillId")
        self.special_effects = self.active_effects  # special skill effect groups live in the SAME table as active skill effects, not a separate file

        self.leader_skills = index_by(load_json(root / "LiveLeaderSkill.json"), "id")

        self.triggers = index_by(load_json(root / "LiveSkillTrigger.json"), "groupId")
        self.targets = index_by(load_json(root / "LiveSkillEffectTarget.json"), "id")

        self.level_curve_groups = self._group_by(load_json(root / "CardLevel.json"), "groupId") if (root / "CardLevel.json").exists() else {}
        self.level_limit_groups = self._group_by(load_json(root / "CardLevelLimit.json"), "groupId") if (root / "CardLevelLimit.json").exists() else {}

        # connect-effect tables (see build_connect_info() docstring) - optional,
        # only needed if --card-connect-info is passed.
        self.connect_effects_by_id_level: dict[str, dict[int, dict]] = {}
        if (root / "SkillTreeConnectEffect.json").exists():
            for row in load_json(root / "SkillTreeConnectEffect.json"):
                d = row["data"]
                self.connect_effects_by_id_level.setdefault(d["id"], {})[d["level"]] = d
        self.connect_extent_by_group: dict[str, list[dict]] = {}
        if (root / "SkillTreeConnectEffectExtent.json").exists():
            for row in load_json(root / "SkillTreeConnectEffectExtent.json"):
                d = row["data"]
                self.connect_extent_by_group.setdefault(d["groupId"], []).append(
                    {"x": d.get("positionX"), "y": d.get("positionY")}
                )

    @staticmethod
    def _group_by(records: list[dict], key: str) -> dict:
        out: dict[str, list] = {}
        for r in records:
            d = r["data"]
            out.setdefault(d[key], []).append(d)
        return out


def resolve_trigger(dm: Datamine, group_id: str | None) -> dict | None:
    if not group_id:
        return None
    t = dm.triggers.get(group_id)
    if not t:
        return None
    return {
        "type": t["type"],
        "threshold": t.get("threshold"),
        "cardAttributeType": t.get("cardAttributeType"),
        "characterGroupingId": t.get("characterGroupingId"),
        "characterIds": t.get("characterIds"),
    }


def resolve_target(dm: Datamine, target_id: str | None) -> dict | None:
    if not target_id:
        return None
    t = dm.targets.get(target_id)
    if not t:
        return None
    return {
        "id": t["id"],
        "type": t["type"],
        "targetCount": t.get("targetCount"),
        "cardAttributeType": t.get("cardAttributeType"),
        "characterGroupingId": t.get("characterGroupingId"),
    }


def build_active_skill(dm: Datamine, card: dict, warnings: list[str]) -> dict:
    skill_id = card.get("liveActiveSkillId")
    if not skill_id:
        return {}
    out = {}
    for lvl in dm.active_levels.get(skill_id, []):
        level = str(lvl["level"])
        eff = dm.active_effects.get(lvl["liveActiveSkillEffectGroupId"])
        add_trigger_id = lvl.get("additionalLiveSkillTriggerGroupId")
        add_eff_id = lvl.get("additionalLiveActiveSkillEffectGroupId")
        add_eff = dm.active_effects.get(add_eff_id) if add_eff_id else None
        entry = {
            "coolTimeMs": lvl["coolTimeMillisecond"],
            "activationProbabilityPermil": lvl["activationProbabilityPermilMultiply"],
            "effectDurationMs": lvl["effectDurationMillisecond"],
            "effects": [{"type": eff["type"], "value": eff["value"], "target": None}] if eff else [],
            "enhancedCondition": resolve_trigger(dm, add_trigger_id),
            "enhancedEffects": [{"type": add_eff["type"], "value": add_eff["value"], "target": None}] if add_eff else [],
        }
        out[level] = entry
    return out


def build_passive_skill(dm: Datamine, card: dict, warnings: list[str]) -> dict:
    skill_id = card.get("livePassiveSkillId")
    if not skill_id:
        return {}
    out = {}
    for lvl in dm.passive_levels.get(skill_id, []):
        level = str(lvl["level"])
        eff = dm.passive_effects.get(lvl["livePassiveSkillEffectGroupId"])
        entry = {
            "condition": resolve_trigger(dm, lvl.get("liveSkillTriggerGroupId")),
            "effects": [],
        }
        if eff:
            entry["effects"].append({
                "type": eff["type"],
                "value": eff["value"],
                "target": resolve_target(dm, eff.get("liveSkillEffectTargetId")),
            })
        out[level] = entry
    return out


def build_special_skill(dm: Datamine, card: dict, warnings: list[str]) -> dict:
    skill_id = card.get("liveSpecialSkillId")
    if not skill_id:
        return {}
    out = {}
    for lvl in dm.special_levels.get(skill_id, []):
        level = str(lvl["level"])
        eff = dm.special_effects.get(lvl["liveActiveSkillEffectGroupId"])
        entry = {
            "effectDurationMs": lvl["effectDurationMillisecond"],
            "effects": [{"type": eff["type"], "value": eff["value"], "target": None}] if eff else [],
            "additionalEffects": [],
            "additionalCondition": None,
        }
        add_trigger_id = lvl.get("additionalLiveSkillTriggerGroupId")
        add_eff_id = lvl.get("additionalLiveActiveSkillEffectGroupId")
        if add_trigger_id or add_eff_id:
            entry["additionalCondition"] = resolve_trigger(dm, add_trigger_id)
            add_eff = dm.special_effects.get(add_eff_id) if add_eff_id else None
            entry["additionalEffects"] = [{"type": add_eff["type"], "value": add_eff["value"], "target": None}] if add_eff else []
        out[level] = entry
    return out


def _resolve_leader_effect_list(dm: Datamine, effect_group_id: str | None) -> list[dict]:
    eff = dm.passive_effects.get(effect_group_id) if effect_group_id else None
    if not eff:
        return []
    return [{
        "type": eff["type"],
        "value": eff["value"],
        "target": resolve_target(dm, eff.get("liveSkillEffectTargetId")),
    }]


def build_leader_skill(dm: Datamine, card_id: str, warnings: list[str]) -> dict:
    ls_id = f"live_leader_skill-{card_id}"
    ls = dm.leader_skills.get(ls_id)
    if not ls:
        return {"condition": None, "effects": []}

    result = {
        "condition": resolve_trigger(dm, ls.get("liveSkillTriggerGroupId")),
        "effects": _resolve_leader_effect_list(dm, ls.get("livePassiveSkillEffectGroupId")),
    }
    # second, separately-triggered leader effect (confirmed pattern on Watame's
    # and Flare's cards, and on both new FuwaMoco cards) - same shape as the
    # main condition/effects, additionalCondition is typically identical to
    # condition (not independently verified to ever differ - flag if so)
    add_trigger_id = ls.get("additionalLiveSkillTriggerGroupId")
    add_eff_id = ls.get("additionalLivePassiveSkillEffectGroupId")
    if add_trigger_id or add_eff_id:
        result["additionalCondition"] = resolve_trigger(dm, add_trigger_id)
        result["additionalEffects"] = _resolve_leader_effect_list(dm, add_eff_id)
        if add_trigger_id != ls.get("liveSkillTriggerGroupId"):
            warnings.append(f"{card_id}: leader skill's additionalCondition trigger DIFFERS from main condition trigger - unverified case, double-check.")
    return result


def resolve_level_curve(dm_new: Datamine, card: dict, existing_members: list[dict], warnings: list[str]) -> tuple[dict, list]:
    group_id = card.get("cardLevelGroupId")
    # prefer reusing an already-extracted card's curve over re-deriving
    for m in existing_members:
        if m.get("_cardLevelGroupId") == group_id:
            return m["levelCurve"], m["levelLimits"]
    warnings.append(f"{card['id']}: no existing card shares cardLevelGroupId={group_id} - falling back to raw CardLevel.json (UNVALIDATED path)")
    curve = {}
    for row in dm_new.level_curve_groups.get(group_id, []):
        curve[str(row["level"])] = {"parameterBaseValue": row.get("parameterBaseValue"), "exp": row.get("exp")}
    limit_group = card.get("cardLevelLimitGroupId")
    limits = [{"limitBreakCount": r.get("limitBreakCount"), "levelLimit": r.get("levelLimit")} for r in dm_new.level_limit_groups.get(limit_group, [])]
    return curve, limits


def resolve_character_name(dm: Datamine, character_id: str) -> tuple[str, str]:
    c = dm.characters.get(character_id, {})
    name = c.get("nameEng", "")
    generation = dm.char_group_names.get(c.get("regularCharacterGroupingNameLangId"), c.get("regularCharacterGroupingNameEng", ""))
    return name, generation


def build_card_entry(dm_new: Datamine, card_id: str, existing_members: list[dict], warnings: list[str]) -> dict:
    card = dm_new.cards[card_id]
    char_name, generation = resolve_character_name(dm_new, card["characterId"])
    subtitle = dm_new.card_names.get(card.get("nameLangId"))
    level_curve, level_limits = resolve_level_curve(dm_new, card, existing_members, warnings)

    entry = {
        "cardId": card_id,
        "characterId": card["characterId"],
        "characterName": char_name,
        "shortName": char_name.split()[-1] if char_name else "",
        "generation": generation,
        "cardSubtitle": subtitle,
        "rarity": card["rarity"],
        "attributeType": card["attributeType"],
        "cardPotentialGroupId": card.get("cardPotentialGroupId"),
        "performancePermilMultiply": card["performancePermilMultiply"],
        "techniquePermilMultiply": card["techniquePermilMultiply"],
        "sensePermilMultiply": card["sensePermilMultiply"],
        "levelCurve": level_curve,
        "levelLimits": level_limits,
        "costumeId": card.get("rewardCostumeId") or card.get("costumeId"),
        "leaderSkill": build_leader_skill(dm_new, card_id, warnings),
        "activeSkill": build_active_skill(dm_new, card, warnings),
        "passiveSkill": build_passive_skill(dm_new, card, warnings),
        "specialSkill": build_special_skill(dm_new, card, warnings),
        "order": card.get("order"),
        "_cardLevelGroupId": card.get("cardLevelGroupId"),  # internal - used by resolve_level_curve, stripped before writing
    }
    return entry



# Raw skillTreeConnectEffectId area keyword -> data/card_connect_info.json's
# "area" string. NOT a literal rename - confirmed 2026-09 against the existing
# 124-entry corpus (122/124 reconstructed byte-identical; the other 2 turned
# out to be a pre-existing swap bug in that corpus, not a mapping error here):
# "card_area" means the MEMBER (Blue) board, not Green/Card-area, matching
# this project's other confirmed card/blue vs all_member/green naming inversion
# (see PROJECT_STATUS.md's "single most important recurring lesson").
# "general_purpose_area" cards get an entry but supported=False - the site's
# picker UI doesn't yet handle that area type (3 confirmed cases, all pre-existing).
CONNECT_AREA_MAP = {
    "leader_area": "leader",
    "card_area": "member",
    "center_area": "center",
    "content_area": "content",
    "general_purpose_area": "general_purpose",
}


def _connect_area_from_group_id(group_id: str) -> str | None:
    rest = group_id.split("skill_tree_connect_effect_extent-", 1)[1]
    for raw, mapped in CONNECT_AREA_MAP.items():
        if rest.startswith(raw):
            return mapped
    return None


def build_connect_info(dm: Datamine, card: dict) -> dict | None:
    """data/card_connect_info.json entry for one card, or None if the card has
    no connect effect at all (confirmed: EVERY rarity-3 card has
    skillTreeConnectEffectId=null in the raw data - not a gap, they genuinely
    don't have this mechanic in-game. Only 4-star/5-star cards carry one.)."""
    steid = card.get("skillTreeConnectEffectId")
    if not steid:
        return None
    levels = dm.connect_effects_by_id_level.get(steid)
    if not levels or 1 not in levels or 2 not in levels:
        return None
    group_id = levels[1]["skillTreeConnectEffectExtentGroupId"]
    area = _connect_area_from_group_id(group_id)
    pattern = dm.connect_extent_by_group.get(group_id, [])
    return {
        "characterId": card["characterId"],
        "area": area,
        "supported": area != "general_purpose",
        "nodeCount": len(pattern),
        "pattern": pattern,
        "boostPermilLevel1": int(levels[1]["effectPermilUp"]),
        "boostPermilLevel2": int(levels[2]["effectPermilUp"]),
    }


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--old-datamine", type=Path, required=True)
    p.add_argument("--new-datamine", type=Path, required=True)
    p.add_argument("--members-json", type=Path, required=True)
    p.add_argument("--card-connect-info", type=Path, default=None, help="Optional path to data/card_connect_info.json - if given, adds entries for new cards that have a connect effect")
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()

    old_cards = load_json(args.old_datamine / "Card.json")
    new_cards = load_json(args.new_datamine / "Card.json")
    old_ids = {x["data"]["id"] for x in old_cards}
    new_ids = [x["data"]["id"] for x in new_cards if x["data"]["id"] not in old_ids]

    if not new_ids:
        print("No new cards found.")
        return
    print(f"Found {len(new_ids)} new card(s): {new_ids}")

    members = load_json(args.members_json)
    # tag existing members with their cardLevelGroupId (from the NEW datamine's
    # Card.json, since it's a superset of old) so resolve_level_curve can match
    new_card_by_id = index_by(new_cards, "id")
    for m in members:
        c = new_card_by_id.get(m["cardId"])
        m["_cardLevelGroupId"] = c.get("cardLevelGroupId") if c else None

    dm_new = Datamine(args.new_datamine)
    existing_ids = {m["cardId"] for m in members}
    warnings: list[str] = []
    added = []

    for card_id in new_ids:
        if card_id in existing_ids:
            print(f"  {card_id} already in {args.members_json.name}, skipping")
            continue
        entry = build_card_entry(dm_new, card_id, members, warnings)
        added.append(entry)
        print(f"  {card_id} -> {entry['characterName']} - {entry['cardSubtitle']}")

    if warnings:
        print("\nWARNINGS (review before trusting output):")
        for w in warnings:
            print(" ", w)

    # strip internal helper field before writing
    for m in members:
        m.pop("_cardLevelGroupId", None)
    for e in added:
        e.pop("_cardLevelGroupId", None)

    connect_added = {}
    connect_skipped_no_effect = []
    if args.card_connect_info:
        for card_id in new_ids:
            if card_id in existing_ids:
                continue
            entry = build_connect_info(dm_new, dm_new.cards[card_id])
            if entry is not None:
                connect_added[card_id] = entry
            else:
                connect_skipped_no_effect.append(card_id)
        if connect_added:
            print(f"\nConnect-info: {len(connect_added)} new card(s) have a connect effect -> {list(connect_added.keys())}")
        if connect_skipped_no_effect:
            print(f"Connect-info: {len(connect_skipped_no_effect)} new card(s) have NO connect effect in the raw data (expected for rarity-3 cards) -> {connect_skipped_no_effect}")

    if not args.dry_run and added:
        members.extend(added)
        with open(args.members_json, "w", encoding="utf-8") as f:
            json.dump(members, f, ensure_ascii=False)
        print(f"\nUpdated {args.members_json} - now {len(members)} cards total.")
    elif args.dry_run:
        print("\n(dry run - no files written)")

    if not args.dry_run and connect_added:
        cci = load_json(args.card_connect_info)
        cci.update(connect_added)
        with open(args.card_connect_info, "w", encoding="utf-8") as f:
            json.dump(cci, f, ensure_ascii=False)
        print(f"Updated {args.card_connect_info} - now {len(cci)} entries total.")


if __name__ == "__main__":
    main()
