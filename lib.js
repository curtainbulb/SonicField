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

export const norm = s => (s||'').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
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
    artist: c.artistName, year: +String(c.releaseDate).slice(0,4), art: (c.artworkUrl100||'').replace('100x100bb','{s}x{s}bb'), tracks: c.trackCount,
    score: +best.s.toFixed(3), country: 'us', genre: c.primaryGenreName, tracks: c.trackCount, label: c.copyright };
}

export async function lookup(a, country = 'us') {
  const q = encodeURIComponent(`${a.artist} ${a.title.replace(/\[.*?\]|\(.*?\)/g,'')}`);
  const r = await fetch(`https://itunes.apple.com/search?term=${q}&media=music&entity=album&limit=12&country=${country}`);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return pick(a, (await r.json()).results);
}

// Search syntax: free text, "phrases", artist: title: crate: family: tag: shelf: is:heard|unheard|rated|noted|matched,
// year:1970-1979, year>=1980, rating>=4, and a leading - to negate. All terms AND together.
export function compile(q, U) {
  const P = [], txt = (a, t) => `${a.title} ${a.artist}`.toLowerCase().includes(t);
  for (const m of q.matchAll(/(-?)(\w+)(:|>=|<=)("[^"]*"|\S+)|("[^"]*"|\S+)/g)) {
    if (m[5]) { const t = m[5].replace(/"/g, '').toLowerCase(); P.push(a => txt(a, t)); continue; }
    const neg = !!m[1], f = m[2].toLowerCase(), op = m[3], v = m[4].replace(/"/g, '').toLowerCase(); let fn;
    if (f === 'year') { const [lo, hi] = v.includes('-') ? v.split('-').map(Number) : op === '>=' ? [+v, 9999] : op === '<=' ? [0, +v] : [+v, +v]; fn = a => a.year >= lo && a.year <= hi; }
    else if (f === 'rating') fn = a => { const r = U.r[a.k] || 0; return op === '>=' ? r >= +v : op === '<=' ? r > 0 && r <= +v : r === +v; };
    else if (f === 'is') fn = a => ({ heard: U.h.has(a.k), unheard: !U.h.has(a.k), rated: !!U.r[a.k], noted: !!U.n[a.k], matched: a.res })[v];
    else if (f === 'tag') fn = a => (U.t[a.k] || []).includes(v);
    else if (f === 'shelf') fn = a => Object.entries(U.s).some(([n, l]) => n.toLowerCase() === v && l.includes(a.k));
    else if (f === 'artist' || f === 'title') fn = a => a[f].toLowerCase().includes(v);
    else if (f === 'crate' || f === 'family') fn = a => (f === 'crate' ? a.crate : a.fam).toLowerCase().includes(v);
    else fn = a => txt(a, m[0].toLowerCase());
    P.push(neg ? a => !fn(a) : fn);
  }
  return a => P.every(p => p(a));
}

// One request returns up to 200 releases for an artist: 348 artists cover all 1,391 albums.
export async function byArtist(artist, country = 'us') {
  const r = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(artist)}&attribute=artistTerm&media=music&entity=album&limit=200&country=${country}`);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return (await r.json()).results;
}
// Reads FLAC STREAMINFO or a WAV fmt chunk. Values are measured from the header, nothing else.
export function sniff(buf) {
  const v = new DataView(buf), u = o => v.getUint8(o), s = o => String.fromCharCode(u(o), u(o+1), u(o+2), u(o+3));
  if (buf.byteLength >= 26 && s(0) === 'fLaC') { const sr = (u(18) << 12) | (u(19) << 4) | (u(20) >> 4);
    return { fmt: 'FLAC', sr: sr / 1000, ch: ((u(20) >> 1) & 7) + 1, bd: (((u(20) & 1) << 4) | (u(21) >> 4)) + 1, dur: sr ? ((u(21) & 15) * 2 ** 32 + v.getUint32(22)) / sr : undefined }; }
  if (buf.byteLength >= 36 && s(0) === 'RIFF' && s(8) === 'WAVE' && s(12) === 'fmt ')
    return { fmt: 'WAV', ch: v.getUint16(22, true), sr: v.getUint32(24, true) / 1000, bd: v.getUint16(34, true) };
  return null;
}
