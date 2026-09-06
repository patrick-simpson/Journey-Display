#!/usr/bin/env python3
"""Re-decode the audio around specific cues, so a reviewer can check what was
actually said instead of judging plausibility from the transcript.

  verify-cue.py [student|leader] <week> <cue> [<cue> ...]

For each cue it prints the current text next to a fresh, independent decode of
that time window (large-v3, beam 10, no conditioning on previous text, so the
new decode cannot inherit the original's invention). Downloads the week's
Student video on first use and keeps it for subsequent cues.
"""
import json, os, subprocess, sys

SCRATCH = os.path.dirname(os.path.abspath(__file__))
RELEASE = "https://github.com/patrick-simpson/Journey-Display/releases/download/transcoded-videos-v1"
PAD = 2.5  # seconds of context on each side

args = sys.argv[1:]
KIND = args.pop(0) if args and args[0] in ("student", "leader") else "student"
week = int(args[0])
cue_nums = [int(x) for x in args[1:]]
cues = json.load(open(f"{SCRATCH}/{KIND}-cues/week-{week:02d}.json"))["cues"]

# Reuse a pre-downloaded copy (the transcription pass keeps them in
# <kind>-mp4/) before fetching one just for this check.
mp4 = f"{SCRATCH}/{KIND}-mp4/week-{week:02d}-{KIND}.mp4"
if not os.path.exists(mp4):
    mp4 = f"{SCRATCH}/verify-{week:02d}-{KIND}.mp4"
if not os.path.exists(mp4):
    print(f"downloading week {week:02d} {KIND} video...", file=sys.stderr)
    subprocess.run(["curl", "-sSL", "-o", mp4, f"{RELEASE}/week-{week:02d}-{KIND}.mp4"], check=True)

from faster_whisper import WhisperModel
from faster_whisper.audio import decode_audio

SR = 16000
model = WhisperModel("large-v3", device="cpu", compute_type="int8", cpu_threads=4)
print(f"decoding week {week:02d} audio...", file=sys.stderr)
audio = decode_audio(mp4, sampling_rate=SR)

for n in cue_nums:
    if not (1 <= n <= len(cues)):
        print(f"cue {n}: OUT OF RANGE (week has {len(cues)} cues)"); continue
    c = cues[n - 1]
    lo = max(0.0, c["start"] - PAD)
    hi = c["end"] + PAD
    # Slice the decoded waveform directly rather than shelling out to ffmpeg:
    # the only ffmpeg on this box is Playwright's stripped build, which cannot
    # even demux mp4. faster-whisper decodes via PyAV and accepts a raw array.
    clip = audio[int(lo * SR):int(hi * SR)]
    segs, _ = model.transcribe(clip, language="en", beam_size=10,
                               condition_on_previous_text=False, vad_filter=False)
    fresh = " ".join(s.text.strip() for s in segs).strip()
    dur = c["end"] - c["start"]
    print(f"\n--- week {week:02d} cue {n} | window {c['start']:.2f}-{c['end']:.2f} ({dur:.2f}s) "
          f"| {len(c['text'])}ch = {len(c['text'])/max(dur,.01):.0f} chars/sec")
    print(f"  CURRENT: {c['text']!r}")
    print(f"  CONTEXT ({lo:.1f}-{hi:.1f}s re-decode): {fresh!r}")
    if n > 1:
        print(f"  PREV CUE: {cues[n-2]['text']!r}")
    if n < len(cues):
        print(f"  NEXT CUE: {cues[n]['text']!r}")
