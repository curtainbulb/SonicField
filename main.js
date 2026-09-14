// ═══════════════════════════════════════════
// SONICFIELD · main.js
// ═══════════════════════════════════════════

// ── STATE ──
let allGenres       = [];   // parsed genre blocks
let currentFilter   = 'all';
let currentSearch   = '';
let activeDecades   = new Set();
let activeGenreIdx  = null; // null = show all
let collapsedGenres = new Set();
let openAlbum       = null; // { album, genreIdx }

const LS_KEY = 'sonicfield_heard';

// ── STORAGE ──
function getHeard() {
  try { return new Set(JSON.parse(localStorage.getItem(LS_KEY) || '[]')); }
  catch { return new Set(); }
}
function setHeard(s) {
  localStorage.setItem(LS_KEY, JSON.stringify([...s]));
}
function albumKey(album) {
  return (album.title + '|' + (album.artist||'') + '|' + (album.year||'')).toLowerCase();
}
function isHeard(album) {
  return getHeard().has(albumKey(album));
}
function toggleHeard(album) {
  const s = getHeard();
  const k = albumKey(album);
  if (s.has(k)) s.delete(k); else s.add(k);
  setHeard(s);
}

// ── PARSE MARKDOWN ──
function parseMarkdown(md) {
  const lines = md.split(/\r?\n/);
  const genres = [];
  let current = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line === 'SONICFIELD LIST') continue;

    if (line.startsWith('- [')) {
      if (!current) continue;
      const heard = line.startsWith('- [x]') || line.startsWith('- [X]');
      const rest = line.replace(/^- \[[xX ]\] ?/, '').trim();

      // Parse: "Album Title (Year) — Artist"
      const dashMatch = rest.match(/^(.+?)\s+\((\d{4})\)\s+—\s+(.+)$/);
      const yearOnlyMatch = rest.match(/^(.+?)\s+\((\d{4})\)$/);
      let title, year, artist;

      if (dashMatch) {
        title  = dashMatch[1].trim();
        year   = parseInt(dashMatch[2]);
        artist = dashMatch[3].trim();
      } else if (yearOnlyMatch) {
        title  = yearOnlyMatch[1].trim();
        year   = parseInt(yearOnlyMatch[2]);
        artist = current.desc ? extractArtistFromDesc(current.desc) : '';
      } else {
        title  = rest;
        year   = null;
        artist = '';
      }

      current.albums.push({ title, year, artist, heard });
    } else if (line.length > 3) {
      // Category line: "FAMILY — Sub-genre (description)"
      const parenMatch = line.match(/^(.+?)\s*\((.+)\)\s*$/);
      let name, desc;
      if (parenMatch) { name = parenMatch[1].trim(); desc = parenMatch[2].trim(); }
      else { name = line; desc = ''; }

      const dashMatch = name.match(/^(.+?)\s+—\s+(.+)$/);
      let family, subName;
      if (dashMatch) { family = dashMatch[1].trim(); subName = dashMatch[2].trim(); }
      else { family = ''; subName = name; }

      current = { family, subName, fullName: name, desc, albums: [] };
      genres.push(current);
    }
  }
  return genres;
}

function extractArtistFromDesc(desc) {
  const m = desc.match(/^([^;,]+)/);
  return m ? m[1].trim() : '';
}

// ── BOOT ──
async function init() {
  try {
    const res  = await fetch('albums.md');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    await runBoot(text);
  } catch(err) {
    document.getElementById('intro-log').innerHTML =
      `<div style="color:#c0392b">ERROR: ${err.message}</div>
       <div style="color:#9a9088">Ensure albums.md is in the same folder.</div>`;
    document.querySelector('.intro-prompt').textContent = 'Load failed.';
  }
}

const BOOT_LINES = [
  'Opening the archive…',
  'Indexing genre families…',
  'Cross-referencing lineages…',
  'Sorting by canon weight…',
  'Building the listening field…',
];

async function runBoot(text) {
  const log = document.getElementById('intro-log');

  for (const line of BOOT_LINES) {
    await delay(120 + Math.random() * 80);
    log.innerHTML += `<div>↳ ${line}</div>`;
  }

  allGenres = parseMarkdown(text);
  const totalAlbums = allGenres.reduce((n, g) => n + g.albums.length, 0);
  const totalGenres = allGenres.length;

  await delay(120);
  log.innerHTML += `<div style="color:#F0C882">✓ ${totalGenres} genre sections · ${totalAlbums} albums indexed</div>`;
  await delay(280);

  // Build UI
  buildDecadeButtons();
  buildNavTree();
  renderField();
  updateGlobalProgress();

  // Transition out
  const intro = document.getElementById('intro');
  intro.style.transition = 'opacity .4s ease';
  intro.style.opacity = '0';
  await delay(400);
  intro.style.display = 'none';
  document.getElementById('app').style.display = 'block';
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── NAV TREE ──
function buildNavTree() {
  const tree = document.getElementById('gnav-tree');
  let html = '';
  let lastFamily = null;

  allGenres.forEach((g, i) => {
    if (g.family !== lastFamily) {
      html += `<div class="gnav-family">${g.family || 'GENERAL'}</div>`;
      lastFamily = g.family;
    }
    const heard = g.albums.filter(a => isHeard(a)).length;
    html += `<div class="gnav-item${activeGenreIdx === i ? ' active' : ''}" id="nav-${i}" onclick="setActiveGenre(${i})">
      <div class="gi-dot"></div>
      <span class="gi-name">${g.subName}</span>
      <span class="gi-count">${heard}/${g.albums.length}</span>
    </div>`;
  });

  // "All genres" at top
  tree.innerHTML = `<div class="gnav-item${activeGenreIdx === null ? ' active' : ''}" onclick="setActiveGenre(null)">
      <div class="gi-dot"></div>
      <span class="gi-name" style="color:var(--amber)">All genres</span>
      <span class="gi-count">${allGenres.reduce((n,g)=>n+g.albums.filter(a=>isHeard(a)).length,0)}/${allGenres.reduce((n,g)=>n+g.albums.length,0)}</span>
    </div>` + html;
}

function setActiveGenre(idx) {
  activeGenreIdx = idx;
  // Update hero
  if (idx === null) {
    document.getElementById('hero-genre-name').textContent = 'All Genres';
    document.getElementById('hero-genre-desc').textContent = 'The complete listening field. Navigate by genre family in the left panel.';
  } else {
    const g = allGenres[idx];
    document.getElementById('hero-genre-name').textContent = g.subName;
    document.getElementById('hero-genre-desc').textContent = g.desc || g.family;
  }
  buildNavTree();
  renderField();
  updateGlobalProgress();
  // Close nav on mobile
  if (window.innerWidth < 768) toggleNav();
  // Scroll field to top
  document.getElementById('view-field').scrollTo(0, 0);
  window.scrollTo(0, 0);
}

function toggleNav() {
  const nav  = document.getElementById('genre-nav');
  const back = document.getElementById('nav-backdrop');
  nav.classList.toggle('open');
  back.classList.toggle('show');
}

// ── RENDER FIELD ──
function renderField() {
  const heard    = getHeard();
  const search   = currentSearch.toLowerCase();
  const sortVal  = document.getElementById('sort-select')?.value || 'default';
  const container= document.getElementById('field-content');

  // Which genres to show
  const genres = activeGenreIdx !== null
    ? [{ g: allGenres[activeGenreIdx], i: activeGenreIdx }]
    : allGenres.map((g, i) => ({ g, i }));

  let html = '';

  for (const { g, i } of genres) {
    // Filter albums
    let albums = g.albums.filter(a => {
      const h = isHeard(a);
      if (currentFilter === 'heard'   && !h) return false;
      if (currentFilter === 'unheard' &&  h) return false;
      if (activeDecades.size > 0 && a.year) {
        const dec = Math.floor(a.year / 10) * 10;
        if (!activeDecades.has(dec)) return false;
      }
      if (search) {
        return a.title.toLowerCase().includes(search) ||
               (a.artist||'').toLowerCase().includes(search) ||
               g.subName.toLowerCase().includes(search) ||
               g.family.toLowerCase().includes(search);
      }
      return true;
    });

    if (albums.length === 0 && (search || activeDecades.size > 0)) continue;

    // Sort
    if (sortVal !== 'default') {
      albums = [...albums];
      if (sortVal === 'year-asc')     albums.sort((a,b) => (a.year||9999)-(b.year||9999));
      if (sortVal === 'year-desc')    albums.sort((a,b) => (b.year||0)-(a.year||0));
      if (sortVal === 'artist-az')    albums.sort((a,b) => (a.artist||'').localeCompare(b.artist||''));
      if (sortVal === 'heard-first')  albums.sort((a,b) => isHeard(b)-isHeard(a));
      if (sortVal === 'unheard-first')albums.sort((a,b) => isHeard(a)-isHeard(b));
    }

    const heardCount = g.albums.filter(a => isHeard(a)).length;
    const total      = g.albums.length;
    const pct        = total > 0 ? (heardCount / total * 100) : 0;
    const isCollapsed= collapsedGenres.has(i) && !search;

    const albumsHtml = albums.map((a, idx) => {
      const h = isHeard(a);
      const displayTitle  = search ? highlight(a.title, search) : a.title;
      const displayArtist = search ? highlight(a.artist||'', search) : (a.artist||'');
      const origIdx = g.albums.indexOf(a);
      return `<div class="album-row${h ? ' heard' : ''}" onclick="openAlbumDrawer(${i},${origIdx})">
        <span class="row-num">${String(origIdx+1).padStart(3,'0')}</span>
        <div class="row-dot" onclick="handleDotClick(event,${i},${origIdx})" title="${h ? 'Mark unheard' : 'Mark heard'}"></div>
        <span class="row-year">${a.year||''}</span>
        <div class="row-main">
          <span class="row-title">${displayTitle}</span>
          <span class="row-artist">${displayArtist}</span>
        </div>
      </div>`;
    }).join('');

    html += `<div class="genre-block" id="genre-block-${i}">
      <div class="genre-header" onclick="toggleGenre(${i})">
        <div class="gh-left">
          <div class="gh-family">${g.family}</div>
          <div class="gh-name">${g.subName}</div>
          ${g.desc ? `<div class="gh-desc">${g.desc}</div>` : ''}
        </div>
        <div class="gh-right">
          <div class="gh-count">
            <div class="gh-count-num">${heardCount}/${total}</div>
            <div class="gh-count-heard">${Math.round(pct)}% heard</div>
            <div class="gh-mini-bar"><div class="gh-mini-fill" style="width:${pct}%"></div></div>
          </div>
          <div class="gh-toggle">${isCollapsed ? '+' : '−'}</div>
        </div>
      </div>
      <div class="album-grid${isCollapsed ? ' collapsed' : ''}" id="grid-${i}">
        ${albumsHtml || `<div class="empty-block">No albums match current filters.</div>`}
      </div>
    </div>`;
  }

  container.innerHTML = html || `<div class="empty-block" style="padding:40px;text-align:center;font-style:italic">No results for current filters.</div>`;
  updateGlobalProgress();
}

function highlight(text, search) {
  if (!search || !text) return text;
  const re = new RegExp(`(${search.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`, 'gi');
  return text.replace(re, '<mark>$1</mark>');
}

function toggleGenre(i) {
  const grid = document.getElementById(`grid-${i}`);
  const icon = document.querySelector(`#genre-block-${i} .gh-toggle`);
  if (!grid) return;
  if (collapsedGenres.has(i)) {
    collapsedGenres.delete(i);
    grid.classList.remove('collapsed');
    if (icon) icon.textContent = '−';
  } else {
    collapsedGenres.add(i);
    grid.classList.add('collapsed');
    if (icon) icon.textContent = '+';
  }
}
function expandAll()  { collapsedGenres.clear(); renderField(); }
function collapseAll(){ allGenres.forEach((_,i) => collapsedGenres.add(i)); renderField(); }

// ── DOT CLICK (mark heard without opening drawer) ──
function handleDotClick(e, genreIdx, albumIdx) {
  e.stopPropagation();
  toggleHeard(allGenres[genreIdx].albums[albumIdx]);
  renderField();
  updateGlobalProgress();
  buildNavTree();
  if (openAlbum && openAlbum.genreIdx === genreIdx && openAlbum.albumIdx === albumIdx) {
    refreshDrawer();
  }
}

// ── GLOBAL PROGRESS ──
function updateGlobalProgress() {
  const heard = getHeard();
  let total = 0, heardCount = 0;

  const genres = activeGenreIdx !== null
    ? [allGenres[activeGenreIdx]]
    : allGenres;

  genres.forEach(g => {
    total += g.albums.length;
    heardCount += g.albums.filter(a => heard.has(albumKey(a))).length;
  });

  const pct = total > 0 ? (heardCount / total) : 0;
  const pctInt = Math.round(pct * 100);

  // Topbar bar
  const bar = document.getElementById('tp-bar');
  if (bar) bar.style.width = `${pctInt}%`;
  const lbl = document.getElementById('tp-label');
  if (lbl) lbl.textContent = `${heardCount} / ${total}`;

  // Hero
  const heardEl = document.getElementById('hero-stat-heard');
  const totalEl = document.getElementById('hero-stat-total');
  const ringFg  = document.getElementById('hero-ring-fg');
  const ringPct = document.getElementById('hero-ring-pct');

  if (heardEl) heardEl.querySelector('.hs-num').textContent = heardCount;
  if (totalEl) totalEl.querySelector('.hs-num').textContent = total;
  if (ringFg) {
    const circ = 2 * Math.PI * 18; // r=18
    ringFg.style.strokeDashoffset = circ * (1 - pct);
  }
  if (ringPct) ringPct.textContent = `${pctInt}%`;
}

// ── ALBUM DRAWER ──
function openAlbumDrawer(genreIdx, albumIdx) {
  openAlbum = { genreIdx, albumIdx };
  refreshDrawer();
  document.getElementById('drawer').classList.add('open');
  document.getElementById('drawer-overlay').classList.add('show');
}

function refreshDrawer() {
  if (!openAlbum) return;
  const { genreIdx, albumIdx } = openAlbum;
  const genre  = allGenres[genreIdx];
  const album  = genre.albums[albumIdx];
  const heard  = isHeard(album);

  // Context list (other albums in genre)
  const ctxHtml = genre.albums.map((a, idx) => {
    const h = isHeard(a);
    const isCurrent = idx === albumIdx;
    return `<li class="dr-context-item${isCurrent?' current':''}${h&&!isCurrent?' heard-item':''}"
      onclick="${isCurrent ? '' : `switchDrawerAlbum(${genreIdx},${idx})`}">
      <div class="dci-dot"></div>
      <span>${a.title}${a.year ? ` (${a.year})` : ''}</span>
    </li>`;
  }).join('');

  document.getElementById('drawer-body').innerHTML = `
    <div class="dr-header">
      <div class="dr-eyebrow">${genre.family} · ${genre.subName}</div>
      <div class="dr-title">${album.title}</div>
      <div class="dr-artist">${album.artist || '—'}</div>
      <div class="dr-year-genre">${album.year || ''}${album.year && genre.family ? ' · ' : ''}${genre.family}</div>
      <button class="dr-listen-btn${heard ? ' heard' : ''}"
        onclick="handleDrawerToggle(${genreIdx},${albumIdx})">
        ${heard
          ? `<span>✓</span> Heard — click to undo`
          : `<span>○</span> Mark as heard`}
      </button>
    </div>
    <div class="dr-body">
      ${genre.desc ? `<div class="dr-note">${genre.desc}</div>` : ''}
      <div class="dr-context-title">OTHER ALBUMS IN THIS SECTION</div>
      <ul class="dr-context-list">${ctxHtml}</ul>
    </div>`;
}

function switchDrawerAlbum(genreIdx, albumIdx) {
  openAlbum = { genreIdx, albumIdx };
  refreshDrawer();
}

function handleDrawerToggle(genreIdx, albumIdx) {
  toggleHeard(allGenres[genreIdx].albums[albumIdx]);
  renderField();
  updateGlobalProgress();
  buildNavTree();
  refreshDrawer();
}

function closeDrawer(e) {
  if (e.target === document.getElementById('drawer-overlay')) closeDrawerDirect();
}
function closeDrawerDirect() {
  document.getElementById('drawer').classList.remove('open');
  document.getElementById('drawer-overlay').classList.remove('show');
  openAlbum = null;
}

// ── FILTERS ──
function setListenFilter(f, btn) {
  currentFilter = f;
  document.querySelectorAll('.flt').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderField();
}

let _searchTimer;
function handleSearch(val) {
  clearTimeout(_searchTimer);
  _searchTimer = setTimeout(() => {
    currentSearch = val;
    renderField();
  }, 180);
}

function buildDecadeButtons() {
  const wrap = document.getElementById('decade-btns');
  if (!wrap) return;
  const decades = [1960,1970,1980,1990,2000];
  wrap.innerHTML = decades.map(d =>
    `<button class="decade-btn" onclick="toggleDecade(${d},this)">${d}s</button>`
  ).join('');
}

function toggleDecade(d, btn) {
  if (activeDecades.has(d)) { activeDecades.delete(d); btn.classList.remove('active'); }
  else { activeDecades.add(d); btn.classList.add('active'); }
  renderField();
}

// ── STATS VIEW ──
function toggleView(which) {
  const field = document.getElementById('view-field');
  const stats = document.getElementById('view-stats');
  const btnStats = document.getElementById('btn-stats');
  const btnField = document.getElementById('btn-field');

  if (which === 'stats') {
    field.style.display = 'none';
    stats.style.display = 'block';
    btnStats.style.display = 'none';
    btnField.style.display = 'block';
    renderStats();
  } else {
    stats.style.display = 'none';
    field.style.display = 'block';
    btnField.style.display = 'none';
    btnStats.style.display = 'block';
  }
}

function renderStats() {
  const heard = getHeard();
  let total = 0, heardCount = 0;
  const decadeMap = {};
  const genreData = [];

  allGenres.forEach(g => {
    let gh = 0;
    g.albums.forEach(a => {
      total++;
      const h = heard.has(albumKey(a));
      if (h) { heardCount++; gh++; }
      if (a.year) {
        const d = Math.floor(a.year/10)*10;
        if (!decadeMap[d]) decadeMap[d] = { total:0, heard:0 };
        decadeMap[d].total++;
        if (h) decadeMap[d].heard++;
      }
    });
    genreData.push({ name: g.subName, total: g.albums.length, heard: gh });
  });

  const pct = total > 0 ? Math.round(heardCount/total*100) : 0;

  // Overview cards
  document.getElementById('stats-overview').innerHTML = [
    ['Total albums',  total,         'in the canon'],
    ['Heard',         heardCount,    `${pct}% complete`],
    ['Remaining',     total-heardCount, 'still to explore'],
    ['Genre sections',allGenres.length, `${genreData.filter(g=>g.heard===g.total&&g.total>0).length} fully heard`],
  ].map(([lab,val,sub]) => `<div class="stat-card">
    <span class="sc-val">${val}</span>
    <span class="sc-lab">${lab}</span>
    <span class="sc-lab" style="margin-top:8px;font-size:10px;color:var(--ink-3)">${sub}</span>
  </div>`).join('');

  // Decade heatmap
  const decades = Object.keys(decadeMap).map(Number).sort();
  document.getElementById('stats-heatmap').innerHTML = decades.map(d => {
    const data = decadeMap[d];
    const p = data.total > 0 ? data.heard/data.total : 0;
    return `<div class="dec-cell" style="border-color:${p>0.5?'var(--amber)':'var(--border)'}">
      <span class="dec-label">${d}s</span>
      <div class="dec-bar"><div class="dec-bar-fill" style="width:${Math.round(p*100)}%"></div></div>
      <span class="dec-pct">${data.heard}/${data.total}</span>
    </div>`;
  }).join('');

  // Genre progress
  const sorted = [...genreData].sort((a,b) => (b.heard/b.total||0)-(a.heard/a.total||0));
  document.getElementById('stats-genres').innerHTML = sorted.map(g => {
    const p = g.total > 0 ? g.heard/g.total : 0;
    return `<div class="gen-row">
      <span class="gen-name">${g.name}</span>
      <div class="gen-bar-wrap"><div class="gen-bar-fill" style="width:${Math.round(p*100)}%"></div></div>
      <span class="gen-pct">${Math.round(p*100)}%</span>
    </div>`;
  }).join('');

  // Gaps: genres with <20% heard and >5 albums
  const gaps = genreData
    .filter(g => g.total >= 5 && g.heard/g.total < 0.2)
    .sort((a,b) => (a.heard/a.total)-(b.heard/b.total))
    .slice(0, 8);

  document.getElementById('stats-gaps').innerHTML = gaps.length
    ? gaps.map(g => `<div class="gap-card">
        <div class="gap-name">${g.name}</div>
        <div class="gap-sub">${g.heard} of ${g.total} heard · a good place to dig in</div>
      </div>`).join('')
    : '<div class="sr-empty">No significant gaps — impressive coverage.</div>';

  document.getElementById('suggest-result').innerHTML = '<div class="sr-empty">Click a button above to get a suggestion.</div>';
}

// ── SUGGESTIONS ──
function getUnheardAlbums() {
  const h = getHeard();
  const out = [];
  allGenres.forEach((g, gi) => {
    g.albums.forEach((a, ai) => {
      if (!h.has(albumKey(a))) out.push({ album: a, genre: g, gi, ai });
    });
  });
  return out;
}

function showSuggestion({ album, genre, gi, ai }, why) {
  document.getElementById('suggest-result').innerHTML = `
    <div class="sr-album">${album.title}</div>
    <div class="sr-artist">${album.artist}</div>
    <div class="sr-meta">${album.year||''} · ${genre.subName}</div>
    <div class="sr-why">${why}</div>
    <button class="sr-open-btn" onclick="toggleView('field');setActiveGenre(${gi})">
      Go to this section →
    </button>`;
}

function suggestRandom() {
  const pool = getUnheardAlbums();
  if (!pool.length) { document.getElementById('suggest-result').innerHTML = '<div class="sr-empty">You\'ve heard everything. Respect.</div>'; return; }
  showSuggestion(pool[Math.floor(Math.random()*pool.length)], 'Random pick from your unheard list.');
}

function suggestGap() {
  const h = getHeard();
  const gaps = allGenres.map((g, gi) => {
    const total  = g.albums.length;
    const heardC = g.albums.filter(a => h.has(albumKey(a))).length;
    const gap    = total - heardC;
    const ratio  = heardC / total;
    return { g, gi, total, heardC, gap, ratio };
  }).filter(x => x.gap > 0 && x.heardC > 0).sort((a,b) => a.ratio-b.ratio);

  if (!gaps.length) { suggestRandom(); return; }
  const pick = gaps[0];
  const unheard = pick.g.albums.filter(a => !h.has(albumKey(a)));
  const album = unheard[0];
  showSuggestion({ album, genre: pick.g, gi: pick.gi }, `You've started "${pick.g.subName}" but have ${pick.gap} albums left. This is next in sequence.`);
}

function suggestOldest() {
  const pool = getUnheardAlbums().filter(x => x.album.year).sort((a,b) => a.album.year-b.album.year);
  if (!pool.length) { suggestRandom(); return; }
  showSuggestion(pool[0], `Oldest unheard in your field: ${pool[0].album.year}.`);
}

function suggestNewest() {
  const pool = getUnheardAlbums().filter(x => x.album.year).sort((a,b) => b.album.year-a.album.year);
  if (!pool.length) { suggestRandom(); return; }
  showSuggestion(pool[0], `Most recent unheard in your field: ${pool[0].album.year}.`);
}

// ── KEYBOARD ──
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (document.getElementById('drawer').classList.contains('open')) closeDrawerDirect();
    if (document.getElementById('genre-nav').classList.contains('open')) toggleNav();
  }
  if ((e.key === 'f' || e.key === '/') && !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)) {
    e.preventDefault();
    toggleNav();
    setTimeout(() => document.getElementById('gnav-search')?.focus(), 200);
  }
});

// ── GO ──
init();
