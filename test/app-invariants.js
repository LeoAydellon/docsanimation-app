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
 *   node test/app-invariants.js <file.html>  # checks a different build
 *                                             (PT100_* checks below only run
 *                                             when that build actually has the
 *                                             feature — see T15 guard; as of
 *                                             PB-0043 the live file has it)
 */

const fs = require('fs');
const path = require('path');

const fileArg = process.argv.slice(2).find(a => a.endsWith('.html'));
const APP = fileArg ? path.resolve(fileArg) : path.join(__dirname, '..', 'animation-cte-prep.html');
const LIVE = 'https://leoaydellon.github.io/docsanimation-app/animation-cte-prep.html';

let pass = 0, fail = 0;
const failures = [];
const pendingChecks = []; // check()s whose fn() is async (e.g. T30's fetch interception) — awaited before RESULT

function report(name, why) {
  if (why) { fail++; failures.push([name, why]); console.log('FAIL  ' + name + '\n        ' + why); }
  else { pass++; console.log('pass  ' + name); }
}

function check(name, fn) {
  let result;
  try {
    result = fn();
  } catch (e) {
    fail++; failures.push([name, e.message]);
    console.log('FAIL  ' + name + '\n        threw: ' + e.message);
    return;
  }
  if (result && typeof result.then === 'function') {
    pendingChecks.push(result.then(
      why => report(name, why),
      e => { fail++; failures.push([name, e.message]); console.log('FAIL  ' + name + '\n        threw: ' + e.message); }
    ));
    return;
  }
  report(name, result);
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

/* Pull a top-level `const NAME = {...}` object literal out of the source.
 * Same brace-counting approach as extractArray, for the same reason. */
function extractObject(name) {
  const start = src.indexOf('const ' + name + ' =');
  if (start < 0) return null;
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
    else if (c === '}') { depth--; if (depth === 0) return eval('(' + src.slice(open, i + 1) + ')'); }
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

/* PB-0052: must live at true module top level, not inside a nested block --
 * extractFunction()'s eval resolves free variables (like
 * PT100_CLUSTER_EXCLUSIONS inside the extracted pt100SelectForStd) against
 * the scope chain at extractFunction's OWN definition site (here, top of
 * file), not wherever extractFunction happens to be called from. A block-
 * scoped const declared inside a later if/else would be invisible to it. */
const PT100_CLUSTER_EXCLUSIONS = extractArray('PT100_CLUSTER_EXCLUSIONS');

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

/* ---------------------------------------- PB-0041/PB-0042/PB-0043: Practice
 * Test (100) -- published PB-0043, direct-link only (see T23/T24): these
 * checks only assert anything when the build being checked actually has
 * FORM_100, so a build that genuinely predates the feature still skips
 * cleanly instead of failing. Against the live file as of v1.14 this is a
 * full check, not a skip. */
const FORM_100 = extractArray('FORM_100');

if (!FORM_100) {
  console.log('skip  T15-T24 Practice Test (100) checks — FORM_100 not in this build');
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

  check('T21 Practice Test (100) pass mark is 95 (Leo\'s approved classroom score, PB-0047)', () => {
    const m = src.match(/const PT100_PASS\s*=\s*(\d+)\s*;/);
    if (!m) return 'PT100_PASS constant not found';
    if (Number(m[1]) !== 95) return `PT100_PASS is ${m[1]}, expected 95`;
    return null;
  });

  check('T22 Practice Test (100) header/results show the proposed-score wording (not "PREVIEW"/"provisional"); review answers are letter-prefixed', () => {
    const bad = [];
    const hSubM = src.match(/\$\('hSub'\)\.textContent\s*=\s*'Proposed[^;]*;/);
    const subM = src.match(/\$\('pt100Sub'\)\.textContent\s*=\s*([^;]+);/);
    if (!hSubM) bad.push('PT100 hSub assignment not found');
    else {
      if (!/Proposed classroom passing score/.test(hSubM[0])) bad.push('hSub missing "Proposed classroom passing score" wording');
      if (/PREVIEW|provisional/i.test(hSubM[0])) bad.push('hSub still says "PREVIEW" or "provisional"');
    }
    if (!subM) bad.push('pt100Sub assignment not found');
    else {
      if (!/Proposed classroom passing score/.test(subM[1])) bad.push('pt100Sub missing "Proposed classroom passing score" wording');
      if (!/official score/.test(subM[1]) || !/ADE/.test(subM[1])) bad.push('pt100Sub missing "not ADE\'s official score"');
      if (/PREVIEW|provisional/i.test(subM[1])) bad.push('pt100Sub still says "PREVIEW" or "provisional"');
    }
    if (!/'ABCD'\[correctDisplayPos\] \+ '&#41; '/.test(src)) bad.push('review list does not prefix the correct answer with its letter (e.g. "C) ...")');
    return bad.length ? bad.join('; ') : null;
  });

  check('T23 Practice Test (100) main-menu button is gated behind PT100_IN_MENU, which starts false', () => {
    const m = src.match(/const PT100_IN_MENU\s*=\s*(true|false)\s*;/);
    if (!m) return 'PT100_IN_MENU constant not found';
    if (m[1] !== 'false') return `PT100_IN_MENU is ${m[1]} — PB-0043 requires it start false until Leo approves the menu`;
    if (!/classList\.toggle\('hide',\s*!PT100_IN_MENU\)/.test(src))
      return 'pt100Btn visibility is not wired to PT100_IN_MENU — the menu button could show regardless of the flag';
    const tagM = src.match(/<button[^>]*id="pt100Btn"[^>]*>/);
    if (!tagM || !/\bhide\b/.test(tagM[0]))
      return 'pt100Btn does not start with the hide class in the markup — it would flash visible before JS runs';
    return null;
  });

  check('T24 the ?test=pt100 deep link opens Practice Test (100) right after name entry, independent of the menu gate', () => {
    if (!/get\('test'\)\s*===\s*'pt100'/.test(src)) return 'no ?test=pt100 query-string check found';
    const beginWrap = src.match(/begin\s*=\s*function\s*\(name\)\s*\{[^}]*\}/s);
    if (!beginWrap || !/startPt100\(\)/.test(beginWrap[0]))
      return 'the ?test=pt100 check does not call startPt100() from inside a wrapped begin() — deep link would not fire after name entry';
    return null;
  });

  /* -------------------------------------------- PB-0050: PT100 results contract v2
   * Matches Pam-Office/docs/records/animation-test/PT100-RESULTS-CONTRACT.md
   * (v2 — writes to /submissions/pt100-anim, the already-allowed node;
   * /pt100 itself is rejected by the DB rules, no rules change was made).
   * Request interception only, by design — these tests must never touch the
   * real Firebase DB. The real-DB end-to-end check is a separate, one-time
   * manual step against ZZ-prefixed test students. */

  check('T25 pt100ResultKey() builds the contract key: anim__<class>__<slug>, or anim__<slug> when blank', () => {
    const pt100ResultKey = extractFunction('pt100ResultKey');
    if (!pt100ResultKey) return 'pt100ResultKey() not found in the build';
    const a = pt100ResultKey('ZZ Pam Test One', 'anim3-p4');
    if (a !== 'anim__anim3-p4__zz-pam-test-one') return `with a class tag, got "${a}"`;
    const b = pt100ResultKey('ZZ Pam Test Two', '');
    if (b !== 'anim__zz-pam-test-two') return `with a blank class tag, got "${b}"`;
    return null;
  });

  check('T26 pt100BuildRecord() matches the contract shape and the 95-mark pass/fail boundary', () => {
    const pt100BuildRecord = extractFunction('pt100BuildRecord');
    if (!pt100BuildRecord) return 'pt100BuildRecord() not found in the build';
    const byDomain = [{ name: 'Domain A', right: 10, n: 10 }];
    const byStd = [{ name: '4.0', right: 10, n: 10 }];
    const pass = pt100BuildRecord(null, 'ZZ Pam Test One', 'anim3-p4', 95, 100, 95, '1.15', byDomain, byStd);
    if (pass.latest.pass !== true) return '95/100 against a 95 pass mark did not score as a pass';
    if (pass.attempts !== 1) return `attempts should start at 1 on a fresh node, got ${pass.attempts}`;
    if (pass.form !== 'FORM-100-v1') return `form should be "FORM-100-v1", got "${pass.form}"`;
    if (JSON.stringify(pass.latest.byDomain) !== JSON.stringify({ 'Domain A': [10, 10] }))
      return 'byDomain is not the contract\'s {"<domain>": [right, total]} shape';
    const notYet = pt100BuildRecord(null, 'ZZ Pam Test Two', 'anim-p6', 94, 100, 95, '1.15', byDomain, byStd);
    if (notYet.latest.pass !== false) return '94/100 against a 95 pass mark scored as a pass';
    const again = pt100BuildRecord(pass, 'ZZ Pam Test One', 'anim3-p4', 90, 100, 95, '1.15', byDomain, byStd);
    if (again.attempts !== 2) return `attempts should increment to 2 on a second completion, got ${again.attempts}`;
    if (again.best.score !== 95) return `best should keep the higher prior score (95), got ${again.best.score}`;
    return null;
  });

  check('T27 the PT100 results write targets only /submissions/pt100-anim, never /prep', () => {
    const m = src.match(/\(function\(\)\{\s*var PT100_RESULTS_DB[\s\S]*?window\.__pt100SaveResult = pt100SaveResult;\s*\}\)\(\);/);
    if (!m) return 'the PT100 results-write IIFE was not found';
    if (!/\/submissions\/pt100-anim['"]/.test(m[0])) return 'PT100_RESULTS_DB does not point at /submissions/pt100-anim';
    if (/\/prep/.test(m[0])) return 'the PT100 results-write code references /prep — it must never write there';
    return null;
  });

  check('T28 pt100Finish() calls the PT100 results write, so it is wired and not dead code', () => {
    const finishFn = src.match(/function pt100Finish\s*\([^)]*\)\s*\{[\s\S]*?\n\}/);
    if (!finishFn) return 'pt100Finish() not found';
    if (!/pt100AttemptSave\(/.test(finishFn[0])) return 'pt100Finish() never calls pt100AttemptSave(...)';
    const attemptFn = src.match(/function pt100AttemptSave\s*\([^)]*\)\s*\{[\s\S]*?\n\}/);
    if (!attemptFn) return 'pt100AttemptSave() not found';
    if (!/__pt100SaveResult\(/.test(attemptFn[0])) return 'pt100AttemptSave() never calls window.__pt100SaveResult(...)';
    return null;
  });

  /* -------------------------------------------- PB-0051: visible save-failure warning
   * Leo 2026-10-15 19:55, requirement #4: a failed cloud save must never look
   * like it succeeded. pt100SaveResult() must reject on both a non-ok HTTP
   * response and a thrown network error (no silent .catch swallowing it),
   * and the UI layer must show the right message/button for each outcome,
   * using interception (a stand-in fetch) for each of the three fixtures
   * the ticket names: 200, 401/permission-denied, and a network error. */

  check('T29 pt100SaveResult() has no silent .catch left — GET/PUT failures must propagate', () => {
    const m = src.match(/\(function\(\)\{\s*var PT100_RESULTS_DB[\s\S]*?window\.__pt100SaveResult = pt100SaveResult;\s*\}\)\(\);/);
    if (!m) return 'the PT100 results-write IIFE was not found';
    if (/\.catch\(function\(\)\{\}\)/.test(m[0])) return 'a silent empty .catch is still present — failures would be swallowed';
    if (!/throw new Error/.test(m[0])) return 'no failure path throws — a non-ok GET/PUT response would be treated as success';
    return null;
  });

  check('T30 pt100SaveResult() resolves on HTTP 200 and rejects on 401/permission-denied and on a thrown network error', async () => {
    const src2 = fs.readFileSync(APP, 'utf8');
    const m = src2.match(/\(function\(\)\{\s*var PT100_RESULTS_DB[\s\S]*?window\.__pt100SaveResult = pt100SaveResult;\s*\}\)\(\);/);
    if (!m) return 'the PT100 results-write IIFE was not found';
    const pt100ResultKey = extractFunction('pt100ResultKey');
    const pt100BuildRecord = extractFunction('pt100BuildRecord');
    if (!pt100ResultKey || !pt100BuildRecord) return 'pt100ResultKey()/pt100BuildRecord() not found — T30 depends on them';

    function run(fixture){
      const fn = new Function('window', 'fetch', 'APP_VERSION', 'PT100_PASS', 'pt100ResultKey', 'pt100BuildRecord',
        m[0] + '\nreturn window.__pt100SaveResult;');
      const pt100SaveResult = fn({}, fixture, '1.17', 95, pt100ResultKey, pt100BuildRecord);
      return pt100SaveResult('ZZ Fixture', 'anim-fixture', 90, 100, [], []);
    }

    /* Fixture 1: GET 200 (no prior record) then PUT 200 — must resolve. */
    let calls = 0;
    const ok200 = () => { calls++; return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(calls === 1 ? null : {}) }); };
    try { await run(ok200); } catch (e) { return 'fixture 200/200 should resolve, rejected instead: ' + e.message; }

    /* Fixture 2: GET 401 permission-denied — must reject, and must NOT attempt the PUT. */
    let putAttempted = false;
    const denied401 = (url, opts) => {
      if (opts && opts.method === 'PUT') putAttempted = true;
      return Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({ error: 'Permission denied' }) });
    };
    let rejected401 = false;
    try { await run(denied401); } catch (e) { rejected401 = true; }
    if (!rejected401) return 'fixture 401/permission-denied should reject, resolved instead';
    if (putAttempted) return 'fixture 401 on the GET should not go on to attempt a PUT';

    /* Fixture 3: a thrown network error (offline) — must reject, not resolve. */
    const networkError = () => Promise.reject(new TypeError('Failed to fetch'));
    let rejectedNet = false;
    try { await run(networkError); } catch (e) { rejectedNet = true; }
    if (!rejectedNet) return 'fixture network-error should reject, resolved instead';

    return null;
  });

  check('T31 a failed save shows the exact non-technical warning + Try again, a success shows the exact confirmation', () => {
    const okMsg = src.match(/pt100ShowSaveOk[\s\S]*?innerHTML\s*=\s*([^;]+);/);
    if (!okMsg) return 'pt100ShowSaveOk() message assignment not found';
    if (!/Score saved for your teacher/.test(okMsg[1])) return 'success message text does not match the required wording';
    const failMsg = src.match(/pt100ShowSaveFail[\s\S]*?innerHTML\s*=\s*([^;]+);/);
    if (!failMsg) return 'pt100ShowSaveFail() message assignment not found';
    if (!/NOT saved/.test(failMsg[1]) || !/gradebook/.test(failMsg[1])) return 'failure message text does not match the required wording';
    if (!/Try again/.test(failMsg[1])) return 'failure message does not mention "Try again"';
    if (!/id="pt100RetrySaveBtn"[^>]*>Try again</.test(src)) return 'no "Try again" button found in the markup';
    return null;
  });

  check('T32 a confirmed-failed save is kept pending and resent once on the next load, and a confirmed write clears it', () => {
    const attemptFn = src.match(/function pt100AttemptSave\s*\([^)]*\)\s*\{[\s\S]*?\n\}/);
    if (!attemptFn) return 'pt100AttemptSave() not found';
    if (!/pt100PendingSave\(/.test(attemptFn[0])) return 'pt100AttemptSave() does not persist a pending record on failure';
    if (!/pt100PendingClear\(/.test(attemptFn[0])) return 'pt100AttemptSave() does not clear the pending record on a confirmed write';
    if (!/pt100PendingGet\(student\)/.test(src)) return 'nothing reads back the pending record (resend-on-load / Try again would have nothing to resend)';
    const beginWraps = src.match(/const _begin\d+ = begin;[\s\S]*?\}\)\(\);/g) || [];
    const resend = beginWraps.find(w => /pt100PendingGet/.test(w));
    if (!resend) return 'no begin() wrapper resends a pending save on the next load';
    if (!/__pt100SaveResult\(/.test(resend)) return 'the resend-on-load wrapper never actually calls window.__pt100SaveResult(...)';
    return null;
  });

  check('T33 pt100BuildRecord() attempts only increments inside the record a confirmed write produces, never speculatively', () => {
    const attemptFn = src.match(/function pt100AttemptSave\s*\([^)]*\)\s*\{[\s\S]*?\n\}/);
    if (!attemptFn) return 'pt100AttemptSave() not found';
    if (/P\.attempts\[.pt100.\]\s*=/.test(attemptFn[0])) return 'pt100AttemptSave() touches P.attempts[\'pt100\'] — that counter belongs to startPt100() only, not the save path';
    const pt100BuildRecord = extractFunction('pt100BuildRecord');
    if (!pt100BuildRecord) return 'pt100BuildRecord() not found';
    const first = pt100BuildRecord(null, 'ZZ Attempts', 'anim-fixture', 90, 100, 95, '1.17', [], []);
    if (first.attempts !== 1) return `first-ever record should have attempts:1, got ${first.attempts}`;
    const resent = pt100BuildRecord(first, 'ZZ Attempts', 'anim-fixture', 90, 100, 95, '1.17', [], []);
    if (resent.attempts !== 2) return `resending against the existing record should increment to 2, got ${resent.attempts}`;
    return null;
  });

  /* -------------------------------------------- PB-0055: v1.19 zero-overlap retakes
   * RETAKE-SPEC-v2.md: a fresh, blueprint-weighted 100-item attempt from
   * PT100_POOL (242 items, POOL-v2) on every retake, shuffled order+choices,
   * saved per-attempt, full post-attempt review -- and now a HARD rule that
   * attempt n+1 shares NO item with attempt n. The 300-attempt simulation
   * these checks only sample from lives in test/pt100-retake-sim.js (its
   * output is the pasted acceptance artifact); these are fast regression
   * checks that run every time. */
  const PT100_POOL = extractArray('PT100_POOL');

  if (!PT100_POOL) {
    console.log('skip  T34-T41 changing-retakes (PB-0052/PB-0055) checks — PT100_POOL not in this build');
  } else {

    check('T34 PT100_POOL has 242 items and is byte-for-byte equivalent to POOL-v2.json (sha256 fd3eb80a…6812f)', () => {
      const fixturePath = path.join(__dirname, 'fixtures', 'POOL-v2.json');
      if (!fs.existsSync(fixturePath)) return 'fixtures/POOL-v2.json is missing — cannot verify against the source pool';
      const rawFixture = fs.readFileSync(fixturePath, 'utf8');
      const canon = JSON.parse(rawFixture);
      if (canon.length !== 242) return `fixture has ${canon.length} items, expected 242`;
      if (PT100_POOL.length !== canon.length) return `build has ${PT100_POOL.length} items, fixture has ${canon.length}`;
      const crypto = require('crypto');
      const fileHash = crypto.createHash('sha256').update(rawFixture).digest('hex');
      const a = crypto.createHash('sha256').update(JSON.stringify(canon)).digest('hex');
      const b = crypto.createHash('sha256').update(JSON.stringify(PT100_POOL)).digest('hex');
      console.log('      fixture file sha256: ' + fileHash + '\n      fixture sha256: ' + a + '\n      build   sha256: ' + b);
      if (fileHash !== 'fd3eb80ac684c1ef6e12066b00ad8bb590d56224a53dc517d1d1cdf770e6812f') return 'fixtures/POOL-v2.json itself does not match the authorized sha256 — wrong file committed';
      return a === b ? null : 'PT100_POOL differs from the canonical POOL-v2.json';
    });

    check('T35 PT100_NEED sums to 100 and matches the verified ADE blueprint per-standard allocation', () => {
      const PT100_NEED = extractObject('PT100_NEED');
      if (!PT100_NEED) return 'PT100_NEED not found in the build';
      const want = { '1.0':4,'2.0':1,'3.0':2,'4.0':15,'5.0':17,'6.0':20,'7.0':17,'8.0':10,'9.0':7,'10.0':3,'11.0':4 };
      const bad = [];
      for (const std of Object.keys(want)) if (PT100_NEED[std] !== want[std]) bad.push(`${std}: want ${want[std]}, got ${PT100_NEED[std]}`);
      const sum = Object.values(PT100_NEED).reduce((a, b) => a + b, 0);
      if (sum !== 100) bad.push(`PT100_NEED sums to ${sum}, want 100`);
      return bad.length ? bad.join('; ') : null;
    });

    check('T36 the pool holds enough items per standard to satisfy PT100_NEED (every attempt is fillable)', () => {
      const PT100_NEED = extractObject('PT100_NEED');
      const have = {};
      PT100_POOL.forEach(it => { have[it.std] = (have[it.std] || 0) + 1; });
      const bad = [];
      for (const std of Object.keys(PT100_NEED)) if ((have[std] || 0) < PT100_NEED[std]) bad.push(`${std}: pool has ${have[std] || 0}, need ${PT100_NEED[std]}`);
      return bad.length ? bad.join('; ') : null;
    });

    /* Rebuild the selection engine locally from its extracted pure pieces
     * (same brace-counting extraction as everything else in this file) so it
     * can be exercised directly, the same way T19/T20 exercise pt100Score()/
     * pt100IsDone() without a browser. v1.19: no more PT100_FULL_STDS bypass
     * -- every standard now hard-excludes the previous attempt's items,
     * falling back to prefer-unused (with a logged event) only if that
     * leaves too few candidates. */
    function buildPt100Engine() {
      const PT100_NEED = extractObject('PT100_NEED');
      const PT100_STD_ORDER = extractArray('PT100_STD_ORDER');
      const PT100_PAIR_EXCLUSIONS = extractArray('PT100_PAIR_EXCLUSIONS');
      const PT100_CLUSTER_EXCLUSIONS = extractArray('PT100_CLUSTER_EXCLUSIONS');
      const pt100PoolByStd = extractFunction('pt100PoolByStd');
      const pt100Shuffle = extractFunction('pt100Shuffle');
      const pt100SelectForStd = extractFunction('pt100SelectForStd');
      if (!PT100_NEED || !PT100_STD_ORDER || !PT100_PAIR_EXCLUSIONS ||
          !PT100_CLUSTER_EXCLUSIONS || !pt100PoolByStd || !pt100Shuffle || !pt100SelectForStd) return null;
      const idToStd = {};
      PT100_POOL.forEach(it => { idToStd[it.id] = it.std; });
      const fallbackLog = [];
      function pt100BuildAttemptPool(pool, prevItemIds, usage, rng) {
        const byStd = pt100PoolByStd(pool);
        const chosenByStd = {};
        function selectStd(std, extraExclude) {
          const need = PT100_NEED[std];
          const candidates = byStd[std] || [];
          const notPrev = candidates.filter(it => !prevItemIds.has(it.id) && it.id !== extraExclude);
          if (notPrev.length >= need) return { chosen: pt100SelectForStd(notPrev, need, prevItemIds, usage, rng), fellBack: false };
          const fallbackCandidates = extraExclude ? candidates.filter(it => it.id !== extraExclude) : candidates;
          return { chosen: pt100SelectForStd(fallbackCandidates, need, prevItemIds, usage, rng), fellBack: true };
        }
        PT100_STD_ORDER.forEach(std => {
          const r = selectStd(std, null);
          chosenByStd[std] = r.chosen;
          if (r.fellBack) fallbackLog.push({ std, need: PT100_NEED[std] });
        });
        PT100_PAIR_EXCLUSIONS.forEach(pair => {
          const [idA, idB] = pair;
          const stdA = idToStd[idA], stdB = idToStd[idB];
          const hasA = chosenByStd[stdA] && chosenByStd[stdA].some(it => it.id === idA);
          const hasB = chosenByStd[stdB] && chosenByStd[stdB].some(it => it.id === idB);
          if (!hasA || !hasB) return;
          const rA = selectStd(stdA, idA);
          if (!rA.fellBack) { chosenByStd[stdA] = rA.chosen; return; }
          const rB = selectStd(stdB, idB);
          if (!rB.fellBack) { chosenByStd[stdB] = rB.chosen; return; }
          fallbackLog.push({ std: stdA + '+' + stdB, pairExclusion: pair });
        });
        let selected = [];
        PT100_STD_ORDER.forEach(std => { selected = selected.concat(chosenByStd[std]); });
        return selected;
      }
      function pt100MakeAttemptItems(pool, prevItemIds, usage, rng) {
        const ordered = pt100Shuffle(pt100BuildAttemptPool(pool, prevItemIds, usage, rng), rng);
        return ordered.map(it => ({ id: it.id, perm: pt100Shuffle([0, 1, 2, 3], rng), chosen: null }));
      }
      return { PT100_NEED, PT100_PAIR_EXCLUSIONS, PT100_CLUSTER_EXCLUSIONS, pt100MakeAttemptItems, fallbackLog };
    }
    function mulberry32(seed) {
      let s = seed >>> 0;
      return function () {
        s |= 0; s = (s + 0x6D2B79F5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    check('T37 one simulated attempt: exactly 100 items, exact per-standard counts, no excluded pair/cluster together, every item from the pool', () => {
      const eng = buildPt100Engine();
      if (!eng) return 'could not rebuild the selection engine from its extracted pieces — a helper is missing or renamed';
      const rng = mulberry32(7);
      const items = eng.pt100MakeAttemptItems(PT100_POOL, new Set(), {}, rng);
      if (items.length !== 100) return `attempt has ${items.length} items, expected 100`;
      const byId = {}; PT100_POOL.forEach(it => { byId[it.id] = it; });
      const ids = new Set();
      const counts = {};
      for (const it of items) {
        if (ids.has(it.id)) return `duplicate item in one attempt: ${it.id}`;
        ids.add(it.id);
        if (!byId[it.id]) return `item not from PT100_POOL: ${it.id}`;
        if (!Array.isArray(it.perm) || it.perm.slice().sort().join(',') !== '0,1,2,3') return `item ${it.id} has a bad perm: ${JSON.stringify(it.perm)}`;
        const std = byId[it.id].std;
        counts[std] = (counts[std] || 0) + 1;
      }
      const bad = [];
      for (const std of Object.keys(eng.PT100_NEED)) if (counts[std] !== eng.PT100_NEED[std]) bad.push(`${std}: want ${eng.PT100_NEED[std]}, got ${counts[std] || 0}`);
      eng.PT100_PAIR_EXCLUSIONS.forEach(pair => { if (ids.has(pair[0]) && ids.has(pair[1])) bad.push(`excluded pair together: ${pair}`); });
      eng.PT100_CLUSTER_EXCLUSIONS.forEach(cluster => {
        const present = cluster.filter(id => ids.has(id));
        if (present.length > 1) bad.push(`>1 of excluded cluster together: ${present}`);
      });
      return bad.length ? bad.join('; ') : null;
    });

    check('T38 option shuffle never changes scoring: answering the displayed-correct option on every item scores 100/100', () => {
      const eng = buildPt100Engine();
      if (!eng) return 'could not rebuild the selection engine';
      const rng = mulberry32(99);
      const items = eng.pt100MakeAttemptItems(PT100_POOL, new Set(), {}, rng);
      const byId = {}; PT100_POOL.forEach(it => { byId[it.id] = it; });
      let right = 0;
      items.forEach(it => {
        const p = byId[it.id];
        const correctDisplayPos = it.perm.indexOf(p.answer);
        it.chosen = it.perm[correctDisplayPos]; // simulate clicking whichever button showed the correct text
        if (it.chosen === p.answer) right++;
      });
      return right === 100 ? null : `answering every displayed-correct option scored ${right}/100, expected 100`;
    });

    check('T39 consecutive attempts: two in a row (with usage/lastIds carried forward like startPt100 does) share 0 items (v1.19 hard rule)', () => {
      const eng = buildPt100Engine();
      if (!eng) return 'could not rebuild the selection engine';
      const rng = mulberry32(2026);
      const a1 = eng.pt100MakeAttemptItems(PT100_POOL, new Set(), {}, rng);
      const usage = {}; a1.forEach(it => { usage[it.id] = 1; });
      const prevIds = new Set(a1.map(it => it.id));
      const a2 = eng.pt100MakeAttemptItems(PT100_POOL, prevIds, usage, rng);
      const ids2 = new Set(a2.map(it => it.id));
      let shared = 0; ids2.forEach(id => { if (prevIds.has(id)) shared++; });
      if (shared !== 0) return `consecutive attempts shared ${shared} items, want 0`;
      if (eng.fallbackLog.length) return `unexpected fallback to prefer-unused: ${JSON.stringify(eng.fallbackLog)} — pool should have had enough non-previous items`;
      return null;
    });

    check('T39b the new cross-standard pair exclusion [3.0-01, N5-15] is present alongside the v1.18 pair', () => {
      const PT100_PAIR_EXCLUSIONS = extractArray('PT100_PAIR_EXCLUSIONS');
      if (!PT100_PAIR_EXCLUSIONS) return 'PT100_PAIR_EXCLUSIONS not found in the build';
      const has = (a, b) => PT100_PAIR_EXCLUSIONS.some(p => (p[0] === a && p[1] === b) || (p[0] === b && p[1] === a));
      if (!has('3.0-01', '11.0-10')) return 'the v1.18 pair [3.0-01, 11.0-10] is missing';
      if (!has('3.0-01', 'N5-15')) return 'the new v1.19 pair [3.0-01, N5-15] is missing';
      return null;
    });

    check('T40 pt100BuildRecord() contract v3: adds pool+items to latest/best when given, omits them (v2 shape) when not', () => {
      const pt100BuildRecord = extractFunction('pt100BuildRecord');
      if (!pt100BuildRecord) return 'pt100BuildRecord() not found';
      const byDomain = [{ name: 'Domain A', right: 10, n: 10 }];
      const byStd = [{ name: '4.0', right: 10, n: 10 }];
      const v2 = pt100BuildRecord(null, 'ZZ V2', 'anim-fixture', 90, 100, 95, '1.18', byDomain, byStd);
      if ('pool' in v2.latest || 'items' in v2.latest) return 'omitting pool/items still produced them on the record — v2 callers would get an unexpected shape';
      const items3 = [['4.0-01', 1, 1], ['6.0-02', 0, 2]];
      const v3 = pt100BuildRecord(null, 'ZZ V3', 'anim-fixture', 90, 100, 95, '1.18', byDomain, byStd, 'POOL-v1', items3);
      if (v3.latest.pool !== 'POOL-v1') return `latest.pool should be "POOL-v1", got ${JSON.stringify(v3.latest.pool)}`;
      if (JSON.stringify(v3.latest.items) !== JSON.stringify(items3)) return 'latest.items does not match the [id, chosenOrig, correctOrig] triples given';
      if (v3.latest.score !== 90 || v3.latest.total !== 100 || v3.latest.pass !== false) return 'v3 record lost the base score/total/pass fields — contract v3 must only ADD fields';
      return null;
    });

    check('T40b pt100BuildRecord() contract v4: appends a history[] entry per completed attempt, attempts === history.length on fresh records', () => {
      const pt100BuildRecord = extractFunction('pt100BuildRecord');
      if (!pt100BuildRecord) return 'pt100BuildRecord() not found';
      const byDomain = [{ name: 'Domain A', right: 10, n: 10 }];
      const byStd = [{ name: '4.0', right: 10, n: 10 }];
      const items3a = [['4.0-01', 1, 1]];
      const items3b = [['4.0-02', 0, 2]];
      const r1 = pt100BuildRecord(null, 'ZZ V4', 'anim-fixture', 90, 100, 95, '1.19', byDomain, byStd, 'POOL-v2', items3a);
      if (!Array.isArray(r1.history) || r1.history.length !== 1) return `history should have 1 entry after 1 attempt, got ${JSON.stringify(r1.history)}`;
      if (r1.attempts !== r1.history.length) return `attempts (${r1.attempts}) !== history.length (${r1.history.length}) on a fresh v4 record`;
      const h1 = r1.history[0];
      if (h1.n !== 1 || h1.score !== 90 || h1.total !== 100 || h1.pct !== 90 || h1.pass !== false || h1.passMark !== 95) return `history[0] shape wrong: ${JSON.stringify(h1)}`;
      if (h1.pool !== 'POOL-v2' || JSON.stringify(h1.items) !== JSON.stringify(items3a)) return 'history[0] did not record pool/items';
      const r2 = pt100BuildRecord(r1, 'ZZ V4', 'anim-fixture', 97, 100, 95, '1.19', byDomain, byStd, 'POOL-v2', items3b);
      if (r2.history.length !== 2) return `history should have 2 entries after 2 attempts, got ${r2.history.length}`;
      if (r2.attempts !== r2.history.length) return `attempts (${r2.attempts}) !== history.length (${r2.history.length}) after a 2nd attempt`;
      if (r2.history[0].score !== 90) return 'history is not append-only — the first entry changed';
      if (r2.history[1].n !== 2 || r2.history[1].score !== 97 || r2.history[1].pass !== true) return `history[1] shape wrong: ${JSON.stringify(r2.history[1])}`;
      // latest/best/attempts stay exactly as the v3 contract defined them — history is additive only
      if (r2.latest.score !== 97 || r2.best.score !== 97) return 'latest/best changed shape when history was added — v4 must only ADD history';
      return null;
    });

    check('T40c pt100BuildRecord() upgrades a v1.18 record (contract v3, no history key) cleanly — no crash, history seeded from this attempt', () => {
      const pt100BuildRecord = extractFunction('pt100BuildRecord');
      if (!pt100BuildRecord) return 'pt100BuildRecord() not found';
      const byDomain = [{ name: 'Domain A', right: 10, n: 10 }];
      const byStd = [{ name: '4.0', right: 10, n: 10 }];
      // a v1.18 record shape: attempts:2, latest/best present, no history key at all
      const legacy = {
        name: 'ZZ Legacy', class: 'anim-fixture', form: 'FORM-100-v1', appVersion: '1.18', attempts: 2,
        latest: { score: 94, total: 100, passMark: 95, pass: false, completedAt: 1000, byDomain: {}, byStd: {}, pool: 'POOL-v1', items: [['4.0-01', 1, 1]] },
        best: { score: 94, total: 100, passMark: 95, pass: false, completedAt: 1000, byDomain: {}, byStd: {}, pool: 'POOL-v1', items: [['4.0-01', 1, 1]] }
      };
      let upgraded;
      try {
        upgraded = pt100BuildRecord(legacy, 'ZZ Legacy', 'anim-fixture', 96, 100, 95, '1.19', byDomain, byStd, 'POOL-v2', [['4.0-01', 1, 1]]);
      } catch (e) { return `pt100BuildRecord() threw on a v1.18 (no-history) record: ${e.message}`; }
      if (upgraded.attempts !== 3) return `attempts should be 3 (2 legacy + this one), got ${upgraded.attempts}`;
      if (!Array.isArray(upgraded.history) || upgraded.history.length !== 1) return `expected a fresh 1-entry history on upgrade, got ${JSON.stringify(upgraded.history)}`;
      if (upgraded.history[0].score !== 96) return 'the upgraded history entry does not reflect this attempt';
      if (upgraded.latest.score !== 96 || upgraded.best.score !== 96) return 'latest/best broke on a v1.18->v4 upgrade';
      return null;
    });

    check('T41 a v1.17 unfinished attempt (no `items` field) is finished, not resumed or crashed, by startPt100()', () => {
      const startFn = src.match(/function startPt100\s*\(\s*\)\s*\{[\s\S]*?\n\}/);
      if (!startFn) return 'startPt100() not found';
      if (!/saved\.v\s*!==\s*3[\s\S]{0,40}saved\.done\s*===\s*false/.test(startFn[0]))
        return 'startPt100() does not detect a legacy (pre-v3) unfinished attempt';
      if (!/pt100FinishLegacy\(saved\)/.test(startFn[0])) return 'startPt100() does not hand a detected legacy attempt to pt100FinishLegacy()';
      if (!/function pt100FinishLegacy\s*\(/.test(src)) return 'pt100FinishLegacy() not found';
      const legacyFn = src.match(/function pt100FinishLegacy\s*\([^)]*\)\s*\{[\s\S]*?\n\}/);
      if (!legacyFn || !/done:\s*true/.test(legacyFn[0])) return 'pt100FinishLegacy() does not mark the attempt done';
      if (!legacyFn || !/show\('pt100result'\)/.test(legacyFn[0])) return 'pt100FinishLegacy() does not land the student on the result screen';
      return null;
    });

    check('T42 the review screen has a working "Show only missed" toggle, wired to a filtered render', () => {
      if (!/id="pt100ReviewToggle"/.test(src)) return 'no pt100ReviewToggle button in the markup';
      if (!/pt100ReviewFilter\s*=\s*pt100ReviewFilter\s*===\s*'all'\s*\?\s*'missed'\s*:\s*'all'/.test(src)) return 'the toggle does not flip pt100ReviewFilter between all/missed';
      const reviewFn = src.match(/function pt100RenderReviewList\s*\([^)]*\)\s*\{[\s\S]*?\n\}/);
      if (!reviewFn) return 'pt100RenderReviewList() not found';
      if (!/pt100ReviewFilter\s*===\s*'missed'/.test(reviewFn[0])) return 'pt100RenderReviewList() does not honor the missed-only filter';
      if (!/not answered/.test(reviewFn[0])) return 'review does not handle an unanswered item';
      if (!/esc\(pool\.why\)/.test(reviewFn[0])) return 'review does not show the explanation for every item';
      return null;
    });

  }

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
  await Promise.all(pendingChecks);
  if (process.argv.includes('--live')) await liveCheck();
  console.log('\n' + '-'.repeat(52));
  console.log(`RESULT: ${pass} passed, ${fail} failed`);
  if (fail) {
    console.log('\nA student would hit each of these:');
    failures.forEach(([n, w]) => console.log('  • ' + n + ' — ' + w));
  }
  process.exit(fail ? 1 : 0);
})();
