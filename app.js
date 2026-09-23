import { parse, keyOf, lookup } from './lib.js';
const $ = s => document.querySelector(s), esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
const ls = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

let crates = [], all = [], res = {}, heard = new Set(ls('sonicfield_heard', []));
const F = { q: '', dec: new Set(), h: 'all' };
const fams = []; const hue = f => { if (!fams.includes(f)) fams.push(f); return `hsl(${(fams.indexOf(f) * 47 + 12) % 360} 88% 64%)`; };
const isHeard = a => heard.has(a.k);

async function boot() {
  try {
    const [md, pre] = await Promise.all([fetch('albums.md').then(r => { if (!r.ok) throw Error('albums.md: HTTP ' + r.status); return r.text(); }),
      fetch('data/resolved.json').then(r => r.ok ? r.json() : {}).catch(() => ({}))]);
    res = { ...pre, ...ls('sf_res', {}) };
    crates = parse(md);
    crates.forEach((c, ci) => { c.c = hue(c.family); c.albums.forEach((a, ai) => { a.k = keyOf(a); a.ci = ci; a.ai = ai; all.push(a); }); });
    $('#dec').innerHTML = [1960,1970,1980,1990,2000].map(d => `<button data-d="${d}" aria-pressed="false">${d}s</button>`).join('');
    $('#rail').innerHTML = crates.map((c, i) => `<a href="#c${i}" id="r${i}" style="--c:${c.c}">${esc(c.name)}<small></small></a>`).join('');
    render();
  } catch (e) { $('#wall').innerHTML = `<p class="none">Couldn't load the list. ${esc(e.message)}. Serve this folder over http (not file://).</p>`; }
}

function visible(a) {
  if (F.h === 'yes' && !isHeard(a)) return false;
  if (F.h === 'no' && isHeard(a)) return false;
  if (F.dec.size && !F.dec.has(Math.floor(a.year / 10) * 10)) return false;
  return !F.q || `${a.title} ${a.artist}`.toLowerCase().includes(F.q);
}
const tile = a => `<button class="sl${isHeard(a) ? ' heard' : ''}" data-k="${esc(a.k)}" data-c="${a.ci}" data-a="${a.ai}" aria-label="${esc(a.title)}, ${esc(a.artist)}, ${a.year}">
  <span class="in"><span class="t">${esc(a.title)}<em>${esc(a.artist)}</em></span><span class="y">${a.year}</span></span></button>`;

function render() {
  const out = crates.map((c, i) => {
    const list = c.albums.filter(visible); if (!list.length) return '';
    return `<section class="crate" id="c${i}" style="--c:${c.c}"><header><span class="fam">${esc(c.family)}</span><h2>${esc(c.name)}</h2>${c.desc ? `<p>${esc(c.desc)}</p>` : ''}
      <div class="tally"><span></span><small>heard</small><i><b></b></i></div></header><div class="shelf">${list.map(tile).join('')}</div></section>`;
  }).join('');
  $('#wall').innerHTML = out || `<p class="none">Nothing in the crates matches that. Clear a filter or shorten the search.</p>`;
  tallies(); watch();
}
function tallies() {
  crates.forEach((c, i) => {
    const n = c.albums.filter(isHeard).length, el = $(`#c${i}`), r = $(`#r${i}`);
    if (r) { r.querySelector('small').textContent = `${n}/${c.albums.length}`; r.classList.toggle('done', n === c.albums.length); }
    if (el) { el.querySelector('.tally span').textContent = `${n}/${c.albums.length}`; el.querySelector('.tally b').style.width = `${n / c.albums.length * 100}%`; }
  });
}

// Artwork: only ever shown for a matched release; lookups run as tiles scroll into view.
const q = []; let busy = false;
const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { io.unobserve(e.target); want(e.target); } }), { rootMargin: '300px' });
function watch() { document.querySelectorAll("#wall .sl").forEach(t => io.observe(t)); document.querySelectorAll(".crate").forEach(c => spy.observe(c)); }
function want(t) { const a = all.find(x => x.k === t.dataset.k); if (!a) return; if (a.k in res) return paint(t, res[a.k]); q.push({ a, t }); pump(); }
function paint(t, r) { if (!r?.art) return; const img = new Image(); img.alt = ''; img.onload = () => { img.className = 'ok'; }; img.onerror = () => img.remove(); img.src = r.art; t.querySelector('.in').prepend(img); }
async function pump() {
  if (busy) return; busy = true;
  while (q.length) {
    const { a, t } = q.shift();
    if (!(a.k in res)) { try { res[a.k] = await lookup(a); save('sf_res', Object.fromEntries(Object.entries(res).filter(([k]) => !k.startsWith('#')))); } catch { break; } await new Promise(r => setTimeout(r, 3200)); }
    paint(t, res[a.k]);
  }
  busy = false;
}

// Detail sheet
let cur = null; const failed = new Set();
async function open(a) {
  cur = a; const c = crates[a.ci], r = res[a.k];
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
    <div class="disc"><div class="rec"></div><div class="cov"><span class="t" style="${r?.art ? 'display:none' : ''}">${esc(a.title)}</span>${r?.art ? `<img src="${esc(r.art)}" alt="Cover of ${esc(a.title)}">` : ''}</div></div>
    <h3>${esc(a.title)}</h3><p class="by">${esc(a.artist)}</p>
    <div class="meta"><span><b>${a.year}</b></span><span>${esc(c.name)}</span><span>${esc(c.family)}</span></div>
    <div class="acts">${link}<button class="btn alt" data-heard>${isHeard(a) ? 'Heard. Undo' : 'Mark heard'}</button></div><p class="why">${why}</p>
    ${c.desc ? `<h4>The crate</h4><p>${esc(c.desc)}.</p>` : ''}
    <h4>Next to it in the crate</h4><div class="strip">${same.map(tile).join('')}</div>
    <h4>Also from ${a.year}, other crates</h4><div class="strip">${yr.map(tile).join('') || '<p>Nothing else in the list from this year.</p>'}</div>`;
  $('#sheet').classList.add('on'); $('#veil').classList.add('on'); $('#sheet').setAttribute('aria-hidden', 'false'); $('#sheet .x').focus();
  $('#sheet').querySelectorAll('.sl').forEach(t => io.observe(t));
  if (!(a.k in res) && !failed.has(a.k)) { try { res[a.k] = await lookup(a); save('sf_res', res); } catch { failed.add(a.k); if (cur === a) open(a); return; } if (cur === a) open(a); }
}
function close() { $('#sheet').classList.remove('on'); $('#veil').classList.remove('on'); $('#sheet').setAttribute('aria-hidden', 'true'); cur = null; }
const byTile = t => { const b = t.closest('.sl'); return b && all.find(x => x.k === b.dataset.k); };

document.addEventListener('click', e => {
  const t = e.target;
  if (t.closest('.sl')) return open(byTile(t));
  if (t.closest('.x') || t.id === 'veil') return close();
  if (t.closest('[data-heard]') && cur) { heard.has(cur.k) ? heard.delete(cur.k) : heard.add(cur.k); save('sonicfield_heard', [...heard]);
    document.querySelectorAll('.sl').forEach(s => s.classList.toggle('heard', heard.has(s.dataset.k))); tallies(); return open(cur); }
  const d = t.closest('[data-d]'); if (d) { const n = +d.dataset.d; F.dec.has(n) ? F.dec.delete(n) : F.dec.add(n); d.setAttribute('aria-pressed', F.dec.has(n)); return render(); }
  const h = t.closest('[data-h]'); if (h) { F.h = h.dataset.h; document.querySelectorAll('[data-h]').forEach(b => b.setAttribute('aria-pressed', b === h)); return render(); }
  if (t.closest('#pull')) { const p = all.filter(a => visible(a) && !isHeard(a)); if (!p.length) return; const a = p[Math.random() * p.length | 0];
    document.querySelector(`.sl[data-k="${CSS.escape(a.k)}"]`)?.scrollIntoView({ block: 'center' }); open(a); }
});
let tm; $('#q').addEventListener('input', e => { clearTimeout(tm); tm = setTimeout(() => { F.q = e.target.value.trim().toLowerCase(); render(); }, 150); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
document.addEventListener('pointermove', e => { const s = e.target.closest?.('.sl'); if (!s || matchMedia('(prefers-reduced-motion:reduce)').matches) return;
  const b = s.getBoundingClientRect(); s.style.setProperty('--ry', `${((e.clientX - b.left) / b.width - .5) * 14}deg`); s.style.setProperty('--rx', `${-((e.clientY - b.top) / b.height - .5) * 14}deg`); });
var spy = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { document.querySelectorAll('#rail a').forEach(a => a.classList.toggle('on', a.id === 'r' + e.target.id.slice(1))); } }), { rootMargin: '-15% 0px -75% 0px' });

boot();
