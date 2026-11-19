"""
Builds data/rank_achievements.json for the Holomem Rank Calculator page
(js/rankCalc.js + js/rankPage.js) from a datamine export.

Usage:
    python tools/extract_rank_achievements.py \
        --datamine /path/to/holodori-db-eng-diff-main \
        --board-materials data/board_materials.json \
        --out data/rank_achievements.json

Re-run whenever a new holomem, card, outfit or solo song is added - the
per-holomem "possible today" caps come from the datamine's content counts.

What it encodes (see tools/rank_exp_achievements.py for the analysis version):
  * Rank EXP = MissionProgress.rewardCharacterExpQuantity, found ONLY on
    per-holomem achievement missions (Mission.characterId set, categoryType
    ACHIEVEMENT). Every holomem has the same 25 achievements; the only
    per-holomem difference is which song the "play your own song" one names.
    The script asserts that the template really is identical.
  * CharacterLevel.exp is read as CUMULATIVE total EXP for that rank
    (Rank 1 = 0, Rank 50 = 196). Inferred from consistency, not yet
    screenshot-verified - see PROJECT_STATUS.md open items.
  * caps[key] = the highest threshold the current game content allows for that
    holomem (cards, outfits, solo songs, emotes, board slots). Achievements
    without a cap are grind-only and always reachable in principle.
"""
import argparse, json, re, collections
from pathlib import Path

def load(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)

ap = argparse.ArgumentParser()
ap.add_argument("--datamine", type=Path, required=True)
ap.add_argument("--board-materials", type=Path, required=True)
ap.add_argument("--out", type=Path, required=True)
a = ap.parse_args()
D = a.datamine

missions = {m["id"]: m["data"] for m in load(D / "Mission.json")}
tiers = collections.defaultdict(list)
for p in load(D / "MissionProgress.json"):
    tiers[p["data"]["missionId"]].append(p["data"])
lang = {x["id"]: x["data"].get("text") for x in load(D / "LangMission_Eng.json")}
music_title = {x["id"]: x["data"].get("text") for x in load(D / "LangMusic_Eng.json")}
board = load(a.board_materials)

OWN_SONG = "own_song"
CATEGORY = {
    "increment_character_get_count": "Holomem", "absolute_character_level": "Holomem",
    "absolute_park_emotion_get_count": "Park & Games", "absolute_park_talk_free_unique_count": "Park & Games",
    "increment_work_finish_count": "Park & Games",
    "increment_combo_card_game_same_category_three_card_count": "Park & Games",
}
def category(key):
    if key in CATEGORY: return CATEGORY[key]
    if key == OWN_SONG or "live" in key or "music" in key: return "Live"
    return "Members & Boards"
AUTO = {"increment_character_get_count": "unlock", "absolute_character_level": "rank"}

def tier_list(mid):
    return sorted(({"threshold": int(t["threshold"]), "exp": int(t.get("rewardCharacterExpQuantity", 0))}
                   for t in tiers[mid]), key=lambda t: t["threshold"])

# ---- per-holomem missions ----
per_char = collections.defaultdict(dict)   # ch -> key -> mid
for mid, m in missions.items():
    ch = m.get("characterId")
    if not ch or not m.get("categoryType", "").endswith("ACHIEVEMENT"):
        continue
    key = re.sub(r"^mission-achievement-chr-\d{5}-", "", mid)
    if re.match(r"increment_live_play_count-m\d{4}$", key):
        key = OWN_SONG
    assert key not in per_char[ch], f"{ch}: two missions map to {key}"
    per_char[ch][key] = mid

ref = sorted(per_char)[0]
template_keys = sorted(per_char[ref], key=lambda k: missions[per_char[ref][k]]["order"])
for ch, ms in per_char.items():
    assert set(ms) == set(template_keys), f"{ch} has a different achievement set"
    for k in template_keys:
        assert tier_list(ms[k]) == tier_list(per_char[ref][k]), f"{ch}/{k} tiers differ from template"

achievements = []
for k in template_keys:
    mid = per_char[ref][k]
    label = "As the Leader, play their own song {0} time(s)" if k == OWN_SONG else lang[missions[mid]["descriptionLangId"]]
    entry = {"key": k, "label": label, "category": category(k), "tiers": tier_list(mid)}
    if k in AUTO: entry["auto"] = AUTO[k]
    achievements.append(entry)

# ---- rank curve ----
curve = {1: 0}
for r in load(D / "CharacterLevel.json"):
    if r["data"].get("exp"): curve[r["level"]] = int(r["data"]["exp"])
rank_curve = [{"rank": k, "exp": curve[k]} for k in sorted(curve)]
assert all(rank_curve[i]["exp"] < rank_curve[i + 1]["exp"] for i in range(len(rank_curve) - 1))

# ---- content caps ----
lim, lb_max, pot_max = collections.defaultdict(int), collections.defaultdict(int), collections.defaultdict(int)
for r in load(D / "CardLevelLimit.json"):
    g = r["data"]["groupId"]
    lim[g] = max(lim[g], r["data"]["levelLimit"]); lb_max[g] = max(lb_max[g], r["data"].get("limitBreakCount", 0))
for r in load(D / "CardPotential.json"):
    g = r["data"]["groupId"]; pot_max[g] = max(pot_max[g], r["data"]["upgradeCount"])
cards = collections.defaultdict(list)
for c in load(D / "Card.json"): cards[c["data"]["characterId"]].append(c["data"])
outfits = collections.Counter(c["data"]["characterId"] for c in load(D / "Costume.json"))
emotes = collections.Counter(c["data"].get("characterId") for c in load(D / "ParkEmotion.json"))
solo = collections.Counter()
for m in load(D / "Music.json"):
    d = m["data"]
    if d.get("musicSingerType", "").endswith("SOLO"):
        for ch in d.get("characterIds", []): solo[ch] += 1
board_slots = {ch: len(board["models"][c["model"]]) for ch, c in board["characters"].items()}

characters = {}
for ch in sorted(per_char):
    cs = cards[ch]
    own_mid = per_char[ch][OWN_SONG]
    song_id = missions[own_mid]["targetIds1"][0]
    bc = board["characters"].get(ch, {})
    characters[ch] = {
        "name": bc.get("name") or ch,
        "groups": bc.get("groups", []),
        "ownSong": {"musicId": song_id, "title": music_title.get(f"la-music_title-{song_id}", song_id)},
        "caps": {
            "absolute_card_get_unique_count": len(cs),
            "absolute_card_level_sum_by_card_id": sum(lim[c["cardLevelLimitGroupId"]] for c in cs),
            "absolute_card_level_limit_break": max(lb_max[c["cardLevelLimitGroupId"]] for c in cs),
            "increment_card_level_limit_break_count": sum(lb_max[c["cardLevelLimitGroupId"]] for c in cs),
            "absolute_card_upgrade_potential": max(pot_max[c["cardPotentialGroupId"]] for c in cs),
            "increment_card_upgrade_potential_count": sum(pot_max[c["cardPotentialGroupId"]] for c in cs),
            "absolute_costume_get_count": outfits[ch],
            "absolute_park_emotion_get_count": emotes[ch],
            "absolute_music_release_count_by_character_id-solo": solo[ch],
            "absolute_skill_tree_release_count": board_slots.get(ch, 0),
        },
    }
    if not bc: print(f"warning: {ch} missing from board_materials.json")

capped = {"absolute_card_get_unique_count": "cards", "absolute_card_level_sum_by_card_id": "cards' max levels",
          "absolute_card_level_limit_break": "cards", "increment_card_level_limit_break_count": "cards",
          "absolute_card_upgrade_potential": "cards", "increment_card_upgrade_potential_count": "cards",
          "absolute_costume_get_count": "outfits", "absolute_park_emotion_get_count": "emotes",
          "absolute_music_release_count_by_character_id-solo": "solo songs",
          "absolute_skill_tree_release_count": "board slots"}
for e in achievements:
    if e["key"] in capped: e["capReason"] = capped[e["key"]]

version = (D / "version.txt").read_text().strip()[:12] if (D / "version.txt").exists() else ""
out = {"datamineVersion": version, "rankCurve": rank_curve, "achievements": achievements, "characters": characters}
a.out.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
print(f"{len(characters)} holomems, {len(achievements)} achievements, "
      f"max {sum(t['exp'] for e in achievements for t in e['tiers'])} EXP -> {a.out}")
