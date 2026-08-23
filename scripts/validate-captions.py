#!/usr/bin/env python3
"""Gate caption data on physical plausibility before it can be published.

Whisper hallucinates: run with condition_on_previous_text=True it will repeat a
neighbouring sentence or invent a fluent clause, and the invented text is
indistinguishable from real text by reading alone. What gives it away is
physics -- the fabricated words are crammed into a window far too short to
have spoken them. Week 11 shipped a 68-character sentence in a 0.64s window
(106 chars/sec); nobody talks at 106 chars/sec.

Two detectors:
  * RATE  - substantial text in an impossibly short window.
  * DUP   - a cue that largely repeats its neighbour (the repetition mode).

Neither is clever, and RATE deliberately ignores very short cues (a one-word
cue like 'mankind?' can show a high rate innocently). A flagged cue is not
proof of a hallucination -- it is a demand that a human or a review pass check
that cue against the AUDIO, not against the transcript. Once checked, list the
cue number under "verified" in that week's corrections file to clear it.

Usage: validate-captions.py <cues-dir> <corrections-dir>
Exit 1 if any week has unresolved flags.
"""
import glob, json, os, sys
from difflib import SequenceMatcher

MIN_CHARS = 25      # ignore very short cues; their rate is noise
MAX_RATE = 26.0     # chars/sec; brisk human speech peaks around 20
DUP_RATIO = 0.88    # similarity above which neighbours are "the same sentence"

def norm(t):
    return ' '.join(t.lower().split())

def flags_for(cues):
    out = []
    for i, c in enumerate(cues):
        dur = max(c["end"] - c["start"], 0.01)
        text = c["text"]
        rate = len(text) / dur
        if len(text) >= MIN_CHARS and rate > MAX_RATE:
            out.append((i + 1, f"RATE {rate:.0f} chars/sec ({len(text)}ch in {dur:.2f}s)", text))
        if i > 0:
            a, b = norm(cues[i - 1]["text"]), norm(text)
            if a and b and SequenceMatcher(None, a, b).ratio() > DUP_RATIO:
                out.append((i + 1, "DUP near-duplicate of previous cue", text))
    return out

cues_dir, corr_dir = sys.argv[1], sys.argv[2]
unresolved_total = 0
for path in sorted(glob.glob(os.path.join(cues_dir, "week-*.json"))):
    d = json.load(open(path))
    week = d["week"]
    flags = flags_for(d["cues"])
    cpath = os.path.join(corr_dir, f"week-{week:02d}.json")
    corrected, verified = set(), set()
    if os.path.exists(cpath):
        cd = json.load(open(cpath))
        corrected = {c["cue"] for c in cd.get("corrections", [])}
        verified = set(cd.get("verified", []))
    unresolved = [f for f in flags if f[0] not in corrected and f[0] not in verified]
    status = "OK" if not unresolved else f"{len(unresolved)} UNRESOLVED"
    print(f"week {week:02d}: {len(flags):2d} flagged, {len(corrected)} corrected, "
          f"{len(verified)} verified -> {status}")
    for cue, why, text in unresolved:
        print(f"    cue {cue:3d}  {why}\n              {text[:72]!r}")
    unresolved_total += len(unresolved)

print(f"\n{unresolved_total} cues still need checking against the audio")
sys.exit(1 if unresolved_total else 0)
