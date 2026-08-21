/* ====================================================================
   Guard for the no-bundler setup: app.js looks its DOM up by id, so a
   renamed / removed element in index.html fails silently at runtime
   (textContent on null, or a dead reference). This walks every
   $('...') / getElementById('...') literal in app.js and asserts the id
   is present in index.html.

   Run: node scripts/check-dom-ids.mjs
   ==================================================================== */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const app  = readFileSync(join(root, 'app.js'), 'utf8');
const html = readFileSync(join(root, 'index.html'), 'utf8');

const htmlIds = new Set(
  [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1])
);

// Ids created at runtime by buildKeypad() from the KEY_* layout tables,
// so they never appear in index.html.
const runtimeIds = new Set(
  [...app.matchAll(/id:\s*'([^']+)'/g)].map(m => m[1])
);

const referenced = new Set([
  ...[...app.matchAll(/\$\('([^']+)'\)/g)].map(m => m[1]),
  ...[...app.matchAll(/getElementById\('([^']+)'\)/g)].map(m => m[1]),
]);

const missing = [...referenced].filter(id => !htmlIds.has(id) && !runtimeIds.has(id));

if (missing.length) {
  console.error('app.js references ids that index.html does not define:');
  for (const id of missing) console.error(`  - ${id}`);
  process.exit(1);
}

console.log(`ok - ${referenced.size} referenced ids all resolve ` +
            `(${runtimeIds.size} created at runtime).`);
