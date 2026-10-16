#!/usr/bin/env node
/*
 * PB-0059 acceptance artifact: build a real Practice Test (100) attempt the
 * same way startPt100()/pt100Finish() would (drawn from PT100_POOL via
 * pt100MakeAttemptItems(), scored via pt100ItemCorrect()), force it to land
 * on an exact score (94 or 98), then run it through the same
 * pt100BuildPdfBytes() the app's "Download my report (PDF)" button calls --
 * and write the resulting PDF to Pam-Office's report-samples folder.
 *
 * RUN
 *   node test/pt100-report-sample.js
 */
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'animation-cte-prep.html');
const src = fs.readFileSync(APP, 'utf8');
const OUT_DIR = '/Users/leosmacproyo/Pam-Office/docs/records/animation-test/report-samples';

function extractArray(name) {
  const start = src.indexOf('const ' + name + ' =');
  if (start < 0) return null;
  const open = src.indexOf('[', start);
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
function extractObject(name) {
  const start = src.indexOf('const ' + name + ' =');
  if (start < 0) return null;
  const open = src.indexOf('{', start);
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
function extractFunction(name) {
  const m = src.match(new RegExp('function\\s+' + name + '\\s*\\('));
  if (!m) return null;
  const start = m.index;
  const open = src.indexOf('{', start);
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

/* Declared in dependency order, same convention app-invariants.js uses --
   extractFunction's eval resolves free variables against THIS script's own
   top-level scope at the moment it is called, so anything an extracted
   function body references by name must already be a const/function here. */
const PT100_POOL = extractArray('PT100_POOL');
const PT100_NEED = extractObject('PT100_NEED');
const PT100_STD_ORDER = extractArray('PT100_STD_ORDER');
const PT100_PAIR_EXCLUSIONS = extractArray('PT100_PAIR_EXCLUSIONS');
const PT100_CLUSTER_EXCLUSIONS = extractArray('PT100_CLUSTER_EXCLUSIONS');
const BLUEPRINT = extractObject('BLUEPRINT');
const STANDARDS = extractArray('STANDARDS');
const PT100_PASS = Number(src.match(/const PT100_PASS\s*=\s*(\d+)/)[1]);

const PT100_POOL_BY_ID = {};
PT100_POOL.forEach(it => { PT100_POOL_BY_ID[it.id] = it; });
const PT100_DOMAIN_DEFS = BLUEPRINT.domains.map(d => ({ name: d.name, share: d.share, standards: d.standards }));
const PT100_STD_DEFS = (function(){
  const seen = {}, ids = [];
  PT100_POOL.forEach(it => { if (!seen[it.std]) { seen[it.std] = true; ids.push(it.std); } });
  ids.sort((a, b) => parseFloat(a) - parseFloat(b));
  return ids.map(std => {
    const s = STANDARDS.filter(x => x.id === std)[0];
    return { std: std, name: s ? s.short : std, standards: [std] };
  });
})();

const pt100ItemStd = extractFunction('pt100ItemStd');
const pt100ItemCorrect = extractFunction('pt100ItemCorrect');
const pt100GroupsForItems = extractFunction('pt100GroupsForItems');
const pt100PoolByStd = extractFunction('pt100PoolByStd');
const pt100Shuffle = extractFunction('pt100Shuffle');
const pt100SelectForStd = extractFunction('pt100SelectForStd');
const pt100BuildAttemptPool = extractFunction('pt100BuildAttemptPool');
const pt100MakeAttemptItems = extractFunction('pt100MakeAttemptItems');
const pt100Score = extractFunction('pt100Score');
const pt100ByGroup = extractFunction('pt100ByGroup');
const PT100_CLASS_LABELS = extractObject('PT100_CLASS_LABELS');
const pt100ClassLabel = extractFunction('pt100ClassLabel');
const PT100_RPAREN = String.fromCharCode(41);
const pt100CheckCode = extractFunction('pt100CheckCode');
const PT100_MONTHS = extractArray('PT100_MONTHS');
const pt100FormatDateTime = extractFunction('pt100FormatDateTime');
const pt100FormatDateStamp = extractFunction('pt100FormatDateStamp');
const pt100SafeFileName = extractFunction('pt100SafeFileName');
const pt100BuildPdfBytes = extractFunction('pt100BuildPdfBytes');

[PT100_POOL, PT100_NEED, PT100_STD_ORDER, BLUEPRINT, STANDARDS, pt100MakeAttemptItems,
 pt100ItemCorrect, pt100Score, pt100ByGroup, pt100GroupsForItems, pt100CheckCode,
 pt100ClassLabel, pt100FormatDateTime, pt100FormatDateStamp, pt100SafeFileName, pt100BuildPdfBytes
].forEach((x, i) => { if (x == null) throw new Error('extraction ' + i + ' failed -- build may have changed shape'); });

/* Simple seeded PRNG so the sample is reproducible run to run. */
function mulberry32(seed) {
  return function() {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildSample({ name, cls, attempt, wrongCount, completedAt, seed }) {
  const rng = mulberry32(seed);
  const items = pt100MakeAttemptItems(PT100_POOL, new Set(), {}, rng);
  // Answer every item correctly, then deliberately miss the first `wrongCount`
  // -- picking any option that is NOT the pool answer for each.
  items.forEach(it => { it.chosen = PT100_POOL_BY_ID[it.id].answer; });
  for (let i = 0; i < wrongCount; i++) {
    const pool = PT100_POOL_BY_ID[items[i].id];
    items[i].chosen = (pool.answer + 1) % pool.options.length;
  }

  const marks = items.map(it => pt100ItemCorrect(it));
  const right = pt100Score(marks);
  const total = items.length;
  const byDomain = pt100ByGroup(marks, pt100GroupsForItems(items, PT100_DOMAIN_DEFS));
  const missed = [];
  items.forEach((item, i) => {
    const pool = PT100_POOL_BY_ID[item.id];
    if (item.chosen === pool.answer) return;
    const yourText = 'ABCD'[item.perm.indexOf(item.chosen)] + PT100_RPAREN + ' ' + pool.options[item.chosen];
    const correctPos = item.perm.indexOf(pool.answer);
    missed.push({ n: i + 1, qText: pool.q, yourText: yourText,
      correctText: 'ABCD'[correctPos] + PT100_RPAREN + ' ' + pool.options[pool.answer], why: pool.why });
  });
  if (right !== 100 - wrongCount) throw new Error('scoring sanity check failed: expected ' + (100 - wrongCount) + ', got ' + right);
  if (missed.length !== wrongCount) throw new Error('missed count mismatch: expected ' + wrongCount + ', got ' + missed.length);

  const passed = right >= PT100_PASS;
  const pct = Math.round(right / total * 100);
  const classLabel = pt100ClassLabel(cls);
  const checkCode = pt100CheckCode(name, cls, attempt, right, completedAt);

  const data = {
    title: 'Animation CTE Practice Test (100) — Attempt report',
    name: name,
    classText: cls + (classLabel ? ' — ' + classLabel : ''),
    attempt: attempt,
    completedText: pt100FormatDateTime(completedAt),
    right: right, total: total, pct: pct,
    resultText: (passed ? 'PASS' : 'NOT YET') + ' — classroom passing score ' + PT100_PASS + '/' + total + ' (' + Math.round(PT100_PASS / total * 100) + '%)',
    byDomain: byDomain, missed: missed,
    checkCode: checkCode,
    checkNote: 'Verify: recompute from this attempt’s cloud history entry (name|class|attempt|score|completedAt, FNV-1a 32-bit, base36) — see PT100-REPORT-CHECK-CODE.md.',
    legacyNote: ''
  };
  const bytes = pt100BuildPdfBytes(data);
  const filename = 'Animation Practice Test - ' + pt100SafeFileName(name) + ' - Attempt ' + attempt + ' - ' + pt100FormatDateStamp(completedAt) + '.pdf';
  return { bytes, filename, right, total, missed, checkCode, completedAt, cls, attempt, name };
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const samples = [
  buildSample({ name: 'ZZ Pam Test One', cls: 'anim3-p4', attempt: 1, wrongCount: 6, completedAt: new Date(2026, 9, 16, 13, 32, 0).getTime(), seed: 94 }),
  buildSample({ name: 'ZZ Pam Test Two', cls: 'anim-p6', attempt: 1, wrongCount: 2, completedAt: new Date(2026, 9, 16, 14, 5, 0).getTime(), seed: 98 }),
];

samples.forEach(s => {
  const outPath = path.join(OUT_DIR, s.filename);
  fs.writeFileSync(outPath, Buffer.from(s.bytes));
  console.log('wrote ' + outPath + '  (' + s.right + '/' + s.total + ', missed=' + s.missed.length + ', checkCode=' + s.checkCode + ', completedAt=' + s.completedAt + ')');
});
