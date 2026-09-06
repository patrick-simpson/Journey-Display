#!/usr/bin/env python3
"""Make the rendered Leader Handout PDFs properly accessible, and verify it.

Chromium's tagged export gives real structure tags but leaves the document
without a language or a title, so a screen reader announces the filename and
guesses pronunciation. This stamps /Lang, the XMP + docinfo title and the
DisplayDocTitle viewer preference, then re-opens each file and refuses to
pass one that isn't tagged, titled and language-marked.

Run after scripts/render-leader-handouts.mjs.
Usage: python3 scripts/finalize-handout-pdf.py [week ...]   (default: all)
"""
import glob
import json
import os
import re
import sys

import pikepdf

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HANDOUTS = os.path.join(REPO, 'public', 'handouts')
SUMMARIES = json.load(open(os.path.join(REPO, 'data', 'leader-handout-summaries.json')))['weeks']


def finalize(path, title):
    with pikepdf.open(path, allow_overwriting_input=True) as pdf:
        pdf.Root.Lang = pikepdf.String('en-US')
        pdf.Root.ViewerPreferences = pikepdf.Dictionary(DisplayDocTitle=True)
        with pdf.open_metadata(set_pikepdf_as_editor=False) as meta:
            meta['dc:title'] = title
            meta['dc:language'] = ['en-US']
        pdf.docinfo['/Title'] = title
        pdf.save()


def verify(path):
    with pikepdf.open(path) as pdf:
        problems = []
        if '/StructTreeRoot' not in pdf.Root:
            problems.append('not tagged')
        if pdf.Root.get('/Lang') is None:
            problems.append('no /Lang')
        if not str(pdf.docinfo.get('/Title', '')).strip():
            problems.append('no title')
        if pdf.Root.get('/ViewerPreferences', {}).get('/DisplayDocTitle') is not True:
            problems.append('DisplayDocTitle unset')
        return len(pdf.pages), problems


def main():
    wanted = {int(w) for w in sys.argv[1:]}
    failures = 0
    for path in sorted(glob.glob(os.path.join(HANDOUTS, 'week-*-leader-handout.pdf'))):
        week = int(re.search(r'week-(\d+)', os.path.basename(path)).group(1))
        if wanted and week not in wanted:
            continue
        d = SUMMARIES[str(week)]
        finalize(path, f"Journey: Advocates Week {week} Leader Handout — {d['title']}")
        pages, problems = verify(path)
        flag = 'OK ' if not problems else 'BAD'
        if problems:
            failures += 1
        print(f"{flag} week {week:>2}: {pages} page(s){'  ' + ', '.join(problems) if problems else ''}")
    print('all handouts accessible' if not failures else f'{failures} handout(s) FAILED verification')
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
