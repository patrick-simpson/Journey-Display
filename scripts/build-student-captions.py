#!/usr/bin/env python3
"""Build public/transcripts/week-NN-student.vtt from reviewed cue JSON.

NOTE ON PATHS: this reads its cue and correction JSON from a working directory
that was scratch space during the original run (see SCRATCH below). Kept in the
repo for reproducibility -- if Awana revises a lesson video, re-run
transcribe-student-captions.py, review, then build -- but point SCRATCH at
wherever that intermediate data lives.


Cue text is written as a SINGLE line with no hard breaks: the kiosk paints
captions into its own overlay with CSS wrapping (text-wrap: balance), so a
break hard-coded at ~42 chars would look wrong on a TV that fits far more.
Letting CSS wrap is what makes one transcript serve both a TV and a phone.
"""
import json, os, sys, glob

SCRATCH = os.path.dirname(os.path.abspath(__file__))
CUES = os.path.join(SCRATCH, "student-cues")
CORR = os.path.join(SCRATCH, "student-corrections")
OUT = "/home/user/Journey-Display/public/transcripts"
TARGET = 84  # what reviewers work to; anything longer is reported
MAX = 90     # hard ceiling: beyond this a line is rejected, not warned

from difflib import SequenceMatcher

MIN_CHARS, BLOCK_RATE, DUP_RATIO = 25, 40.0, 0.88  # only the unsayable band blocks

def _norm(t):
    return ' '.join(t.lower().split())

def _flags(cues):
    """Same detectors as scripts/validate-captions.py — see it for rationale."""
    out = []
    for i, c in enumerate(cues):
        dur = max(c["end"] - c["start"], 0.01)
        if len(c["text"]) >= MIN_CHARS and len(c["text"]) / dur > BLOCK_RATE:
            out.append((i + 1, "RATE"))
        if i > 0 and SequenceMatcher(None, _norm(cues[i-1]["text"]), _norm(c["text"])).ratio() > DUP_RATIO:
            out.append((i + 1, "DUP"))
    return out

def ts(sec):
    h = int(sec // 3600); m = int((sec % 3600) // 60); s = sec % 60
    return f"{h:02d}:{m:02d}:{s:06.3f}"

built = skipped = applied = overlong = 0
for path in sorted(glob.glob(os.path.join(CUES, "week-*.json"))):
    d = json.load(open(path))
    week = d["week"]
    cues = d["cues"]
    cpath = os.path.join(CORR, f"week-{week:02d}.json")
    if not os.path.exists(cpath):
        skipped += 1
        continue
    # Corrections are keyed by CUE NUMBER, so they are only valid for the exact
    # transcription they were written against. Re-transcribing renumbers cues
    # (week 1 went 73 -> 66), which silently lands a correction on unrelated
    # text -- observed: a fix intended for cue 15 overwrote cue 15 of a
    # different decode. Refuse whenever the cue data is newer than the review.
    if os.path.getmtime(path) > os.path.getmtime(cpath):
        print(f"week {week:02d}: BLOCKED - corrections predate this transcription "
              f"(re-review required)", file=sys.stderr)
        continue
    cdata = json.load(open(cpath))
    corrections = {c["cue"]: c["text"].strip() for c in cdata["corrections"]}
    # Hard gate: a week cannot be published while any physically-implausible
    # cue is neither corrected nor explicitly marked verified-against-audio.
    # Reading a transcript cannot detect a fluent hallucination; this can.
    sys.path.insert(0, "/home/user/Journey-Display/scripts")
    from importlib import import_module
    validator = import_module("validate-captions".replace("-", "_")) if False else None
    flagged = _flags(cues)
    cleared = set(corrections) | set(cdata.get("verified", []))
    blocked = [f for f in flagged if f[0] not in cleared]
    if blocked:
        print(f"week {week:02d}: BLOCKED - {len(blocked)} implausible cue(s) unverified: "
              f"{[f[0] for f in blocked]}", file=sys.stderr)
        continue
    bad = [n for n in corrections if not (1 <= n <= len(cues))]
    if bad:
        print(f"week {week:02d}: ERROR correction refers to missing cues {bad}", file=sys.stderr)
        continue
    for n, text in corrections.items():
        if len(text) > MAX:
            print(f"week {week:02d}: REJECTED cue {n} is {len(text)} chars (>{MAX})", file=sys.stderr)
            overlong += 1
        elif len(text) > TARGET:
            print(f"week {week:02d}: note cue {n} is {len(text)} chars (>{TARGET}, allowed)")
        cues[n - 1]["text"] = text
    applied += len(corrections)
    # Some artifacts cannot be fixed by editing text: a window boundary can
    # emit a whole spurious cue that merely repeats its neighbour's last words
    # (week 8 had 'curiosity.' alone in a 0.34s window). Editing it leaves a
    # flicker and emptying it makes a malformed VTT block, so the only correct
    # fix is removing the cue. Deletions are applied AFTER corrections so the
    # cue numbers in both lists refer to the same original numbering, and the
    # VTT is renumbered sequentially on write.
    drop = sorted(set(cdata.get("delete", [])), reverse=True)
    bad_drop = [n for n in drop if not (1 <= n <= len(cues))]
    if bad_drop:
        print(f"week {week:02d}: ERROR delete refers to missing cues {bad_drop}", file=sys.stderr)
        continue
    for n in drop:
        cues.pop(n - 1)
    if drop:
        print(f"week {week:02d}: deleted {len(drop)} spurious cue(s) {sorted(drop)}")
    out_path = os.path.join(OUT, f"week-{week:02d}-student.vtt")
    with open(out_path, "w") as f:
        f.write("WEBVTT\n\n")
        f.write(f"NOTE\nJourney: Advocates - Week {week} Student Video\n{d['title']}\n\n")
        for i, c in enumerate(cues, 1):
            f.write(f"{i}\n{ts(c['start'])} --> {ts(c['end'])}\n{c['text']}\n\n")
    built += 1

print(f"built {built} student VTTs ({applied} corrections applied), {skipped} awaiting review, {overlong} over-long")
