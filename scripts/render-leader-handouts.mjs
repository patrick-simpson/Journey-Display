// Render the per-lesson Leader Handout PDFs in public/handouts/.
//
// Page 1 is the one-page summary (Big Idea, Key Points, Scripture, Discussion
// Questions) from data/leader-handout-summaries.json. After it come the
// transcript pages: that week's Leader Video, edited into readable prose in
// data/leader-transcript-prose.json, with a timestamp beside each paragraph so
// a leader can jump back to the moment in the video, and section headings to
// skim by. Both data files are hand-editable — correct the JSON and re-run.
//
// Output is a TAGGED PDF (real structure tags via Chromium's tagged export);
// scripts/finalize-handout-pdf.py then stamps /Lang, the XMP + docinfo title
// and DisplayDocTitle. Run that second — a handout is not finished until it
// is tagged, titled and language-marked.
//
// Week 27 has no Leader Video, so it has no handout at all.
//
// Usage: node scripts/render-leader-handouts.mjs [week ...]   (default: all)
import { chromium } from 'playwright-core';
import { readFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const REPO = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const OUT_DIR = path.join(REPO, 'public', 'handouts');
const SUMMARIES = JSON.parse(readFileSync(path.join(REPO, 'data', 'leader-handout-summaries.json'), 'utf8')).weeks;
const PROSE_PATH = path.join(REPO, 'data', 'leader-transcript-prose.json');
const PROSE = existsSync(PROSE_PATH) ? JSON.parse(readFileSync(PROSE_PATH, 'utf8')).weeks : {};

// One Letter page of content, in CSS px, at the @page margins below.
const PAGE_CONTENT_PX = (11 - 0.55 * 2) * 96;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const pad = (w) => String(w).padStart(2, '0');

/** Cue number -> start time, read from the VTT the prose was edited from. */
function cueStarts(week) {
  const file = path.join(REPO, 'public', 'transcripts', `week-${pad(week)}-leader.vtt`);
  const starts = new Map();
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const num = lines[i].trim();
    const time = (lines[i + 1] || '').trim();
    if (/^\d+$/.test(num) && time.includes('-->')) {
      const [h, m, s] = time.split('-->')[0].trim().split(':');
      starts.set(Number(num), Math.floor(Number(h) * 3600 + Number(m) * 60 + parseFloat(s)));
    }
  }
  return starts;
}

const clock = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

function transcriptHTML(week) {
  const prose = PROSE[String(week)];
  if (!prose || !Array.isArray(prose.paragraphs) || !prose.paragraphs.length) return '';
  const starts = cueStarts(week);
  const body = prose.paragraphs
    .map((p) => {
      const at = starts.get(p.fromCue);
      const stamp = at === undefined ? '' : `<span class="ts">${clock(at)}</span>`;
      const heading = p.heading ? `<h3>${esc(p.heading)}</h3>` : '';
      return `${heading}<p class="tp">${stamp}${esc(p.text)}</p>`;
    })
    .join('\n');
  return `<section class="transcript">
  <h2>Leader Video &mdash; Full Transcript</h2>
  <p class="transcript-note">The talk from this week&rsquo;s Leader Video, lightly edited for reading.
  Times point back to that moment in the video.</p>
  ${body}
</section>`;
}

function renderHTML(d, compact) {
  const week = d.week;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Journey: Advocates Week ${week} Leader Handout — ${esc(d.title)}</title>
<style>
  /* Margins live on @page, not on body: body padding only insets the first
     page's top and the last page's bottom, so transcript pages in between
     would run to the paper's edge. */
  @page { size: Letter; margin: 0.55in 0.65in; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; }
  body {
    font-family: Helvetica, Arial, sans-serif;
    color: #1a1a1a;
    font-size: ${compact ? '10pt' : '10.8pt'};
    line-height: 1.42;
  }
  header { border-bottom: 3px solid #c8102e; padding-bottom: 8pt; margin-bottom: ${compact ? '8pt' : '11pt'}; }
  .kicker { font-size: 9.5pt; font-weight: bold; letter-spacing: 0.08em; text-transform: uppercase; color: #c8102e; }
  h1 { font-size: ${compact ? '16pt' : '18pt'}; margin-top: 3pt; }
  h2 { font-size: ${compact ? '11pt' : '12pt'}; color: #c8102e; margin-bottom: 3pt; text-transform: uppercase; letter-spacing: 0.04em; }
  section { margin-bottom: ${compact ? '7pt' : '10pt'}; }
  ul, ol { padding-left: 16pt; }
  li { margin-bottom: ${compact ? '2pt' : '3pt'}; }
  .scripture { font-style: italic; }
  footer { margin-top: ${compact ? '8pt' : '12pt'}; padding-top: 6pt; border-top: 1px solid #bbbbbb; font-size: 8pt; color: #444444; }

  /* ── Transcript pages ─────────────────────────────────────────────
     Single column, set larger and looser than page 1: this is read while
     teaching, and annotated in the margin. */
  .transcript { page-break-before: always; break-before: page; margin-bottom: 0; }
  .transcript > h2 { margin-bottom: 4pt; }
  .transcript-note { font-size: 9pt; color: #555555; margin-bottom: 12pt; }
  .transcript h3 {
    font-size: 11.5pt;
    margin-top: 14pt;
    margin-bottom: 5pt;
    color: #1a1a1a;
    /* A heading must never be stranded at the foot of a page. */
    page-break-after: avoid;
    break-after: avoid-page;
  }
  .transcript h3:first-of-type { margin-top: 0; }
  p.tp {
    font-size: 11pt;
    line-height: 1.5;
    margin-bottom: 9pt;
    /* Hanging indent: the timestamp sits out in the margin beside the first
       line, and still reads in document order for a screen reader. */
    padding-left: 0.62in;
    orphans: 2;
    widows: 2;
  }
  p.tp .ts {
    display: inline-block;
    width: 0.62in;
    margin-left: -0.62in;
    font-size: 8.5pt;
    color: #c8102e;
    font-variant-numeric: tabular-nums;
  }
</style>
</head>
<body>
<section class="handout-page">
  <header>
    <p class="kicker">Journey: Advocates&reg; &mdash; Leader Handout</p>
    <h1>Week ${week}: ${esc(d.shortTitle || d.title)}</h1>
  </header>
  <main>
    <section>
      <h2>Big Idea</h2>
      <p>${esc(d.bigIdea)}</p>
    </section>
    <section>
      <h2>Key Points from the Leader Video</h2>
      <ul>${d.keyPoints.map((k) => `<li>${esc(k)}</li>`).join('')}</ul>
    </section>
    ${d.scriptures.length ? `<section>
      <h2>Scripture</h2>
      <p class="scripture">${esc(d.scriptures.join(' • '))}</p>
    </section>` : ''}
    <section>
      <h2>Discussion Questions</h2>
      <ol>${d.questions.map((q) => `<li>${esc(q)}</li>`).join('')}</ol>
    </section>
  </main>
  <footer>
    <p>Summary and transcript of the Week ${week} Leader Video, for this church&rsquo;s Awana&reg; leaders
    &mdash; internal ministry use only; not for redistribution.
    Awana&reg; and Journey: Advocates&reg; are trademarks of Awana Clubs International.
    This handout is not affiliated with or endorsed by Awana. The transcript is of the Leader Video
    (public/transcripts/week-${pad(week)}-leader.vtt), lightly edited for reading.</p>
  </footer>
</section>
${transcriptHTML(week)}
</body>
</html>`;
}

const wanted = process.argv.slice(2).map(Number);
const weeks = Object.keys(SUMMARIES)
  .map(Number)
  .filter((w) => wanted.length === 0 || wanted.includes(w))
  .sort((a, b) => a - b);

mkdirSync(OUT_DIR, { recursive: true });
// PLAYWRIGHT_CHROMIUM override for machines that keep Chromium elsewhere.
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium',
  args: ['--no-sandbox'],
});
const page = await browser.newPage();

for (const week of weeks) {
  const d = SUMMARIES[String(week)];
  const out = path.join(OUT_DIR, `week-${pad(week)}-leader-handout.pdf`);
  let compact = false;
  // Page 1 must stay a single page; step it down once if the summary overruns.
  for (const attempt of [false, true]) {
    compact = attempt;
    await page.setContent(renderHTML(d, compact), { waitUntil: 'load' });
    const firstPageHeight = await page.evaluate(() => document.querySelector('.handout-page').scrollHeight);
    if (firstPageHeight <= PAGE_CONTENT_PX) break;
    if (attempt) console.warn(`week ${week}: summary still overruns one page (${(firstPageHeight / 96).toFixed(2)}in)`);
  }
  await page.pdf({ path: out, format: 'Letter', printBackground: true, tagged: true });
  console.log(`week ${week}: ${path.basename(out)}${compact ? ' (compact page 1)' : ''}${PROSE[String(week)] ? '' : ' — NO TRANSCRIPT PROSE'}`);
}

await browser.close();
