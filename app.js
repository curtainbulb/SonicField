import { parse, keyOf, lookup, byArtist, pick, norm, sniff, compile } from './lib.js';
const $ = s => document.querySelector(s), esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
const ls = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

let crates = [], all = [], res = {};
const heardKeys = ls('sonicfield_heard', []);
let heard = new Set(Array.isArray(heardKeys) ? heardKeys : []);
const savedKeys = ls('sf_faves', []), recentKeys = ls('sf_recent', []);
let favorites = new Set(Array.isArray(savedKeys) ? savedKeys : []), recent = Array.isArray(recentKeys) ? recentKeys : [], currentView = 'listen';
const F = { q: '', dec: new Set(), h: 'all' };
const isHeard = a => heard.has(a.k);
const isFavorite = a => favorites.has(a.k);

async function boot() {
  try {
    const [md, pre] = await Promise.all([fetch('albums.md').then(r => { if (!r.ok) throw Error('albums.md: HTTP ' + r.status); return r.text(); }),
      fetch('data/resolved.json').then(r => r.ok ? r.json() : {}).catch(() => ({}))]);
    res = { ...pre, ...ls('sf_res', {}) };
    crates = parse(md);
    crates.forEach((c, ci) => { c.c = 'var(--accent)'; c.albums.forEach((a, ai) => { a.k = keyOf(a); a.ci = ci; a.ai = ai; all.push(a); }); });
    all.forEach(a => { const c = crates[a.ci]; a.crate = c.name; a.fam = c.family; a.res = !!res[a.k]; byK.set(a.k, a); (byA.get(a.artist) || byA.set(a.artist, []).get(a.artist)).push(a); });
    $('#rail').innerHTML = crates.map((c, i) => `<a href="#c${i}" id="r${i}" style="--c:${c.c}">${esc(c.name)}<small></small></a>`).join('');
    $('#crate-count').textContent = crates.length;
    updateSavedCount();
    render();
  } catch (e) { $('#wall').innerHTML = `<section class="error-state"><span class="eyebrow">The index did not open</span><h1>We couldn't read your crates.</h1><p>${esc(e.message)}. Open SonicField through a web server and try again.</p><button class="action" data-retry>Try again</button></section>`; }
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
const tile = a => `<button class="sl${isHeard(a) ? ' heard' : ''}" data-k="${esc(a.k)}" data-c="${a.ci}" data-a="${a.ai}" aria-label="${esc(a.title)}, ${esc(a.artist)}, ${a.year}${isHeard(a) ? ', heard' : ''}">
  <span class="in"><span class="t">${esc(a.title)}<em>${esc(a.artist)}</em></span><span class="y">${a.year}</span>${isFavorite(a) ? '<span class="saved-mark">SAVED</span>' : ''}</span></button>`;

function recommendations(limit = 8) {
  const seeds = all.filter(a => (meta[a.k]?.r || 0) >= 4);
  if (!seeds.length) return `<div class="quiet-note"><span class="eyebrow">A note on discovery</span><p>Rate records as you listen. SonicField will use your ratings and the collection’s crate, family, decade, and tags to suggest what to try next.</p></div>`;
  const score = (a, b) => {
    const tags = (meta[a.k]?.tags || []).filter(t => (meta[b.k]?.tags || []).includes(t)).length;
    return (a.crate === b.crate ? 4 : 0) + (a.fam === b.fam ? 3 : 0) + (Math.floor(a.year / 10) === Math.floor(b.year / 10) ? 2 : 0) + tags * 2;
  };
  const picks = all.filter(a => !seeds.includes(a)).map(a => ({ a, score: Math.max(...seeds.map(s => score(a, s))) }))
    .filter(x => x.score > 0).sort((x, y) => y.score - x.score || x.a.year - y.a.year).slice(0, limit).map(x => x.a);
  return picks.length ? `<div class="record-row">${picks.map(tile).join('')}</div>` : `<div class="quiet-note"><p>Your high-rated records do not have enough shared metadata to make suggestions yet.</p></div>`;
}

function render() {
  pred = compile(F.q, U());
  io.disconnect(); spy.disconnect(); vis.clear(); slow.clear(); // old tiles were never released after a re-render
  document.body.dataset.view = currentView;
  document.querySelectorAll('[data-view]').forEach(b => {
    const selected = b.dataset.view === currentView;
    if (b.matches('button')) b.setAttribute('aria-current', selected ? 'page' : 'false');
    b.classList.toggle('selected', selected);
  });
  const rail = $('#rail');
  rail.hidden = currentView !== 'crates' || !!F.q;
  $('.crate-index-head').hidden = rail.hidden;
  $('#stats').hidden = currentView !== 'stats';
  if (currentView === 'stats') { stats(); $('#wall').hidden = true; tallies(); return; }
  $('#wall').hidden = false;
  let out;
  if (currentView === 'listen') out = listeningRoom();
  else if (currentView === 'saved') out = savedView();
  else out = crateView();
  $('#wall').innerHTML = out;
  crates.forEach((c, i) => { const r = $('#r' + i); if (r) r.hidden = !$('#c' + i); });
  tallies(); watch();
}
function crateView() {
  const filtered = F.q || F.dec.size || F.h !== 'all';
  const controls = `<div class="collection-heading"><div><span class="eyebrow">The collection · ${all.length} records</span><h1>${F.q ? 'Search results' : 'Browse the crates'}</h1><p>One collection, filed by sound and era. Choose a crate or narrow the index.</p></div><div class="view-controls"><div class="filter-line" aria-label="Decade">${[1960,1970,1980,1990,2000].map(d => `<button data-d="${d}" aria-pressed="${F.dec.has(d)}">${d}s</button>`).join('')}</div><label class="select-filter"><span class="sr-only">Listening status</span><select id="heard-filter"><option value="all" ${F.h === 'all' ? 'selected' : ''}>Every record</option><option value="no" ${F.h === 'no' ? 'selected' : ''}>Not heard yet</option><option value="yes" ${F.h === 'yes' ? 'selected' : ''}>Heard</option><option value="unrated" ${F.h === 'unrated' ? 'selected' : ''}>Unrated</option><option value="untagged" ${F.h === 'untagged' ? 'selected' : ''}>Untagged</option><option value="flag" ${F.h === 'flag' ? 'selected' : ''}>Needs review</option></select></label>${filtered ? '<button class="clear-filters" data-clear>Clear filters</button>' : ''}</div></div>`;
  const sections = crates.map((c, i) => {
    const list = c.albums.filter(visible); if (!list.length) return '';
    return `<section class="crate" id="c${i}"><header><span class="fam">${esc(c.family)}</span><h2>${esc(c.name)}</h2>${c.desc ? `<p>${esc(c.desc)}</p>` : ''}
      <div class="tally"><span></span><small>heard</small><i><b></b></i></div></header><div class="shelf">${list.map(tile).join('')}</div></section>`;
  }).join('');
  const mobileRail = `<nav class="mobile-crate-index" aria-label="Jump to a crate">${crates.map((c,i)=>`<a href="#c${i}">${esc(c.name)}</a>`).join('')}</nav>`;
  return mobileRail + controls + (sections || `<div class="empty-state"><span class="eyebrow">No records in this view</span><h2>Try a wider search.</h2><p>Remove a decade or listening filter, or search for a different artist, title, crate, or tag.</p><button class="action" data-clear>Clear filters</button></div>`);
}
function listeningRoom() {
  const last = recent.map(k => byK.get(k)).filter(Boolean).slice(0, 6);
  const next = all.find(a => !isHeard(a));
  const cratePicks = crates.slice(0, 6);
  return `<section class="room-intro"><div class="intro-copy"><span class="eyebrow">A private archive for curious ears</span><h1>Your collection,<br><em>still in motion.</em></h1><p>${all.length.toLocaleString()} records filed across ${crates.length} crates. Pick up where you left off, follow a thread, or let the shelves surprise you.</p><div class="intro-actions"><button class="action" data-view="crates">Enter the crates <span aria-hidden="true">↗</span></button>${next ? `<button class="text-action" data-open="${esc(next.k)}">Start with ${esc(next.title)} <span>— ${esc(next.artist)}</span></button>` : ''}</div></div><div class="room-stamp" aria-label="Collection summary"><span>ON THE SHELF</span><strong>${all.length.toLocaleString()}</strong><span>RECORDS · ${crates.length} CRATES</span><i></i><small>${all.filter(isHeard).length} heard so far</small></div></section>
    <section class="room-section"><div class="section-head"><div><span class="eyebrow">Your listening trail</span><h2>Back in the room</h2></div>${last.length ? '<button class="text-action" data-view="saved">Saved & recent →</button>' : ''}</div>${last.length ? `<div class="record-row">${last.map(tile).join('')}</div>` : `<div class="quiet-note"><span class="eyebrow">The first mark is yours</span><p>Open any record to rate it, save it for later, or mark it heard. Your listening trail stays on this device.</p></div>`}</section>
    <section class="room-section discovery-section"><div class="section-head"><div><span class="eyebrow">Built from your own ratings</span><h2>Follow a thread</h2></div><button class="text-action" data-view="crates">Explore all →</button></div>${recommendations(6)}</section>
    <section class="room-section crate-preview"><div class="section-head"><div><span class="eyebrow">Filed by sound and era</span><h2>Choose a crate</h2></div><button class="text-action" data-view="crates">All ${crates.length} crates →</button></div><div class="crate-cards">${cratePicks.map((c,i)=>`<button class="crate-card" data-crate="${i}"><span class="eyebrow">${esc(c.family)}</span><strong>${esc(c.name)}</strong><span>${c.albums.length} records <b>↗</b></span></button>`).join('')}</div></section>`;
}
function savedView() {
  const saved = favorites.size ? all.filter(isFavorite) : [];
  const played = recent.map(k => byK.get(k)).filter(Boolean).slice(0, 12);
  return `<div class="collection-heading"><div><span class="eyebrow">Your personal index</span><h1>Saved & recent</h1><p>Records you marked to return to, and the last records you opened.</p></div></div><section class="room-section"><div class="section-head"><div><span class="eyebrow">Kept close</span><h2>Saved for later <small>${saved.length}</small></h2></div></div>${saved.length ? `<div class="shelf">${saved.map(tile).join('')}</div>` : `<div class="empty-state"><span class="eyebrow">Nothing saved yet</span><h2>Keep a record in reach.</h2><p>Open a record and choose “Save for later”. It will be waiting here next time.</p><button class="action" data-view="crates">Browse records</button></div>`}</section><section class="room-section"><div class="section-head"><div><span class="eyebrow">Your latest visits</span><h2>Recently opened <small>${played.length}</small></h2></div></div>${played.length ? `<div class="shelf">${played.map(tile).join('')}</div>` : '<p class="quiet-note">Records you open will appear here.</p>'}</section>`;
}
function tallies() {
  $('#cnt').textContent = `${all.length.toLocaleString()} records · ${all.filter(isHeard).length} heard`;
  crates.forEach((c, i) => {
    const n = c.albums.filter(isHeard).length, el = $(`#c${i}`), r = $(`#r${i}`);
    if (r) { r.querySelector('small').textContent = `${n}/${c.albums.length}`; r.classList.toggle('done', n === c.albums.length); }
    if (el) { el.querySelector('.tally span').textContent = `${n}/${c.albums.length}`; el.querySelector('.tally b').style.width = `${n / c.albums.length * 100}%`; }
  });
}
function updateSavedCount() {
  const n = favorites.size;
  $('#saved-count').textContent = n || '';
  document.querySelectorAll('.mobile-nav [data-view="saved"]').forEach(b => b.setAttribute('aria-label', `Saved, ${n} records`));
}
let toastTimer;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

// Covers load from Apple only when their tiles enter the reading area.
const byK = new Map(), byA = new Map(), vis = new Set(), started = new Set(), slow = new Set(), checked = new Set(); let workers = 0, saveT;
const sz = (r, n) => r?.art ? r.art.replace(/\{s\}/g, n) : '';
const persist = () => { clearTimeout(saveT); saveT = setTimeout(() => save('sf_res', res), 700); };
const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { vis.add(e.target); want(e.target); } else vis.delete(e.target); }), { rootMargin: '700px' });
function watch() { document.querySelectorAll('#wall .sl').forEach(t => io.observe(t)); document.querySelectorAll('.crate').forEach(c => spy.observe(c)); }
function want(t) { const a = byK.get(t.dataset.k); if (!a) return; if (res[a.k]) return paint(t, res[a.k]); if (checked.has(a.k) || failed.has(a.k)) return; if (started.has(a.artist)) slow.add(a); go(); }
function paint(t, r) { if (!r?.id || t.querySelector('img')) return; const img = new Image(); img.alt = ''; img.decoding = 'async'; img.onload = () => { img.className = 'ok'; }; img.onerror = () => img.remove(); img.src = sz(r, 320); t.querySelector('.in').prepend(img); }
const paintAll = () => vis.forEach(t => { const a = byK.get(t.dataset.k); if (a && res[a.k]) paint(t, res[a.k]); });
const nap = ms => new Promise(r => setTimeout(r, ms));
function nextJob() {
  for (const t of vis) { const a = byK.get(t.dataset.k); if (a && !res[a.k] && !checked.has(a.k) && !started.has(a.artist)) return { artist: a.artist }; }
  for (const a of slow) { slow.delete(a); if (!res[a.k] && !checked.has(a.k) && [...vis].some(t => t.dataset.k === a.k)) return { a }; }
}
async function go() {
  while (workers < 3) { const j = nextJob(); if (!j) return; workers++;
    (async () => { try {
      if (j.artist) { started.add(j.artist); const rs = await byArtist(j.artist);
        byA.get(j.artist).forEach(a => { const m = pick(a, rs); if (m) { res[a.k] = m; a.res = true; } else slow.add(a); }); }
      else { const m = await lookup(j.a); checked.add(j.a.k); res[j.a.k] = m; j.a.res = !!m; await nap(1500); }
      persist(); paintAll();
    } catch { if (j.artist) { started.delete(j.artist); await nap(30000); } else { checked.add(j.a.k); failed.add(j.a.k); } } finally { workers--; go(); } })(); }
}
// Detail sheet
let cur = null; const failed = new Set();
let opener = null;
function lock(on) { document.documentElement.classList.toggle('lock', on); ['.app-frame', '.masthead', '.mobile-nav', '#stats'].forEach(s => { $(s).inert = on; }); }
async function open(a) {
  recent = [a.k, ...recent.filter(k => k !== a.k)].slice(0, 24);
  save('sf_recent', recent);
  cur = a; const ae = document.activeElement, keep = ae?.closest?.('#sheet') ? (ae.dataset.f ? `[data-f="${ae.dataset.f}"]` : ae.dataset.a ? `[data-a="${ae.dataset.a}"]` : ae.id ? '#' + ae.id : null) : null; const c = crates[a.ci], r = res[a.k];
  const same = c.albums.slice(Math.max(0, a.ai - 5), a.ai + 7).filter(x => x !== a);
  const yr = all.filter(x => x.year === a.year && x.ci !== a.ci).slice(0, 14);
  const apple = r?.url || `https://music.apple.com/us/search?term=${encodeURIComponent(`${a.artist} ${a.title}`)}`;
  const link = `<a class="btn" href="${esc(apple)}" rel="noopener">Open in Apple Music</a>`;
  const query = encodeURIComponent(`${a.artist} ${a.title}`);
  const otherLinks = `<a class="btn service" href="https://open.spotify.com/search/${query}" target="_blank" rel="noopener">Spotify</a><a class="btn service" href="https://music.youtube.com/search?q=${query}" target="_blank" rel="noopener">YouTube Music</a>`;
  const why = r ? `Matched to "${esc(r.name)}" by ${esc(r.artist)}, ${r.year}, US storefront (confidence ${r.score}).`
    : failed.has(a.k) ? `Apple's catalogue could not be reached, so this opens an Apple Music search for the artist and title.` : `This record is not matched to a specific Apple release yet, so the button opens an Apple Music search for the artist and title.`;
  $('#sheet').style.setProperty('--c', c.c);
  $('#sheet').innerHTML = `<button class="x" aria-label="Close">×</button>
    <div class="disc"><div class="rec"></div><div class="cov"><span class="t" style="${r?.id ? 'display:none' : ''}">${esc(a.title)}</span>${r?.id ? `<img src="${esc(sz(r, 480))}" alt="Cover of ${esc(a.title)}">` : ''}</div></div>
    <h3>${esc(a.title)}</h3><p class="by">${esc(a.artist)}</p>
    <div class="meta"><span><b>${a.year}</b></span><span>${esc(c.name)}</span><span>${esc(c.family)}</span></div>
    <div class="acts">${link}${otherLinks}<button class="btn save-record" data-favorite aria-pressed="${isFavorite(a)}">${isFavorite(a) ? 'Saved for later' : 'Save for later'}</button><button class="btn heard-action" data-heard>${isHeard(a) ? 'Heard · undo' : 'Mark heard'}</button></div><p class="why">${why}</p>${editor(a)}
    ${c.desc ? `<h4>The crate</h4><p>${esc(c.desc)}.</p>` : ''}
    <h4>Next to it in the crate</h4><div class="strip">${same.map(tile).join('')}</div>
    <h4>Also from ${a.year}, other crates</h4><div class="strip">${yr.map(tile).join('') || '<p>Nothing else in the list from this year.</p>'}</div>`;
  const was = $('#sheet').classList.contains('on'); if (!was) { opener = document.activeElement; lock(true); }
  $('#sheet').classList.add('on'); $('#veil').classList.add('on'); $('#sheet').setAttribute('aria-hidden', 'false'); ((keep && $(keep)) || (!$('#sheet').contains(document.activeElement) ? $('#sheet .x') : null))?.focus({ preventScroll: true });
  $('#sheet').querySelectorAll('.sl').forEach(t => io.observe(t));
  if (!res[a.k] && !failed.has(a.k) && !checked.has(a.k)) { try { res[a.k] = await lookup(a); checked.add(a.k); save('sf_res', res); } catch { failed.add(a.k); checked.add(a.k); if (cur === a) open(a); return; } if (cur === a) open(a); }
}
function close() { $('#sheet').classList.remove('on'); $('#veil').classList.remove('on'); $('#sheet').setAttribute('aria-hidden', 'true'); cur = null; if (document.documentElement.classList.contains('lock')) { lock(false); opener?.focus({ preventScroll: true }); opener = null; } }
const byTile = t => { const b = t.closest('.sl'); return b && all.find(x => x.k === b.dataset.k); };
function drawRecord() {
  const pool = all.filter(a => !isHeard(a));
  if (!pool.length) return toast('You have heard every record in the collection');
  currentView = 'crates'; F.q = ''; $('#q').value = ''; F.dec.clear(); F.h = 'all'; render();
  const a = pool[Math.random() * pool.length | 0];
  requestAnimationFrame(() => { document.querySelector(`.sl[data-k="${CSS.escape(a.k)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); open(a); });
}

document.addEventListener('click', e => {
  const t = e.target;
  if (t.closest('[data-retry]')) return location.reload();
  const view = t.closest('[data-view]');
  if (view) { e.preventDefault(); currentView = view.dataset.view; if (currentView !== 'crates') { F.q = ''; $('#q').value = ''; } render(); $('#wall').focus({ preventScroll: true }); if (currentView === 'stats') scrollTo({ top: 0 }); return; }
  if (t.closest('[data-favorite]') && cur) {
    if (favorites.has(cur.k)) favorites.delete(cur.k); else favorites.add(cur.k);
    save('sf_faves', [...favorites]); updateSavedCount(); toast(favorites.has(cur.k) ? 'Saved for later' : 'Removed from saved'); return open(cur);
  }
  if (t.closest('[data-clear]')) { F.q = ''; F.dec.clear(); F.h = 'all'; $('#q').value = ''; currentView = 'crates'; return render(); }
  const cratePick = t.closest('[data-crate]');
  if (cratePick) { currentView = 'crates'; render(); requestAnimationFrame(() => $(`#c${cratePick.dataset.crate}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })); return; }
  const quickOpen = t.closest('[data-open]');
  if (quickOpen) { const a = byK.get(quickOpen.dataset.open); if (a) open(a); return; }
  if (t.closest('.sl')) return open(byTile(t));
  if (t.closest('.x') || t.id === 'veil') return close();
  if (t.closest('[data-heard]') && cur) { heard.has(cur.k) ? heard.delete(cur.k) : heard.add(cur.k); save('sonicfield_heard', [...heard]);
    document.querySelectorAll('.sl').forEach(s => s.classList.toggle('heard', heard.has(s.dataset.k))); tallies(); return open(cur); }
  const d = t.closest('[data-d]'); if (d) { const n = +d.dataset.d; F.dec.has(n) ? F.dec.delete(n) : F.dec.add(n); currentView = 'crates'; render(); return; }
  if (t.closest('#pull')) return drawRecord();
});
let tm; $('#q').addEventListener('input', e => { clearTimeout(tm); tm = setTimeout(() => { F.q = e.target.value.trim(); currentView = F.q ? 'crates' : currentView === 'crates' ? 'crates' : currentView; render(); scrollTo({ top: 0, behavior: 'instant' }); }, 150); });
document.addEventListener('change', e => { if (e.target.id === 'heard-filter') { F.h = e.target.value; render(); } });
$('#help').addEventListener('click', () => { const on = $('#search-help').hidden; $('#search-help').hidden = !on; $('#help').setAttribute('aria-expanded', on); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { close(); $('#search-help').hidden = true; $('#help').setAttribute('aria-expanded', 'false'); }
  if (e.key === 'Tab' && $('#sheet').classList.contains('on')) {
    const items = [...$('#sheet').querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled])')];
    const first = items[0], last = items.at(-1);
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  if ((e.key === '/' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); $('#q').focus(); }
  if (e.key.toLowerCase() === 'r' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && !document.documentElement.classList.contains('lock')) drawRecord();
});
var spy = new IntersectionObserver(es => es.forEach(e => { if (!e.isIntersecting) return;
  const href = '#' + e.target.id;
  document.querySelectorAll('#rail a, .mobile-crate-index a').forEach(a => a.classList.toggle('on', a.getAttribute('href') === href));
  const on = document.querySelector(`#rail a[href="${href}"]`), r = $('#rail');
  if (on) r.scrollTo({ top: on.offsetTop - r.clientHeight / 2 + on.offsetHeight / 2, left: on.offsetLeft - r.clientWidth / 2 + on.clientWidth / 2, behavior: 'auto' }); }), { rootMargin: '-130px 0px -70% 0px' });

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
  $('#stats').innerHTML = `<span class="eyebrow">The shape of your collection</span><h2>Your ledger</h2><p class="why">A running record of what is here, what you have heard, and how you have annotated your own copies.</p><div class="sts">${T(new Set(all.map(a => a.artist)).size, 'artists')}${T(n, 'albums')}${T(mt.length + '/' + n, 'matched to Apple Music')}
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
$('#stats').addEventListener('click', e => { const g = e.target.closest('[data-go],[data-c],[data-q],#ex-j,#ex-c');
  if (!g) return; if (g.id === 'ex-j') return dl('sonicfield.json', JSON.stringify({ heard: [...heard], meta, favorites: [...favorites], recent }, null, 1), 'application/json');
  if (g.id === 'ex-c') { const q = s => `"${String(s ?? '').replace(/"/g, '""')}"`; return dl('sonicfield-technical.csv', ['artist,title,year,crate,heard,rating,type,tags,format,khz,bits,channels,audio_provenance,apple_id,flags'].concat(all.map(a => { const m = meta[a.k] || {}, u = m.au || {};
    return [a.artist, a.title, a.year, a.crate, isHeard(a), m.r, m.ty, (m.tags || []).join(';'), u.fmt, u.sr, u.bd, u.ch, u.prov, res[a.k]?.id, flags(a).join(' | ')].map(q).join(','); })).join('\n'), 'text/csv'); }
  if (g.dataset.c !== undefined) { currentView = 'crates'; render(); return requestAnimationFrame(() => $(`#c${g.dataset.c}`)?.scrollIntoView({ behavior: 'smooth' })); }
  const s = g.dataset.q ?? ({ 'is:heard': 'is:heard', 'is:rated': 'is:rated', 'is:noted': 'is:noted', flag: '' })[g.dataset.go]; if (s == null || g.dataset.go === undefined && g.dataset.q === undefined) return;
  if (g.dataset.go === 'flag') F.h = 'flag'; else F.h = 'all'; F.q = s; $('#q').value = s; currentView = 'crates'; render(); });
$('#stats').addEventListener('change', async e => { if (e.target.id !== 'im' || !e.target.files[0]) return; try { const d = JSON.parse(await e.target.files[0].text());
  if (!Array.isArray(d.heard) || typeof d.meta !== 'object') throw 0; heard = new Set([...heard, ...d.heard]); meta = { ...meta, ...d.meta }; favorites = new Set([...favorites, ...(d.favorites || [])]); recent = [...new Set([...(d.recent || []), ...recent])].slice(0, 24); save('sonicfield_heard', [...heard]); saveMeta(); save('sf_faves', [...favorites]); save('sf_recent', recent); render(); } catch { toast('That file is not a SonicField export'); } });
const hh = () => document.documentElement.style.setProperty('--masthead-height', `${$('.masthead').offsetHeight}px`);
new ResizeObserver(hh).observe($('.masthead')); addEventListener('resize', hh); hh();
boot();
