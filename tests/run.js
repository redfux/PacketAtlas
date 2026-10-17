// Minimal test runner (no dependencies): node tests/run.js [filter]
// Every tests/*.test.js exports register(test) and calls test(name, fn) for each case.
// thought up by human, created by ai

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const filter = process.argv[2] || '';
let passed = 0;
let failed = 0;

for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.test.js')).sort()) {
  const module = await import(pathToFileURL(path.join(dir, file)).href);
  const cases = [];
  module.register((name, fn) => cases.push({ name, fn }));
  for (const { name, fn } of cases) {
    if (filter && !`${file} ${name}`.includes(filter)) continue;
    try {
      await fn();
      passed++;
      console.log(`  ok    ${file} › ${name}`);
    } catch (error) {
      failed++;
      console.log(`  FAIL  ${file} › ${name}\n${String(error.stack || error).split('\n').map((line) => `        ${line}`).join('\n')}`);
    }
  }
}

console.log(`\n${passed} bestanden, ${failed} fehlgeschlagen`);
process.exit(failed ? 1 : 0);
