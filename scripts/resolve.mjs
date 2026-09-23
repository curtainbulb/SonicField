// Build-time resolver: node scripts/resolve.mjs  (resumable; one request per 3.2s for Apple's rate limit)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { parse, keyOf, lookup } from '../lib.js';
const OUT = new URL('../data/resolved.json', import.meta.url);
const db = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
const all = parse(readFileSync(new URL('../albums.md', import.meta.url), 'utf8')).flatMap(c => c.albums);
let n = 0;
for (const a of all) {
  const k = keyOf(a); if (k in db) continue;
  try { db[k] = await lookup(a); } catch (e) { console.error('skip', k, e.message); await new Promise(r => setTimeout(r, 30000)); continue; }
  console.log(db[k] ? 'ok ' : 'NO MATCH', a.artist, '-', a.title);
  if (++n % 20 === 0) writeFileSync(OUT, JSON.stringify(db));
  await new Promise(r => setTimeout(r, 3200));
}
writeFileSync(OUT, JSON.stringify(db));
const v = Object.values(db); console.log(`${v.filter(Boolean).length} matched, ${v.filter(x => !x).length} unmatched of ${all.length}`);
