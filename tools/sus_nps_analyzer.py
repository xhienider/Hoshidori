"""
sus_nps_analyzer.py

A ".sus notes-per-second analyzer" built directly on the real note-parsing
pipeline from the holodori-scores repo (which itself delegates the actual
.sus grammar to the `sonolus_converters` library, rather than hand-parsing
the format). This is far more trustworthy than a from-scratch .sus parser:
BPM changes, time-signature changes, and beat->time conversion are all
handled by `_Timeline` / `sonolus_converters.holodori_sus.load()`, and note
extraction reuses `Score.combo_events()` - the exact same source of truth
the game's own scoring formula (`chart_score_multipliers`) is built from.

Usage:
    python sus_nps_analyzer.py path/to/chart.sus
    python sus_nps_analyzer.py path/to/chart.sus --csv out.csv
    python sus_nps_analyzer.py path/to/chart.sus --by-type

As a library:
    from sus_nps_analyzer import analyze_sus
    result = analyze_sus("chart.sus")
    result["notes_per_second"]   # {0: 3, 1: 7, 2: 5, ...} - every integer
                                  # second from 0 to the last note, zero-filled
    result["by_type_per_second"] # {0: {"tap": 2, "flick": 1}, ...}
    result["peak_second"]        # (second, count) for the densest 1s window
    result["total_notes"]        # int
    result["duration_seconds"]   # float, time of the last note
"""

from __future__ import annotations

import argparse
import csv
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from holodori.scores import chart_metadata, load_sus

# PERFECT_PLUS scoreCoefficientPermilMultiply per note type, from LiveNote.json.
# Matches the site's NOTE_WEIGHTS_PERFECT_PLUS in js/unitEngine.js - keep in sync.
NOTE_WEIGHTS_PERFECT_PLUS = {
    "tap": 1000,
    "flick": 1050,
    "long_start": 1000,
    "long_end": 1000,
    "long_flick_end": 1000,
    "long_relay": 100,
    "long_continuation": 100,
}


def compute_total_chart_weight(path: str | Path) -> int:
    """Sum of PERFECT_PLUS coefficients across every scorable note in the
    chart - the denominator for the theoretical-max-score formula.

    This deliberately does NOT reuse chart_metadata()'s note list, because
    that list (built from Score.combo_events()) skips slide relay points
    whose `critical` field is None - correct for combo counting, but WRONG
    for this sum: those points still occupy a slot in the score's PERFECT_PLUS
    coefficient pool even though they don't independently earn combo. Verified
    against a real discrepancy: a chart with 23 such "critical=None" tick
    points needed them included (at the long_relay weight, 100 each) to
    exactly reproduce the real in-game score for a test case - see the
    2026-09-02 Wicked/Hard investigation.
    """
    score, _ = load_sus(path)
    total = 0
    for note in score.notes:
        if type(note).__name__ == "Single":
            if getattr(note, "type", "single") == "damage":
                continue  # obstacle notes, not scored
            total += NOTE_WEIGHTS_PERFECT_PLUS["flick" if note.direction is not None else "tap"]
        elif type(note).__name__ == "Slide":
            for conn in note.connections:
                cname = type(conn).__name__
                if cname == "SlideStartPoint":
                    if conn.judgeType != "none":
                        total += NOTE_WEIGHTS_PERFECT_PLUS["long_start"]
                elif cname == "SlideEndPoint":
                    if conn.judgeType != "none":
                        total += NOTE_WEIGHTS_PERFECT_PLUS["long_flick_end" if conn.direction is not None else "long_end"]
                elif cname == "SlideRelayPoint":
                    # every relay point (visible tick or invisible attach)
                    # counts toward the weight pool, regardless of whether
                    # `critical` is set (that only gates combo eligibility)
                    total += NOTE_WEIGHTS_PERFECT_PLUS["long_relay"]
    # long_continuation (procedurally-generated hold-sustain ticks) - these
    # only come from combo_events() since they're not literal SUS entries,
    # and they're unaffected by the critical=None exclusion issue above
    for cat, crit, beat in score.combo_events():
        if cat == "long_continuations":
            total += NOTE_WEIGHTS_PERFECT_PLUS["long_continuation"]
    return total


def analyze_sus(path: str | Path) -> dict[str, Any]:
    """Loads a .sus file and catalogs how many notes land in each 1-second
    bucket, using the real note timeline (not raw beats/measures)."""
    score, bar_lengths = load_sus(path)
    meta = chart_metadata(score, bar_lengths)
    notes: list[tuple[str, float]] = meta["notes"]

    if not notes:
        return {
            "notes_per_second": {},
            "by_type_per_second": {},
            "peak_second": None,
            "total_notes": 0,
            "duration_seconds": 0.0,
            "fever": meta["fever"],
        }

    duration = notes[-1][1]
    last_second = int(duration)

    per_second: Counter[int] = Counter()
    by_type: dict[int, Counter[str]] = defaultdict(Counter)
    for typ, t in notes:
        sec = int(t)  # which second-bucket this note falls in: [sec, sec+1)
        per_second[sec] += 1
        by_type[sec][typ] += 1

    # zero-fill every second from 0 to the last note's second, so gaps in the
    # chart show up as explicit 0s rather than being silently absent
    notes_per_second = {s: per_second.get(s, 0) for s in range(last_second + 1)}
    by_type_per_second = {s: dict(by_type.get(s, {})) for s in range(last_second + 1)}

    peak_second, peak_count = max(notes_per_second.items(), key=lambda kv: kv[1])

    return {
        "notes_per_second": notes_per_second,
        "by_type_per_second": by_type_per_second,
        "peak_second": (peak_second, peak_count),
        "total_notes": len(notes),
        "duration_seconds": duration,
        "fever": meta["fever"],
    }


def _print_summary(path: Path, result: dict[str, Any], *, by_type: bool) -> None:
    print(f"=== {path.name} ===")
    print(f"Total notes: {result['total_notes']}")
    print(f"Duration (last note): {result['duration_seconds']:.2f}s")
    if result["peak_second"] is not None:
        sec, count = result["peak_second"]
        print(f"Peak density: {count} notes in second {sec} (t={sec}-{sec + 1}s)")
    if result["fever"]:
        f = result["fever"]
        print(f"Fever window: {f['start']:.2f}s - {f['end']:.2f}s")
    avg = result["total_notes"] / (result["duration_seconds"] or 1)
    print(f"Average notes/sec: {avg:.2f}")
    print()

    if by_type:
        header = f"{'sec':>5} | {'count':>5} | breakdown"
        print(header)
        print("-" * len(header))
        for sec, count in result["notes_per_second"].items():
            breakdown = result["by_type_per_second"][sec]
            breakdown_str = ", ".join(f"{k}:{v}" for k, v in sorted(breakdown.items())) if breakdown else ""
            print(f"{sec:>5} | {count:>5} | {breakdown_str}")
    else:
        header = f"{'sec':>5} | {'count':>5} | bar"
        print(header)
        print("-" * len(header))
        for sec, count in result["notes_per_second"].items():
            print(f"{sec:>5} | {count:>5} | {'#' * count}")


def _write_csv(path: Path, result: dict[str, Any], out_path: Path) -> None:
    with open(out_path, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["second", "note_count"])
        for sec, count in result["notes_per_second"].items():
            writer.writerow([sec, count])
    print(f"Wrote {out_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Catalog notes-per-second for a .sus chart file.")
    parser.add_argument("sus_file", type=Path, help="Path to a .sus chart file")
    parser.add_argument("--csv", type=Path, default=None, help="Write the per-second table to a CSV file")
    parser.add_argument("--by-type", action="store_true", help="Break down each second by note type")
    args = parser.parse_args()

    result = analyze_sus(args.sus_file)
    _print_summary(args.sus_file, result, by_type=args.by_type)
    if args.csv:
        _write_csv(args.sus_file, result, args.csv)


if __name__ == "__main__":
    main()
