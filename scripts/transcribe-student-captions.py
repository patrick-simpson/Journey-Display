#!/usr/bin/env python3
"""High-quality Student-video transcription for on-screen captions.

Differences from the Leader pass (transcribe-all.py), all in service of
"near-perfect captions for students":
  * model large-v3 (not small) -- measured materially more accurate on this
    material (e.g. "They're answers" vs "their answers").
  * initial_prompt seeded with this course's domain vocabulary, so proper
    nouns and theological terms (apologia, Areopagus, Sean McDowell, book
    names) aren't mangled into plausible-but-wrong words.
  * word_timestamps -- cues are rebuilt from word timings into caption-sized
    chunks rather than using whisper's long sentence segments, which run up
    to ~135 chars and read terribly on a TV.
Writes cues to a sidecar JSON (reviewable/correctable) plus a .txt for the
contextual review pass; the VTT itself is generated from the JSON afterward
by build-student-vtt.py, so a review never has to touch timing lines.
"""
import json, os, subprocess, sys, time

SCRATCH = os.path.dirname(os.path.abspath(__file__))
REPO = "/home/user/Journey-Display"
CUE_DIR = os.path.join(SCRATCH, "student-cues")
TXT_DIR = os.path.join(SCRATCH, "student-txt")
RELEASE = "https://github.com/patrick-simpson/Journey-Display/releases/download/transcoded-videos-v1"
os.makedirs(CUE_DIR, exist_ok=True)
os.makedirs(TXT_DIR, exist_ok=True)

PROMPT = ("Journey: Advocates, an Awana apologetics course. Terms: apologetics, apologia, "
          "worldview, theism, deism, monotheism, pantheism, naturalism, atheism, epistemology, "
          "cosmological, teleological, Areopagus, incarnation, Trinity, canon, manuscripts, "
          "resurrection, deity of Christ, Scripture, Genesis, Isaiah, Matthew, Luke, John, Acts, "
          "Romans, 1 Corinthians, Hebrews, 1 Peter, Revelation, Jesus Christ, Holy Spirit, "
          "Sean McDowell, Jonathan Morrow.")

MAX_CHARS = 84      # two 42-char lines
MIN_BREAK_CHARS = 32
MAX_DUR = 6.0
GAP_BREAK = 0.8

with open(os.path.join(REPO, "public", "lessons.json")) as f:
    lessons = json.load(f)["lessons"]

from faster_whisper import WhisperModel
model = WhisperModel("large-v3", device="cpu", compute_type="int8", cpu_threads=4)


def build_cues(words):
    """Group word-level timings into caption-sized cues."""
    cues, cur, start, prev_end = [], [], None, None
    for w in words:
        text = w.word
        if start is None:
            start, cur, prev_end = w.start, [text], w.end
            continue
        joined = "".join(cur).strip()
        gap = w.start - prev_end
        ends_sentence = joined.endswith((".", "!", "?"))
        too_long = len(joined) + len(text) > MAX_CHARS
        too_slow = (w.end - start) > MAX_DUR
        if too_long or too_slow or gap > GAP_BREAK or (ends_sentence and len(joined) >= MIN_BREAK_CHARS):
            cues.append({"start": start, "end": prev_end, "text": joined})
            start, cur = w.start, [text]
        else:
            cur.append(text)
        prev_end = w.end
    if cur and start is not None:
        cues.append({"start": start, "end": prev_end, "text": "".join(cur).strip()})
    return [c for c in cues if c["text"]]


for lesson in sorted(lessons, key=lambda l: l["week"]):
    week = lesson["week"]
    cue_path = os.path.join(CUE_DIR, f"week-{week:02d}.json")
    txt_path = os.path.join(TXT_DIR, f"week-{week:02d}.txt")
    if os.path.exists(cue_path) and os.path.exists(txt_path):
        print(f"week {week:02d}: already transcribed - skipping", flush=True)
        continue
    mp4 = os.path.join(SCRATCH, f"student-{week:02d}.mp4")
    t0 = time.time()
    try:
        if not os.path.exists(mp4):
            subprocess.run(["curl", "-sSL", "-o", mp4, f"{RELEASE}/week-{week:02d}-student.mp4"], check=True)
        segments, info = model.transcribe(
            mp4, language="en", vad_filter=True, beam_size=5,
            initial_prompt=PROMPT, word_timestamps=True,
            # condition_on_previous_text=True (the default) feeds each window
            # the previous text, and made the model repeat and invent: week 11
            # came back with a neighbouring sentence duplicated into a 0.64s
            # window (106 chars/sec, physically unsayable) and week 7 with a
            # wholly fabricated clause. Turning it off costs a little
            # cross-window consistency and buys a lot of not making things up.
            condition_on_previous_text=False,
            # Same failure mode from two other angles: drop text emitted over
            # silence, and mildly discourage loops.
            hallucination_silence_threshold=2.0,
            repetition_penalty=1.1)
        words = []
        for seg in segments:
            if seg.words:
                words.extend(seg.words)
        cues = build_cues(words)
        if not cues:
            print(f"week {week:02d}: NO SPEECH FOUND", flush=True)
            continue
        with open(cue_path, "w") as f:
            json.dump({"week": week, "title": lesson["title"],
                       "duration": info.duration, "cues": cues}, f, indent=1)
        with open(txt_path, "w") as f:
            f.write(f"Week {week}: {lesson['title']} (Student Video, {info.duration:.0f}s)\n")
            f.write("Numbered cues - the review pass corrects these by number.\n\n")
            for i, c in enumerate(cues, 1):
                f.write(f"{i}. {c['text']}\n")
        print(f"week {week:02d}: {len(cues)} cues, {info.duration:.0f}s audio in {time.time()-t0:.0f}s", flush=True)
    except Exception as exc:
        print(f"week {week:02d}: ERROR {exc}", flush=True)
    finally:
        if os.path.exists(mp4):
            os.remove(mp4)

print("ALL DONE", flush=True)
