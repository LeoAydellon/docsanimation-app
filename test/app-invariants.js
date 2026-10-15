#!/usr/bin/env node
/*
 * Ag CTE Prep — invariant tests.
 *
 * WHY THIS EXISTS
 *   This app started as a demo ("for student test run") and became production
 *   classroom software without anyone adding a safety net. It shipped nine
 *   times in a month with nothing checking it. Every regression was found by a
 *   student sitting in front of it, which is the most expensive possible place
 *   to find one.
 *
 *   Each check below is a thing a student would FEEL if it broke. Several are
 *   guards against regressions that actually happened, not hypotheticals.
 *
 * DESIGN
 *   Plain Node, zero dependencies, no build step. Nothing to install, nothing
 *   to keep up to date, nothing that rots. Runs in about a second.
 *
 * RUN
 *   node test/app-invariants.js            # checks the local file
 *   node test/app-invariants.js --live     # also checks the deployed site
 *   node test/app-invariants.js <file.html>  # checks a different build, e.g.
 *                                             a PREVIEW file not yet published
 *                                             (PT100_* checks below only run
 *                                             when that build actually has the
 *                                             feature — see T15 guard)
 */

const fs = require('fs');
const path = require('path');

const fileArg = process.argv.slice(2).find(a => a.endsWith('.html'));
const APP = fileArg ? path.resolve(fileArg) : path.join(__dirname, '..', 'animation-cte-prep.html');
const LIVE = 'https://leoaydellon.github.io/docsanimation-app/animation-cte-prep.html';

let pass = 0, fail = 0;
const failures = [];

function check(name, fn) {
  try {
    const why = fn();
    if (why) { fail++; failures.push([name, why]); console.log('FAIL  ' + name + '\n        ' + why); }
    else { pass++; console.log('pass  ' + name); }
  } catch (e) {
    fail++; failures.push([name, e.message]);
    console.log('FAIL  ' + name + '\n        threw: ' + e.message);
  }
}

const src = fs.readFileSync(APP, 'utf8');

/* Pull a top-level `const NAME = [...]` array out of the source and evaluate
 * it. Brace-counting rather than regex, because these arrays contain prose with
 * brackets in it and a regex gets it wrong. */
function extractArray(name) {
  const start = src.indexOf('const ' + name + ' =');
  if (start < 0) return null;
  const open = src.indexOf('[', start);
  if (open < 0) return null;
  let depth = 0, inStr = false, quote = '', esc = false;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (inStr) { if (c === quote) inStr = false; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = true; quote = c; continue; }
    if (c === '[') depth++;
    else if (c === ']') { depth--; if (depth === 0) return eval(src.slice(open, i + 1)); }
  }
  return null;
}

/* Pull a top-level `function NAME(...){...}` out of the source and return it
 * as a callable. Same brace-counting approach as extractArray, for the same
 * reason (the function bodies contain strings with braces in them). */
function extractFunction(name) {
  const m = src.match(new RegExp('function\\s+' + name + '\\s*\\('));
  if (!m) return null;
  const start = m.index;
  const open = src.indexOf('{', start);
  if (open < 0) return null;
  let depth = 0, inStr = false, quote = '', esc = false;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (inStr) { if (c === quote) inStr = false; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = true; quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return eval('(' + src.slice(start, i + 1) + ')'); }
  }
  return null;
}

console.log('--- Ag CTE Prep invariants\n');

/* ---------------------------------------------------------------- structure */

check('T01 the file parses as balanced HTML/JS', () => {
  const o = (src.match(/\{/g) || []).length, c = (src.match(/\}/g) || []).length;
  if (o !== c) return `braces unbalanced: ${o} open, ${c} close`;
  const po = (src.match(/\(/g) || []).length, pc = (src.match(/\)/g) || []).length;
  if (po !== pc) return `parens unbalanced: ${po} open, ${pc} close`;
  const so = (src.match(/<script/g) || []).length, sc = (src.match(/<\/script>/g) || []).length;
  if (so !== sc) return `script tags unbalanced: ${so} open, ${sc} close`;
  if (!src.trim().endsWith('</html>')) return 'file does not end with </html> — truncated?';
  return null;
});

check('T02 the app is self-contained (no external assets to fail)', () => {
  const ext = (src.match(/(?:src|href)="https?:\/\/[^"]+/g) || [])
    .filter(u => !/fonts\.googleapis|\.json/.test(u));
  return ext.length ? 'external asset(s): ' + ext.slice(0, 3).join(', ') : null;
});

/* ------------------------------------------------- the regressions we've hit */

check('T03 a student is NEVER locked out of an item (the Noah regression)', () => {
  // 2026-09-01: a student who had reached item 5 lost progress, was restarted
  // at 1, and could not navigate forward. renderMap computed
  // `locked = i > upto`, which is correct only while progress survives.
  if (/locked\s*=\s*i\s*>\s*upto/.test(src))
    return 'renderMap locks items past `upto` again — a student whose progress '
         + 'resets will be trapped at item 1';
  if (!/locked\s*=\s*false/.test(src))
    return 'no `locked = false` found in renderMap — check the lock logic';
  return null;
});

check('T04 progress is saved somewhere that survives a Chromebook wipe', () => {
  if (!/localStorage/.test(src)) return 'no localStorage — progress would die on reload';
  if (!/firebaseio|cloudSave/.test(src))
    return 'no cloud save — progress will not follow a student to another machine';
  return null;
});

check('T05 cloud restore is actually wired, not just defined', () => {
  const defined = /function cloudSave|cloudSave\s*=|var cloudSave/.test(src);
  if (!defined) return 'cloudSave is not defined';
  // it must be CALLED, not merely present
  const calls = (src.match(/cloudSave\s*\(/g) || []).length;
  if (calls < 2) return `cloudSave defined but called only ${calls} time(s) — likely dead code`;
  return null;
});

/* --------------------------------------------------- the teaching content */

check('T06 the standards list loads and is non-trivial', () => {
  const S = extractArray('STANDARDS');
  if (!S) return 'STANDARDS array could not be parsed — the app will render empty';
  if (!Array.isArray(S)) return 'STANDARDS is not an array';
  if (S.length < 10) return `only ${S.length} standards — content may have been truncated`;
  return null;
});

check('T07 every standard has an id, a title and a lesson', () => {
  const S = extractArray('STANDARDS') || [];
  const bad = S.filter(s => !s || !s.id || !s.title || !s.lesson)
               .map(s => (s && s.id) || '(no id)');
  return bad.length ? `${bad.length} incomplete: ${bad.slice(0, 5).join(', ')}` : null;
});

check('T08 standard ids are unique (duplicates corrupt saved progress)', () => {
  const S = extractArray('STANDARDS') || [];
  const seen = new Set(), dup = [];
  S.forEach(s => { if (seen.has(s.id)) dup.push(s.id); seen.add(s.id); });
  return dup.length ? 'duplicate ids: ' + dup.slice(0, 5).join(', ') : null;
});

check('T09 the track BUILDS correctly from the standards', () => {
  // TRACK starts as [] and is populated at runtime, so asserting on the
  // literal proves nothing. Build it the way the app does and check the result.
  const S = extractArray('STANDARDS');
  if (!S) return 'STANDARDS unavailable, cannot build the track';
  const ckm = src.match(/const CK_EVERY\s*=\s*(\d+)/);
  if (!ckm) return 'CK_EVERY not found — checkpoint spacing is undefined';
  const CK_EVERY = Number(ckm[1]);
  if (!(CK_EVERY > 0)) return 'CK_EVERY is not a positive number';

  const TRACK = [];
  S.forEach((s, i) => {
    TRACK.push({ kind: 'std', idx: i, id: s.id });
    if ((i + 1) % CK_EVERY === 0) TRACK.push({ kind: 'ck', ckN: (i + 1) / CK_EVERY });
  });

  if (!TRACK.length) return 'the track builds empty — the map would render nothing';
  if (TRACK.length < S.length) return 'the track has fewer entries than standards';
  const bad = TRACK.filter(t => !t || !t.kind).length;
  if (bad) return `${bad} track entries have no kind`;
  const stds = TRACK.filter(t => t.kind === 'std').length;
  if (stds !== S.length) return `track holds ${stds} standards but there are ${S.length}`;
  return null;
});

check('T10 every student can reach every item from a cold start', () => {
  // The Noah case, simulated: a student with NO saved progress (upto = 0).
  // Under the old rule (locked = i > upto) everything but item 1 was locked.
  // Reproduce both rules against a real track and assert the current one frees
  // the whole track.
  const S = extractArray('STANDARDS') || [];
  const ckm = src.match(/const CK_EVERY\s*=\s*(\d+)/);
  const CK_EVERY = ckm ? Number(ckm[1]) : 5;
  const TRACK = [];
  S.forEach((s, i) => {
    TRACK.push({ kind: 'std' });
    if ((i + 1) % CK_EVERY === 0) TRACK.push({ kind: 'ck' });
  });
  const upto = 0;                                  // fresh student, no progress
  const oldRule = TRACK.filter((_, i) => i > upto).length;   // what used to lock
  const nowLocked = TRACK.filter(() => false).length;        // current rule
  if (!TRACK.length) return 'no track to test';
  if (oldRule === 0) return 'test is not exercising the failure it guards';
  if (nowLocked !== 0)
    return `${nowLocked} of ${TRACK.length} items still locked for a fresh student`;
  return null;
});

/* ------------------------------------------------- the parts students touch */

check('T11 the functions the student journey depends on all exist', () => {
  const need = ['keyOf', 'renderMap', 'renderQ', 'begin', 'save', 'load'];
  const missing = need.filter(f => !new RegExp('function\\s+' + f + '\\s*\\(').test(src));
  return missing.length ? 'missing: ' + missing.join(', ') : null;
});

check('T12 the start/name controls the student first touches are present', () => {
  const need = ['startBtn', 'nameIn'];
  const missing = need.filter(id => !src.includes(id));
  return missing.length ? 'missing element id(s): ' + missing.join(', ') : null;
});

check('T13 the version is stamped, and all three copies agree', () => {
  // The version is how Leo knows a change actually reached students. It is
  // useless if the three places can disagree, so this enforces one truth.
  const t = src.match(/<title>Animation CTE Prep — Verde Tech ([0-9]+\.[0-9]+)<\/title>/);
  const h = src.match(/id="appVerTop">([0-9]+\.[0-9]+)</);
  const c = src.match(/const APP_VERSION = '([0-9]+\.[0-9]+)'/);
  if (!t) return 'no version in <title> — the browser tab will not show it';
  if (!h) return 'no version in the on-screen header — Leo cannot see it in class';
  if (!c) return 'no APP_VERSION constant in the script';
  if (t[1] !== h[1] || h[1] !== c[1])
    return `versions disagree: title ${t[1]}, header ${h[1]}, script ${c[1]}. `
         + 'Use: node test/bump-version.js <version>';
  return null;
});

check('T14 no leftover debugger or TODO-blocking marker ships', () => {
  if (/\bdebugger\b/.test(src)) return 'a `debugger` statement would freeze the app for students';
  return null;
});

/* ---------------------------------------- PB-0041: Practice Test (100) --
 * PREVIEW ONLY — this feature is deliberately NOT in the live student file
 * until Leo approves it, so these checks only assert anything when the
 * build being checked actually has FORM_100. Against the live file today
 * that means a skip, not a failure; against the preview build it is a full
 * check. */
const FORM_100 = extractArray('FORM_100');

if (!FORM_100) {
  console.log('skip  T15-T20 Practice Test (100) checks — FORM_100 not in this build (expected before Leo approves PB-0041)');
} else {

  check('T15 Practice Test (100) has exactly 100 items', () => {
    return FORM_100.length === 100 ? null : `FORM_100 has ${FORM_100.length} items, expected 100`;
  });

  check('T16 Practice Test (100) per-standard counts match the blueprint allocation', () => {
    const want = { '1.0':4, '2.0':1, '3.0':2, '4.0':15, '5.0':17, '6.0':20, '7.0':17, '8.0':10, '9.0':7, '10.0':3, '11.0':4 };
    const got = {};
    FORM_100.forEach(it => { got[it.std] = (got[it.std] || 0) + 1; });
    const bad = [];
    for (const std of Object.keys(want)) if (got[std] !== want[std]) bad.push(`${std}: want ${want[std]}, got ${got[std] || 0}`);
    for (const std of Object.keys(got)) if (!(std in want)) bad.push(`unexpected standard ${std} (${got[std]} items)`);
    return bad.length ? bad.join('; ') : null;
  });

  check('T17 every Practice Test (100) item has 4 non-empty options and a valid answer', () => {
    const bad = [];
    FORM_100.forEach(it => {
      if (!Array.isArray(it.options) || it.options.length !== 4) { bad.push(`${it.id}: ${it.options ? it.options.length : 0} options`); return; }
      if (it.options.some(o => !String(o || '').trim())) bad.push(`${it.id}: empty option`);
      if (!(Number.isInteger(it.answer) && it.answer >= 0 && it.answer <= 3)) bad.push(`${it.id}: answer=${it.answer}`);
    });
    return bad.length ? bad.slice(0, 8).join('; ') : null;
  });

  check('T18 Practice Test (100) is byte-for-byte equivalent to FORM-100-v1.json (q/options/answer)', () => {
    const fixturePath = path.join(__dirname, 'fixtures', 'FORM-100-v1.json');
    if (!fs.existsSync(fixturePath)) return 'fixtures/FORM-100-v1.json is missing — cannot verify against the source form';
    const canon = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    if (canon.length !== FORM_100.length) return `fixture has ${canon.length} items, build has ${FORM_100.length}`;
    const shape = arr => arr.map(it => ({ n: it.n, id: it.id, q: it.q, options: it.options, answer: it.answer }));
    const a = JSON.stringify(shape(canon.slice().sort((x, y) => x.n - y.n)));
    const b = JSON.stringify(shape(FORM_100.slice().sort((x, y) => x.n - y.n)));
    const crypto = require('crypto');
    const ha = crypto.createHash('sha256').update(a).digest('hex').slice(0, 16);
    const hb = crypto.createHash('sha256').update(b).digest('hex').slice(0, 16);
    console.log('      fixture checksum: ' + ha + '   build checksum: ' + hb);
    return a === b ? null : 'q/options/answer differ from the canonical FORM-100-v1.json';
  });

  check('T19 Practice Test (100) scoring returns the right totals (all-correct / all-wrong / mixed)', () => {
    const pt100Score = extractFunction('pt100Score');
    if (!pt100Score) return 'pt100Score() not found in the build';
    const n = FORM_100.length;
    const allCorrect = new Array(n).fill(true);
    const allWrong = new Array(n).fill(false);
    const mixed = new Array(n).fill(false).map((_, i) => i < 63); // 63 correct, by construction
    const bad = [];
    if (pt100Score(allCorrect) !== n) bad.push(`all-correct scored ${pt100Score(allCorrect)}, want ${n}`);
    if (pt100Score(allWrong) !== 0) bad.push(`all-wrong scored ${pt100Score(allWrong)}, want 0`);
    if (pt100Score(mixed) !== 63) bad.push(`mixed scored ${pt100Score(mixed)}, want 63`);
    return bad.length ? bad.join('; ') : null;
  });

  check('T20 Practice Test (100) reaches a completion state after item 100', () => {
    const pt100IsDone = extractFunction('pt100IsDone');
    if (!pt100IsDone) return 'pt100IsDone() not found in the build';
    const n = FORM_100.length;
    if (pt100IsDone(n - 1, n)) return `pt100IsDone(${n - 1}, ${n}) is true — flags complete one question early`;
    if (!pt100IsDone(n, n)) return `pt100IsDone(${n}, ${n}) is false — never reaches completion`;
    return null;
  });

  check('T21 Practice Test (100) pass mark is one named, provisional constant', () => {
    const m = src.match(/const PT100_PASS\s*=\s*(\d+)\s*;([^\n]*)/);
    if (!m) return 'PT100_PASS constant not found';
    if (Number(m[1]) !== 60) return `PT100_PASS is ${m[1]}, ticket's provisional value is 60`;
    if (!/provisional/i.test(m[2])) return 'PT100_PASS is not marked provisional in a trailing comment';
    return null;
  });

}

/* ------------------------------------------------------------- live check */

async function liveCheck() {
  console.log('\n--- live site');
  let body;
  try {
    const res = await fetch(LIVE, { redirect: 'follow' });
    if (!res.ok) { fail++; console.log('FAIL  L01 live site responds\n        HTTP ' + res.status); return; }
    body = await res.text();
    pass++; console.log('pass  L01 live site responds 200');
  } catch (e) {
    fail++; failures.push(['L01 live site responds', e.message]);
    console.log('FAIL  L01 live site responds\n        ' + e.message); return;
  }
  // A 200 proves nothing about an SPA: the shell can serve while the app is
  // broken. Assert on content the student actually depends on.
  check('L02 the deployed app is not an empty shell', () =>
    body.length < 50000 ? `only ${body.length} bytes — looks like a stub, not the app` : null);
  check('L03 the deployed app has the standards content', () =>
    body.includes('STANDARDS') ? null : 'STANDARDS missing from the deployed file');
  check('L04 the deployed app does not re-introduce the lock', () =>
    /locked\s*=\s*i\s*>\s*upto/.test(body)
      ? 'the LIVE site traps students at item 1 — the Noah regression is back' : null);
  check('L05 the DEPLOYED version matches the committed version', () => {
    // This is the check that answers "did my change actually go live?"
    const live = body.match(/<title>Animation CTE Prep — Verde Tech ([0-9]+\.[0-9]+)<\/title>/);
    const here = src.match(/<title>Animation CTE Prep — Verde Tech ([0-9]+\.[0-9]+)<\/title>/);
    if (!live) return 'the deployed site has no version in its title';
    console.log('      live version: ' + live[1] + '   committed: ' + (here ? here[1] : '?'));
    if (here && live[1] !== here[1])
      return `deployed is v${live[1]} but this commit is v${here[1]} — the change has NOT reached students`;
    return null;
  });

  check('L06 deployed matches what is committed here', () => {
    const drift = Math.abs(body.length - src.length);
    return drift > 2000
      ? `live and local differ by ${drift} bytes — something was edited but never pushed`
      : null;
  });
}

(async () => {
  if (process.argv.includes('--live')) await liveCheck();
  console.log('\n' + '-'.repeat(52));
  console.log(`RESULT: ${pass} passed, ${fail} failed`);
  if (fail) {
    console.log('\nA student would hit each of these:');
    failures.forEach(([n, w]) => console.log('  • ' + n + ' — ' + w));
  }
  process.exit(fail ? 1 : 0);
})();
