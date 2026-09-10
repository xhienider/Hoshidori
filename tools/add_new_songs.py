"""
add_new_songs.py

Extracts and integrates newly-released songs into data/music.json and
data/note_density/, given a new datamine snapshot and the matching .sus
chart files.

PREREQUISITES (not bundled with this repo - large external deps):
  - The `holodori-scores` package must be importable (pip install from
    https://github.com/.../holodori-scores, or add its `src/` to PYTHONPATH).
    Provides .sus parsing (load_sus, _timeline) - do NOT hand-parse .sus files,
    the format's BPM/time-signature handling is nontrivial and this package
    is the same source of truth the game's own scoring is built from.
  - sus_nps_analyzer.py (sibling file in this tools/ folder) - the
    notes-per-second / totalChartWeight pipeline, reused as-is from note-
    density generation for every existing song in this project.

USAGE:
    python add_new_songs.py \
        --old-datamine /path/to/old/holodori-db-eng-diff-main \
        --new-datamine /path/to/new/holodori-db-eng-diff-main \
        --sus-dir /path/to/new/song/sus/files \
        --music-json ../data/music.json \
        --note-density-dir ../data/note_density

This only ADDS songs whose id is present in the new datamine's Music.json
but absent from the old one (or absent from music.json, whichever check
you point --music-json at) - it never modifies or removes existing entries.

WHAT THIS DOES NOT DO: fetch/verify the .sus chart files themselves - you
need EVERY difficulty's .sus file (easy/normal/hard/expert) for each new
song already downloaded into --sus-dir, named chart_{songId}_{difficulty}.sus
(matching the convention the base game's asset filenames use).

HOW feverSeconds IS DERIVED (confirmed 2026-09, matched bit-exact against
known values for an existing song): the game's "0B" SUS channel encodes
5 `HolodoriSkill` markers (slot=1..5), one per special-skill activation
window in the song. This is a SEPARATE mechanic from the single fever
start/end window the holodori-scores package already parses natively -
don't confuse the two. Confirmed difficulty-independent (same beats
across easy/hard variants of the same song), so any one difficulty's
chart suffices.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

# --- external deps -----------------------------------------------------
try:
    from holodori.scores import load_sus
    from holodori.scores.metadata import _timeline
except ImportError:
    print("ERROR: holodori-scores package not importable. See module docstring.", file=sys.stderr)
    raise

sys.path.insert(0, str(Path(__file__).parent))
from sus_nps_analyzer import analyze_sus, compute_total_chart_weight  # noqa: E402

TYPE_CODE_MAP = {
    "tap": "T",
    "flick": "F",
    "long_start": "LS",
    "long_end": "LE",
    "long_flick_end": "LFE",
    "long_relay": "LR",
    "long_continuation": "LC",
}
DIFFICULTIES = ["easy", "normal", "hard", "expert"]


def load_json(path: str | Path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def find_new_song_ids(old_datamine: Path, new_datamine: Path) -> list[str]:
    old_music = load_json(old_datamine / "Music.json")
    new_music = load_json(new_datamine / "Music.json")
    old_ids = {x["data"]["id"] for x in old_music}
    return [x["data"]["id"] for x in new_music if x["data"]["id"] not in old_ids]


def get_skill_window_seconds(sus_path: Path) -> list[float]:
    """The 5 special-skill activation-window timestamps, from the SUS
    file's HolodoriSkill markers (see module docstring)."""
    score, bar_lengths = load_sus(sus_path)
    timeline = _timeline(score, bar_lengths)
    skills = sorted((n for n in score.notes if type(n).__name__ == "HolodoriSkill"), key=lambda n: n.slot)
    return [round(timeline.time(s.beat), 2) for s in skills]


def build_note_density(sus_paths_by_difficulty: dict[str, Path]) -> dict:
    out = {}
    for diff, path in sus_paths_by_difficulty.items():
        result = analyze_sus(path)
        total_weight = compute_total_chart_weight(path)
        per_second = []
        last_second = max(result["notes_per_second"].keys()) if result["notes_per_second"] else -1
        for sec in range(last_second + 1):
            total = result["notes_per_second"].get(sec, 0)
            if total == 0:
                per_second.append([0])
            else:
                type_counts = result["by_type_per_second"].get(sec, {})
                mapped: dict[str, int] = {}
                for k, v in type_counts.items():
                    code = TYPE_CODE_MAP.get(k, k)
                    mapped[code] = mapped.get(code, 0) + v
                per_second.append([total, mapped])
        out[diff] = {"perSecond": per_second, "totalChartWeight": total_weight}
    return out


def build_music_entry(song_id: str, new_datamine: Path, sus_dir: Path) -> dict:
    music = load_json(new_datamine / "Music.json")
    by_id = {x["data"]["id"]: x["data"] for x in music}
    m = by_id[song_id]

    lang = load_json(new_datamine / "LangMusic_Eng.json")
    lang_by_id = {x["data"]["id"]: x["data"].get("text") for x in lang}
    title = lang_by_id.get(m["titleLangId"])

    diff_table = load_json(new_datamine / "MusicDifficulty.json")
    difficulty_levels = {}
    for x in diff_table:
        dd = x["data"]
        if dd["musicId"] == song_id:
            difficulty_levels[dd["difficultyType"].split("_")[-1].lower()] = dd["difficultyLevel"]

    release_date = datetime.fromtimestamp(int(m["startTime"]) / 1000, tz=timezone.utc).strftime("%Y-%m-%d")
    release_type = m["releaseType"].split("_")[-1].capitalize()

    expert_sus = sus_dir / f"chart_{song_id}_expert.sus"
    fever_seconds = get_skill_window_seconds(expert_sus)

    return {
        "id": song_id,
        "title": title,
        "playingSeconds": m["playingSeconds"],
        "feverSeconds": fever_seconds,
        "characterIds": m["characterIds"],
        "releaseDate": release_date,
        "releaseType": release_type,
        "unlockCost": None,  # not yet mapped from raw data - matches existing entries' common case
        "mvUrl": m.get("mvUrl"),
        "difficultyLevels": difficulty_levels,
        "liveScoreCoefficientPermil": m["liveScoreCoefficientPermil"],
    }


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--old-datamine", type=Path, required=True)
    p.add_argument("--new-datamine", type=Path, required=True)
    p.add_argument("--sus-dir", type=Path, required=True, help="Dir containing chart_{songId}_{difficulty}.sus for every new song")
    p.add_argument("--music-json", type=Path, required=True)
    p.add_argument("--note-density-dir", type=Path, required=True)
    p.add_argument("--dry-run", action="store_true", help="Print what would change without writing files")
    args = p.parse_args()

    new_song_ids = find_new_song_ids(args.old_datamine, args.new_datamine)
    if not new_song_ids:
        print("No new songs found.")
        return
    print(f"Found {len(new_song_ids)} new song(s): {new_song_ids}")

    music = load_json(args.music_json)
    existing_ids = {m["id"] for m in music}
    added_entries = []

    for song_id in new_song_ids:
        if song_id in existing_ids:
            print(f"  {song_id} already in {args.music_json.name}, skipping")
            continue

        entry = build_music_entry(song_id, args.new_datamine, args.sus_dir)
        added_entries.append(entry)
        print(f"  {song_id} -> {entry['title']} | fever: {entry['feverSeconds']}")

        sus_paths = {d: args.sus_dir / f"chart_{song_id}_{d}.sus" for d in DIFFICULTIES}
        missing = [d for d, path in sus_paths.items() if not path.exists()]
        if missing:
            print(f"    WARNING: missing .sus files for difficulties {missing} - skipping note-density for {song_id}")
            continue
        density = build_note_density(sus_paths)
        density_path = args.note_density_dir / f"{song_id}.json"
        if not args.dry_run:
            with open(density_path, "w", encoding="utf-8") as f:
                json.dump(density, f)
        print(f"    wrote note-density -> {density_path}")

    if not args.dry_run and added_entries:
        music.extend(added_entries)
        with open(args.music_json, "w", encoding="utf-8") as f:
            json.dump(music, f, ensure_ascii=False)
        print(f"Updated {args.music_json} - now {len(music)} songs total.")
    elif args.dry_run:
        print("(dry run - no files written)")


if __name__ == "__main__":
    main()
