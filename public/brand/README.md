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
| `fonts/` | Galindo, Londrina Solid (400, 900) and Figtree (variable), as latin WOFF2 for the web and full TTF for the printer's canvas, with each font's SIL Open Font License. |
| `logos/` | Every club mark as vector SVG: `-white` (knockout for club-color and dark fields), `-color` (full color, for light fields), `-black` (one color, for the thermal label printer). Plus the Awana Clubs mark, white and black. |
| `shapes/` | The catalog's club wave per club, the corner tabs, the stepped chip's plate and keyline, the starburst and the tip blob. Single-color shapes paint in `currentColor`. |
| `doodles/` | The catalog's doodle set (sparkles, dots, rings, squiggles, zigzags, loops and more), in `currentColor`. |

## The design language, in one paragraph

A club-color S-wave rises from the bottom and carries the name. A wavy
corner tab names the section. A stepped two-tier chip puts a small label
over a big value ("RIGHT NOW / 7:56"). Doodles come in clusters of three,
never a dense field. One hot red-orange (`hot`, `#F15A28`) marks what is
new or special. Shapes are flat: depth comes from a hard offset shadow or an
offset outline, never a blur. Galindo shouts (names, headlines, numbers),
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
and are not bundled. Galindo, Londrina Solid and Figtree are the closest
free matches, chosen by rendering each candidate beside the catalog's own
glyphs.

## Regenerating from a new catalog

`scripts/brand/extract-catalog-brand.py` rebuilds every mark and shape
from the catalog PDF (run it against next year's catalog, then copy the
pieces listed above into this folder by hand and update the colors in
`tokens.json`, `tokens.css` and `../theme.json` together). A unit test
(`src/lib/brandKit.test.js`) fails if `tokens.css`, `tokens.json` and
`theme.json` disagree.

## Mirrors

`journey-display/public/brand/` and
`Print-TwoTimTwo-Labels/print-server/public/brand/` are byte-identical
copies of this folder, checked by a drift test in each repo, so neither
depends on the network at showtime. Change the kit here first, then
re-copy it into both.

## Trademarks

The club marks and the Awana Clubs mark are trademarks of Awana Clubs
International, used here by the owner's decision for the church's own
club screens and labels. See `TRADEMARKS.md` at the repo root.
