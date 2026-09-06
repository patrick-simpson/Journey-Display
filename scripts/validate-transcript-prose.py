#!/usr/bin/env python3
"""Gate data/leader-transcript-prose.json before it can be printed.

The prose in that file is an edited rendering of each Leader Video transcript.
Editing spoken words into readable paragraphs is exactly the step where a
model can quietly summarize, drop a passage, or "tidy" a misheard word into a
confident Bible reference the speaker never gave — and unlike a caption that
flickers past, a printed handout makes that permanent. These checks are
mechanical, so they catch what proofreading misses:

  COVERAGE   paragraphs must tile cues 1..lastCue with no gap or overlap, and
             lastCue must be the real final cue of the VTT. A dropped passage
             shows up here as a gap.
  LENGTH     edited words vs spoken words. Removing filler trims maybe a
             quarter; anything under HALF means it was summarized, not edited.
  SCRIPTURE  every book of the Bible named in the prose must also appear in
             the transcript. Catches an invented or "corrected" citation.
  SHAPE      non-empty paragraphs, a heading on the first one, a sane number
             of headings.

Usage: python3 scripts/validate-transcript-prose.py
Exit status is non-zero if anything fails, so it can gate the render step.
"""
import json
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROSE = os.path.join(REPO, 'data', 'leader-transcript-prose.json')
TRANSCRIPTS = os.path.join(REPO, 'public', 'transcripts')

MIN_LENGTH_RATIO = 0.5
BOOKS = re.compile(
    r'\b((?:[123]\s+|First\s+|Second\s+|Third\s+)?'
    r'(?:Genesis|Exodus|Leviticus|Numbers|Deuteronomy|Joshua|Judges|Ruth|Samuel|Kings|Chronicles|'
    r'Ezra|Nehemiah|Esther|Job|Psalms?|Proverbs|Ecclesiastes|Isaiah|Jeremiah|Lamentations|Ezekiel|'
    r'Daniel|Hosea|Joel|Amos|Obadiah|Jonah|Micah|Nahum|Habakkuk|Zephaniah|Haggai|Zechariah|Malachi|'
    r'Matthew|Mark|Luke|John|Acts|Romans|Corinthians|Galatians|Ephesians|Philippians|Colossians|'
    r'Thessalonians|Timothy|Titus|Philemon|Hebrews|James|Peter|Jude|Revelation))\b')


def spoken(week):
    """(cue numbers, spoken words) straight from the VTT."""
    path = os.path.join(TRANSCRIPTS, f'week-{week:02d}-leader.vtt')
    lines = open(path).read().splitlines()
    nums, words, i = [], [], 0
    while i < len(lines):
        if re.fullmatch(r'\d+', lines[i].strip()) and '-->' in (lines[i + 1] if i + 1 < len(lines) else ''):
            nums.append(int(lines[i].strip()))
            j = i + 2
            while j < len(lines) and lines[j].strip():
                words.extend(lines[j].split())
                j += 1
            i = j
        else:
            i += 1
    return nums, words


def check(week, entry):
    problems = []
    nums, words = spoken(week)
    paras = entry.get('paragraphs') or []
    if not paras:
        return ['no paragraphs']

    # COVERAGE
    if entry.get('lastCue') != max(nums):
        problems.append(f"lastCue {entry.get('lastCue')} but VTT ends at {max(nums)}")
    expect = 1
    for p in paras:
        if p['fromCue'] != expect:
            problems.append(f"cue {expect} not covered (paragraph starts at {p['fromCue']})")
            break
        if p['toCue'] < p['fromCue']:
            problems.append(f"paragraph {p['fromCue']}-{p['toCue']} runs backwards")
            break
        expect = p['toCue'] + 1
    else:
        if expect != max(nums) + 1:
            problems.append(f"stops at cue {expect - 1}, transcript runs to {max(nums)}")

    # LENGTH
    edited = sum(len(p['text'].split()) for p in paras)
    ratio = edited / max(1, len(words))
    if ratio < MIN_LENGTH_RATIO:
        problems.append(f'summarized, not edited: {edited} words vs {len(words)} spoken ({ratio:.0%})')

    # SCRIPTURE. Matched case-INSENSITIVELY against the transcript: speech
    # recognition does not reliably capitalize a book name (week 1's audio came
    # through as "we see in acts 420"), and demanding a capital there raised
    # false alarms on citations the editor had repaired correctly. A gate that
    # cries wolf gets ignored, so the trade is deliberate — it does mean a
    # prose citation of "Acts" passes if the transcript only ever used "acts"
    # as an ordinary verb. What still gets caught is the case that matters: a
    # book named in the handout that appears nowhere in what was said.
    spoken_text = ' '.join(words).lower()
    said = set(m.group(1).split()[-1] for m in BOOKS.finditer(spoken_text.title()))
    said |= set(b.lower() for b in said)
    for m in BOOKS.finditer(' '.join(p['text'] for p in paras)):
        book = m.group(1).split()[-1]
        if book.lower() not in said and book.lower() not in spoken_text:
            problems.append(f'cites "{m.group(1)}" — never named in the transcript')

    # SHAPE
    if any(not p['text'].strip() for p in paras):
        problems.append('empty paragraph')
    if not paras[0].get('heading'):
        problems.append('first paragraph has no heading')
    headings = sum(1 for p in paras if p.get('heading'))
    if not 2 <= headings <= 10:
        problems.append(f'{headings} headings (want 2-10)')
    return problems


def main():
    if not os.path.exists(PROSE):
        print(f'{PROSE} does not exist yet')
        return 1
    weeks = json.load(open(PROSE))['weeks']
    bad = 0
    for key in sorted(weeks, key=int):
        problems = check(int(key), weeks[key])
        if problems:
            bad += 1
            print(f'FAIL week {key}:')
            for p in problems:
                print(f'       - {p}')
        else:
            paras = weeks[key]['paragraphs']
            print(f'ok   week {key:>2}: {len(paras)} paragraphs, '
                  f"{sum(1 for p in paras if p.get('heading'))} sections, "
                  f"{sum(len(p['text'].split()) for p in paras)} words")
    print(f'\n{len(weeks)} weeks checked, {bad} failing')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
