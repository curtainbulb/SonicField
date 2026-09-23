// Shared by the browser and scripts/resolve.mjs: parsing + release matching.
export const keyOf = a => `${a.title}|${a.artist||''}|${a.year||''}`.toLowerCase();

export function parse(md) {
  const crates = []; let cur = null;
  for (const raw of md.split(/\r?\n/)) {
    const l = raw.trim();
    if (!l || l === 'SONICFIELD LIST') continue;
    if (l.startsWith('- [')) {
      const m = l.replace(/^- \[[xX ]\] ?/, '').match(/^(.+?)\s+\((\d{4})\)\s+—\s+(.+)$/);
      if (cur && m) cur.albums.push({ title: m[1].trim(), year: +m[2], artist: m[3].trim() });
    } else {
      const p = l.match(/^(.+?)\s*\((.+)\)\s*$/), name = p ? p[1].trim() : l;
      const d = name.match(/^(.+?)\s+—\s+(.+)$/);
      cur = { family: d ? d[1] : '', name: d ? d[2] : name, desc: p ? p[2].trim() : '', albums: [] };
      crates.push(cur);
    }
  }
  return crates;
}

const norm = s => (s||'').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
  .replace(/&/g,' and ').replace(/\[.*?\]|\(.*?\)/g,' ').replace(/[^a-z0-9 ]/g,' ')
  .replace(/\b(the|a)\b/g,' ').replace(/\s+/g,' ').trim();
const toks = s => new Set(norm(s).split(' ').filter(Boolean));
const BAD = /\b(live|deluxe|remix|tribute|karaoke|demo|anniversary|expanded|instrumental|sessions|rarities|box set)\b/i;

// Score one Apple release against one list entry. Artist, title and year all have to agree.
export function score(a, c) {
  const A = norm(a.artist), CA = norm(c.artistName);
  const artist = A === CA ? 1 : (CA.includes(A) || A.includes(CA)) ? .7 : 0;
  const t1 = toks(a.title), t2 = toks(c.collectionName);
  const inter = [...t1].filter(x => t2.has(x)).length;
  const title = norm(a.title) === norm(c.collectionName) ? 1 : inter / (new Set([...t1, ...t2]).size || 1) * .85;
  const cy = +String(c.releaseDate||'').slice(0,4), dy = Math.abs(cy - a.year);
  const year = dy === 0 ? 1 : dy === 1 ? .6 : 0;
  let s = .38*artist + .4*title + .22*year;
  if (BAD.test(c.collectionName) && !BAD.test(a.title)) s -= .15;
  return { s, artist, title, year };
}

export function pick(a, results) {
  const ranked = (results||[]).filter(c => c.collectionType === 'Album' || c.wrapperType === 'collection')
    .map(c => ({ c, ...score(a, c) })).sort((x, y) => y.s - x.s);
  const best = ranked[0];
  if (!best || best.artist < .7 || best.title < .8 || best.s < .84) return null;
  const c = best.c;
  return { id: c.collectionId, url: c.collectionViewUrl.split('?')[0], name: c.collectionName,
    artist: c.artistName, year: +String(c.releaseDate).slice(0,4), art: (c.artworkUrl100||'').replace('100x100bb','600x600bb'),
    score: +best.s.toFixed(3), country: 'us' };
}

export async function lookup(a, country = 'us') {
  const q = encodeURIComponent(`${a.artist} ${a.title.replace(/\[.*?\]|\(.*?\)/g,'')}`);
  const r = await fetch(`https://itunes.apple.com/search?term=${q}&media=music&entity=album&limit=12&country=${country}`);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return pick(a, (await r.json()).results);
}
