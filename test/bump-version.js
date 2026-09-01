#!/usr/bin/env node
/*
 * Bump the app version in every place it appears, at once.
 *
 * WHY
 *   The version is what tells Leo, at a glance, whether a change actually
 *   reached the students. That only works if it is impossible to forget to
 *   change it, and impossible for the three copies to disagree.
 *
 * USE
 *   node test/bump-version.js          # show the current version
 *   node test/bump-version.js 1.1      # set it to 1.1 everywhere
 *   node test/bump-version.js next     # 1.0 -> 1.1 automatically
 */

const fs = require('fs');
const path = require('path');
const APP = path.join(__dirname, '..', 'animation-cte-prep.html');

const RX = {
  title:  /<title>Animation CTE Prep — Verde Tech ([0-9]+\.[0-9]+)<\/title>/,
  header: /id="appVerTop">([0-9]+\.[0-9]+)</,
  script: /const APP_VERSION = '([0-9]+\.[0-9]+)'/,
};

let src = fs.readFileSync(APP, 'utf8');

const found = {};
for (const [k, rx] of Object.entries(RX)) {
  const m = src.match(rx);
  if (!m) { console.error(`ERROR: version not found in ${k} — has the markup changed?`); process.exit(2); }
  found[k] = m[1];
}

const versions = [...new Set(Object.values(found))];
if (versions.length > 1) {
  console.error('ERROR: the three versions disagree — ' + JSON.stringify(found));
  console.error('Fix by setting one explicitly:  node test/bump-version.js <version>');
  process.exit(2);
}
const current = versions[0];

const arg = process.argv[2];
if (!arg) {
  console.log('current version: ' + current);
  console.log('\nbump with:  node test/bump-version.js next');
  process.exit(0);
}

let next;
if (arg === 'next') {
  const [maj, min] = current.split('.').map(Number);
  next = `${maj}.${min + 1}`;
} else {
  if (!/^[0-9]+\.[0-9]+$/.test(arg)) {
    console.error('ERROR: version must look like 1.2');
    process.exit(2);
  }
  next = arg;
}

if (next === current) { console.log('already at ' + next); process.exit(0); }

src = src
  .replace(RX.title,  `<title>Animation CTE Prep — Verde Tech ${next}</title>`)
  .replace(RX.header, `id="appVerTop">${next}<`)
  .replace(/id="appVerGate">[0-9]+\.[0-9]+</, `id="appVerGate">${next}<`)
  .replace(RX.script, `const APP_VERSION = '${next}'`);

fs.writeFileSync(APP, src);
console.log(`${current}  ->  ${next}`);
console.log('\nAll three places updated. Now commit and push:');
console.log('  git add animation-cte-prep.html');
console.log(`  git commit -m "v${next}: <what changed>"`);
console.log('  git push');
console.log(`\nThen check the live site shows ${next} — that is your proof it deployed.`);
