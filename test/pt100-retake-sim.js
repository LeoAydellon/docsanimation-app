#!/usr/bin/env node
/*
 * PB-0052 acceptance artifact: simulate N consecutive Practice Test (100)
 * retakes for one student and verify the changing-retakes contract end to
 * end (RETAKE-SPEC-v1.md), the same way startPt100()/pt100MakeAttemptItems()
 * would build them in the browser -- just driven here instead of by clicks.
 *
 * RUN
 *   node test/pt100-retake-sim.js            # 200 attempts, default seed
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
const PT100_FULL_STDS = extractArray('PT100_FULL_STDS');
const PT100_STD_ORDER = extractArray('PT100_STD_ORDER');
const PT100_PAIR_EXCLUSIONS = extractArray('PT100_PAIR_EXCLUSIONS');
const pt100PoolByStd = extractFunction('pt100PoolByStd');
const pt100Shuffle = extractFunction('pt100Shuffle');
const pt100SelectForStd = extractFunction('pt100SelectForStd');

if (!PT100_POOL || !PT100_NEED || !pt100PoolByStd || !pt100Shuffle || !pt100SelectForStd) {
  console.error('could not extract the retake engine from ' + APP + ' -- has it changed shape?');
  process.exit(2);
}

function pt100BuildAttemptPool(pool, prevItemIds, usage, rng) {
  const byStd = pt100PoolByStd(pool);
  const banned = {};
  let selected = [];
  PT100_STD_ORDER.forEach(std => {
    const need = PT100_NEED[std];
    const candidates = (byStd[std] || []).filter(it => !banned[it.id]);
    const chosen = PT100_FULL_STDS.indexOf(std) >= 0 ? candidates : pt100SelectForStd(candidates, need, prevItemIds, usage, rng);
    chosen.forEach(it => {
      PT100_PAIR_EXCLUSIONS.forEach(pair => {
        if (pair[0] === it.id) banned[pair[1]] = true;
        if (pair[1] === it.id) banned[pair[0]] = true;
      });
    });
    selected = selected.concat(chosen);
  });
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

const N = Number(process.argv[2]) || 200;
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
    if (!poolIds.has(it.id)) { console.log(`FAIL attempt ${a + 1}: item not from POOL-v1: ${it.id}`); ok = false; }
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
    if (shared > 77) { console.log(`FAIL attempt ${a + 1}: shares ${shared} with previous, want <=77`); ok = false; }
    if (100 - shared < 23) { console.log(`FAIL attempt ${a + 1}: differs by ${100 - shared} from previous, want >=23`); ok = false; }
  }
  // scoring invariant: answering every displayed-correct option must score 100
  let right = 0;
  items.forEach(it => {
    const p = byId[it.id];
    const correctDisplayPos = it.perm.indexOf(p.answer);
    const chosen = it.perm[correctDisplayPos];
    if (chosen === p.answer) right++;
  });
  if (right !== 100) { console.log(`FAIL attempt ${a + 1}: answer-all-correct scored ${right}/100, want 100`); ok = false; }

  if (!ok) failures++;
  ids.forEach(id => { usage[id] = attemptN; });
  prevIds = ids;
}

const distinctDrawn = Object.keys(drawCount).length;
console.log(`attempts checked: ${N}`);
console.log(`failures: ${failures}`);
console.log(`consecutive-attempt overlap -- min: ${Math.min(...overlaps)}  max: ${Math.max(...overlaps)}  (spec: <=77 shared, >=23 different)`);
console.log(`distinct POOL-v1 items drawn across all attempts: ${distinctDrawn} of ${PT100_POOL.length}`);
console.log(`\nRESULT: ${failures === 0 ? 'PASS' : 'FAIL'}`);
process.exit(failures === 0 ? 0 : 1);
