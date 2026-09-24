import { parse, keyOf, lookup, byArtist, pick, norm, sniff, compile } from './lib.js';
const $ = s => document.querySelector(s), esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
const ls = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

let crates = [], all = [], res = {}, heard = new Set(ls('sonicfield_heard', []));
const F = { q: '', dec: new Set(), h: 'all' };
const fams = []; const hue = f => { if (!fams.includes(f)) fams.push(f); return `hsl(${(fams.indexOf(f) * 47 + 12) % 360} 100% 68%)`; };
const isHeard = a => heard.has(a.k);

async function boot() {
  try {
    const [md, pre] = await Promise.all([fetch('albums.md').then(r => { if (!r.ok) throw Error('albums.md: HTTP ' + r.status); return r.text(); }),
      fetch('data/resolved.json').then(r => r.ok ? r.json() : {}).catch(() => ({}))]);
    res = { ...pre, ...ls('sf_res', {}) };
    crates = parse(md);
    crates.forEach((c, ci) => { c.c = hue(c.family); c.albums.forEach((a, ai) => { a.k = keyOf(a); a.ci = ci; a.ai = ai; all.push(a); }); });
    all.forEach(a => { const c = crates[a.ci]; a.crate = c.name; a.fam = c.family; a.res = !!res[a.k]; byK.set(a.k, a); (byA.get(a.artist) || byA.set(a.artist, []).get(a.artist)).push(a); });
    $('#dec').innerHTML = [1960,1970,1980,1990,2000].map(d => `<button data-d="${d}" aria-pressed="false">${d}s</button>`).join('');
    $('#rail').innerHTML = crates.map((c, i) => `<a href="#c${i}" id="r${i}" style="--c:${c.c}">${esc(c.name)}<small></small></a>`).join('');
    render();
  } catch (e) { $('#wall').innerHTML = `<p class="none">Couldn't load the list. ${esc(e.message)}. Serve this folder over http (not file://).</p>`; }
}

let pred = () => true;
const U = () => { const r = {}, t = {}, n = {}, s = {}; for (const [k, m] of Object.entries(meta)) { if (m.r) r[k] = m.r; if (m.tags?.length) t[k] = m.tags; if (m.note) n[k] = 1;
  if (m.sec !== undefined) (s[crates[m.sec].name] ||= []).push(k); } return { r, t, n, s, h: heard }; };
function visible(a) {
  const m = meta[a.k] || {};
  if (F.h === 'yes' && !isHeard(a)) return false; if (F.h === 'no' && isHeard(a)) return false;
  if (F.h === 'unrated' && m.r) return false; if (F.h === 'untagged' && m.tags?.length) return false; if (F.h === 'flag' && !flags(a).length) return false;
  if (F.dec.size && !F.dec.has(Math.floor(a.year / 10) * 10)) return false;
  return pred(a);
}
const tile = a => `<button class="sl${isHeard(a) ? ' heard' : ''}" data-k="${esc(a.k)}" data-c="${a.ci}" data-a="${a.ai}" aria-label="${esc(a.title)}, ${esc(a.artist)}, ${a.year}">
  <span class="in"><span class="t">${esc(a.title)}<em>${esc(a.artist)}</em></span><span class="y">${a.year}</span></span></button>`;

function render() {
  pred = compile(F.q, U());
  io.disconnect(); spy.disconnect(); vis.clear(); slow.clear(); // old tiles were never released after a re-render
  const out = crates.map((c, i) => {
    const list = c.albums.filter(visible); if (!list.length) return '';
    return `<section class="crate" id="c${i}" style="--c:${c.c}"><header><span class="fam">${esc(c.family)}</span><h2>${esc(c.name)}</h2>${c.desc ? `<p>${esc(c.desc)}</p>` : ''}
      <div class="tally"><span></span><small>heard</small><i><b></b></i></div></header><div class="shelf">${list.map(tile).join('')}</div></section>`;
  }).join('');
  $('#wall').innerHTML = out || `<p class="none">Nothing in the crates matches that. Clear a filter or shorten the search.</p>`;
  crates.forEach((c, i) => { const r = $('#r' + i); if (r) r.hidden = !$('#c' + i); });
  tallies(); watch();
}
function tallies() {
  $('#cnt').textContent = `${all.length} sleeves · ${all.filter(isHeard).length} played`;
  crates.forEach((c, i) => {
    const n = c.albums.filter(isHeard).length, el = $(`#c${i}`), r = $(`#r${i}`);
    if (r) { r.querySelector('small').textContent = `${n}/${c.albums.length}`; r.classList.toggle('done', n === c.albums.length); }
    if (el) { el.querySelector('.tally span').textContent = `${n}/${c.albums.length}`; el.querySelector('.tally b').style.width = `${n / c.albums.length * 100}%`; }
  });
}

// Artwork pipeline. Cause of the old slowness: one lookup per album, strictly sequential, 3.2s apart (~74 min for the list,
// ~100s for a single screen), nothing pre-resolved, and full 600px images in ~150px tiles. Now: cache-first paint, one search per
// artist (covers all their albums), visible-first queue, 3 workers, off-screen jobs skipped, 300px thumbs (600px only in the sheet).
const byK = new Map(), byA = new Map(), vis = new Set(), started = new Set(), slow = new Set(); let workers = 0, saveT;
const sz = (r, n) => r.art.replace(/\{s\}/g, n);
const persist = () => { clearTimeout(saveT); saveT = setTimeout(() => save('sf_res', res), 700); };
const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { vis.add(e.target); want(e.target); } else vis.delete(e.target); }), { rootMargin: '700px' });
function watch() { document.querySelectorAll('#wall .sl').forEach(t => io.observe(t)); document.querySelectorAll('.crate').forEach(c => spy.observe(c)); }
function want(t) { const a = byK.get(t.dataset.k); if (!a) return; if (a.k in res) return paint(t, res[a.k]); if (started.has(a.artist)) slow.add(a); go(); }
function paint(t, r) { if (!r?.art || t.querySelector('img')) return; const img = new Image(); img.alt = ''; img.decoding = 'async'; img.onload = () => { img.className = 'ok'; }; img.onerror = () => img.remove(); img.src = sz(r, 300); t.querySelector('.in').prepend(img); }
const paintAll = () => vis.forEach(t => { const a = byK.get(t.dataset.k); if (a && res[a.k]) paint(t, res[a.k]); });
const nap = ms => new Promise(r => setTimeout(r, ms));
function nextJob() {
  for (const t of vis) { const a = byK.get(t.dataset.k); if (a && !(a.k in res) && !started.has(a.artist)) return { artist: a.artist }; }
  for (const a of slow) { slow.delete(a); if (!(a.k in res) && [...vis].some(t => t.dataset.k === a.k)) return { a }; }
}
async function go() {
  while (workers < 3) { const j = nextJob(); if (!j) return; workers++;
    (async () => { try {
      if (j.artist) { started.add(j.artist); const rs = await byArtist(j.artist);
        byA.get(j.artist).forEach(a => { const m = pick(a, rs); if (m) { res[a.k] = m; a.res = true; } else slow.add(a); }); }
      else { const m = await lookup(j.a); res[j.a.k] = m; j.a.res = !!m; await nap(1500); }
      persist(); paintAll();
    } catch { if (j.artist) { started.delete(j.artist); await nap(30000); } } finally { workers--; go(); } })(); }
}
// Detail sheet
let cur = null; const failed = new Set();
let opener = null;
function lock(on) { document.documentElement.classList.toggle('lock', on); ['#wall', '#rail', '.bar', '#stats'].forEach(s => { $(s).inert = on; }); }
async function open(a) {
  cur = a; const ae = document.activeElement, keep = ae?.closest?.('#sheet') ? (ae.dataset.f ? `[data-f="${ae.dataset.f}"]` : ae.dataset.a ? `[data-a="${ae.dataset.a}"]` : ae.id ? '#' + ae.id : null) : null; const c = crates[a.ci], r = res[a.k];
  const same = c.albums.slice(Math.max(0, a.ai - 5), a.ai + 7).filter(x => x !== a);
  const yr = all.filter(x => x.year === a.year && x.ci !== a.ci).slice(0, 14);
  let link;
  if (r) link = `<a class="btn" href="${esc(r.url)}" target="_blank" rel="noopener">Play in Apple Music</a>`;
  else if (a.k in res) link = `<span class="btn off">No Apple Music link</span>`;
  else link = `<span class="btn off">${failed.has(a.k) ? 'Apple lookup unreachable' : 'Matching…'}</span>`;
  const why = r ? `Matched to "${esc(r.name)}" by ${esc(r.artist)}, ${r.year}, US storefront (confidence ${r.score}). Album id ${r.id}.`
    : a.k in res ? `No release scored high enough on artist, title and year together, so no link is shown. A guess would be worse.` : failed.has(a.k) ? `Couldn't reach Apple's catalogue just now. Close and reopen this record to retry; no link is guessed meanwhile.` : `Checking Apple's catalogue for artist, title and year.`;
  $('#sheet').style.setProperty('--c', c.c);
  $('#sheet').innerHTML = `<button class="x" aria-label="Close">×</button>
    <div class="disc"><div class="rec"></div><div class="cov"><span class="t" style="${r?.art ? 'display:none' : ''}">${esc(a.title)}</span>${r?.art ? `<img src="${esc(sz(r, 600))}" alt="Cover of ${esc(a.title)}">` : ''}</div></div>
    <h3>${esc(a.title)}</h3><p class="by">${esc(a.artist)}</p>
    <div class="meta"><span><b>${a.year}</b></span><span>${esc(c.name)}</span><span>${esc(c.family)}</span></div>
    <div class="acts">${link}<button class="btn alt" data-heard>${isHeard(a) ? 'Heard. Undo' : 'Mark heard'}</button></div><p class="why">${why}</p>${editor(a)}
    ${c.desc ? `<h4>The crate</h4><p>${esc(c.desc)}.</p>` : ''}
    <h4>Next to it in the crate</h4><div class="strip">${same.map(tile).join('')}</div>
    <h4>Also from ${a.year}, other crates</h4><div class="strip">${yr.map(tile).join('') || '<p>Nothing else in the list from this year.</p>'}</div>`;
  const was = $('#sheet').classList.contains('on'); if (!was) { opener = document.activeElement; lock(true); }
  $('#sheet').classList.add('on'); $('#veil').classList.add('on'); $('#sheet').setAttribute('aria-hidden', 'false'); ((keep && $(keep)) || (!$('#sheet').contains(document.activeElement) ? $('#sheet .x') : null))?.focus({ preventScroll: true });
  $('#sheet').querySelectorAll('.sl').forEach(t => io.observe(t));
  if (!(a.k in res) && !failed.has(a.k)) { try { res[a.k] = await lookup(a); save('sf_res', res); } catch { failed.add(a.k); if (cur === a) open(a); return; } if (cur === a) open(a); }
}
function close() { $('#sheet').classList.remove('on'); $('#veil').classList.remove('on'); $('#sheet').setAttribute('aria-hidden', 'true'); cur = null; if (document.documentElement.classList.contains('lock')) { lock(false); opener?.focus({ preventScroll: true }); opener = null; } }
const byTile = t => { const b = t.closest('.sl'); return b && all.find(x => x.k === b.dataset.k); };

document.addEventListener('click', e => {
  const t = e.target;
  if (t.closest('.sl')) return open(byTile(t));
  if (t.closest('.x') || t.id === 'veil') return close();
  if (t.closest('[data-heard]') && cur) { heard.has(cur.k) ? heard.delete(cur.k) : heard.add(cur.k); save('sonicfield_heard', [...heard]);
    document.querySelectorAll('.sl').forEach(s => s.classList.toggle('heard', heard.has(s.dataset.k))); tallies(); return open(cur); }
  const d = t.closest('[data-d]'); if (d) { const n = +d.dataset.d; F.dec.has(n) ? F.dec.delete(n) : F.dec.add(n); d.setAttribute('aria-pressed', F.dec.has(n)); render(); return scrollTo({ top: 0, behavior: 'instant' }); }
  const h = t.closest('[data-h]'); if (h) { F.h = h.dataset.h; document.querySelectorAll('[data-h]').forEach(b => b.setAttribute('aria-pressed', b === h)); render(); return scrollTo({ top: 0, behavior: 'instant' }); }
  if (t.closest('#pull')) { const p = all.filter(a => visible(a) && !isHeard(a)); if (!p.length) return; const a = p[Math.random() * p.length | 0];
    document.querySelector(`.sl[data-k="${CSS.escape(a.k)}"]`)?.scrollIntoView({ block: 'center', behavior: 'instant' }); open(a); }
});
let tm; $('#q').addEventListener('input', e => { clearTimeout(tm); tm = setTimeout(() => { F.q = e.target.value.trim(); render(); scrollTo({ top: 0, behavior: 'instant' }); }, 150); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
document.addEventListener('pointermove', e => { const s = e.target.closest?.('.sl'); if (!s || matchMedia('(prefers-reduced-motion:reduce)').matches) return;
  const b = s.getBoundingClientRect(); s.style.setProperty('--ry', `${((e.clientX - b.left) / b.width - .5) * 14}deg`); s.style.setProperty('--rx', `${-((e.clientY - b.top) / b.height - .5) * 14}deg`); });
var spy = new IntersectionObserver(es => es.forEach(e => { if (!e.isIntersecting) return; let on;
  document.querySelectorAll('#rail a').forEach(a => { const y = a.id === 'r' + e.target.id.slice(1); a.classList.toggle('on', y); if (y) on = a; });
  const r = $('#rail'); if (on) r.scrollTo({ top: on.offsetTop - r.clientHeight / 2 + on.offsetHeight / 2, left: on.offsetLeft - r.clientWidth / 2 + on.offsetWidth / 2, behavior: 'auto' }); }), { rootMargin: '-130px 0px -70% 0px' });

// Taxonomy + audio annotations. Every audio value carries provenance: 'file' (measured) or 'user' (typed in). Nothing is inferred silently.
var meta = ls('sf_meta', {}); const M = k => meta[k] || (meta[k] = {}), saveMeta = () => save('sf_meta', meta);
const FMT = { FLAC: 1, ALAC: 1, WAV: 1, AIFF: 1, DSD: 1, MP3: 0, AAC: 0, Opus: 0, Vorbis: 0 };
const TYPES = ['Studio album', 'Live', 'Compilation', 'EP', 'Soundtrack', 'Reissue', 'Demo/outtakes'], RATES = [44.1, 48, 88.2, 96, 176.4, 192, 352.8, 384];
let dm; const dupOf = a => { if (!dm) { dm = new Map(); const g = new Map(); all.forEach(x => { const s = x.artist + '|' + norm(x.title); (g.get(s) || g.set(s, []).get(s)).push(x); });
  g.forEach(v => v.length > 1 && v.forEach(x => dm.set(x.k, v.find(y => y !== x).title))); } return dm.get(a.k); };
function flags(a) { const u = meta[a.k]?.au, f = [], l = u && FMT[u.fmt];
  if (u) { if (l === 0 && u.bd) f.push('Lossy formats have no bit depth: the value or the format is wrong.'); if (l === 0 && u.sr > 48) f.push('Sample rate above 48 kHz on a lossy file is unusual.');
    if (u.sr && !RATES.includes(+u.sr)) f.push(`${u.sr} kHz is not a standard rate.`); if (u.bd && ![16, 24, 32].includes(+u.bd)) f.push(`${u.bd}-bit is not a standard depth.`);
    if (l === 1 && !u.sr) f.push('Lossless file with no sample rate recorded.'); }
  const d = dupOf(a); if (d) f.push(`Possible duplicate of "${d}" (same artist, same title without edition tags).`); return f; }
function editor(a) { const m = meta[a.k] || {}, u = m.au || {}, fl = flags(a), o = (l, v) => l.map(x => `<option${x === v ? ' selected' : ''}>${x}</option>`).join('');
  const dur = u.dur ? `, ${Math.floor(u.dur / 60)}:${String(Math.round(u.dur % 60)).padStart(2, '0')} long` : '';
  return `<div class="ed"><h4>Your classification</h4><div class="stars" role="group" aria-label="Rating">${[1, 2, 3, 4, 5].map(n => `<button data-r="${n}" aria-label="${n} stars" class="${(m.r || 0) >= n ? 'on' : ''}">★</button>`).join('')}<button data-r="0">clear</button></div>
  <label>Release type<select data-f="ty"><option value="">unset</option>${o(TYPES, m.ty)}</select></label>
  <label>Also filed under<select data-f="sec"><option value="">nowhere else</option>${crates.map((c, i) => `<option value="${i}"${m.sec === i ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
  <label>Tags, comma separated<input data-f="tags" value="${esc((m.tags || []).join(', '))}" placeholder="concept album, mono mix"></label>
  <label>Note<input data-f="note" value="${esc(m.note || '')}"></label>
  <h4>Audio of your copy</h4><div class="row"><label>Format<select data-a="fmt"><option value="">unset</option>${o(Object.keys(FMT), u.fmt)}</select></label>
  <label>kHz<input data-a="sr" type="number" step="0.1" value="${u.sr || ''}"></label><label>Bits<input data-a="bd" type="number" value="${u.bd || ''}"></label><label>Channels<input data-a="ch" type="number" min="1" value="${u.ch || ''}"></label></div>
  <label>Mastering or source<input data-a="src" value="${esc(u.src || '')}" placeholder="2009 remaster, CD rip"></label>
  <label>Read a FLAC or WAV header<input type="file" id="hdr" accept=".flac,.wav"></label>
  <p class="why">${u.prov === 'file' ? `Measured from the file header${dur}. Loudness, dynamic range and file integrity are not measured.` : u.prov ? 'Typed in by you, not measured.' : 'No audio details yet. Nothing is guessed.'}</p>
  ${fl.length ? `<ul class="flags">${fl.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</div>`; }
document.addEventListener('click', e => { const b = e.target.closest('[data-r]'); if (b && cur) { M(cur.k).r = +b.dataset.r || undefined; saveMeta(); open(cur); } });
document.addEventListener('change', async e => { const t = e.target; if (!cur) return; const m = M(cur.k);
  if (t.dataset.f) { const f = t.dataset.f; m[f] = f === 'tags' ? t.value.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : f === 'sec' ? (t.value === '' ? undefined : +t.value) : t.value || undefined; }
  else if (t.dataset.a) { const u = m.au ||= {}; u[t.dataset.a] = t.type === 'number' ? +t.value || undefined : t.value || undefined; u.prov = 'user'; }
  else if (t.id === 'hdr' && t.files[0]) { const i = sniff(await t.files[0].slice(0, 64).arrayBuffer()); if (!i) return t.insertAdjacentHTML('afterend', '<p class="why">Not a FLAC or WAV header, so nothing was read.</p>'); m.au = { ...m.au, ...i, prov: 'file' }; }
  else return; saveMeta(); open(cur); });

// Total Stats: each crate is a five-spike star, one spike per decade. Faint spike = albums in that decade (same scale for every crate);
// solid spike = the part you've heard. Click a star to jump to its crate.
const DEC = [1960, 1970, 1980, 1990, 2000];
function starSvg(c) { const dc = DEC.map(d => c.albums.filter(a => Math.floor(a.year / 10) * 10 === d)), P = (arr, f) => arr.map((_, i) => { const ang = i => (-90 + 72 * i) * Math.PI / 180, r = 8 + 40 * f(i);
  const v = a => `${(50 + 9 * Math.cos(a)).toFixed(1)},${(50 + 9 * Math.sin(a)).toFixed(1)}`; return `${(50 + r * Math.cos(ang(i))).toFixed(1)},${(50 + r * Math.sin(ang(i))).toFixed(1)} ${v(ang(i) + .63)}`; }).join(' ');
  return `<svg viewBox="0 0 100 100" aria-hidden="true"><polygon points="${P(dc, i => Math.sqrt(dc[i].length / 45))}" fill="${c.c}" opacity=".28"/><polygon points="${P(dc, i => Math.sqrt(dc[i].filter(isHeard).length / 45))}" fill="${c.c}"/></svg>`; }
function stats() {
  const n = all.length, hd = all.filter(isHeard).length, mt = all.filter(a => res[a.k]), R = all.filter(a => meta[a.k]?.r), tg = all.filter(a => meta[a.k]?.tags?.length), au = all.filter(a => meta[a.k]?.au?.fmt);
  const ll = au.filter(a => FMT[meta[a.k].au.fmt] === 1).length, fl = all.filter(a => flags(a).length), dup = all.filter(dupOf).length;
  const comp = n ? Math.round(all.reduce((s, a) => { const m = meta[a.k] || {}; return s + [m.r, m.tags?.length, m.ty, m.au?.fmt, res[a.k]].filter(Boolean).length / 5; }, 0) / n * 100) : 0;
  const cnt = {}; all.forEach(a => cnt[a.artist] = (cnt[a.artist] || 0) + 1);
  const T = (v, l, f) => `<button class="st" data-go="${f || ''}"><b>${v}</b><span>${l}</span></button>`, rd = [5, 4, 3, 2, 1].map(s => R.filter(a => meta[a.k].r === s).length), mx = Math.max(1, ...rd);
  $('#stats').innerHTML = `<h2>Total stats</h2><div class="sts">${T(new Set(all.map(a => a.artist)).size, 'artists')}${T(n, 'albums')}${T(mt.length + '/' + n, 'matched to Apple Music')}
   ${T(mt.reduce((s, a) => s + (res[a.k].tracks || 0), 0), 'tracks in matched releases')}${T(hd + ' (' + (n ? Math.round(hd / n * 100) : 0) + '%)', 'heard', 'is:heard')}${T(R.length ? (R.reduce((s, a) => s + meta[a.k].r, 0) / R.length).toFixed(1) + '★ · ' + R.length : '0', 'rated, average', 'is:rated')}
   ${T(tg.length, 'tagged')}${T(au.length ? ll + ' lossless / ' + (au.length - ll) + ' lossy' : 'none yet', 'copies with a format')}${T(fl.length, 'flagged for review', 'flag')}${T(dup, 'possible duplicates', 'flag')}${T(comp + '%', 'metadata complete')}</div>
   <h3>Star map</h3><p class="why">One star per crate, one spike per decade, clockwise from the top: ${DEC.map(d => d + 's').join(', ')}. Faint is what exists, solid is what you've heard.</p>
   <div class="map">${crates.map((c, i) => `<button data-c="${i}" title="${esc(c.name)}: ${c.albums.filter(isHeard).length}/${c.albums.length} heard">${starSvg(c)}<span>${esc(c.name)}</span></button>`).join('')}</div>
   <div class="two"><div><h3>Ratings</h3>${rd.map((v, i) => `<div class="rbar"><span>${5 - i}★</span><i style="width:${v / mx * 100}%"></i><em>${v}</em></div>`).join('')}${R.length ? '' : '<p class="why">Nothing rated yet. Open a record and tap the stars.</p>'}</div>
   <div><h3>Most represented artists</h3>${Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([a, v]) => `<button class="ln" data-q="artist:&quot;${esc(a)}&quot;">${esc(a)}<em>${v}</em></button>`).join('')}
   <h3>Smallest crates</h3>${[...crates].sort((a, b) => a.albums.length - b.albums.length).slice(0, 5).map(c => `<button class="ln" data-q="crate:&quot;${esc(c.name)}&quot;">${esc(c.name)}<em>${c.albums.length}</em></button>`).join('')}</div></div>
   <h3>Your data</h3><div class="acts"><button class="btn" id="ex-j">Export JSON</button><button class="btn" id="ex-c">Export CSV</button><label class="btn alt">Import JSON<input type="file" id="im" accept=".json" hidden></label></div>`;
}
const dl = (name, text, type) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); };
let pos = 0;
function stats_show(on, keep = true) { if (on) pos = scrollY; document.body.classList.toggle('stats', on); $('#sb').textContent = on ? 'Back to crates' : 'Stats'; if (on) stats(); else render(); scrollTo({ top: on || !keep ? 0 : pos, behavior: 'instant' }); }
$('#sb').onclick = () => stats_show(!document.body.classList.contains('stats'));
$('#stats').addEventListener('click', e => { const g = e.target.closest('[data-go],[data-c],[data-q],#ex-j,#ex-c');
  if (!g) return; if (g.id === 'ex-j') return dl('sonicfield.json', JSON.stringify({ heard: [...heard], meta }, null, 1), 'application/json');
  if (g.id === 'ex-c') { const q = s => `"${String(s ?? '').replace(/"/g, '""')}"`; return dl('sonicfield-technical.csv', ['artist,title,year,crate,heard,rating,type,tags,format,khz,bits,channels,audio_provenance,apple_id,flags'].concat(all.map(a => { const m = meta[a.k] || {}, u = m.au || {};
    return [a.artist, a.title, a.year, a.crate, isHeard(a), m.r, m.ty, (m.tags || []).join(';'), u.fmt, u.sr, u.bd, u.ch, u.prov, res[a.k]?.id, flags(a).join(' | ')].map(q).join(','); })).join('\n'), 'text/csv'); }
  if (g.dataset.c) { stats_show(false, false); return setTimeout(() => $(`#c${g.dataset.c}`)?.scrollIntoView(), 30); }
  const s = g.dataset.q ?? ({ 'is:heard': 'is:heard', 'is:rated': 'is:rated', 'is:noted': 'is:noted', flag: '' })[g.dataset.go]; if (s == null || g.dataset.go === undefined && g.dataset.q === undefined) return;
  if (g.dataset.go === 'flag') F.h = 'flag'; else F.h = 'all'; F.q = s; $('#q').value = s; stats_show(false, false); });
$('#stats').addEventListener('change', async e => { if (e.target.id !== 'im' || !e.target.files[0]) return; try { const d = JSON.parse(await e.target.files[0].text());
  if (!Array.isArray(d.heard) || typeof d.meta !== 'object') throw 0; heard = new Set([...heard, ...d.heard]); meta = { ...meta, ...d.meta }; save('sonicfield_heard', [...heard]); saveMeta(); stats(); } catch { e.target.insertAdjacentHTML('afterend', '<p class="why">That file isn\'t a SonicField export.</p>'); } });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
const hh = () => { const b = $('.bar'), sticky = getComputedStyle(b).position === 'sticky'; document.documentElement.style.setProperty('--hh', (sticky ? b.offsetHeight : $('#rail').offsetHeight) + 'px'); };
new ResizeObserver(hh).observe($('.bar')); new ResizeObserver(hh).observe($('#rail')); addEventListener('resize', hh); hh();
boot();
