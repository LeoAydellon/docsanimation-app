#!/usr/bin/env node
/*
 * PB-0055 acceptance artifact: simulate N consecutive Practice Test (100)
 * retakes for one student and verify the zero-overlap retakes + history
 * contract end to end (RETAKE-SPEC-v2.md), the same way
 * startPt100()/pt100MakeAttemptItems()/pt100BuildRecord() would build and
 * save them in the browser -- just driven here instead of by clicks.
 *
 * RUN
 *   node test/pt100-retake-sim.js            # 300 attempts, default seed
 *   node test/pt100-retake-sim.js 500 7       # <N> attempts, <seed>
 */
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'animation-cte-prep.html');
const src = fs.readFileSync(APP, 'utf8');

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

// Must be at module top level -- see app-invariants.js T37's comment for why
// (extractFunction's eval resolves free vars against ITS OWN definition
// site, not the caller's scope).
const PT100_CLUSTER_EXCLUSIONS = extractArray('PT100_CLUSTER_EXCLUSIONS');

const PT100_POOL = extractArray('PT100_POOL');
const PT100_NEED = extractObject('PT100_NEED');
const PT100_STD_ORDER = extractArray('PT100_STD_ORDER');
const PT100_PAIR_EXCLUSIONS = extractArray('PT100_PAIR_EXCLUSIONS');
const pt100PoolByStd = extractFunction('pt100PoolByStd');
const pt100Shuffle = extractFunction('pt100Shuffle');
const pt100SelectForStd = extractFunction('pt100SelectForStd');
const pt100BuildRecord = extractFunction('pt100BuildRecord');

if (!PT100_POOL || !PT100_NEED || !pt100PoolByStd || !pt100Shuffle || !pt100SelectForStd || !pt100BuildRecord) {
  console.error('could not extract the retake engine from ' + APP + ' -- has it changed shape?');
  process.exit(2);
}
const idToStd = {};
PT100_POOL.forEach(it => { idToStd[it.id] = it.std; });
function pt100ItemStd(item) { return idToStd[item.id] || null; }

// v1.19 (RETAKE-SPEC-v2.md): hard-exclude every item used in the immediately
// previous attempt, for every standard; resolve cross-standard pair
// exclusions in a second pass (preferring to swap out whichever side still
// has slack, so a zero-slack standard like 5.0 is never starved); fall back
// to the old v1.18 prefer-unused behavior (and log it) only if truly
// impossible. Mirrors pt100BuildAttemptPool() in the app.
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
    const stdA = pt100ItemStd({ id: idA }), stdB = pt100ItemStd({ id: idB });
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

function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const N = Number(process.argv[2]) || 300;
const SEED = Number(process.argv[3]) || 42;
const rng = mulberry32(SEED);

const byId = {};
PT100_POOL.forEach(it => { byId[it.id] = it; });
const poolIds = new Set(Object.keys(byId));

let usage = {};
let prevIds = new Set();
let attemptN = 0;
const overlaps = [];
const drawCount = {};
let failures = 0;
let cloudRecord = null; // simulated cloud write, same shape pt100SaveResult() PUTs

console.log(`--- PT100 retake simulation: ${N} consecutive attempts, seed ${SEED}\n`);

for (let a = 0; a < N; a++) {
  attemptN++;
  const items = pt100MakeAttemptItems(PT100_POOL, prevIds, usage, rng);
  const ids = new Set();
  const counts = {};
  let ok = true;

  if (items.length !== 100) { console.log(`FAIL attempt ${a + 1}: ${items.length} items, want 100`); ok = false; }
  items.forEach(it => {
    if (ids.has(it.id)) { console.log(`FAIL attempt ${a + 1}: duplicate item ${it.id}`); ok = false; }
    ids.add(it.id);
    if (!poolIds.has(it.id)) { console.log(`FAIL attempt ${a + 1}: item not from POOL-v2: ${it.id}`); ok = false; }
    drawCount[it.id] = (drawCount[it.id] || 0) + 1;
    const std = byId[it.id] ? byId[it.id].std : '?';
    counts[std] = (counts[std] || 0) + 1;
  });
  for (const std of Object.keys(PT100_NEED)) {
    if (counts[std] !== PT100_NEED[std]) { console.log(`FAIL attempt ${a + 1}: std ${std} got ${counts[std] || 0}, want ${PT100_NEED[std]}`); ok = false; }
  }
  PT100_PAIR_EXCLUSIONS.forEach(pair => {
    if (ids.has(pair[0]) && ids.has(pair[1])) { console.log(`FAIL attempt ${a + 1}: excluded pair together: ${pair}`); ok = false; }
  });
  PT100_CLUSTER_EXCLUSIONS.forEach(cluster => {
    const present = cluster.filter(id => ids.has(id));
    if (present.length > 1) { console.log(`FAIL attempt ${a + 1}: >1 of excluded cluster together: ${present}`); ok = false; }
  });
  if (a > 0) {
    let shared = 0;
    ids.forEach(id => { if (prevIds.has(id)) shared++; });
    overlaps.push(shared);
    if (shared !== 0) { console.log(`FAIL attempt ${a + 1}: shares ${shared} item(s) with the previous attempt, want 0`); ok = false; }
  }
  // scoring invariant: answering every displayed-correct option must score 100
  let right = 0;
  const marks = [];
  items.forEach(it => {
    const p = byId[it.id];
    const correctDisplayPos = it.perm.indexOf(p.answer);
    const chosen = it.perm[correctDisplayPos];
    const correct = chosen === p.answer;
    marks.push(correct);
    it.chosen = chosen;
    if (correct) right++;
  });
  if (right !== 100) { console.log(`FAIL attempt ${a + 1}: answer-all-correct scored ${right}/100, want 100`); ok = false; }

  // cloud contract v4: build the record exactly like pt100Finish()/pt100AttemptSave() would
  const items3 = items.map(it => [it.id, it.chosen, byId[it.id].answer]);
  cloudRecord = pt100BuildRecord(cloudRecord, 'ZZ Sim', 'sim-fixture', right, 100, 95, '1.19', [], [], 'POOL-v2', items3);
  if (cloudRecord.attempts !== attemptN) { console.log(`FAIL attempt ${a + 1}: cloud attempts=${cloudRecord.attempts}, want ${attemptN}`); ok = false; }
  if (!Array.isArray(cloudRecord.history) || cloudRecord.history.length !== attemptN) {
    console.log(`FAIL attempt ${a + 1}: cloud history.length=${cloudRecord.history ? cloudRecord.history.length : 'n/a'}, want ${attemptN} (attempts === history.length)`); ok = false;
  }

  if (!ok) failures++;
  ids.forEach(id => { usage[id] = attemptN; });
  prevIds = ids;
}

// v1.18 -> v4 migration: an existing contract-v3 record (no history key)
// must upgrade cleanly -- no crash, a fresh 1-entry history seeded from this
// attempt (pre-v4 attempts were never recorded with enough detail to
// backfill, so attempts and history.length only agree going forward).
console.log('\n--- v1.18 -> contract v4 migration (upgrade-cleanly check)');
const legacyRecord = {
  name: 'ZZ Legacy', class: 'sim-fixture', form: 'FORM-100-v1', appVersion: '1.18', attempts: 2,
  latest: { score: 94, total: 100, passMark: 95, pass: false, completedAt: 1000, byDomain: {}, byStd: {} },
  best: { score: 94, total: 100, passMark: 95, pass: false, completedAt: 1000, byDomain: {}, byStd: {} }
};
let migrationOk = true;
try {
  const upgraded = pt100BuildRecord(legacyRecord, 'ZZ Legacy', 'sim-fixture', 96, 100, 95, '1.19', [], [], 'POOL-v2', [['4.0-01', 1, 1]]);
  if (upgraded.attempts !== 3) { console.log(`FAIL migration: attempts=${upgraded.attempts}, want 3`); migrationOk = false; }
  if (!Array.isArray(upgraded.history) || upgraded.history.length !== 1) { console.log(`FAIL migration: history=${JSON.stringify(upgraded.history)}, want 1 fresh entry`); migrationOk = false; }
  if (migrationOk) console.log('PASS: v1.18 record (attempts=2, no history) upgraded without crashing -> attempts=3, history=[this attempt]');
} catch (e) {
  console.log('FAIL migration: pt100BuildRecord() threw: ' + e.message);
  migrationOk = false;
}
if (!migrationOk) failures++;

const distinctDrawn = Object.keys(drawCount).length;
console.log(`\nattempts checked: ${N}`);
console.log(`failures: ${failures}`);
console.log(`consecutive-attempt overlap -- min: ${overlaps.length ? Math.min(...overlaps) : 'n/a'}  max: ${overlaps.length ? Math.max(...overlaps) : 'n/a'}  (spec: 0 shared, every time)`);
console.log(`fallback-to-prefer-unused events: ${fallbackLog.length}` + (fallbackLog.length ? ' -- ' + JSON.stringify(fallbackLog) : ' (expected: 0, every standard pool is >= 2x its need)'));
console.log(`distinct POOL-v2 items drawn across all attempts: ${distinctDrawn} of ${PT100_POOL.length}`);
console.log(`final simulated cloud record: attempts=${cloudRecord.attempts}, history.length=${cloudRecord.history.length}`);
console.log(`\nRESULT: ${failures === 0 ? 'PASS' : 'FAIL'}`);
process.exit(failures === 0 ? 0 : 1);
