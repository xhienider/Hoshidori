"""
Tabulate every Holomem-Rank-EXP-granting achievement and its maximum EXP.

Usage:
    python rank_exp_achievements.py --datamine /path/to/holodori-db-eng-diff-main \
        [--board-categories ../data/board_categories.json --green-yellow ../data/green_yellow_board.json] \
        > character_rank_exp_achievements.md

Findings this script encodes (verified against datamine structure, Aug-2026 export):
  * Rank EXP = MissionProgress.rewardCharacterExpQuantity. It only appears on
    per-character achievement missions (Mission.characterId set,
    categoryType ACHIEVEMENT). Common/Live/Park/Game/Other achievements give 0.
  * Every character gets the identical template set (same thresholds, same EXP),
    plus exactly one "play your own song as Leader" mission.
  * CharacterLevel.exp is CUMULATIVE total EXP to reach that rank (Rank 50 = 196),
    not per-level. Proof by consistency: the achievements themselves ask for
    Rank 30, which a per-level reading (sum 4258) could never reach from 191 EXP.
  * Some upper tiers are gated by content that doesn't exist yet (e.g. "obtain 5
    different Members" when a character only has 3 cards). The "currently
    reachable" column caps each threshold by what the datamine makes possible.
"""
import argparse, json, re, collections
from pathlib import Path

def load(p): return json.load(open(p, encoding="utf-8"))

ap = argparse.ArgumentParser()
ap.add_argument("--datamine", type=Path, required=True)
ap.add_argument("--board-categories", type=Path)
ap.add_argument("--green-yellow", type=Path)
a = ap.parse_args()
D = a.datamine

missions = {m["id"]: m["data"] for m in load(D / "Mission.json")}
tiers = collections.defaultdict(list)
for p in load(D / "MissionProgress.json"):
    tiers[p["data"]["missionId"]].append(p["data"])
lang = {x["id"]: x["data"].get("text") for x in load(D / "LangMission_Eng.json")}
music_title = {x["id"]: x["data"].get("text") for x in load(D / "LangMusic_Eng.json")}
chars = {x["id"]: x["data"] for x in load(D / "Character.json")}

# ---- rank curve (cumulative) ----
curve = {1: 0}
for r in load(D / "CharacterLevel.json"):
    if r["data"].get("exp"): curve[r["level"]] = int(r["data"]["exp"])
def rank_for(exp):
    return max(l for l, e in curve.items() if e <= exp)

# ---- content caps per character ----
lim = collections.defaultdict(int)
for r in load(D / "CardLevelLimit.json"):
    g = r["data"]["groupId"]; lim[g] = max(lim[g], r["data"]["levelLimit"])
lb_max = collections.defaultdict(int)
for r in load(D / "CardLevelLimit.json"):
    g = r["data"]["groupId"]; lb_max[g] = max(lb_max[g], r["data"].get("limitBreakCount", 0))
pot_max = collections.defaultdict(int)
for r in load(D / "CardPotential.json"):
    g = r["data"]["groupId"]; pot_max[g] = max(pot_max[g], r["data"]["upgradeCount"])
cards = collections.defaultdict(list)
for c in load(D / "Card.json"): cards[c["data"]["characterId"]].append(c["data"])
cos = collections.Counter(c["data"]["characterId"] for c in load(D / "Costume.json"))
emo = collections.Counter(c["data"].get("characterId") for c in load(D / "ParkEmotion.json"))
solo = collections.Counter()
for m in load(D / "Music.json"):
    d = m["data"]
    if d.get("musicSingerType", "").endswith("SOLO"):
        for ch in d.get("characterIds", []): solo[ch] += 1
board_nodes = {}
if a.board_categories and a.green_yellow:
    bc, gy = load(a.board_categories), load(a.green_yellow)
    for ch, v in bc.items():
        board_nodes[ch] = sum(len(x) for x in v["categories"].values()) + \
            sum(len(x) for x in gy["variants"][v["greenYellowVariant"]].values())

def cap(ch, suffix):
    cs = cards[ch]
    return {
        "absolute_card_get_unique_count": len(cs),
        "absolute_card_level_sum_by_card_id": sum(lim[c["cardLevelLimitGroupId"]] for c in cs),
        "absolute_card_level_limit_break": max(lb_max[c["cardLevelLimitGroupId"]] for c in cs),
        "increment_card_level_limit_break_count": sum(lb_max[c["cardLevelLimitGroupId"]] for c in cs),
        "absolute_card_upgrade_potential": max(pot_max[c["cardPotentialGroupId"]] for c in cs),
        "increment_card_upgrade_potential_count": sum(pot_max[c["cardPotentialGroupId"]] for c in cs),
        "absolute_costume_get_count": cos[ch],
        "absolute_park_emotion_get_count": emo[ch],
        "absolute_music_release_count_by_character_id-solo": solo[ch],
        "absolute_skill_tree_release_count": board_nodes.get(ch),
    }.get(suffix)

# ---- collect ----
per_char = collections.defaultdict(list)   # ch -> [(suffix, mid)]
for mid, m in missions.items():
    ch = m.get("characterId")
    if ch and m.get("categoryType", "").endswith("ACHIEVEMENT"):
        per_char[ch].append((re.sub(r"^mission-achievement-chr-\d{5}-", "", mid), mid))

def tier_list(mid):
    return sorted(((int(t["threshold"]), int(t.get("rewardCharacterExpQuantity", 0))) for t in tiers[mid]))

def desc(mid):
    m = missions[mid]; t = lang.get(m["descriptionLangId"], m["descriptionLangId"])
    return t.replace("{0}", "N")

# template table from first character
ref = sorted(per_char)[0]
rows = []
for suffix, mid in sorted(per_char[ref], key=lambda x: missions[x[1]]["order"]):
    tl = tier_list(mid)
    own = suffix.startswith("increment_live_play_count-m")
    rows.append(("increment_live_play_count-<own song>" if own else suffix,
                 "As the Leader, play <their own song> N time(s)" if own else desc(mid),
                 missions[mid]["type"].split("MISSION_TYPE_")[-1],
                 len(tl), sum(e for _, e in tl), ", ".join(str(t) for t, _ in tl)))

out = []
out.append("# Holomem Rank EXP — achievement table\n")
out.append(f"Source: holodori-db-eng-diff datamine (Mission / MissionProgress / CharacterLevel). "
           f"{len(per_char)} characters, all with an identical template.\n")
out.append("| # | Achievement (mission key) | Description | Tiers | Max Rank EXP | Thresholds |")
out.append("|---|---|---|---|---|---|")
for i, r in enumerate(rows, 1):
    out.append(f"| {i} | `{r[0]}` | {r[1]} | {r[3]} | **{r[4]}** | {r[5]} |")
total = sum(r[4] for r in rows)
out.append(f"| | **Total per character** | | {sum(r[3] for r in rows)} | **{total}** | |\n")

out.append("## Rank curve (cumulative EXP)\n")
out.append("| Rank | Total EXP | | Rank | Total EXP | | Rank | Total EXP |")
out.append("|---|---|---|---|---|---|---|---|")
ks = sorted(curve)
third = (len(ks) + 2) // 3
for i in range(third):
    cells = []
    for j in range(3):
        k = i + j * third
        cells += [str(ks[k]), str(curve[ks[k]])] if k < len(ks) else ["", ""]
    out.append(f"| {cells[0]} | {cells[1]} | | {cells[2]} | {cells[3]} | | {cells[4]} | {cells[5]} |")
out.append(f"\nTheoretical max {total} EXP → Rank {rank_for(total)} (Rank 50 needs {curve[50]}).\n")

out.append("## Currently reachable per character (content-capped)\n")
out.append("Caps applied: cards owned (unique count, level sum, limit-break & bloom counts), outfits, solo songs, "
           "emotes, board nodes. Grind-only goals (1000 Lives, 400 card copies, score/unit-score targets) are assumed reachable.\n")
SHORT = {
    "absolute_card_get_unique_count": "Unique Members", "absolute_card_level_sum_by_card_id": "Member Lv sum",
    "increment_card_level_limit_break_count": "Train count", "increment_card_upgrade_potential_count": "Bloom count",
    "absolute_costume_get_count": "Outfits", "absolute_music_release_count_by_character_id-solo": "Solo songs",
    "absolute_skill_tree_release_count": "Board nodes",
}
patterns = collections.defaultdict(list)
for ch in per_char:
    got = 0; lost = collections.OrderedDict((k, 0) for k in SHORT)
    for suffix, mid in per_char[ch]:
        c = cap(ch, suffix); tl = tier_list(mid)
        e = sum(x for t, x in tl if c is None or t <= c); got += e
        if suffix in lost: lost[suffix] += sum(x for _, x in tl) - e
    key = (len(cards[ch]), solo[ch], got, tuple(lost.values()))
    patterns[key].append(chars[ch].get("nameEng", ch))
out.append("| Cards | Solo songs | " + " | ".join(f"−{v}" for v in SHORT.values()) + " | Reachable EXP | Max Rank now | Characters |")
out.append("|---|---|" + "---|" * len(SHORT) + "---|---|---|")
for (nc, ns, got, lost), names in sorted(patterns.items(), key=lambda kv: -kv[0][2]):
    out.append(f"| {nc} | {ns} | " + " | ".join(str(x) for x in lost) +
               f" | **{got}** | {rank_for(got)} | {', '.join(sorted(names))} ({len(names)}) |")
out.append("""
## Notes / confidence
- **Only per-holomem achievements give Rank EXP.** All 128 shared achievements (Live, Park, Game, Training, Others) have no `rewardCharacterExpQuantity`.
- **Rank curve is cumulative** (inferred, not screenshot-verified): a per-level reading would need 4,258 EXP for Rank 50, yet the achievements themselves only pay 191 and ask you to reach Rank 30. Worth confirming with one in-game "EXP to next rank" readout.
- Every tier pays 1 EXP except *Obtain N different Members* (2 EXP per tier).
- **Board nodes (−1)**: Hoshidori's board data gives 131 nodes per holomem (Red+Blue 75, Green+Yellow 56), so the 140 tier looks unreachable. Unverified whether bridge/center slots count toward the in-game total.
- **Solo songs**: counted from `Music.json` where `musicSingerType` is SOLO. FuwaMoco's joint songs credit both of them, hence 4.
- Emotes (17 each) and Free Chat (10) are assumed fully collectible; Free Chat per holomem was not counted.
- Grind goals assumed reachable: 1000 Lives as Leader, 400 Member cards obtained (duplicates presumably count), 400 Holowork, 2.5M Live Score, 2M Unit Score.
""")
print("\n".join(out))
