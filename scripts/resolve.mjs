// Build-time resolver: node scripts/resolve.mjs  (resumable; one request per 3.2s for Apple's rate limit)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { parse, keyOf, lookup, byArtist, pick } from '../lib.js';
const OUT = new URL('../data/resolved.json', import.meta.url);
const db = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
const all = parse(readFileSync(new URL('../albums.md', import.meta.url), 'utf8')).flatMap(c => c.albums);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const artists = [...new Set(all.map(a => a.artist))];
for (const ar of artists) {
  const todo = all.filter(a => a.artist === ar && !(keyOf(a) in db)); if (!todo.length) continue;
  try { const rs = await byArtist(ar); for (const a of todo) { const m = pick(a, rs); if (m) db[keyOf(a)] = m; } await sleep(1500); }
  catch (e) { console.error('skip', ar, e.message); await sleep(30000); continue; }
  for (const a of todo.filter(a => !(keyOf(a) in db))) { try { db[keyOf(a)] = await lookup(a); } catch { continue; } await sleep(3200); }
  console.log(ar, todo.filter(a => db[keyOf(a)]).length + '/' + todo.length);
  writeFileSync(OUT, JSON.stringify(db));
}
writeFileSync(OUT, JSON.stringify(db));
const v = Object.values(db); console.log(`${v.filter(Boolean).length} matched, ${v.filter(x => !x).length} unmatched of ${all.length}`);
