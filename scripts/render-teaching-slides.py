#!/usr/bin/env python3
"""Render Awana's Teaching Slides decks (one .pptx per lesson) into the
kiosk-ready images under public/slides/week-NN/.

Per week this writes:
  slide-1.jpg .. slide-4.jpg  Awana's own four teaching slides (title, core
                              verse, misconception, illumination), 1280x960
                              JPEG q85 — the Pi Zero decodes JPEG cheaply and
                              the source art is photographic texture anyway.
  template.jpg                the bare background of the deck's fifth slide
                              (Awana's blank "TEMPLATE" — heading + three
                              empty bullets). The kiosk renders the generated
                              Talk About It / Remember This / This Week
                              slides as HTML text over this, so their copy in
                              public/teaching-slides.json stays editable and
                              crisp at any size.

Every deck on the real Advocates page has exactly five slides (verified for
all 32 on 2026-09-06); the fifth is never copied as an image because it is the
template this project fills in. Deck URLs come from public/teaching-slides.json
(built by scraping the "Teaching Slides" buttons on the Advocates page — two of
them, weeks 3 and 4, carry a doubled ".pptx.pptx" extension on Awana's side;
that is their real URL, not a typo to fix here).

Requires: LibreOffice Impress (`soffice`), and the Python packages pypdfium2 +
Pillow. Same licensing character as the re-encoded videos: kiosk-only
copies, never linked or advertised anywhere else (see CLAUDE.md).

Usage: python3 scripts/render-teaching-slides.py [week ...]   (default: all)
"""
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.request
import zipfile

import pypdfium2 as pdfium
from PIL import Image

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = os.path.join(REPO, 'public', 'teaching-slides.json')
OUT_ROOT = os.path.join(REPO, 'public', 'slides')
WIDTH, HEIGHT = 1280, 960  # the decks are 10in x 7.5in (4:3)
DECK_SLIDES = 4            # slides 1-4 are Awana's; 5 is the blank template


def render_week(week, url, workdir):
    tag = f'week-{week:02d}'
    pptx = os.path.join(workdir, f'{tag}.pptx')
    urllib.request.urlretrieve(url, pptx)
    subprocess.run(
        ['soffice', '--headless', '--norestore', '--convert-to', 'pdf', '--outdir', workdir, pptx],
        check=True, capture_output=True, env={**os.environ, 'HOME': workdir},
    )
    pdf = pdfium.PdfDocument(os.path.join(workdir, f'{tag}.pdf'))
    n = len(pdf)
    if n != DECK_SLIDES + 1:
        raise SystemExit(f'{tag}: expected {DECK_SLIDES + 1} slides, got {n} — inspect before publishing')
    out = os.path.join(OUT_ROOT, tag)
    os.makedirs(out, exist_ok=True)
    for i in range(DECK_SLIDES):
        page = pdf[i]
        img = page.render(scale=WIDTH / page.get_width()).to_pil().convert('RGB')
        img.save(os.path.join(out, f'slide-{i + 1}.jpg'), 'JPEG', quality=85, optimize=True, progressive=True)
    # The template's background is the largest image the last slide references.
    z = zipfile.ZipFile(pptx)
    rels = z.read(f'ppt/slides/_rels/slide{n}.xml.rels').decode()
    media = ['ppt/media/' + m for m in re.findall(r'media/([^"]+)', rels)]
    if not media:
        raise SystemExit(f'{tag}: template slide references no background image')
    biggest = max(media, key=lambda m: z.getinfo(m).file_size)
    bg = Image.open(io.BytesIO(z.read(biggest))).convert('RGB').resize((WIDTH, HEIGHT), Image.LANCZOS)
    bg.save(os.path.join(out, 'template.jpg'), 'JPEG', quality=85, optimize=True, progressive=True)
    print(f'{tag}: {DECK_SLIDES} slides + template written')


def main():
    manifest = json.load(open(MANIFEST))
    weeks = [int(w) for w in sys.argv[1:]] or sorted(int(k) for k in manifest['weeks'])
    with tempfile.TemporaryDirectory() as workdir:
        for week in weeks:
            render_week(week, manifest['weeks'][str(week)]['deckUrl'], workdir)


if __name__ == '__main__':
    main()
