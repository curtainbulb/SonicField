import { parse, keyOf, compile, lookup, norm, sniff } from './lib.js';

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));
const read = (key, fallback) => {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value ?? fallback;
  } catch {
    return fallback;
  }
};
const readArray = key => {
  const value = read(key, []);
  return Array.isArray(value) ? value : [];
};
const readObject = key => {
  const value = read(key, {});
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
};
const save = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    toast('Could not save. Device storage may be full or disabled.');
  }
};

const FMT = { FLAC: true, ALAC: true, WAV: true, AIFF: true, DSD: true, MP3: false, AAC: false, Opus: false, Vorbis: false };
const TYPES = ['Studio album', 'Live', 'Compilation', 'EP', 'Soundtrack', 'Reissue', 'Demo/outtakes'];
const RATES = [44.1, 48, 88.2, 96, 176.4, 192, 352.8, 384];
const HEARD_KEY = 'sonicfield_heard';
const FAVORITES_KEY = 'sf_faves';
const RECENT_KEY = 'sf_recent';
const META_KEY = 'sf_meta';
const RESOLVED_KEY = 'sf_res';
const PREFS_KEY = 'sf_preferences';

let crates = [];
let records = [];
let byKey = new Map();
let byId = new Map();
let resolved = {};
let heard = new Set(readArray(HEARD_KEY));
let favorites = new Set(readArray(FAVORITES_KEY));
let recent = readArray(RECENT_KEY);
let meta = readObject(META_KEY);
let prefs = { accent: 'rust', density: 'standard', ...readObject(PREFS_KEY) };
let view = 'room';
let activeCrate = '';
let query = '';
let statusFilter = 'all';
let decades = new Set();
let pageSize = 72;
let current = null;
let dialogOpener = null;
let toastTimer;
let saveTimer;
let lookupPending = new Set();
let lookupFailed = new Set();
let duplicateIndex;

const recordDialog = $('#record-dialog');
const commandDialog = $('#command-dialog');
const detailContent = $('#detail-content');
const commandQuery = $('#command-query');
const wall = $('#wall');
const coverObserver = new IntersectionObserver(entries => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    coverObserver.unobserve(entry.target);
    paintCover(entry.target);
  }
}, { rootMargin: '420px 0px' });

function isHeard(record) {
  return heard.has(record.k);
}

function isSaved(record) {
  return favorites.has(record.k);
}

function recordMeta(key) {
  return meta[key] || (meta[key] = {});
}

function saveMeta() {
  save(META_KEY, meta);
}

function savePreferences() {
  save(PREFS_KEY, prefs);
  applyPreferences();
}

function applyPreferences() {
  document.documentElement.dataset.accent = prefs.accent === 'frost' ? 'frost' : 'rust';
  document.documentElement.dataset.density = prefs.density === 'compact' ? 'compact' : 'standard';
}

async function boot() {
  wall.innerHTML = '<p class="loading-state"><span class="signal-line"></span> Opening the archive…</p>';
  wall.setAttribute('aria-busy', 'true');
  try {
    const [response, cached] = await Promise.all([
      fetch('albums.md').then(result => {
        if (!result.ok) throw new Error('albums.md returned HTTP ' + result.status);
        return result.text();
      }),
      fetch('data/resolved.json').then(result => result.ok ? result.json() : {}).catch(() => ({}))
    ]);
    resolved = { ...cached, ...readObject(RESOLVED_KEY) };
    crates = parse(response);
    if (!crates.length) throw new Error('The archive contains no crates');
    records = [];
    byKey = new Map();
    byId = new Map();
    crates.forEach((crate, crateIndex) => {
      crate.albums.forEach((record, albumIndex) => {
        record.k = keyOf(record);
        record.id = crateIndex + ':' + albumIndex;
        record.ci = crateIndex;
        record.ai = albumIndex;
        record.crate = crate.name;
        record.fam = crate.family;
        record.res = !!resolved[record.k];
        records.push(record);
        byId.set(record.id, record);
        if (!byKey.has(record.k)) byKey.set(record.k, record);
      });
    });
    duplicateIndex = undefined;
    renderCrateNav();
    applyPreferences();
    render();
  } catch (error) {
    wall.innerHTML = '<section class="error-state"><p class="eyebrow">ARCHIVE / UNAVAILABLE</p><h1>The index did not open.</h1><p>' +
      esc(error.message) + '. Serve the project over HTTP, then try again. Your local listening data remains untouched.</p>' +
      '<button class="action-button" data-action="retry">TRY AGAIN</button></section>';
    wall.setAttribute('aria-busy', 'false');
  }
}

function renderCrateNav() {
  $('#crate-nav').innerHTML = crates.map((crate, index) =>
    '<button data-crate="' + esc(crate.name) + '" data-crate-index="' + index + '" aria-current="false">' +
    '<span>' + esc(crate.name) + '</span><small>' + crate.albums.length + '</small></button>'
  ).join('');
  $('#nav-total').textContent = records.length.toLocaleString();
  updateSavedCount();
}

function updateSavedCount() {
  $('#nav-saved').textContent = favorites.size || '';
  document.querySelectorAll('.mobile-nav [data-view="saved"]').forEach(button => {
    button.setAttribute('aria-label', 'Kept, ' + favorites.size + ' records');
  });
}

function routeTitle() {
  if (view === 'index' && activeCrate) return activeCrate;
  return ({ room: 'Listening room', index: 'The index', saved: 'Kept records', ledger: 'Your ledger', settings: 'Settings' })[view] || 'Listening room';
}

function updateNavigation() {
  document.body.dataset.view = view;
  document.querySelectorAll('[data-view]').forEach(button => {
    const selected = button.dataset.view === view;
    button.classList.toggle('selected', selected);
    if (button.matches('button')) button.setAttribute('aria-current', selected ? 'page' : 'false');
  });
  document.querySelectorAll('#crate-nav [data-crate]').forEach(button => {
    const selected = view === 'index' && button.dataset.crate === activeCrate;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-current', selected ? 'location' : 'false');
  });
  $('#route-kicker').textContent = view === 'index' && activeCrate ? 'CRATE / ' + String(crates.find(crate => crate.name === activeCrate)?.family || '').toUpperCase() : 'PRIVATE ARCHIVE / 0' + (['room', 'index', 'saved', 'ledger', 'settings'].indexOf(view) + 1);
  $('#route-title').textContent = routeTitle();
  document.title = 'SonicField — ' + routeTitle();
}

function render() {
  if (!records.length) return;
  updateNavigation();
  wall.setAttribute('aria-busy', 'true');
  const output = view === 'room' ? roomView()
    : view === 'saved' ? savedView()
    : view === 'ledger' ? ledgerView()
    : view === 'settings' ? settingsView()
    : indexView();
  wall.innerHTML = output;
  wall.setAttribute('aria-busy', 'false');
  coverObserver.disconnect();
  wall.querySelectorAll('[data-cover-key]').forEach(element => coverObserver.observe(element));
  if (view === 'index') {
    const selected = $('#crate-filter');
    if (selected) selected.value = activeCrate;
    const state = $('#status-filter');
    if (state) state.value = statusFilter;
  }
}

function searchContext() {
  const ratings = {}, tags = {}, notes = {}, shelves = {};
  for (const [key, stored] of Object.entries(meta)) {
    const value = stored && typeof stored === 'object' ? stored : {};
    if (value.r) ratings[key] = value.r;
    if (value.tags?.length) tags[key] = value.tags;
    if (value.note) notes[key] = 1;
    if (Number.isInteger(value.sec) && crates[value.sec]) (shelves[crates[value.sec].name] ||= []).push(key);
  }
  return { r: ratings, t: tags, n: notes, s: shelves, h: heard };
}

function audioFlags(record) {
  const audio = meta[record.k]?.au;
  const flags = [];
  if (audio) {
    const lossless = FMT[audio.fmt];
    if (lossless === false && audio.bd) flags.push('Lossy format with bit depth');
    if (lossless === false && audio.sr > 48) flags.push('Unusual lossy sample rate');
    if (audio.sr && !RATES.includes(+audio.sr)) flags.push('Non-standard sample rate');
    if (audio.bd && ![16, 24, 32].includes(+audio.bd)) flags.push('Non-standard bit depth');
    if (lossless === true && !audio.sr) flags.push('Lossless file without sample rate');
  }
  const duplicate = duplicateOf(record);
  if (duplicate) flags.push('Possible duplicate of ' + duplicate);
  return flags;
}

function duplicateOf(record) {
  if (!duplicateIndex) {
    duplicateIndex = new Map();
    const groups = new Map();
    records.forEach(item => {
      const normalized = item.artist + '|' + norm(item.title);
      (groups.get(normalized) || groups.set(normalized, []).get(normalized)).push(item);
    });
    groups.forEach(group => {
      if (group.length > 1) group.forEach(item => duplicateIndex.set(item.k, group.find(other => other !== item).title));
    });
  }
  return duplicateIndex.get(record.k);
}

function matchesStatus(record) {
  const value = meta[record.k] || {};
  if (statusFilter === 'heard') return isHeard(record);
  if (statusFilter === 'unheard') return !isHeard(record);
  if (statusFilter === 'saved') return isSaved(record);
  if (statusFilter === 'rated') return !!value.r;
  if (statusFilter === 'noted') return !!value.note;
  if (statusFilter === 'matched') return !!resolved[record.k];
  if (statusFilter === 'flagged') return audioFlags(record).length > 0;
  return true;
}

function filteredRecords() {
  const predicate = compile(query, searchContext());
  return records.filter(record =>
    (!activeCrate || record.crate === activeCrate) &&
    (!decades.size || decades.has(Math.floor(record.year / 10) * 10)) &&
    matchesStatus(record) && predicate(record)
  );
}

function recordRow(record) {
  const value = meta[record.k] || {};
  const marks = [
    isHeard(record) ? '<span class="record-mark">HEARD</span>' : '',
    isSaved(record) ? '<span class="record-mark saved">KEPT</span>' : '',
    value.r ? '<span class="record-mark rating">' + value.r + '/5</span>' : ''
  ].filter(Boolean).join('');
  const short = (record.artist || record.title).trim().split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase();
  return '<li><button class="record-row" data-record="' + esc(record.id) + '" aria-label="Open ' + esc(record.title) + ', ' + esc(record.artist) + ', ' + record.year + '">' +
    '<span class="record-cover" data-cover-key="' + esc(record.k) + '"><span class="cover-fallback" aria-hidden="true">' + esc(short || '—') + '</span></span>' +
    '<span class="record-identity"><strong>' + esc(record.title) + '</strong><span>' + esc(record.artist) + '</span></span>' +
    '<span class="record-crate">' + esc(record.crate) + '</span><span class="record-year">' + record.year + '</span>' +
    '<span class="record-marks">' + (marks || '<span class="record-mark blank">—</span>') + '</span><span class="row-arrow" aria-hidden="true">↗</span>' +
    '</button></li>';
}

function roomView() {
  const heardCount = records.filter(isHeard).length;
  const ratedCount = records.filter(record => meta[record.k]?.r).length;
  const percent = records.length ? Math.round(heardCount / records.length * 100) : 0;
  const last = recent.map(key => byKey.get(key)).filter(Boolean).slice(0, 5);
  const cratesToShow = [...crates].sort((a, b) => b.albums.length - a.albums.length).slice(0, 6);
  const suggestions = recommendationList(5);
  const next = records.find(record => !isHeard(record));
  return '<section class="home-top">' +
    '<div class="home-lead"><p class="eyebrow">PRIVATE ARCHIVE / ' + crates.length + ' CRATES</p><h1>THE RECORDS<br><span>REMAIN.</span></h1>' +
    '<p class="home-copy">' + records.length.toLocaleString() + ' records, filed by hand. Your notes and listening marks stay on this device.</p>' +
    '<div class="home-actions"><button class="action-button" data-view="index">OPEN THE INDEX <span aria-hidden="true">↗</span></button>' +
    (next ? '<button class="line-button" data-record="' + esc(next.id) + '">BEGIN WITH <strong>' + esc(next.title) + '</strong><span>— ' + esc(next.artist) + '</span></button>' : '') +
    '</div></div>' +
    '<aside class="archive-state" aria-label="Listening progress"><p class="eyebrow">ARCHIVE STATE / 01</p><strong class="state-number">' + String(heardCount).padStart(4, '0') + '</strong>' +
    '<span class="state-caption">OF ' + records.length.toLocaleString() + ' MARKED HEARD</span><div class="progress-track" role="progressbar" aria-label="Records marked heard" aria-valuenow="' + heardCount + '" aria-valuemin="0" aria-valuemax="' + records.length + '"><span style="width:' + percent + '%"></span></div>' +
    '<dl><div><dt>HEARD</dt><dd>' + percent + '%</dd></div><div><dt>KEPT</dt><dd>' + favorites.size + '</dd></div><div><dt>RATED</dt><dd>' + ratedCount + '</dd></div></dl>' +
    '<button class="text-button state-draw" data-action="draw">DRAW AN UNHEARD RECORD <span aria-hidden="true">↗</span></button></aside></section>' +
    '<section class="home-section"><div class="section-heading"><div><p class="eyebrow">RECENT / 01</p><h2>Last touched</h2></div><button class="text-button" data-view="saved">ALL RECENT <span aria-hidden="true">↗</span></button></div>' +
    (last.length ? '<ol class="record-list compact-list">' + last.map(recordRow).join('') + '</ol>' : '<div class="quiet-empty"><strong>No trace yet.</strong><p>Open any record. Your recent list stays here on this device.</p><button class="text-button" data-view="index">FIND A RECORD ↗</button></div>') + '</section>' +
    '<section class="home-section"><div class="section-heading"><div><p class="eyebrow">FROM YOUR RATINGS / 02</p><h2>Follow a line</h2></div><button class="text-button" data-view="index">BROWSE ALL <span aria-hidden="true">↗</span></button></div>' +
    (suggestions.length ? '<ol class="record-list compact-list">' + suggestions.map(recordRow).join('') + '</ol>' : '<div class="quiet-empty"><strong>No signal to follow.</strong><p>Rate a few records. Suggestions use only your ratings and this archive’s crate, decade, and tag data.</p><button class="text-button" data-view="index">OPEN THE INDEX ↗</button></div>') + '</section>' +
    '<section class="home-section crate-shortcuts"><div class="section-heading"><div><p class="eyebrow">SHELVES / 03</p><h2>Choose a crate</h2></div><button class="text-button" data-view="index">ALL ' + crates.length + ' CRATES <span aria-hidden="true">↗</span></button></div>' +
    '<div class="crate-quick-list">' + cratesToShow.map(crate => '<button data-crate="' + esc(crate.name) + '"><span>' + esc(crate.family) + '</span><strong>' + esc(crate.name) + '</strong><small>' + crate.albums.length + ' records <b aria-hidden="true">↗</b></small></button>').join('') + '</div></section>';
}

function recommendationList(limit) {
  const seeds = uniqueRecords(records.filter(record => (meta[record.k]?.r || 0) >= 4)).slice(0, 24);
  if (!seeds.length) return [];
  const seedSet = new Set(seeds.map(record => record.k));
  const score = (candidate, seed) => {
    const sharedTags = (meta[candidate.k]?.tags || []).filter(tag => (meta[seed.k]?.tags || []).includes(tag)).length;
    return (candidate.crate === seed.crate ? 4 : 0) +
      (candidate.fam === seed.fam ? 3 : 0) +
      (Math.floor(candidate.year / 10) === Math.floor(seed.year / 10) ? 2 : 0) + sharedTags * 2;
  };
  return uniqueRecords(records.filter(record => !seedSet.has(record.k) && !isHeard(record)))
    .map(record => ({ record, score: Math.max(...seeds.map(seed => score(record, seed))) }))
    .filter(result => result.score > 0)
    .sort((a, b) => b.score - a.score || a.record.year - b.record.year)
    .slice(0, limit).map(result => result.record);
}

function uniqueRecords(items) {
  const seen = new Set();
  return items.filter(record => {
    if (seen.has(record.k)) return false;
    seen.add(record.k);
    return true;
  });
}

function filterControls(matches) {
  const statusOptions = [
    ['all', 'Everything'], ['unheard', 'Unheard'], ['heard', 'Heard'], ['saved', 'Kept'],
    ['rated', 'Rated'], ['noted', 'Noted'], ['matched', 'Matched'], ['flagged', 'Review']
  ];
  const allDecades = [...new Set(records.map(record => Math.floor(record.year / 10) * 10))].sort((a, b) => a - b);
  const hasFilter = !!(activeCrate || query || decades.size || statusFilter !== 'all');
  return '<section class="index-tools" aria-label="Index filters">' +
    '<div class="select-line"><label class="filter-select"><span>CRATE</span><select id="crate-filter" aria-label="Filter by crate"><option value="">All crates</option>' +
    crates.map(crate => '<option value="' + esc(crate.name) + '"' + (crate.name === activeCrate ? ' selected' : '') + '>' + esc(crate.name) + ' · ' + crate.albums.length + '</option>').join('') +
    '</select></label><label class="filter-select"><span>STATE</span><select id="status-filter" aria-label="Filter by record state">' +
    statusOptions.map(option => '<option value="' + option[0] + '"' + (statusFilter === option[0] ? ' selected' : '') + '>' + option[1] + '</option>').join('') +
    '</select></label></div><div class="decade-line" aria-label="Filter by decade">' +
    allDecades.map(decade => '<button data-decade="' + decade + '" aria-pressed="' + decades.has(decade) + '">' + decade + 's</button>').join('') +
    (hasFilter ? '<button class="clear-filters" data-action="clear-filters">CLEAR ×</button>' : '') +
    '</div><p class="list-summary" role="status">' + matches.length.toLocaleString() + ' RECORDS' + (query ? ' / QUERY: ' + esc(query) : '') + '</p>' +
    '<details class="syntax-help"><summary>Search syntax</summary><p>Words search titles and artists. Try <code>artist:"Nina Simone"</code>, <code>crate:ambient</code>, <code>family:jazz</code>, <code>tag:mono</code>, <code>shelf:"Soul"</code>, <code>year:1970-1979</code>, <code>rating&gt;=4</code>, or <code>is:unheard</code>. Prefix a term with <code>-</code> to exclude it.</p></details>' +
    '</section>';
}

function indexView() {
  const matches = filteredRecords();
  const shown = matches.slice(0, pageSize);
  const title = activeCrate || (query ? 'Search results' : 'All records');
  const descriptor = activeCrate ? (crates.find(crate => crate.name === activeCrate)?.family || 'CRATE') : 'COLLECTION / 01';
  return '<section class="page-heading"><div><p class="eyebrow">' + esc(descriptor) + ' / ' + matches.length.toLocaleString() + ' RECORDS</p><h1>' + esc(title) + '</h1>' +
    '<p class="page-description">Search the archive. Narrow by crate, decade, or listening state.</p></div><button class="line-button page-draw" data-action="draw">DRAW UNHEARD <span aria-hidden="true">↗</span></button></section>' +
    filterControls(matches) + (shown.length ? '<div class="record-columns" aria-hidden="true"><span>RECORD / ARTIST</span><span>CRATE</span><span>YEAR</span><span>MARKS</span><span></span></div><ol class="record-list">' + shown.map(recordRow).join('') + '</ol>' :
      '<div class="empty-state"><p class="eyebrow">NO MATCH / 00</p><h2>The signal ends here.</h2><p>Clear one or more filters, or search another title, artist, crate, family, or tag.</p><button class="action-button" data-action="clear-filters">CLEAR FILTERS</button></div>') +
    (matches.length > shown.length ? '<div class="load-more"><span>SHOWING ' + shown.length + ' OF ' + matches.length.toLocaleString() + '</span><button class="line-button" data-action="load-more">LOAD NEXT ' + Math.min(pageSize, matches.length - shown.length) + ' <span aria-hidden="true">↓</span></button></div>' :
      (shown.length ? '<p class="end-mark">— END OF INDEX —</p>' : ''));
}

function savedView() {
  const seenSaved = new Set();
  const savedRecords = records.filter(record => {
    if (!isSaved(record) || seenSaved.has(record.k)) return false;
    seenSaved.add(record.k);
    return true;
  });
  const visibleSaved = savedRecords.slice(0, pageSize);
  const recentRecords = recent.map(key => byKey.get(key)).filter(Boolean).slice(0, 24);
  return '<section class="page-heading"><div><p class="eyebrow">PERSONAL MARKS / 03</p><h1>Kept records</h1><p class="page-description">Saved for later, followed by the records you opened most recently.</p></div></section>' +
    '<section class="saved-section"><div class="section-heading"><div><p class="eyebrow">SAVED / ' + savedRecords.length + '</p><h2>Held for later</h2></div></div>' +
    (savedRecords.length ? '<ol class="record-list">' + visibleSaved.map(recordRow).join('') + '</ol>' +
      (savedRecords.length > visibleSaved.length ? '<div class="load-more"><span>SHOWING ' + visibleSaved.length + ' OF ' + savedRecords.length + '</span><button class="line-button" data-action="load-more-saved">LOAD NEXT ' + Math.min(pageSize, savedRecords.length - visibleSaved.length) + ' <span aria-hidden="true">↓</span></button></div>' : '') :
      '<div class="empty-state"><p class="eyebrow">NO SAVED RECORDS</p><h2>Leave yourself a marker.</h2><p>Open a record and choose “Keep for later”. It will remain here on this device.</p><button class="action-button" data-view="index">OPEN THE INDEX</button></div>') +
    '</section><section class="saved-section"><div class="section-heading"><div><p class="eyebrow">RECENT / ' + recentRecords.length + '</p><h2>Last opened</h2></div></div>' +
    (recentRecords.length ? '<ol class="record-list">' + recentRecords.map(recordRow).join('') + '</ol>' : '<div class="quiet-empty"><strong>No recent record.</strong><p>Records you open will appear here.</p></div>') + '</section>';
}

function ledgerView() {
  const heardCount = records.filter(isHeard).length;
  const rated = records.filter(record => meta[record.k]?.r);
  const average = rated.length ? (rated.reduce((total, record) => total + meta[record.k].r, 0) / rated.length).toFixed(1) : '—';
  const tagged = records.filter(record => meta[record.k]?.tags?.length).length;
  const noted = records.filter(record => meta[record.k]?.note).length;
  const matched = records.filter(record => resolved[record.k]).length;
  const audioRecords = records.filter(record => meta[record.k]?.au?.fmt);
  const losslessCopies = audioRecords.filter(record => FMT[meta[record.k].au.fmt]).length;
  const reviewCount = records.filter(record => audioFlags(record).length).length;
  const duplicateCount = records.filter(duplicateOf).length;
  const tracks = records.reduce((total, record) => total + (resolved[record.k]?.tracks || 0), 0);
  const completeness = Math.round(records.reduce((total, record) => {
    const value = meta[record.k] || {};
    return total + [value.r, value.tags?.length, value.ty, value.au?.fmt, resolved[record.k]].filter(Boolean).length / 5;
  }, 0) / records.length * 100);
  const metrics = [
    [records.length.toLocaleString(), 'RECORDS'], [crates.length, 'CRATES'],
    [new Set(records.map(record => record.artist)).size.toLocaleString(), 'ARTISTS'],
    [heardCount, 'HEARD'], [rated.length, 'RATED · AVG ' + average], [favorites.size, 'KEPT'],
    [tagged, 'TAGGED'], [noted, 'NOTED'], [matched.toLocaleString(), 'MATCHED RELEASES'],
    [tracks.toLocaleString(), 'TRACKS IN MATCHED RELEASES'],
    [audioRecords.length ? losslessCopies + ' / ' + audioRecords.length : '—', 'LOSSLESS / FORMATS'],
    [reviewCount, 'REVIEW FLAGS'], [duplicateCount, 'POSSIBLE DUPLICATES'], [completeness + '%', 'ANNOTATION COMPLETENESS']
  ];
  const decadeYears = [...new Set(records.map(record => Math.floor(record.year / 10) * 10))].sort((a, b) => a - b);
  const decadeRows = decadeYears.map(decade => {
    const group = records.filter(record => Math.floor(record.year / 10) * 10 === decade);
    const count = group.length;
    const heardInDecade = group.filter(isHeard).length;
    return '<div class="ledger-bar"><span>' + decade + 's</span><div class="bar-track"><i style="width:' + (count / records.length * 100) + '%"></i></div><strong>' + count + '</strong><small>' + heardInDecade + ' HEARD</small></div>';
  }).join('');
  const crateRows = crates.map(crate => {
    const marked = crate.albums.filter(isHeard).length;
    return '<button class="crate-ledger-row" data-crate="' + esc(crate.name) + '"><span><small>' + esc(crate.family) + '</small><strong>' + esc(crate.name) + '</strong></span><span>' + marked + ' / ' + crate.albums.length + '<i class="mini-progress"><b style="width:' + (marked / crate.albums.length * 100) + '%"></b></i></span></button>';
  }).join('');
  const ratingCounts = [5, 4, 3, 2, 1].map(rating => rated.filter(record => meta[record.k].r === rating).length);
  const artistCounts = new Map();
  records.forEach(record => artistCounts.set(record.artist, (artistCounts.get(record.artist) || 0) + 1));
  const artistRows = [...artistCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([artist, count]) => '<button data-query="' + esc('artist:"' + artist + '"') + '"><span>' + esc(artist) + '</span><small>' + count + ' RECORDS</small></button>')
    .join('');
  const smallestCrateRows = [...crates]
    .sort((a, b) => a.albums.length - b.albums.length)
    .slice(0, 6)
    .map(crate => '<button data-crate="' + esc(crate.name) + '"><span>' + esc(crate.name) + '</span><small>' + crate.albums.length + ' RECORDS</small></button>')
    .join('');
  return '<section class="page-heading"><div><p class="eyebrow">COLLECTION MEASUREMENTS / 04</p><h1>Your ledger</h1><p class="page-description">A plain account of what is filed, heard, and marked.</p></div></section>' +
    '<div class="metric-grid">' + metrics.map(metric => '<div class="metric"><strong>' + esc(metric[0]) + '</strong><span>' + esc(metric[1]) + '</span></div>').join('') + '</div>' +
    '<div class="ledger-columns"><section><div class="section-heading"><div><p class="eyebrow">TIME / 01</p><h2>By decade</h2></div></div>' +
    '<div class="ledger-bars">' + decadeRows + '</div><div class="section-heading rating-heading"><div><p class="eyebrow">JUDGMENT / 02</p><h2>Ratings</h2></div></div>' +
    '<div class="rating-bars">' + ratingCounts.map((count, index) => '<div class="ledger-bar"><span>' + (5 - index) + ' / 5</span><div class="bar-track"><i style="width:' + (rated.length ? count / rated.length * 100 : 0) + '%"></i></div><strong>' + count + '</strong></div>').join('') +
    (!rated.length ? '<p class="quiet-note">Nothing rated. Open a record and mark what stays with you.</p>' : '') + '</div></section>' +
    '<section><div class="section-heading"><div><p class="eyebrow">FILED / ' + crates.length + '</p><h2>Crate progress</h2></div><button class="text-button" data-view="index">OPEN INDEX ↗</button></div>' +
    '<div class="crate-ledger">' + crateRows + '</div></section></div>' +
    '<div class="ledger-foot-grid"><section><div class="section-heading"><div><p class="eyebrow">REPEATED MOST / 03</p><h2>Artists</h2></div></div>' +
    '<div class="ledger-link-list">' + artistRows + '</div></section>' +
    '<section><div class="section-heading"><div><p class="eyebrow">SMALLEST FILES / 04</p><h2>Smallest crates</h2></div></div>' +
    '<div class="ledger-link-list">' + smallestCrateRows + '</div></section></div>';
}

function settingsView() {
  return '<section class="page-heading"><div><p class="eyebrow">LOCAL CONTROL / 05</p><h1>Settings</h1><p class="page-description">Your archive lives in this browser. Choose its signal and density, or carry your marks out as a file.</p></div></section>' +
    '<section class="settings-section"><div class="settings-label"><p class="eyebrow">DISPLAY / 01</p><h2>Signal color</h2><p>One active accent. The mark remains visible without color.</p></div><div class="choice-row">' +
    '<button data-accent="rust" aria-pressed="' + (prefs.accent !== 'frost') + '"><i class="swatch rust-swatch"></i><span>Rust</span><small>DEFAULT</small></button>' +
    '<button data-accent="frost" aria-pressed="' + (prefs.accent === 'frost') + '"><i class="swatch frost-swatch"></i><span>Cold ash</span><small>ALTERNATE</small></button></div></section>' +
    '<section class="settings-section"><div class="settings-label"><p class="eyebrow">READING / 02</p><h2>Index density</h2><p>Adjust row height for the way you work.</p></div><div class="choice-row">' +
    '<button data-density="standard" aria-pressed="' + (prefs.density !== 'compact') + '"><span>Measured</span><small>STANDARD ROWS</small></button>' +
    '<button data-density="compact" aria-pressed="' + (prefs.density === 'compact') + '"><span>Compressed</span><small>MORE ON SCREEN</small></button></div></section>' +
    '<section class="settings-section"><div class="settings-label"><p class="eyebrow">YOUR DATA / 03</p><h2>Carry the archive</h2><p>Export or merge your heard marks, ratings, notes, tags, and saved list. Files stay on your device.</p></div>' +
    '<div class="data-actions"><button class="action-button" data-action="export-json">EXPORT JSON</button><button class="line-button" data-action="export-csv">EXPORT CSV</button><label class="line-button file-import">IMPORT JSON<input id="import-file" type="file" accept=".json,application/json"></label>' +
    '<p id="import-status" class="settings-note" role="status">Import merges with this browser’s archive. It does not replace existing marks.</p></div></section>' +
    '<section class="settings-section"><div class="settings-label"><p class="eyebrow">KEYS / 04</p><h2>Direct access</h2><p>Shortcuts are inactive while you type in a field.</p></div><dl class="shortcut-list">' +
    '<div><dt><kbd>/</kbd></dt><dd>Focus collection search</dd></div><div><dt><kbd>CTRL</kbd><kbd>⌘K</kbd></dt><dd>Open the command palette</dd></div>' +
    '<div><dt><kbd>R</kbd></dt><dd>Draw an unheard record</dd></div><div><dt><kbd>ESC</kbd></dt><dd>Close the open sheet</dd></div></dl></section>' +
    '<p class="storage-note"><span class="local-mark" aria-hidden="true"></span>LOCAL STORAGE / PRIVATE TO THIS DEVICE / NO REMOTE ACCOUNT</p>';
}

function openRecord(record, restoreFocus = document.activeElement) {
  if (!record) return;
  recent = [record.k, ...recent.filter(key => key !== record.k)].slice(0, 24);
  save(RECENT_KEY, recent);
  if (!recordDialog.open) dialogOpener = restoreFocus;
  current = record;
  paintDetail(record);
  if (!recordDialog.open) recordDialog.showModal();
  $('#record-close')?.focus({ preventScroll: true });
  if (!resolved[record.k] && !lookupFailed.has(record.k)) requestMatch(record);
}

function paintDetail(record) {
  const copy = meta[record.k] || {};
  const audio = copy.au || {};
  const release = resolved[record.k];
  const apple = release?.url || 'https://music.apple.com/us/search?term=' + encodeURIComponent(record.artist + ' ' + record.title);
  const queryText = encodeURIComponent(record.artist + ' ' + record.title);
  const neighbors = crates[record.ci].albums.slice(Math.max(0, record.ai - 4), record.ai + 5).filter(item => item !== record);
  const sameYear = records.filter(item => item.year === record.year && item.ci !== record.ci).slice(0, 8);
  const flags = audioFlags(record);
  const cover = release?.art ? '<img class="detail-cover" src="' + esc(release.art.replace(/\{s\}/g, '480')) + '" alt="" decoding="async">' : '<span class="detail-cover-fallback">' + esc(record.title) + '</span>';
  const optionList = (items, selected) => items.map(item => '<option value="' + esc(item) + '"' + (item === selected ? ' selected' : '') + '>' + esc(item) + '</option>').join('');
  detailContent.innerHTML = '<div class="detail-top"><p class="eyebrow">RECORD / ' + String(record.ci + 1).padStart(2, '0') + '.' + String(record.ai + 1).padStart(2, '0') + '</p>' +
    '<button id="record-close" class="close-button" data-close-record aria-label="Close record detail">×</button></div>' +
    '<div class="detail-identity"><div class="detail-cover-wrap">' + cover + '<span class="detail-year">' + record.year + '</span></div>' +
    '<div><p class="eyebrow">' + esc(record.fam) + ' / ' + esc(record.crate) + '</p><h1 id="detail-title">' + esc(record.title) + '</h1><p class="detail-artist">' + esc(record.artist) + '</p>' +
    '<div class="detail-facts"><span>' + record.year + '</span><span>' + esc(record.crate) + '</span><span>' + esc(record.fam) + '</span></div></div></div>' +
    '<section class="detail-actions" aria-label="Record actions"><a class="action-button" id="apple-link" href="' + esc(apple) + '" target="_blank" rel="noopener">APPLE MUSIC ↗</a>' +
    '<a class="line-button" href="https://open.spotify.com/search/' + queryText + '" target="_blank" rel="noopener">SPOTIFY ↗</a>' +
    '<a class="line-button" href="https://music.youtube.com/search?q=' + queryText + '" target="_blank" rel="noopener">YOUTUBE MUSIC ↗</a>' +
    '<button class="line-button" data-action="toggle-saved" aria-pressed="' + isSaved(record) + '">' + (isSaved(record) ? 'KEPT · REMOVE' : 'KEEP FOR LATER') + '</button>' +
    '<button class="action-button heard-button" data-action="toggle-heard">' + (isHeard(record) ? 'HEARD · UNDO' : 'MARK HEARD') + '</button></section>' +
    '<p class="catalog-note" id="catalog-note">' + (release ? 'Matched to ' + esc(release.name) + ' by ' + esc(release.artist) + ' · ' + release.year + ' · US catalogue.' : lookupPending.has(record.k) ? 'Checking the catalogue… the archive stays usable.' : lookupFailed.has(record.k) ? 'Catalogue lookup unavailable. Apple Music opens a search for this title.' : 'No specific release match. Apple Music opens a search for this title.') + '</p>' +
    '<section class="detail-section"><div class="detail-section-head"><p class="eyebrow">YOUR MARKS / 01</p><h2>Classification</h2></div>' +
    '<div class="rating-control" role="group" aria-label="Personal rating">' + [1, 2, 3, 4, 5].map(rating => '<button data-rating="' + rating + '" aria-label="' + rating + ' out of 5 stars" aria-pressed="' + ((copy.r || 0) >= rating) + '">' + (copy.r >= rating ? '★' : '☆') + '</button>').join('') +
    '<button class="clear-rating" data-rating="0" aria-label="Clear rating">CLEAR</button></div>' +
    '<div class="detail-form"><label>RELEASE TYPE<select data-meta="ty"><option value="">Unset</option>' + optionList(TYPES, copy.ty) + '</select></label>' +
    '<label>ALSO FILED UNDER<select data-meta="sec"><option value="">Nowhere else</option>' + crates.map((crate, index) => '<option value="' + index + '"' + (copy.sec === index ? ' selected' : '') + '>' + esc(crate.name) + '</option>').join('') + '</select></label>' +
    '<label class="wide-field">TAGS / COMMA SEPARATED<input data-meta="tags" value="' + esc((copy.tags || []).join(', ')) + '" placeholder="mono, concept album"></label>' +
    '<label class="wide-field">NOTE<textarea data-meta="note" rows="3" placeholder="A short note to yourself">' + esc(copy.note || '') + '</textarea></label></div></section>' +
    '<section class="detail-section"><div class="detail-section-head"><p class="eyebrow">YOUR COPY / 02</p><h2>Audio record</h2></div>' +
    '<div class="audio-form"><label>FORMAT<select data-audio="fmt"><option value="">Unset</option>' + optionList(Object.keys(FMT), audio.fmt) + '</select></label>' +
    '<label>SAMPLE RATE / KHZ<input type="number" step="0.1" data-audio="sr" value="' + esc(audio.sr || '') + '"></label>' +
    '<label>BIT DEPTH<input type="number" data-audio="bd" value="' + esc(audio.bd || '') + '"></label>' +
    '<label>CHANNELS<input type="number" min="1" data-audio="ch" value="' + esc(audio.ch || '') + '"></label>' +
    '<label class="wide-field">MASTERING OR SOURCE<input data-audio="src" value="' + esc(audio.src || '') + '" placeholder="CD rip, 2009 remaster"></label>' +
    '<label class="wide-field file-label">READ A FLAC OR WAV HEADER<input id="audio-file" type="file" data-audio-file accept=".flac,.wav,audio/flac,audio/wav"></label></div>' +
    '<p class="catalog-note">' + (audio.prov === 'file' ? 'Technical fields read from the file header' + (audio.dur ? ' · ' + Math.floor(audio.dur / 60) + ':' + String(Math.round(audio.dur % 60)).padStart(2, '0') + ' long' : '') + '. Loudness and file integrity are not measured.' : audio.prov ? 'Technical fields entered by you. Nothing is inferred.' : 'No copy details recorded. Nothing is inferred.') + '</p>' +
    (flags.length ? '<ul class="review-flags">' + flags.map(flag => '<li>' + esc(flag) + '</li>').join('') + '</ul>' : '') + '</section>' +
    (crates[record.ci].desc ? '<section class="detail-section"><div class="detail-section-head"><p class="eyebrow">FILED IN / 03</p><h2>' + esc(record.crate) + '</h2></div><p class="crate-description">' + esc(crates[record.ci].desc) + '</p></section>' : '') +
    '<section class="detail-section"><div class="detail-section-head"><p class="eyebrow">NEARBY / 04</p><h2>Same crate</h2></div>' +
    (neighbors.length ? '<div class="neighbor-list">' + neighbors.map(item => '<button data-record="' + esc(item.id) + '"><span>' + esc(item.title) + '</span><small>' + esc(item.artist) + ' · ' + item.year + '</small><b aria-hidden="true">↗</b></button>').join('') + '</div>' : '<p class="quiet-note">No adjacent records in this crate.</p>') +
    (sameYear.length ? '<div class="detail-section-head year-head"><p class="eyebrow">SAME YEAR / ' + record.year + '</p><h2>Elsewhere</h2></div><div class="neighbor-list">' +
      sameYear.map(item => '<button data-record="' + esc(item.id) + '"><span>' + esc(item.title) + '</span><small>' + esc(item.artist) + ' · ' + esc(item.crate) + '</small><b aria-hidden="true">↗</b></button>').join('') + '</div>' : '') + '</section>';
}

async function requestMatch(record) {
  if (lookupPending.has(record.k) || lookupFailed.has(record.k)) return;
  lookupPending.add(record.k);
  try {
    const result = await lookup(record);
    lookupPending.delete(record.k);
    if (result) {
      resolved[record.k] = result;
      record.res = true;
      save(RESOLVED_KEY, resolved);
    } else {
      lookupFailed.add(record.k);
    }
    if (current?.k === record.k) updateCatalogNote(record);
  } catch {
    lookupPending.delete(record.k);
    lookupFailed.add(record.k);
    if (current?.k === record.k) updateCatalogNote(record);
  }
}

function updateCatalogNote(record) {
  const release = resolved[record.k];
  const note = $('#catalog-note');
  const appleLink = $('#apple-link');
  if (!note || !appleLink) return;
  appleLink.href = release?.url || 'https://music.apple.com/us/search?term=' + encodeURIComponent(record.artist + ' ' + record.title);
  note.textContent = release
    ? 'Matched to ' + release.name + ' by ' + release.artist + ' · ' + release.year + ' · US catalogue.'
    : lookupPending.has(record.k) ? 'Checking the catalogue… the archive stays usable.'
    : 'Catalogue lookup unavailable or unmatched. Apple Music opens a search for this title.';
  const art = release?.art;
  const wrap = $('.detail-cover-wrap');
  if (art && wrap && !wrap.querySelector('img')) {
    const image = new Image();
    image.className = 'detail-cover';
    image.alt = '';
    image.decoding = 'async';
    image.onload = () => $('.detail-cover-wrap')?.classList.add('has-cover');
    image.onerror = () => image.remove();
    image.src = art.replace(/\{s\}/g, '480');
    wrap.prepend(image);
  }
}

function paintCover(element) {
  const record = byKey.get(element.dataset.coverKey);
  const artwork = record && resolved[record.k]?.art;
  if (!artwork || element.querySelector('img')) return;
  const image = new Image();
  image.alt = '';
  image.decoding = 'async';
  image.onload = () => element.classList.add('has-cover');
  image.onerror = () => image.remove();
  image.src = artwork.replace(/\{s\}/g, '160');
  element.prepend(image);
}

function closeRecord() {
  if (recordDialog.open) recordDialog.close();
}

function closeCommand() {
  if (commandDialog.open) commandDialog.close();
}

function drawRecord() {
  const pool = records.filter(record => !isHeard(record));
  if (!pool.length) return toast('Every record is marked heard.');
  const record = pool[Math.floor(Math.random() * pool.length)];
  view = 'index';
  query = '';
  activeCrate = '';
  statusFilter = 'all';
  decades.clear();
  pageSize = 72;
  $('#q').value = '';
  render();
  requestAnimationFrame(() => openRecord(record, $('#pull')));
}

function navigate(nextView, crateName = '') {
  view = nextView;
  query = '';
  $('#q').value = '';
  activeCrate = nextView === 'index' ? crateName : '';
  statusFilter = 'all';
  decades.clear();
  pageSize = 72;
  render();
  window.scrollTo({ top: 0, behavior: 'instant' });
  $('#main').focus({ preventScroll: true });
}

function openCommand() {
  renderCommandResults('');
  commandQuery.value = '';
  commandDialog.showModal();
  commandQuery.focus({ preventScroll: true });
}

function renderCommandResults(rawQuery) {
  const text = norm(rawQuery);
  const routes = [
    ['room', 'Listening room', 'Resume / discovery'],
    ['index', 'The index', 'All records / search'],
    ['saved', 'Kept records', 'Saved / recent'],
    ['ledger', 'Your ledger', 'Progress / counts'],
    ['settings', 'Settings', 'Display / data / keys']
  ];
  const routeItems = routes.filter(([, title, detail]) => !text || norm(title + ' ' + detail).includes(text))
    .map(([name, title, detail]) => '<button class="command-item" data-command-view="' + name + '"><span class="command-code">VIEW</span><strong>' + title + '</strong><small>' + detail + '</small><kbd>↵</kbd></button>');
  const actionItems = (!text || 'draw unheard record'.includes(text)) ?
    '<button class="command-item" data-command-draw><span class="command-code">ACT</span><strong>Draw an unheard record</strong><small>Choose one from the archive</small><kbd>R</kbd></button>' : '';
  let recordItems = '';
  if (text.length >= 2) {
    const found = records.filter(record => norm(record.title + ' ' + record.artist + ' ' + record.crate).includes(text)).slice(0, 8);
    recordItems = found.map(record => '<button class="command-item" data-command-record="' + esc(record.id) + '"><span class="command-code">RECORD</span><strong>' + esc(record.title) + '</strong><small>' + esc(record.artist) + ' · ' + record.year + ' · ' + esc(record.crate) + '</small><kbd>↵</kbd></button>').join('');
  } else if (!text) {
    recordItems = recent.map(key => byKey.get(key)).filter(Boolean).slice(0, 4).map(record =>
      '<button class="command-item" data-command-record="' + esc(record.id) + '"><span class="command-code">RECENT</span><strong>' + esc(record.title) + '</strong><small>' + esc(record.artist) + ' · ' + record.year + '</small><kbd>↵</kbd></button>'
    ).join('');
  }
  const results = $('#command-results');
  const output = routeItems.join('') + actionItems + recordItems;
  results.innerHTML = output || '<p class="command-empty">NO MATCH / SEARCH A TITLE OR ARTIST</p>';
}

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('show'), 2400);
}

function toggleHeard() {
  if (!current) return;
  if (isHeard(current)) heard.delete(current.k); else heard.add(current.k);
  save(HEARD_KEY, [...heard]);
  updateDetailActions();
  updateVisibleMarks();
  if (view === 'ledger') render();
  toast(isHeard(current) ? 'Marked heard.' : 'Heard mark removed.');
}

function toggleSaved() {
  if (!current) return;
  if (isSaved(current)) favorites.delete(current.k); else favorites.add(current.k);
  save(FAVORITES_KEY, [...favorites]);
  updateSavedCount();
  updateDetailActions();
  updateVisibleMarks();
  if (view === 'ledger') render();
  toast(isSaved(current) ? 'Kept for later.' : 'Removed from kept records.');
}

function updateDetailActions() {
  const heardButton = $('[data-action="toggle-heard"]');
  const savedButton = $('[data-action="toggle-saved"]');
  if (heardButton && current) heardButton.textContent = isHeard(current) ? 'HEARD · UNDO' : 'MARK HEARD';
  if (savedButton && current) {
    savedButton.textContent = isSaved(current) ? 'KEPT · REMOVE' : 'KEEP FOR LATER';
    savedButton.setAttribute('aria-pressed', String(isSaved(current)));
  }
  updateNavigation();
}

function updateVisibleMarks() {
  document.querySelectorAll('.record-row[data-record]').forEach(button => {
    const record = byId.get(button.dataset.record);
    if (!record) return;
    const marks = button.querySelector('.record-marks');
    if (!marks) return;
    const value = meta[record.k] || {};
    const output = [
      isHeard(record) ? '<span class="record-mark">HEARD</span>' : '',
      isSaved(record) ? '<span class="record-mark saved">KEPT</span>' : '',
      value.r ? '<span class="record-mark rating">' + value.r + '/5</span>' : ''
    ].filter(Boolean).join('');
    marks.innerHTML = output || '<span class="record-mark blank">—</span>';
  });
}

function setRating(value) {
  if (!current) return;
  const copy = recordMeta(current.k);
  if (value) copy.r = value; else delete copy.r;
  saveMeta();
  paintDetail(current);
  $('[data-rating="' + value + '"]')?.focus({ preventScroll: true });
  updateVisibleMarks();
  toast(value ? 'Rating saved.' : 'Rating cleared.');
}

function setMetaField(target) {
  if (!current) return;
  const copy = recordMeta(current.k);
  const field = target.dataset.meta;
  if (field === 'tags') copy.tags = target.value.split(',').map(tag => tag.trim().toLowerCase()).filter(Boolean);
  else if (field === 'sec') {
    if (target.value === '') delete copy.sec;
    else copy.sec = +target.value;
  } else if (target.value) copy[field] = target.value;
  else delete copy[field];
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveMeta, 260);
  updateVisibleMarks();
}

function setAudioField(target, record = current) {
  if (!record) return;
  const copy = recordMeta(record.k);
  const audio = copy.au || (copy.au = {});
  const field = target.dataset.audio;
  if (target.type === 'number') {
    if (target.value === '') delete audio[field];
    else audio[field] = +target.value || undefined;
  } else if (target.value) audio[field] = target.value;
  else delete audio[field];
  audio.prov = 'user';
  saveMeta();
}

function toggleDecade(value) {
  if (decades.has(value)) decades.delete(value);
  else decades.add(value);
  pageSize = 72;
  render();
  document.querySelector('[data-decade="' + value + '"]')?.focus({ preventScroll: true });
}

function clearFilters() {
  query = '';
  activeCrate = '';
  statusFilter = 'all';
  decades.clear();
  pageSize = 72;
  $('#q').value = '';
  view = 'index';
  render();
  $('#q').focus({ preventScroll: true });
}

function downloadFile(filename, content, mime) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportJSON() {
  downloadFile('sonicfield.json', JSON.stringify({
    heard: [...heard], meta, favorites: [...favorites], recent
  }, null, 2), 'application/json');
  toast('Archive exported.');
}

function exportCSV() {
  const quote = value => '"' + String(value ?? '').replace(/"/g, '""') + '"';
  const header = ['artist', 'title', 'year', 'crate', 'heard', 'saved', 'rating', 'type', 'tags', 'format', 'khz', 'bits', 'channels', 'audio_provenance', 'apple_id', 'review_flags'];
  const rows = records.map(record => {
    const value = meta[record.k] || {};
    const audio = value.au || {};
    return [
      record.artist, record.title, record.year, record.crate, isHeard(record), isSaved(record),
      value.r, value.ty, (value.tags || []).join('; '), audio.fmt, audio.sr, audio.bd, audio.ch,
      audio.prov, resolved[record.k]?.id, audioFlags(record).join(' | ')
    ].map(quote).join(',');
  });
  downloadFile('sonicfield-index.csv', [header.map(quote).join(','), ...rows].join('\r\n'), 'text/csv;charset=utf-8');
  toast('Index exported.');
}

async function importJSON(file) {
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.heard) || !data.meta || typeof data.meta !== 'object' || Array.isArray(data.meta)) throw new Error();
    heard = new Set([...heard, ...data.heard.filter(key => typeof key === 'string')]);
    for (const [key, value] of Object.entries(data.meta)) {
      const previous = meta[key] || {};
      meta[key] = { ...previous, ...(value || {}) };
      if (previous.au || value?.au) meta[key].au = { ...(previous.au || {}), ...(value?.au || {}) };
    }
    favorites = new Set([...favorites, ...(Array.isArray(data.favorites) ? data.favorites.filter(key => typeof key === 'string') : [])]);
    recent = [...new Set([...(Array.isArray(data.recent) ? data.recent : []).filter(key => typeof key === 'string'), ...recent])].slice(0, 24);
    save(HEARD_KEY, [...heard]);
    saveMeta();
    save(FAVORITES_KEY, [...favorites]);
    save(RECENT_KEY, recent);
    render();
    $('#import-status').textContent = 'Merged. Imported fields replaced matching values; unrelated marks were kept.';
    toast('Archive merged.');
  } catch {
    $('#import-status').textContent = 'Could not read that file as a SonicField JSON export.';
    toast('That file is not a SonicField export.');
  }
}

document.addEventListener('click', event => {
  const target = event.target.closest('button, a, label');
  if (!target) return;

  if (target.dataset.view) {
    event.preventDefault();
    navigate(target.dataset.view);
    return;
  }
  if (target.dataset.crate) {
    navigate('index', target.dataset.crate);
    return;
  }
  if (target.dataset.query !== undefined) {
    query = target.dataset.query;
    $('#q').value = query;
    activeCrate = '';
    statusFilter = 'all';
    decades.clear();
    view = 'index';
    pageSize = 72;
    render();
    window.scrollTo({ top: 0, behavior: 'instant' });
    $('#main').focus({ preventScroll: true });
    return;
  }
  if (target.dataset.record) {
    openRecord(byId.get(target.dataset.record));
    return;
  }
  if (target.id === 'command-open') {
    openCommand();
    return;
  }
  if (target.id === 'pull' || target.dataset.action === 'draw' || target.dataset.commandDraw !== undefined) {
    closeCommand();
    drawRecord();
    return;
  }
  if (target.dataset.commandView) {
    closeCommand();
    navigate(target.dataset.commandView);
    return;
  }
  if (target.dataset.commandRecord) {
    const record = byId.get(target.dataset.commandRecord);
    closeCommand();
    requestAnimationFrame(() => openRecord(record, $('#command-open')));
    return;
  }
  if (target.hasAttribute('data-close-command')) {
    closeCommand();
    return;
  }
  if (target.hasAttribute('data-close-record')) {
    closeRecord();
    return;
  }
  if (target.dataset.action === 'retry') {
    boot();
    return;
  }
  if (target.dataset.action === 'load-more') {
    pageSize += 72;
    render();
    $('[data-action="load-more"]')?.focus({ preventScroll: true });
    return;
  }
  if (target.dataset.action === 'load-more-saved') {
    pageSize += 72;
    render();
    $('[data-action="load-more-saved"]')?.focus({ preventScroll: true });
    return;
  }
  if (target.dataset.action === 'clear-filters') {
    clearFilters();
    return;
  }
  if (target.dataset.action === 'toggle-heard') {
    toggleHeard();
    return;
  }
  if (target.dataset.action === 'toggle-saved') {
    toggleSaved();
    return;
  }
  if (target.dataset.action === 'export-json') {
    exportJSON();
    return;
  }
  if (target.dataset.action === 'export-csv') {
    exportCSV();
    return;
  }
  if (target.dataset.accent) {
    prefs.accent = target.dataset.accent;
    savePreferences();
    render();
    $('[data-accent="' + prefs.accent + '"]')?.focus({ preventScroll: true });
    return;
  }
  if (target.dataset.density) {
    prefs.density = target.dataset.density;
    savePreferences();
    render();
    $('[data-density="' + prefs.density + '"]')?.focus({ preventScroll: true });
    return;
  }
  if (target.dataset.rating !== undefined) {
    setRating(+target.dataset.rating);
    return;
  }
  if (target.dataset.decade) {
    toggleDecade(+target.dataset.decade);
  }
});

let searchTimer;
$('#q').addEventListener('input', event => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    query = event.target.value.trim();
    view = 'index';
    activeCrate = '';
    pageSize = 72;
    render();
  }, 90);
});

document.addEventListener('change', async event => {
  const target = event.target;
  if (target.id === 'crate-filter') {
    activeCrate = target.value;
    pageSize = 72;
    render();
    $('#crate-filter')?.focus({ preventScroll: true });
  } else if (target.id === 'status-filter') {
    statusFilter = target.value;
    pageSize = 72;
    render();
    $('#status-filter')?.focus({ preventScroll: true });
  } else if (target.id === 'import-file') {
    if (target.files?.[0]) await importJSON(target.files[0]);
    target.value = '';
  } else if (target.matches('[data-meta]')) {
    setMetaField(target);
  } else if (target.matches('[data-audio]')) {
    setAudioField(target);
  } else if (target.matches('[data-audio-file]') && target.files?.[0]) {
    const record = current;
    try {
      const buffer = await target.files[0].slice(0, 64).arrayBuffer();
      const detected = sniff(buffer);
      if (!detected) {
        toast('No FLAC or WAV header was found.');
        return;
      }
      const copy = recordMeta(record.k);
      copy.au = { ...copy.au, ...detected, prov: 'file' };
      saveMeta();
      if (current?.k === record.k) {
        paintDetail(record);
        $('#audio-file')?.focus({ preventScroll: true });
        toast('File header read. Values are marked as measured.');
      }
    } catch {
      toast('Could not read that file header.');
    }
  }
});

document.addEventListener('input', event => {
  const target = event.target;
  if (target.matches('[data-meta]')) setMetaField(target);
});

document.addEventListener('keydown', event => {
  const target = event.target;
  const typing = target.matches('input, textarea, select, [contenteditable="true"]');
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    if (!commandDialog.open && !recordDialog.open) openCommand();
    return;
  }
  if (commandDialog.open) {
    const items = [...$('#command-results').querySelectorAll('button')];
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const index = items.indexOf(document.activeElement);
      const next = event.key === 'ArrowDown'
        ? (index + 1) % items.length
        : (index <= 0 ? items.length - 1 : index - 1);
      items[next]?.focus();
    } else if (event.key === 'Enter' && document.activeElement.matches('.command-item')) {
      event.preventDefault();
      document.activeElement.click();
    }
    return;
  }
  if (event.key === '/' && !typing && !recordDialog.open) {
    event.preventDefault();
    $('#q').focus();
  } else if (event.key.toLowerCase() === 'r' && !typing && !recordDialog.open) {
    event.preventDefault();
    drawRecord();
  }
});

recordDialog.addEventListener('click', event => {
  if (event.target === recordDialog) closeRecord();
});
recordDialog.addEventListener('close', () => {
  const opener = dialogOpener;
  const recordId = opener?.dataset?.record;
  current = null;
  dialogOpener = null;
  render();
  const replacement = recordId
    ? [...document.querySelectorAll('#main [data-record]')].find(element => element.dataset.record === recordId)
    : opener;
  (replacement?.isConnected ? replacement : $('#main'))?.focus({ preventScroll: true });
});
commandDialog.addEventListener('click', event => {
  if (event.target === commandDialog) closeCommand();
});

$('#command-query').addEventListener('input', event => renderCommandResults(event.target.value));
$('#q').addEventListener('search', event => {
  query = event.target.value.trim();
  view = 'index';
  activeCrate = '';
  pageSize = 72;
  render();
});

applyPreferences();
boot();
