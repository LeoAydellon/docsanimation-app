#!/usr/bin/env node
/*
 * Duplicate-app guard.
 *
 * WHY THIS EXISTS
 *   On 2026-09-01 a student sat blocked by a bug that had already been fixed --
 *   in a different copy of the same app, in a different repository. FOUR copies
 *   of TWO apps existed across four repos. They drifted. An afternoon went into
 *   fixing a file that student had never opened.
 *
 *   The copies are gone now. This exists so they cannot come back quietly.
 *
 * WHAT IT DOES
 *   Scans every repository on the account for pages carrying the study-guide
 *   app's signature, and fails if it finds a live copy that is not one of the
 *   two blessed ones. A retired copy that only redirects is fine -- that is how
 *   old bookmarks keep working.
 *
 * RUN
 *   node test/check-no-duplicates.js        (needs the gh CLI, already logged in)
 */

const { execSync } = require('child_process');

// The two real apps. Everything else claiming to be one of them is a duplicate.
const BLESSED = [
  'verde-lessons/ag-standards.html',
  'docsanimation-app/animation-cte-prep.html',
];

// A page is "the app" if it has these together. Cheap and specific enough that
// an ordinary lesson page will not trip it.
const SIGNATURE = ['function renderMap', 'function keyOf', 'TRACK'];

function sh(cmd) {
  try { return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch { return ''; }
}

(async () => {
  const repos = sh('gh repo list --limit 100 --json name -q ".[].name"')
    .split('\n').map(s => s.trim()).filter(Boolean);

  if (!repos.length) {
    console.log('Could not list repositories (is the gh CLI logged in?).');
    console.log('Skipping rather than reporting a false all-clear.');
    process.exit(0);
  }

  const owner = sh('gh api user -q .login').trim();
  console.log(`--- scanning ${repos.length} repositories for copies of the apps\n`);

  const found = [];
  for (const repo of repos) {
    const files = sh(`gh api repos/${owner}/${repo}/contents -q '.[]|select(.name|endswith(".html"))|.name' 2>/dev/null`)
      .split('\n').map(s => s.trim()).filter(Boolean);
    for (const f of files) {
      const url = `https://${owner.toLowerCase()}.github.io/${repo}/${f}`;
      let body = '';
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
        if (!r.ok) continue;
        body = await r.text();
      } catch { continue; }

      // A retired copy that only redirects is fine and deliberate.
      if (/location\.replace\('https:\/\//.test(body)) continue;
      if (!SIGNATURE.every(sig => body.includes(sig))) continue;

      const id = `${repo}/${f}`;
      const version = (body.match(/appVerTop">([0-9.]+)</) || [])[1] || 'none';
      const buggy = /locked = i > upto/.test(body);
      found.push({ id, version, buggy, blessed: BLESSED.includes(id) });
    }
  }

  for (const a of found) {
    const tag = a.blessed ? 'OK   ' : 'DUPE ';
    console.log(`  ${tag} ${a.id.padEnd(44)} v${a.version}${a.buggy ? '   ** HAS THE LOCK BUG **' : ''}`);
  }

  const dupes = found.filter(a => !a.blessed);
  const missing = BLESSED.filter(b => !found.some(a => a.id === b));
  const buggy = found.filter(a => a.buggy);

  console.log('');
  if (missing.length) {
    console.log('FAIL: an app that should exist was not found live:');
    missing.forEach(m => console.log('  ' + m));
  }
  if (dupes.length) {
    console.log('FAIL: extra live copies of the app exist. This is how a fix gets');
    console.log('applied to a file no student opens:');
    dupes.forEach(d => console.log('  ' + d.id));
    console.log('\nRetire each one to a redirect pointing at the real app.');
  }
  if (buggy.length) {
    console.log('FAIL: a live copy still traps students at item 1:');
    buggy.forEach(b => console.log('  ' + b.id));
  }
  if (!dupes.length && !missing.length && !buggy.length) {
    console.log(`RESULT: ${found.length} live app(s), both blessed, no duplicates, no lock bug.`);
    process.exit(0);
  }
  process.exit(1);
})();
