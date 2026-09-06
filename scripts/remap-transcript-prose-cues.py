#!/usr/bin/env python3
"""Re-point data/leader-transcript-prose.json at a re-transcribed VTT.

The prose paragraphs carry fromCue/toCue numbers into that week's
public/transcripts/week-NN-leader.vtt (they drive the printed timestamps and
the validator's coverage check). Re-transcribing a video renumbers every cue,
so those numbers would silently point at the wrong moments. This maps each
paragraph boundary by TIME instead: the old fromCue's start time is looked up
in the new VTT and the nearest new cue start becomes the new fromCue; toCue is
then simply "the cue before the next paragraph starts", so the paragraphs
still tile 1..lastCue exactly as the validator demands.

Usage: remap-transcript-prose-cues.py <old-vtt-dir> [week ...]
  <old-vtt-dir> holds the VTTs the prose was written against, named
  week-NN-leader.vtt; the new ones are read from public/transcripts/.
Edits data/leader-transcript-prose.json in place and prints each week's
largest boundary drift so a big jump can be eyeballed.
"""
import json, os, re, sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROSE = os.path.join(REPO, 'data', 'leader-transcript-prose.json')
NEW_DIR = os.path.join(REPO, 'public', 'transcripts')


def cue_times(path):
    """[(start, end), ...] in cue order (index 0 = cue 1)."""
    out = []
    lines = open(path).read().splitlines()
    for i, line in enumerate(lines):
        if re.fullmatch(r'\d+', line.strip()) and i + 1 < len(lines) and '-->' in lines[i + 1]:
            a, b = [t.strip() for t in lines[i + 1].split('-->')]
            out.append((to_sec(a), to_sec(b.split()[0])))
    return out


def to_sec(ts):
    h, m, s = ts.split(':')
    return int(h) * 3600 + int(m) * 60 + float(s)


def nearest_start(times, t):
    return min(range(len(times)), key=lambda i: abs(times[i][0] - t)) + 1


def main():
    old_dir = sys.argv[1]
    only = {int(w) for w in sys.argv[2:]}
    data = json.load(open(PROSE))
    for key, entry in sorted(data['weeks'].items(), key=lambda kv: int(kv[0])):
        week = int(key)
        if only and week not in only:
            continue
        old = cue_times(os.path.join(old_dir, f'week-{week:02d}-leader.vtt'))
        new = cue_times(os.path.join(NEW_DIR, f'week-{week:02d}-leader.vtt'))
        paras = entry['paragraphs']
        starts, drift = [], 0.0
        for p in paras:
            t = old[p['fromCue'] - 1][0]
            n = nearest_start(new, t)
            # Boundaries must stay strictly increasing or a paragraph would
            # cover no cues; nudge forward if two collapse onto one new cue.
            if starts and n <= starts[-1]:
                n = starts[-1] + 1
            starts.append(min(n, len(new)))
            drift = max(drift, abs(new[starts[-1] - 1][0] - t))
        starts[0] = 1
        for i, p in enumerate(paras):
            p['fromCue'] = starts[i]
            p['toCue'] = (starts[i + 1] - 1) if i + 1 < len(paras) else len(new)
        entry['lastCue'] = len(new)
        print(f'week {week:>2}: {len(old)} -> {len(new)} cues, {len(paras)} paragraphs, '
              f'max boundary drift {drift:.1f}s')
    json.dump(data, open(PROSE, 'w'), indent=2, ensure_ascii=False)
    open(PROSE, 'a').write('\n')


if __name__ == '__main__':
    main()
