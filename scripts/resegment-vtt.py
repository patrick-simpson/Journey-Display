#!/usr/bin/env python3
"""Split over-long VTT cues into caption-sized ones.

The Leader transcripts were produced with whisper's own sentence-level
segmentation, which emits cues up to ~200 characters -- fine as a reading
transcript, unusable as an on-screen caption (a wall of text on a TV, and
6+ wrapped lines on a phone). This splits any cue over MAX_CHARS at the best
available boundary (sentence, then clause, then word) and apportions the
cue's duration across the pieces by character count.

Timing within a split is approximate -- the source has no word-level timings
-- but a few hundred ms of drift inside one cue is far better than a caption
nobody can read. The Student pipeline builds cues from real word timestamps
and needs none of this. Idempotent: re-running changes nothing.
"""
import re, sys, glob, os

MAX_CHARS = 84

def parse_ts(t):
    t = t.replace(',', '.')
    parts = t.split(':')
    if len(parts) == 3:
        h, m, s = parts
    else:
        h, (m, s) = 0, parts
    return int(h) * 3600 + int(m) * 60 + float(s)

def fmt_ts(sec):
    h = int(sec // 3600); m = int((sec % 3600) // 60); s = sec % 60
    return f"{h:02d}:{m:02d}:{s:06.3f}"

def split_text(text):
    """Break text into <=MAX_CHARS pieces at the most natural boundary."""
    if len(text) <= MAX_CHARS:
        return [text]
    # Prefer sentence ends, then clause punctuation, then any space.
    for pattern in (r'(?<=[.!?])\s+', r'(?<=[,;:])\s+'):
        parts = re.split(pattern, text)
        if len(parts) > 1:
            out, cur = [], ''
            for p in parts:
                cand = f"{cur} {p}".strip()
                if cur and len(cand) > MAX_CHARS:
                    out.append(cur); cur = p
                else:
                    cur = cand
            if cur:
                out.append(cur)
            # Any piece still too long recurses on the next-weaker boundary.
            final = []
            for p in out:
                final.extend(split_text(p) if len(p) > MAX_CHARS else [p])
            return final
    # Last resort: greedy word wrap.
    words, out, cur = text.split(), [], ''
    for w in words:
        cand = f"{cur} {w}".strip()
        if cur and len(cand) > MAX_CHARS:
            out.append(cur); cur = w
        else:
            cur = cand
    if cur:
        out.append(cur)
    return out

def process(path):
    raw = open(path).read()
    blocks = raw.split('\n\n')
    header, cues, notes = [], [], []
    for b in blocks:
        if not b.strip():
            continue
        if b.startswith('WEBVTT') or b.startswith('NOTE'):
            notes.append(b.rstrip())
            continue
        lines = b.strip().split('\n')
        # drop a numeric id line if present
        if lines and re.fullmatch(r'\d+', lines[0]):
            lines = lines[1:]
        if not lines or '-->' not in lines[0]:
            continue
        start, end = [x.strip() for x in lines[0].split('-->')]
        text = ' '.join(l.strip() for l in lines[1:]).strip()
        cues.append((parse_ts(start), parse_ts(end), text))

    out, changed = [], 0
    for s, e, text in cues:
        pieces = split_text(text)
        if len(pieces) == 1:
            out.append((s, e, text)); continue
        changed += 1
        total = sum(len(p) for p in pieces) or 1
        t = s
        for p in pieces:
            dur = (e - s) * (len(p) / total)
            out.append((t, min(t + dur, e), p))
            t += dur

    body = '\n\n'.join(notes) + '\n\n' if notes else 'WEBVTT\n\n'
    for i, (s, e, text) in enumerate(out, 1):
        body += f"{i}\n{fmt_ts(s)} --> {fmt_ts(e)}\n{text}\n\n"
    open(path, 'w').write(body)
    return len(cues), len(out), changed

total_before = total_after = total_changed = 0
for path in sorted(glob.glob(sys.argv[1])):
    before, after, changed = process(path)
    total_before += before; total_after += after; total_changed += changed
    if changed:
        print(f"{os.path.basename(path)}: {before} -> {after} cues ({changed} split)")
print(f"TOTAL: {total_before} -> {total_after} cues, {total_changed} over-long cues split")
