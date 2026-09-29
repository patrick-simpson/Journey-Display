# Brand kit (Awana Clubs 2026–27 catalog)

One kit for every screen in the Awana app family: the lobby signage
(`index.html`), the projector (`countdown.html`), the Journey kiosk and the
label printer's dashboard and labels. This folder is the canonical copy;
the other repos carry byte-identical mirrors.

| File | What it is |
| --- | --- |
| `tokens.json` | Club colors (primary, deep, tint), house colors, the three font families and the motion timing table, for code (JS, canvas). |
| `tokens.css` | The same values as `--brand-*` custom properties, for plain CSS. |
| `fonts.css` | `@font-face` rules for pages with no bundler (paths relative to this file). |
| `fonts/` | Paytone One and Londrina Solid, each as the FULL font (an unmodified TTF and a lossless WOFF2), and Figtree (variable): a latin WOFF2 for the web and the full TTF for the printer's canvas, with each font's SIL Open Font License. See "The three voices" and "Reserved Font Names and the OFL" below. |
| `logos/` | Every club mark as vector SVG: `-white` (knockout for club-color and dark fields), `-color` (full color, for light fields), `-black` (one color, for the thermal label printer). Plus the Awana Clubs mark, white and black. |
| `shapes/` | The catalog's club wave per club, the corner tabs, the stepped chip's plate and keyline, the starburst and the tip blob. Single-color shapes paint in `currentColor`. |
| `doodles/` | The catalog's doodle set (sparkles, dots, rings, squiggles, zigzags, loops and more), in `currentColor`. |

## The design language, in one paragraph

A club-color S-wave rises from the bottom and carries the name. A wavy
corner tab names the section. A stepped two-tier chip puts a small label
over a big value ("RIGHT NOW / 7:56"). Doodles come in clusters of three,
never a dense field. One hot red-orange (`hot`, `#F15A28`) marks what is
new or special. Shapes are flat: depth comes from a hard offset shadow or an
offset outline, never a blur. Paytone One shouts (names, headlines, numbers),
Londrina Solid labels (kickers, tabs, buttons), Figtree is read (body,
settings, notices).

Motion runs on one rhythm: a 100 ms beat, and four curves only (`wipe` for
color fields, `settle` for type landing, `pop` for stickers and chips,
`exit` for leaving). Only transform and opacity animate. Every animation's
final keyframe is its resting state, so the zero-animation Pi Zero embed
(`?lowPower=1`) shows a finished design.

## Where the values come from

Club colors were sampled from the vector fills of the catalog's club
opener pages (p.25 Puggles, p.33 Cubbies, p.41 Sparks, p.49 T&T, p.57 Trek,
p.63 Journey). One deliberate exception, by the owner's decision
(2026-09-27): **Puggles is blue** (`#1DB6D9`, the Puggles wordmark and duck
outline), not the orange its catalog page happens to use; its tint is the
pastel of the Puggles shirt and the duck's body. Deep shades carry hard
offset shadows and text on tints; tints are the pale club band colors from
the catalog's awards directory.

The catalog's own fonts (RugFish, Motel California, Gibson) are commercial
and are not bundled. Paytone One, Londrina Solid and Figtree are free
stand-ins (SIL OFL 1.1), chosen by rendering each candidate beside the
catalog's own glyphs and, for the shout, on the real screens and labels.

## The three voices

| Voice | Family (CSS name) | Used for | Files in `fonts/` |
| --- | --- | --- | --- |
| Shout | `'Paytone One'` (`tokens.json` `fonts.display`, `--brand-font-display`) | Children's names, headlines, numbers, the name on a printed label | `paytone-one-full-400-normal.woff2`, `PaytoneOne-Regular.ttf` |
| Label | `'Londrina Solid'` (400, 900) | Kickers, tabs, buttons, small caps lines | `londrina-solid-full-{400,900}-normal.woff2`, `LondrinaSolid-{Regular,Black}.ttf` |
| Read | `'Figtree'` (300 to 900, variable) | Body copy, settings, notices | `figtree-latin-wght-normal.woff2`, `Figtree-Variable.ttf` |

Each has its license beside it (`OFL-PaytoneOne.txt`, `OFL-LondrinaSolid.txt`,
`OFL-Figtree.txt`). The token and property names stay `display` /
`--brand-font-display` (consumers read those); the family they name is what
changed.

### Paytone One is the shout (owner decision, 2026-09-29)

Galindo was the shout from 2026-09-27 to 2026-09-29. The owner replaced it
with **Paytone One** on every surface (lobby signage, projector, Journey
kiosk, printed labels, the printer's dashboard, phone and status windows)
because Galindo "looks too much like SpongeBob": its bulging, wavy edges,
domed A, notched C and capitals that bob a few percent up and down read as a
cartoon title card, worst on the labels' mixed-case names. The owner chose
Paytone One from a side-by-side render of the real screens and labels. Lilita
One was the runner-up (it lacks Polish, Czech, Turkish, Romanian and
Vietnamese letters, and it is already the season posters' face). Londrina
Solid and Figtree stay. The posters keep their own faces (`--font-poster` and
`--promo-font-*` are not brand tokens).

What Paytone One is: a single heavy weight (Regular 400, by Vernon Adams,
copyright "The Paytone Project Authors"), upright and level, with even strokes.
Measured from the font file (1000 units per em):

- **Coverage.** Basic Latin and Latin-1, Latin Extended-A (all 128), the
  Romanian letters Ș ș Ț ț, and precomposed Vietnamese (all of U+1EA0 to
  U+1EF9, 90 letters, plus Ă Â Ê Ô Ơ Ư Đ in both cases); combining U+0300,
  0301, 0303, 0304, 0308, 0309 and 0323. Galindo lacked Ș Ț and most of
  Vietnamese, so code that assumed those letters fall back to Baloo 2 no
  longer holds for the shout. **No Cyrillic, Greek (three signs only), Hebrew,
  Arabic, Devanagari, Thai or CJK**: those still fall through the CSS stack,
  as they always did.
- **Figures.** Default digits are proportional (0 is .679 em, 1 is .444 em).
  The `tnum` feature gives every digit a .600 em cell
  (`font-variant-numeric: tabular-nums`); `pnum`, `case`, `frac`, `sups`
  and `kern` are there too.
- **Metrics.** Cap height .688 em (Galindo .725), so at one font-size names
  draw about 5 to 6 percent shorter. hhea ascent 1.113 em, descent -.283 em,
  line gap 0. Accented capitals rise past the ascent (É 1.045 em, Ễ 1.161
  em), and the Ș comma drops to -.351 em, below the descent: a line box or an
  `overflow: hidden` sized to ascent and descent will clip them. Descenders
  are shallow (-.195 em; Ç and Ą reach -.248 em).

## Regenerating from a new catalog

`scripts/brand/extract-catalog-brand.py` rebuilds every mark and shape
from the catalog PDF (run it against next year's catalog, then copy the
pieces listed above into this folder by hand and update the colors in
`tokens.json`, `tokens.css` and `../theme.json` together). A unit test
(`src/lib/brandKit.test.js`) fails if `tokens.css`, `tokens.json` and
`theme.json` disagree, if the three font voices differ between `tokens.json`,
`tokens.css` and `fonts.css`, and if the Paytone One or Londrina Solid files
stop being the unmodified font (see "Reserved Font Names and the OFL").

## Mirrors

`journey-display/public/brand/` and
`Print-TwoTimTwo-Labels/print-server/public/brand/` are byte-identical
copies of this folder, checked by a drift test in each repo, so neither
depends on the network at showtime. Change the kit here first, then
re-copy it into both. The Paytone One and Londrina Solid files must stay whole
in the mirrors too (the same OFL reasoning applies to a copy).

## Reserved Font Names and the OFL

Two of the kit's three families declare a Reserved Font Name in their license:
Paytone One ("Paytone" and "Paytone One") and Londrina Solid ("Londrina
Solid"). Figtree declares none, which is why its file is allowed to be a latin
subset. **The Reserved Font Name is why the kit ships the whole font and never
a subset** of Paytone One or Londrina Solid. OFL clause 3: "No Modified Version
of the Font Software may use the Reserved Font Name(s) unless explicit written
permission is granted", and the license defines a Modified Version as any
derivative made "by adding to, deleting, or substituting ... any of the
components of the Original Version, by changing formats or by porting the Font
Software to a new environment". So a latin-only subset (which is what
`@fontsource` and Google Fonts serve, and what the Londrina Solid files here
were until 2026-09-29) would have to be renamed. Decision, from the OFL FAQ
(https://openfontlicense.org/ofl-faq/, section 2), applied identically to both
fonts:

- **The TTF is shipped unmodified** (`PaytoneOne-Regular.ttf`,
  `LondrinaSolid-Regular.ttf`, `LondrinaSolid-Black.ttf`; for the printer's
  canvas and as the web fallback).
- **A WOFF2 of the full font is allowed, under two conditions.** FAQ 2.2:
  "A change in font format normally is considered modification, and Reserved
  Font Names (RFNs) cannot be used. Because of the design of the WOFF and
  WOFF2 formats, however, it is possible to create a WOFF/WOFF2 version that
  is not considered modification, and so would not require a name change."
  FAQ 2.2.1: "You are allowed to create, use and distribute a WOFF version of
  an OFL font without changing the font name, but only if the original font
  data remains unchanged except for WOFF compression, and WOFF-specific
  metadata is either omitted altogether or present and includes, unaltered,
  the contents of all equivalent metadata in the original font." The
  "Webfonts and Reserved Font Names" paper says WOFF there means both WOFF and
  WOFF2. FAQ 2.2.2 warns that many converters do not meet this and their
  output is a Modified Version.
- **So each `*-full-*-normal.woff2` is built to meet it, and a test proves
  it.** It is every table of its TTF, Brotli-compressed with the WOFF2 "null
  transform" (glyf and loca at transform version 3, "presented in its
  original, unmodified format" in the WOFF2 spec), no extended metadata block
  and no private data. Decoded by the Google reference decoder and by
  fontTools, every table is byte-identical to the TTF's, with two exceptions
  that the WOFF2 spec itself requires of an encoder (section 5):
  - `head`: bit 11 of `flags` is set ("lossless modifying transform") and
    `checkSumAdjustment` follows;
  - `DSIG`: "the compliant WOFF2 encoder MUST remove the DSIG table", because
    any container change invalidates a signature. Paytone One has none.
    Londrina Solid's two TTFs carry the 8-byte empty stub (version 1, zero
    signatures, flags 0), so nothing is lost; the test pins the stub as empty
    and fails if a TTF ever carries a real signature.

  The default WOFF2 glyf transform is NOT used: it re-encodes `glyf` and `loca`
  (Paytone's 59,902 bytes become 59,028), which is lossless for drawing but is
  not "unchanged". `src/lib/brandKit.test.js` decodes every WOFF2 in the kit
  and fails if any table other than `head` (and the empty `DSIG`) differs from
  the TTF's, if the file grows a metadata block, or if a TTF stops matching
  upstream.
- **Subsetting is out (FAQ 2.6):** "Removing any parts of the font when
  delivering a webfont to a browser, including unused glyphs and smart font
  code, is considered modification." That includes `@fontsource` and Google
  Fonts subset files: a screen that wants Paytone One or Londrina Solid loads
  the files here, not a latin cut of them, and neither `@fontsource` package
  may be a dependency (`brandKit.test.js` fails on either). If a subset is ever
  wanted, it must be renamed (for example "Awana Shout") and stop using the
  reserved name in its name table.
- `font-display: swap` and the TTF fallback in `fonts.css` are unchanged in
  spirit; a browser that cannot decode the null transform skips to the TTF.

To rebuild a WOFF2 (for a new upstream version), from the kit's TTF:

```python
from fontTools.ttLib import TTFont
from fontTools.ttLib.woff2 import WOFF2FlavorData
f = TTFont('PaytoneOne-Regular.ttf', lazy=True, recalcBBoxes=False, recalcTimestamp=False)
f.flavor = 'woff2'
f.flavorData = WOFF2FlavorData(transformedTables=set())  # null transform
f.save('paytone-one-full-400-normal.woff2')   # likewise LondrinaSolid-Regular.ttf -> londrina-solid-full-400-normal.woff2, LondrinaSolid-Black.ttf -> ...-900-...
```

The output is deterministic (a rebuild from the same TTF is byte-identical).
fontTools drops `DSIG` on its own, as the spec asks.

### Paytone One

`fonts/OFL-PaytoneOne.txt` is the upstream `OFL.txt` verbatim (SIL OFL 1.1,
"Copyright 2011 The Paytone Project Authors, with Reserved Font Names
'Paytone' and 'Paytone One'"). The source is `google/fonts` `ofl/paytoneone/`
(`PaytoneOne-Regular.ttf`, 114,648 bytes, sha256
`1c07073b0b578199b54c7866d55e2b631d285e8aa4bb4fbc08809d980cd49b14`;
Version 1.002). The font's own `name` table carries the copyright and the
license notice and URL (IDs 0, 13, 14). `paytone-one-full-400-normal.woff2` is
all 17 of its tables (`GPOS`, `GSUB` and the hinting tables included): 42,732
bytes against 114,648 for the TTF.

### Londrina Solid

`fonts/OFL-LondrinaSolid.txt` is the upstream `OFL.txt` verbatim (SIL OFL 1.1,
"Copyright 2011 The Londrina Solid Authors ... with Reserved Font Name
'Londrina Solid'"). The source is `google/fonts` `ofl/londrinasolid/`, Version
1.002, and both TTFs were compared with upstream byte for byte:

| File | Bytes | sha256 |
| --- | --- | --- |
| `LondrinaSolid-Regular.ttf` | 92,132 | `e82b9b3ee21ccf153dcf67e5f4226a210474591a6ad31b5f17f2f14dc2524514` |
| `LondrinaSolid-Black.ttf` | 93,408 | `8c63a15e3fa34e0b362abeb903944a2bd45e71b1efa122486c0a47e295eae06f` |

`londrina-solid-full-400-normal.woff2` (38,856 bytes) and
`londrina-solid-full-900-normal.woff2` (40,908 bytes) are the 17 tables that
survive the DSIG rule above. They replace two `@fontsource` latin subsets that
had 210 of the font's 230 mapped characters, no `GDEF` table and no license
text (name ID 13): a Modified Version under a reserved name. The full font also
draws Š š Ž ž Ÿ ƒ ĳ ⅛ ⅜ ⅝ ⅞ ● and U+FB00 to U+FB04, which the subset lacked, so
the browser sent them to the fallback face.

The signage and the projector use the 400 cut only (Londrina's Regular is
already bold, and no CSS weight may reach for the much fatter Black), each in
one `@font-face` in `src/styles/app.css` and `src/presentation/index.css`;
the 900 files are for the pages that load `fonts.css`.

## Trademarks

The club marks and the Awana Clubs mark are trademarks of Awana Clubs
International, used here by the owner's decision for the church's own
club screens and labels. See `TRADEMARKS.md` at the repo root.
