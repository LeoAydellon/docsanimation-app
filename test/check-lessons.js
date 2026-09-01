#!/usr/bin/env node
/*
 * Lesson sweep — every page, every link, every video.
 *
 * WHY
 *   On 2026-09-01 a sweep found EIGHT of ten Agribusiness videos dead. They had
 *   been pulled or made private since the lessons were written, and nothing
 *   noticed. A student clicking one gets a black box, and the teacher finds out
 *   in front of the class.
 *
 *   Lesson content rots quietly. Code breaks loudly; a YouTube video just stops
 *   existing one day and the HTML around it stays perfectly valid.
 *
 * WHAT IT CHECKS
 *   - every .html page is present and parses
 *   - every internal link resolves to a real file
 *   - every YouTube video still exists (via oembed; 404 = gone or private)
 *   - every external link still responds
 *
 * RUN
 *   node test/check-lessons.js           # local files + videos + external links
 *   node test/check-lessons.js --quick   # skip the network checks
 */

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..');
const QUICK = process.argv.includes('--quick');

const pages = fs.readdirSync(DIR).filter(f => f.endsWith('.html')).sort();
let problems = [];
let checked = { pages: 0, links: 0, videos: 0, external: 0 };

function read(f) { return fs.readFileSync(path.join(DIR, f), 'utf8'); }

async function head(url) {
  try {
    const r = await fetch(url, { method: 'GET', redirect: 'follow',
                                 signal: AbortSignal.timeout(12000) });
    return r.status;
  } catch (e) { return 0; }
}

(async () => {
  console.log(`--- sweeping ${pages.length} pages\n`);

  // ---- structure + internal links -----------------------------------------
  for (const f of pages) {
    checked.pages++;
    const s = read(f);
    if (s.length < 300) problems.push([f, 'page is suspiciously small — truncated?']);
    if (!/<title>/i.test(s)) problems.push([f, 'no <title> — shows as a blank tab']);
    const o = (s.match(/<script/g) || []).length, c = (s.match(/<\/script>/g) || []).length;
    if (o !== c) problems.push([f, `script tags unbalanced (${o}/${c})`]);

    for (const m of s.matchAll(/href="([^"#:]+\.html)"/g)) {
      checked.links++;
      if (!fs.existsSync(path.join(DIR, m[1])))
        problems.push([f, `broken link -> ${m[1]}`]);
    }
  }

  if (QUICK) { report(); return; }

  // ---- videos --------------------------------------------------------------
  // A dead video is the most common rot and the most invisible: the page still
  // renders perfectly, the embed is just empty.
  const vids = new Map();               // id -> [pages]
  for (const f of pages) {
    const s = read(f);
    for (const m of s.matchAll(/youtube\.com\/(?:watch\?v=|embed\/)([A-Za-z0-9_-]{6,})/g)) {
      if (!vids.has(m[1])) vids.set(m[1], []);
      if (!vids.get(m[1]).includes(f)) vids.get(m[1]).push(f);
    }
  }
  for (const [id, where] of vids) {
    checked.videos++;
    const st = await head(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`);
    if (st !== 200)
      problems.push([where.join(', '), `DEAD VIDEO ${id} — removed or made private`]);
  }

  // ---- external links ------------------------------------------------------
  const ext = new Map();
  for (const f of pages) {
    for (const m of read(f).matchAll(/href="(https?:\/\/[^"]+)"/g)) {
      if (/youtube\.com\/(watch|embed)/.test(m[1])) continue;   // covered above
      if (!ext.has(m[1])) ext.set(m[1], []);
      if (!ext.get(m[1]).includes(f)) ext.get(m[1]).push(f);
    }
  }
  for (const [url, where] of ext) {
    checked.external++;
    const st = await head(url);
    if (st === 0 || st >= 400)
      problems.push([where.join(', '), `dead link (${st || 'no response'}) ${url}`]);
  }

  report();
})();

function report() {
  console.log(`checked: ${checked.pages} pages, ${checked.links} internal links, `
            + `${checked.videos} videos, ${checked.external} external links\n`);
  if (!problems.length) {
    console.log('RESULT: everything resolves. Nothing rotten.');
    process.exit(0);
  }
  console.log(`RESULT: ${problems.length} problem(s) a student would hit:\n`);
  for (const [where, what] of problems) console.log(`  ${what}\n      in: ${where}`);
  console.log('\nDead videos need a human to choose replacements — that is teaching');
  console.log('content, not a code fix.');
  process.exit(1);
}
