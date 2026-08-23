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

MIN_CHARS = 25       # ignore very short cues; their rate is noise
REVIEW_RATE = 26.0   # chars/sec: fast, worth a careful read
BLOCK_RATE = 40.0    # chars/sec: physically unsayable -- treat as fabrication
DUP_RATIO = 0.88     # similarity above which neighbours are "the same sentence"

# Two tiers, calibrated against measured data rather than intuition. Across 962
# cues from the hallucination-prone setting, 5 cues exceeded 40 chars/sec (the
# worst was 106) and 1 duplicated its neighbour; those are the fabrications.
# The 26-40 band held 1.5% of those cues and 3.0% of cues from the hardened
# setting -- it tracks CONTENT, not invention (week 18 is a fast two-person
# interview), so blocking on it would be crying wolf. Only the impossible band
# and duplicates block publication; the fast band is surfaced for the review
# pass to read with care.

def norm(t):
    return ' '.join(t.lower().split())

def flags_for(cues):
    out = []
    for i, c in enumerate(cues):
        dur = max(c["end"] - c["start"], 0.01)
        text = c["text"]
        rate = len(text) / dur
        if len(text) >= MIN_CHARS and rate > BLOCK_RATE:
            out.append((i + 1, "BLOCK", f"{rate:.0f} chars/sec ({len(text)}ch in {dur:.2f}s) - unsayable", text))
        elif len(text) >= MIN_CHARS and rate > REVIEW_RATE:
            out.append((i + 1, "REVIEW", f"{rate:.0f} chars/sec ({len(text)}ch in {dur:.2f}s) - fast", text))
        if i > 0:
            a, b = norm(cues[i - 1]["text"]), norm(text)
            if a and b and SequenceMatcher(None, a, b).ratio() > DUP_RATIO:
                out.append((i + 1, "BLOCK", "near-duplicate of previous cue", text))
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
    cleared = corrected | verified
    blocking = [f for f in flags if f[1] == "BLOCK" and f[0] not in cleared]
    reviewy = [f for f in flags if f[1] == "REVIEW" and f[0] not in cleared]
    status = "BLOCKED" if blocking else ("OK" if not reviewy else f"OK ({len(reviewy)} to read)")
    print(f"week {week:02d}: {len(blocking)} blocking, {len(reviewy)} to read, "
          f"{len(corrected)} corrected, {len(verified)} verified -> {status}")
    for cue, tier, why, text in blocking + reviewy:
        print(f"    [{tier:6}] cue {cue:3d}  {why}\n              {text[:72]!r}")
    unresolved_total += len(blocking)

print(f"\n{unresolved_total} BLOCKING cues must be checked against the audio before publishing")
sys.exit(1 if unresolved_total else 0)
