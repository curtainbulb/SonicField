(() => {
  "use strict";

  const STORE_KEY = "sonicfield.state.v1";
  const ART_KEY   = "sonicfield.apple-cache.v1";
  const $ = (selector) => document.querySelector(selector);
  const windowEl      = $("#album-window");
  const tapeEl        = $("#tape");
  const searchEl      = $("#search");
  const categoryEl    = $("#category");
  const heardFilterEl = $("#heard-filter");
  const positionEl    = $("#position");
  const connectionEl  = $("#connection");
  const sourceHelpEl  = $("#source-help");
  const fileEl        = $("#source-file");
  const summaryEl     = $("#catalog-summary");
  const continueButton  = $("#continue-button");
  const detourButton    = $("#detour-button");
  const slipButton      = $("#slip-button");
  const routeResult     = $("#route-result");
  const exportButton    = $("#export-record");
  const importFileEl    = $("#import-record");
  const progressFill    = $("#progress-fill");
  const progressLabel   = $("#progress-label");
  const slipCountEl     = $("#slip-count");

  const state = readState();
  let albums        = [];
  let categories    = [];
  let visibleItems  = [];
  let offsets       = [0];
  let itemIndexById = new Map();
  let rendered      = new Map();
  let filteredCount = 0;
  let resizeTimer   = 0;
  let renderFrame   = 0;
  let lastStart     = -1;
  let lastEnd       = -1;
  let saveTimer     = 0;
  let lookupQueue   = [];
  let activeLookups = 0;
  let lookupTimer   = 0;
  let lastLookupStarted = 0;
  let jsonpSequence = 0;
  let attempted     = new Set();
  let artCache      = readArtCache();
  let statusError   = "";
  let storageError  = false;
  let restorePending = true;
  let notes         = Object.create(null);
  let detourHistory = Array.isArray(state.detourHistory) ? state.detourHistory.slice(-6) : [];
  let lastDetourCategory = typeof state.lastDetourCategory === "string" ? state.lastDetourCategory : "";
  const expandedNotes = new Set();
  const orbits = new Set(Array.isArray(state.orbits) ? state.orbits : []);
  let slips    = Array.isArray(state.slips) ? [...new Set(state.slips)] : [];
  let attention  = Object.create(null);
  let resonance  = Object.create(null);
  let currentAttentionId  = "";
  let lastAttentionAt     = Date.now();
  let lastAttentionPersist = Date.now();
  let attentionTimer = 0;

  // ─── NEW: Session state ───────────────────────────────────────────────
  let sessionHeardCount = 0;       // heard marks in this session
  let streakTimer       = 0;       // timeout for clearing streak display

  // ─── NEW: Idle drift ─────────────────────────────────────────────────
  let idleTimer     = 0;           // fires after inactivity to start drift
  let driftFrame    = 0;           // rAF id for drift animation
  let isDrifting    = false;
  const IDLE_DELAY  = 45000;       // ms before drift starts
  const DRIFT_SPEED = 0.6;         // px per frame (~36px/s at 60fps)

  // ─── NEW: Scan momentum ───────────────────────────────────────────────
  let lastScrollY      = 0;
  let lastScrollTime   = 0;
  let scrollVelTimer   = 0;
  let isScanning       = false;

  const NOTE_COMMON_WORDS = new Set([
    "about","album","albums","also","been","being","from","have","into","just",
    "like","made","more","music","record","records","that","their","them","there",
    "these","they","this","those","very","were","what","when","with","your"
  ]);

  const heard = new Set(Array.isArray(state.heard) ? state.heard : []);
  const observer = "IntersectionObserver" in window
    ? new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          observer.unobserve(entry.target);
          const id = entry.target.dataset.albumId;
          const album = albums.find((item) => item.id === id);
          if (album) requestLookup(album);
        }
      }, { root: windowEl, rootMargin: "120px 0px" })
    : null;
  const sizeObserver = "ResizeObserver" in window
    ? new ResizeObserver((entries) => updateMeasuredHeights(entries.map((entry) => entry.target)))
    : null;

  // ─── Storage ─────────────────────────────────────────────────────────

  function readState() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  }

  function readArtCache() {
    try {
      const parsed = JSON.parse(localStorage.getItem(ART_KEY) || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch { return {}; }
  }

  function persistArtCache() {
    try { localStorage.setItem(ART_KEY, JSON.stringify(artCache)); } catch {}
  }

  function persistState(placeId = currentPlaceId()) {
    const value = {
      heard: [...heard],
      knownIds: albums.map((album) => album.id),
      notes,
      orbits: [...orbits],
      slips,
      attention,
      resonance,
      detourHistory,
      lastDetourCategory,
      query:       searchEl.value,
      category:    categoryEl.value,
      heardFilter: heardFilterEl.value,
      placeId,
      scrollTop: windowEl.scrollTop
    };
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(value));
      statusError = "";
      storageError = false;
      updateFooter();
    } catch {
      storageError = true;
      updateFooter();
    }
  }

  function schedulePersist() {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => persistState(), 180);
  }

  // ─── Text utilities ───────────────────────────────────────────────────

  function normalize(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function hash(value) {
    let output = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      output ^= value.charCodeAt(index);
      output = Math.imul(output, 16777619);
    }
    return (output >>> 0).toString(36);
  }

  // ─── Source parsing ───────────────────────────────────────────────────

  function parseSource(markdown) {
    const resultAlbums     = [];
    const resultCategories = [];
    const occurrences      = new Map();
    let category = null;
    const lines = markdown.replace(/^\uFEFF/, "").split(/\r?\n/);

    for (const originalLine of lines) {
      const line = originalLine.trim();
      if (!line || line === "SONICFIELD LIST") continue;
      const match = line.match(/^-\s+\[([ xX])\]\s+(.+?)\s+\((\d{4})\)\s+—\s+(.+?)\s*$/);
      if (match) {
        if (!category) throw new Error("An album appears before its category heading.");
        const [, checked, title, year, artist] = match;
        const key        = `${normalize(artist)}|${normalize(title)}|${year}`;
        const occurrence = occurrences.get(key) || 0;
        occurrences.set(key, occurrence + 1);
        const id = `${hash(key)}-${occurrence}`;
        resultAlbums.push({
          id,
          catalogIndex: resultAlbums.length + 1,
          title: title.trim(),
          year,
          artist: artist.trim(),
          categoryId:    category.id,
          categoryName:  category.name,
          categoryGroup: category.group,
          description:   category.description,
          initiallyHeard: checked.toLowerCase() === "x"
        });
        continue;
      }

      const heading   = line.match(/^(.*?)(?:\s+\((.*))?$/);
      const fullName  = (heading?.[1] || line).trim();
      const description = (heading?.[2] || "").trim().replace(/\)$/, "");
      const separator = fullName.indexOf(" — ");
      const group = separator >= 0 ? fullName.slice(0, separator).trim() : fullName;
      const name  = separator >= 0 ? fullName.slice(separator + 3).trim() : fullName;
      category = {
        id:          `category-${resultCategories.length}`,
        name,
        group,
        fullName,
        description,
        count: 0
      };
      resultCategories.push(category);
    }

    if (resultAlbums.length === 0 || resultCategories.length === 0) {
      throw new Error("No album entries were found in albums.md.");
    }
    for (const album of resultAlbums) {
      const matchCategory = resultCategories.find((item) => item.id === album.categoryId);
      if (matchCategory) matchCategory.count += 1;
    }
    return { albums: resultAlbums, categories: resultCategories };
  }

  // ─── Source loading ───────────────────────────────────────────────────

  async function loadSource() {
    try {
      const response = await fetch(new URL("albums.md", window.location.href), { cache: "no-store" });
      if (!response.ok) throw new Error(`Source request returned ${response.status}.`);
      initialize(await response.text());
    } catch {
      sourceHelpEl.hidden = false;
      summaryEl.textContent  = "Source not loaded";
      positionEl.textContent = "Choose albums.md to continue";
    }
  }

  function initialize(markdown) {
    try {
      const parsed = parseSource(markdown);
      albums     = parsed.albums;
      categories = parsed.categories;
      const validIds = new Set(albums.map((album) => album.id));
      for (const id of heard)   if (!validIds.has(id)) heard.delete(id);
      for (const id of orbits)  if (!validIds.has(id)) orbits.delete(id);
      slips = slips.filter((id) => validIds.has(id));
      const savedAttention = state.attention && typeof state.attention === "object" ? state.attention : {};
      for (const [id, seconds] of Object.entries(savedAttention)) {
        if (validIds.has(id) && Number.isFinite(seconds) && seconds > 0)
          attention[id] = Math.min(3600, seconds);
      }
      const savedResonance = state.resonance && typeof state.resonance === "object" ? state.resonance : {};
      for (const [id, level] of Object.entries(savedResonance)) {
        if (validIds.has(id) && Number.isFinite(level) && level > 0)
          resonance[id] = Math.min(3, Math.max(1, Math.round(level)));
      }
      const knownIds    = new Set(Array.isArray(state.knownIds) ? state.knownIds : []);
      const hasSavedMarks = Array.isArray(state.heard);
      const savedNotes  = state.notes && typeof state.notes === "object" ? state.notes : {};
      for (const [id, note] of Object.entries(savedNotes)) {
        if (validIds.has(id) && typeof note === "string" && note.trim())
          notes[id] = note.slice(0, 4000);
      }
      detourHistory = detourHistory.filter((id) => validIds.has(id)).slice(-6);
      if (!categories.some((category) => category.id === lastDetourCategory)) lastDetourCategory = "";
      for (const album of albums) {
        if (album.initiallyHeard && (!hasSavedMarks || (Array.isArray(state.knownIds) && !knownIds.has(album.id)))) {
          heard.add(album.id);
        }
      }
      populateControls();
      restoreControls();
      searchEl.disabled      = false;
      categoryEl.disabled    = false;
      heardFilterEl.disabled = false;
      continueButton.disabled = false;
      detourButton.disabled   = false;
      slipButton.disabled     = slips.length === 0;
      exportButton.disabled   = false;
      importFileEl.disabled   = false;
      sourceHelpEl.hidden     = true;
      renderList();
      updateSummary();
      updateFooter();
      updateProgress();
      updateSlipBadge();
      if (restorePending) {
        restorePending = false;
        requestAnimationFrame(restorePlace);
      }
      // kick off idle drift system
      scheduleIdleDrift();
    } catch (error) {
      sourceHelpEl.hidden    = false;
      summaryEl.textContent  = "Source could not be read";
      positionEl.textContent = error instanceof Error ? error.message : "The source file could not be parsed.";
    }
  }

  function populateControls() {
    const options = [new Option("All categories", "all")];
    for (const category of categories) {
      options.push(new Option(`${category.group} · ${category.name}`, category.id));
    }
    categoryEl.replaceChildren(...options);
  }

  function restoreControls() {
    searchEl.value = typeof state.query === "string" ? state.query : "";
    if (["all","heard","unheard","notes","orbit","pulled","slip"].includes(state.heardFilter))
      heardFilterEl.value = state.heardFilter;
    if (state.category && [...categoryEl.options].some((option) => option.value === state.category)) {
      categoryEl.value = state.category;
    }
  }

  // ─── Filtering ────────────────────────────────────────────────────────

  function matches(album) {
    if (categoryEl.value !== "all" && album.categoryId !== categoryEl.value) return false;
    if (heardFilterEl.value === "heard"   && !heard.has(album.id))   return false;
    if (heardFilterEl.value === "unheard" && heard.has(album.id))    return false;
    if (heardFilterEl.value === "notes"   && !notes[album.id]?.trim() && !expandedNotes.has(album.id)) return false;
    if (heardFilterEl.value === "orbit"   && !orbits.has(album.id))  return false;
    if (heardFilterEl.value === "pulled"  && !resonance[album.id])   return false;
    if (heardFilterEl.value === "slip"    && !slips.includes(album.id)) return false;
    const query = normalize(searchEl.value);
    if (!query) return true;
    const content = normalize(
      `${album.title} ${album.artist} ${album.year} ${album.categoryGroup} ${album.categoryName} ${album.description} ${notes[album.id] || ""}`
    );
    return content.includes(query);
  }

  function buildItems() {
    const grouped = new Map();
    for (const album of albums) {
      if (!matches(album)) continue;
      if (!grouped.has(album.categoryId)) grouped.set(album.categoryId, []);
      grouped.get(album.categoryId).push(album);
    }
    const items = [];
    const selectedCategories = categoryEl.value === "all"
      ? categories
      : categories.filter((item) => item.id === categoryEl.value);
    for (const category of selectedCategories) {
      const entries = grouped.get(category.id) || [];
      if (!entries.length) continue;
      items.push({ type: "category", category, id: `cut-${category.id}` });
      for (const album of entries) items.push({ type: "album", album, id: album.id });
    }
    return items;
  }

  // ─── Layout / virtual scroll ──────────────────────────────────────────

  function measurements() {
    const narrow = window.matchMedia("(max-width: 640px)").matches;
    const medium = window.matchMedia("(max-width: 920px)").matches;
    return {
      album:    narrow ? 88 : medium ? 88 : 94,
      category: narrow ? 160 : medium ? 126 : 116
    };
  }

  function renderList() {
    if (observer) {
      for (const element of rendered.values()) {
        if (element.classList.contains("album-row")) observer.unobserve(element);
      }
    }
    if (sizeObserver) for (const element of rendered.values()) sizeObserver.unobserve(element);
    visibleItems  = buildItems();
    filteredCount = visibleItems.reduce((count, item) => count + (item.type === "album" ? 1 : 0), 0);
    itemIndexById = new Map();
    const size = measurements();
    visibleItems.forEach((item, index) => {
      item.height = item.type === "album" ? size.album : size.category;
      itemIndexById.set(item.id, index);
    });
    rebuildOffsets();
    rendered.clear();
    lastStart = -1;
    lastEnd   = -1;
    queueRender();
    updateFooter();
  }

  function rebuildOffsets() {
    offsets = new Array(visibleItems.length + 1);
    offsets[0] = 0;
    visibleItems.forEach((item, index) => { offsets[index + 1] = offsets[index] + item.height; });
    tapeEl.style.height = `${offsets[offsets.length - 1] || 0}px`;
    for (const element of rendered.values()) {
      const index = Number(element.dataset.itemIndex);
      if (Number.isInteger(index)) element.style.transform = `translateY(${offsets[index]}px)`;
    }
  }

  function updateMeasuredHeights(elements) {
    let changed = false;
    for (const element of elements) {
      const index = Number(element.dataset.itemIndex);
      if (!Number.isInteger(index) || !visibleItems[index]) continue;
      const height = Math.ceil(element.getBoundingClientRect().height);
      if (height > 0 && Math.abs(height - visibleItems[index].height) > 1) {
        visibleItems[index].height = height;
        changed = true;
      }
    }
    if (!changed) return;
    const anchorIndex = visibleItems.length ? lowerBound(windowEl.scrollTop) : 0;
    const anchorId    = visibleItems[anchorIndex]?.id;
    const anchorDelta = windowEl.scrollTop - (offsets[anchorIndex] || 0);
    rebuildOffsets();
    const newAnchorIndex = anchorId ? itemIndexById.get(anchorId) : undefined;
    if (newAnchorIndex !== undefined) windowEl.scrollTop = Math.max(0, offsets[newAnchorIndex] + anchorDelta);
    lastStart = -1;
    lastEnd   = -1;
    queueRender();
  }

  function measureRenderedFallback() {
    if (!sizeObserver) updateMeasuredHeights([...rendered.values()]);
  }

  function lowerBound(value) {
    let low = 0, high = visibleItems.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (offsets[middle + 1] < value) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  function queueRender() {
    if (renderFrame) return;
    renderFrame = requestAnimationFrame(() => { renderFrame = 0; renderWindow(); });
  }

  function renderWindow() {
    const start = Math.max(0, lowerBound(windowEl.scrollTop) - 7);
    const end   = Math.min(visibleItems.length, lowerBound(windowEl.scrollTop + windowEl.clientHeight) + 9);
    if (start === lastStart && end === lastEnd) {
      updatePosition(start, end);
      return;
    }
    const active    = document.activeElement;
    const activeRow = active?.closest?.(".album-row");
    const focusRestore = activeRow && tapeEl.contains(activeRow)
      ? {
          id: activeRow.dataset.albumId,
          control: active.matches(".heard-toggle")       ? ".heard-toggle"
                 : active.matches(".note-toggle")        ? ".note-toggle"
                 : active.matches(".orbit-toggle")       ? ".orbit-toggle"
                 : active.matches(".resonance-toggle")   ? ".resonance-toggle"
                 : active.matches(".slip-toggle")        ? ".slip-toggle"
                 : active.matches("textarea")            ? ".note-editor textarea"
                 : active.matches(".record-link")        ? ".record-link"
                 : ".cover-link"
        }
      : null;

    const wanted   = new Set();
    const fragment = document.createDocumentFragment();

    for (let index = start; index < end; index += 1) {
      const item = visibleItems[index];
      wanted.add(item.id);
      let element = rendered.get(item.id);
      if (!element) {
        element = item.type === "category"
          ? makeCategoryElement(item, index)
          : makeAlbumElement(item, index);
        rendered.set(item.id, element);
      } else if (item.type === "album") {
        updateAlbumControls(element, item.album);
      }
      element.style.transform = `translateY(${offsets[index]}px)`;
      element.dataset.itemIndex = String(index);
      if (sizeObserver) sizeObserver.observe(element);
      fragment.appendChild(element);
    }

    lookupQueue = lookupQueue.filter((task) => {
      if (wanted.has(task.album.id)) return true;
      attempted.delete(task.album.id);
      return false;
    });
    if (!lookupQueue.length && lookupTimer) {
      window.clearTimeout(lookupTimer);
      lookupTimer = 0;
    }

    for (const [id, element] of rendered) {
      if (wanted.has(id)) continue;
      if (observer && element.classList.contains("album-row")) observer.unobserve(element);
      if (sizeObserver) sizeObserver.unobserve(element);
      rendered.delete(id);
    }
    tapeEl.replaceChildren(fragment);
    const visibleId = currentPlaceId();
    if (visibleId) currentAttentionId = visibleId;
    markCurrentRow(currentAttentionId);
    applyWearClasses();
    highlightSearch();
    lastStart = start;
    lastEnd   = end;
    if (focusRestore && wanted.has(focusRestore.id)) {
      rendered.get(focusRestore.id)?.querySelector(focusRestore.control)?.focus({ preventScroll: true });
    }
    measureRenderedFallback();
    updatePosition(start, end);
  }

  // ─── NEW: Wear classes (linger-based margin dots) ─────────────────────

  function wearLevel(seconds) {
    if (!seconds || seconds < 20) return 0;
    if (seconds < 60)   return 1;
    if (seconds < 180)  return 2;
    if (seconds < 600)  return 3;
    return 4;
  }

  function applyWearClasses() {
    for (const [id, element] of rendered) {
      if (!element.classList.contains("album-row")) continue;
      const level = wearLevel(attention[id] || 0);
      if (level > 0) element.dataset.wear = String(level);
      else delete element.dataset.wear;
    }
  }

  // ─── NEW: Search highlight ─────────────────────────────────────────────

  function highlightSearch() {
    const query = normalize(searchEl.value).trim();
    for (const element of rendered.values()) {
      if (!element.classList.contains("album-row")) continue;
      const titleEl  = element.querySelector(".record-title");
      const artistEl = element.querySelector(".record-artist");
      if (!titleEl || !artistEl) continue;
      if (!query) {
        // restore plain text if we had marked it
        if (titleEl.dataset.raw)  { titleEl.textContent  = titleEl.dataset.raw;  delete titleEl.dataset.raw; }
        if (artistEl.dataset.raw) { artistEl.textContent = artistEl.dataset.raw; delete artistEl.dataset.raw; }
        continue;
      }
      applyHighlightToEl(titleEl, query);
      applyHighlightToEl(artistEl, query);
    }
  }

  function applyHighlightToEl(el, query) {
    // store original text once
    if (!el.dataset.raw) el.dataset.raw = el.textContent;
    const original = el.dataset.raw;
    const normOrig = normalize(original);
    const idx = normOrig.indexOf(query);
    if (idx < 0) {
      el.textContent = original;
      return;
    }
    // find approximate char range in original (NFD stripping shifts indices,
    // so we do a best-effort highlight)
    // Walk normalized until we find the match, map back to original by character
    const frag = document.createDocumentFragment();
    let origIdx = 0;
    let normIdx = 0;
    const normLen = query.length;
    // Build a map: normIdx → origIdx by iterating both
    const normMap = buildNormMap(original);
    const matchStart = normMap[idx]       ?? 0;
    const matchEnd   = normMap[idx + normLen] ?? original.length;
    if (matchStart >= matchEnd) {
      el.textContent = original;
      return;
    }
    if (matchStart > 0) {
      frag.appendChild(document.createTextNode(original.slice(0, matchStart)));
    }
    const mark = document.createElement("span");
    mark.className = "search-hl";
    mark.textContent = original.slice(matchStart, matchEnd);
    frag.appendChild(mark);
    if (matchEnd < original.length) {
      frag.appendChild(document.createTextNode(original.slice(matchEnd)));
    }
    el.replaceChildren(frag);
  }

  function buildNormMap(str) {
    // Returns an array where normMap[normIdx] = origIdx
    const map = [];
    let normPos = 0;
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      const n  = normalize(ch);
      for (let j = 0; j < n.length; j++) {
        map[normPos + j] = i;
      }
      normPos += n.length || 1;
    }
    map[normPos] = str.length;
    return map;
  }

  // ─── Category element ─────────────────────────────────────────────────

  function makeCategoryElement(item) {
    const { category } = item;
    const section = document.createElement("section");
    section.className = "tape-item category-cut";
    section.dataset.categoryId = category.id;
    section.setAttribute("aria-label", `Category ${category.name}`);

    const mainRow = document.createElement("div");
    mainRow.className = "category-main-row";

    const copy = document.createElement("div");
    copy.className = "category-copy";
    if (category.group !== category.name) {
      const group = document.createElement("span");
      group.className = "category-group";
      group.textContent = category.group;
      copy.append(group);
    }
    const heading = document.createElement("h2");
    heading.className = "category-name";
    heading.textContent = category.name;
    copy.append(heading);
    if (category.description) {
      const description = document.createElement("p");
      description.className = "category-description";
      description.textContent = category.description;
      copy.append(description);
    }

    const count = document.createElement("span");
    count.className = "category-count";
    count.dataset.categoryCount = category.id;
    updateCategoryCount(count, category);

    mainRow.append(copy, count);

    // ─── heat bar ───
    const heatRow  = document.createElement("div");
    heatRow.className = "category-heat-row";
    const heatFill = document.createElement("div");
    heatFill.className = "category-heat-fill";
    heatFill.dataset.categoryHeat = category.id;
    updateCategoryHeat(heatFill, category);
    heatRow.append(heatFill);

    section.append(mainRow, heatRow);
    return section;
  }

  function heardInCategory(categoryId) {
    let count = 0;
    for (const album of albums) {
      if (album.categoryId === categoryId && heard.has(album.id)) count += 1;
    }
    return count;
  }

  function updateCategoryCount(element, category) {
    const count = heardInCategory(category.id);
    element.textContent = `${count} / ${category.count} heard`;
    element.title = `${count} of ${category.count} albums marked heard in ${category.fullName}`;
    element.setAttribute("aria-label", element.title);
  }

  function updateCategoryHeat(fillEl, category) {
    const count    = heardInCategory(category.id);
    const fraction = category.count ? count / category.count : 0;
    fillEl.style.width = `${Math.round(fraction * 100)}%`;
    fillEl.title = `${Math.round(fraction * 100)}% heard`;
  }

  function updateCategoryCuts() {
    for (const element of rendered.values()) {
      const categoryId = element.dataset.categoryId;
      if (!categoryId) continue;
      const category = categories.find((item) => item.id === categoryId);
      const count    = element.querySelector("[data-category-count]");
      const heatFill = element.querySelector("[data-category-heat]");
      if (category && count) updateCategoryCount(count, category);
      if (category && heatFill) updateCategoryHeat(heatFill, category);
    }
  }

  // ─── Summary / progress ───────────────────────────────────────────────

  function updateSummary() {
    const noted = Object.values(notes).filter((note) => note.trim()).length;
    const details = [
      `${albums.length.toLocaleString()} albums`,
      `${categories.length} cuts`,
      `${heard.size} heard`,
      `${orbits.size} in orbit`,
      `${noted} notes`
    ];
    if (resonanceCount()) details.push(`${resonanceCount()} pulled`);
    if (slips.length)     details.push(`${slips.length} slips`);
    summaryEl.textContent = details.join(" · ");
    detourButton.disabled = albums.length > 0 && heard.size >= albums.length;
    slipButton.disabled   = slips.length === 0;
    updateProgress();
    updateSlipBadge();
  }

  function resonanceCount() {
    return Object.values(resonance).filter((level) => level > 0).length;
  }

  // ─── NEW: Progress track ──────────────────────────────────────────────

  function updateProgress() {
    if (!albums.length || !progressFill || !progressLabel) return;
    const fraction = heard.size / albums.length;
    const pct      = Math.round(fraction * 100);
    progressFill.style.width = `${pct}%`;
    progressLabel.textContent = `${pct}% heard (${heard.size} / ${albums.length})`;
  }

  // ─── NEW: Slip count badge + preview ─────────────────────────────────

  function updateSlipBadge() {
    if (!slipCountEl) return;
    if (slips.length > 0) {
      slipCountEl.textContent = `(${slips.length})`;
      slipCountEl.hidden = false;
    } else {
      slipCountEl.hidden = true;
    }
    // preview tooltip: show what album "Take slip" would land on
    if (slips.length > 0) {
      const valid   = slips.filter((id) => albums.some((album) => album.id === id));
      const unread  = valid.filter((id) => !heard.has(id));
      const previewId = unread[0] || valid[0];
      const previewAlbum = albums.find((a) => a.id === previewId);
      if (previewAlbum) {
        slipButton.dataset.preview = `→ ${previewAlbum.title} — ${previewAlbum.artist}`;
      } else {
        delete slipButton.dataset.preview;
      }
    } else {
      delete slipButton.dataset.preview;
    }
  }

  // ─── Apple Music ─────────────────────────────────────────────────────

  function appleSearchUrl(album) {
    const term = encodeURIComponent(`${album.title} ${album.artist}`);
    return `https://music.apple.com/us/search?term=${term}`;
  }

  // ─── Album element ────────────────────────────────────────────────────

  function makeAlbumElement(item, index) {
    const album = item.album;
    const row   = document.createElement("article");
    row.className = "tape-item album-row";
    row.dataset.albumId = album.id;

    const serial = document.createElement("span");
    serial.className = "serial";
    serial.textContent = String(album.catalogIndex).padStart(4, "0");
    serial.setAttribute("aria-hidden", "true");

    const link = document.createElement("a");
    link.className = "cover-link";
    link.href = appleSearchUrl(album);
    link.setAttribute("aria-label", `Open ${album.title} by ${album.artist} in Apple Music`);
    const cover = document.createElement("span");
    cover.className = "cover-slot";
    cover.dataset.albumId = album.id;
    link.append(cover);

    const copy     = document.createElement("div");
    copy.className = "record-copy";
    const copyLink = document.createElement("a");
    copyLink.className = "record-link";
    copyLink.href = link.href;
    copyLink.setAttribute("aria-label", `Open ${album.title} by ${album.artist} (${album.year}) in Apple Music`);
    const title  = document.createElement("span");
    title.className = "record-title";
    title.textContent = album.title;
    const artist = document.createElement("span");
    artist.className = "record-artist";
    artist.textContent = album.artist;
    copyLink.append(title, artist);

    const tools     = document.createElement("div");
    tools.className = "record-tools";

    // note toggle
    const noteToggle = document.createElement("button");
    noteToggle.className = "note-toggle";
    noteToggle.type  = "button";
    noteToggle.setAttribute("aria-controls", `note-editor-${album.id}`);
    noteToggle.title = "Add a private margin note; a saved note unlocks Echo.";
    noteToggle.setAttribute("aria-label", `${notes[album.id]?.trim() ? "Edit" : "Add"} margin note for ${album.title} by ${album.artist}`);
    noteToggle.setAttribute("aria-expanded", String(expandedNotes.has(album.id)));
    noteToggle.textContent = notes[album.id]?.trim() ? "Note · edit" : "+ note";
    noteToggle.addEventListener("click", () => {
      if (expandedNotes.has(album.id)) expandedNotes.delete(album.id);
      else expandedNotes.add(album.id);
      const isOpen = expandedNotes.has(album.id);
      noteToggle.setAttribute("aria-expanded", String(isOpen));
      const editor = copy.querySelector(".note-editor");
      editor.hidden = !isOpen;
      if (isOpen) {
        editor.querySelector("textarea").focus();
        refreshNoteTokens(album, editor);
      } else if (heardFilterEl.value === "notes" && !notes[album.id]?.trim()) {
        renderList();
        windowEl.focus({ preventScroll: true });
      }
      schedulePersist();
    });
    tools.append(noteToggle);

    // orbit toggle
    const orbitToggle = document.createElement("button");
    orbitToggle.className = "orbit-toggle";
    orbitToggle.type = "button";
    orbitToggle.textContent = "↻";
    updateOrbitButton(orbitToggle, album);
    orbitToggle.addEventListener("click", () => toggleOrbit(album, orbitToggle));
    tools.append(orbitToggle);

    // resonance toggle
    const resonanceToggle = document.createElement("button");
    resonanceToggle.className = "resonance-toggle";
    resonanceToggle.type = "button";
    resonanceToggle.addEventListener("click", () => cycleResonance(album, resonanceToggle));
    updateResonanceButton(resonanceToggle, album);
    tools.append(resonanceToggle);

    // slip toggle
    const slipToggle = document.createElement("button");
    slipToggle.className = "slip-toggle";
    slipToggle.type = "button";
    slipToggle.addEventListener("click", () => toggleSlip(album, slipToggle));
    updateSlipButton(slipToggle, album);
    tools.append(slipToggle);

    // echo button
    const echoButton = document.createElement("button");
    echoButton.className = "echo-toggle";
    echoButton.type = "button";
    echoButton.textContent = "Echo ↗";
    echoButton.hidden = !notes[album.id]?.trim();
    echoButton.title = "Trace a word from this note into an unheard record";
    echoButton.setAttribute("aria-label", `Find an unheard album that echoes your note on ${album.title} by ${album.artist}`);
    echoButton.addEventListener("click", () => findNoteEcho(album));
    tools.append(echoButton);

    // note editor
    const editor = document.createElement("div");
    editor.className = "note-editor";
    editor.id = `note-editor-${album.id}`;
    editor.hidden = !expandedNotes.has(album.id);
    const textarea = document.createElement("textarea");
    textarea.maxLength = 4000;
    textarea.value = notes[album.id] || "";
    textarea.placeholder = "A phrase, memory, or question";
    textarea.setAttribute("aria-label", `Margin note for ${album.title} by ${album.artist}`);
    textarea.addEventListener("input", () => {
      const value = textarea.value.slice(0, 4000);
      if (value.trim()) notes[album.id] = value;
      else delete notes[album.id];
      noteToggle.textContent = notes[album.id]?.trim() ? "Note · edit" : "+ note";
      noteToggle.setAttribute("aria-label", `${notes[album.id]?.trim() ? "Edit" : "Add"} margin note for ${album.title} by ${album.artist}`);
      echoButton.hidden = !notes[album.id]?.trim();
      refreshNoteTokens(album, editor);
      updateSummary();
      schedulePersist();
    });
    textarea.addEventListener("focus", () => {
      refreshNoteTokens(album, editor);
    });
    textarea.addEventListener("blur", () => {
      if (!matches(album)) renderList();
    });
    editor.append(textarea);

    // token ghost wrap (shown when textarea has focus)
    const tokensWrap = document.createElement("div");
    tokensWrap.className = "note-tokens-wrap";
    tokensWrap.hidden = true;
    editor.append(tokensWrap);

    copy.append(copyLink, tools, editor);

    const year = document.createElement("span");
    year.className = "record-year";
    year.textContent = album.year;

    const toggle = document.createElement("button");
    toggle.className = "heard-toggle";
    toggle.type = "button";
    toggle.addEventListener("click", () => {
      triggerHeardStamp(toggle);
      toggleHeard(album);
    });
    const mark = document.createElement("span");
    mark.className = "heard-mark";
    mark.setAttribute("aria-hidden", "true");
    const word = document.createElement("span");
    word.className = "heard-word";
    toggle.append(mark, word);
    updateHeardButton(row, album, toggle);

    row.append(serial, link, copy, year, toggle);
    row.dataset.itemIndex = String(index);

    const cached = artCache[album.id];
    if (cached) applyCache(row, album, cached);
    else {
      // show shimmer while lookup pending
      cover.classList.add("is-loading");
      if (observer) observer.observe(row);
      else requestLookup(album);
    }
    return row;
  }

  // ─── NEW: Note token ghosts ───────────────────────────────────────────

  function noteTokens(value) {
    return [...new Set(
      normalize(value)
        .split(/\s+/)
        .filter((w) => w.length >= 4 && !NOTE_COMMON_WORDS.has(w))
    )].slice(0, 20);
  }

  function refreshNoteTokens(album, editorEl) {
    const wrap = editorEl.querySelector(".note-tokens-wrap");
    if (!wrap) return;
    const raw = notes[album.id] || "";
    const tokens = noteTokens(raw);
    if (!tokens.length) {
      wrap.hidden = true;
      return;
    }
    wrap.hidden = false;
    const label = document.createElement("span");
    label.className = "note-token-label";
    label.textContent = "Echo sees:";
    const list = document.createElement("div");
    list.className = "note-tokens";
    for (const token of tokens) {
      const chip = document.createElement("span");
      chip.className = "note-token";
      chip.textContent = token;
      list.append(chip);
    }
    wrap.replaceChildren(label, list);
  }

  // ─── NEW: Heard stamp animation ───────────────────────────────────────

  function triggerHeardStamp(toggleEl) {
    const markEl = toggleEl.querySelector(".heard-mark");
    if (!markEl) return;
    // remove then re-add class to re-trigger animation
    markEl.classList.remove("stamp-animate");
    void markEl.offsetWidth; // force reflow
    markEl.classList.add("stamp-animate");
    markEl.addEventListener("animationend", () => markEl.classList.remove("stamp-animate"), { once: true });
  }

  // ─── NEW: Session streak ──────────────────────────────────────────────

  function incrementSessionHeard() {
    sessionHeardCount += 1;
    const milestones = [5, 10, 15, 20, 25, 50];
    if (milestones.includes(sessionHeardCount)) {
      window.clearTimeout(streakTimer);
      const prev = positionEl.textContent;
      positionEl.textContent = `${sessionHeardCount} heard this session`;
      positionEl.classList.remove("streak-flash");
      void positionEl.offsetWidth;
      positionEl.classList.add("streak-flash");
      streakTimer = window.setTimeout(() => {
        positionEl.classList.remove("streak-flash");
        updatePosition(lastStart, lastEnd);
      }, 2800);
    }
  }

  // ─── Heard button ─────────────────────────────────────────────────────

  function updateHeardButton(row, album, button = row.querySelector(".heard-toggle")) {
    if (!button) return;
    const isHeard = heard.has(album.id);
    button.setAttribute("aria-pressed", String(isHeard));
    button.setAttribute("aria-label", `${isHeard ? "Mark as not heard" : "Mark as heard"}: ${album.title} by ${album.artist}`);
    const w = button.querySelector(".heard-word");
    if (w) w.textContent = isHeard ? "Heard" : "Unheard";
  }

  function updateAlbumControls(row, album) {
    updateHeardButton(row, album);
    updateOrbitButton(row.querySelector(".orbit-toggle"), album);
    updateResonanceButton(row.querySelector(".resonance-toggle"), album);
    updateSlipButton(row.querySelector(".slip-toggle"), album);
  }

  // ─── Orbit ────────────────────────────────────────────────────────────

  function updateOrbitButton(button, album) {
    if (!button) return;
    const isOrbiting = orbits.has(album.id);
    button.setAttribute("aria-pressed", String(isOrbiting));
    button.setAttribute("aria-label", `${isOrbiting ? "Remove" : "Keep"} ${album.title} by ${album.artist} ${isOrbiting ? "from" : "in"} your orbit`);
    button.title = isOrbiting ? "In orbit · mark to return here" : "Keep in orbit for a return visit";
  }

  function toggleOrbit(album, button) {
    if (orbits.has(album.id)) orbits.delete(album.id);
    else orbits.add(album.id);
    updateOrbitButton(button, album);
    updateSummary();
    if (heardFilterEl.value === "orbit") {
      renderList();
      windowEl.focus({ preventScroll: true });
    }
    persistState();
  }

  // ─── Resonance / pull ─────────────────────────────────────────────────

  function updateResonanceButton(button, album) {
    if (!button) return;
    const level = resonance[album.id] || 0;
    button.dataset.level = String(level);
    button.textContent = level ? `∿${level}` : "∿";
    button.setAttribute("aria-pressed", String(level > 0));
    button.setAttribute("aria-label", level
      ? `Album pull ${level} of 3 for ${album.title} by ${album.artist}; activate to change`
      : `Give ${album.title} by ${album.artist} a pull for future detours`);
    button.title = level ? `Pull ${level} of 3 · activate to cycle` : "Give this record a pull for future detours";
  }

  function cycleResonance(album, button) {
    const level = resonance[album.id] || 0;
    const next  = level >= 3 ? 0 : level + 1;
    if (next) resonance[album.id] = next;
    else delete resonance[album.id];
    updateResonanceButton(button, album);
    updateSummary();
    // ─── NEW: pulse at max ───
    if (next === 3 && button) {
      button.classList.remove("pulse-max");
      void button.offsetWidth;
      button.classList.add("pulse-max");
      button.addEventListener("animationend", () => button.classList.remove("pulse-max"), { once: true });
    }
    if (heardFilterEl.value === "pulled") {
      renderList();
      windowEl.focus({ preventScroll: true });
    }
    routeResult.textContent = next
      ? `Pull ${next} of 3 · future detours will lean toward ${album.title}.`
      : `Pull released · ${album.title} returns to the open field.`;
    persistState();
  }

  // ─── Slip ─────────────────────────────────────────────────────────────

  function updateSlipButton(button, album) {
    if (!button) return;
    const isSlipped = slips.includes(album.id);
    button.textContent = isSlipped ? "slip · held" : "slip";
    button.setAttribute("aria-pressed", String(isSlipped));
    button.setAttribute("aria-label", `${isSlipped ? "Remove" : "Leave"} ${album.title} by ${album.artist} ${isSlipped ? "from" : "on"} your paper slips`);
    button.title = isSlipped ? "Held on a paper slip · activate to remove" : "Leave this record on a paper slip for later";
  }

  function toggleSlip(album, button) {
    const index = slips.indexOf(album.id);
    if (index >= 0) slips.splice(index, 1);
    else slips.push(album.id);
    updateSlipButton(button, album);
    slipButton.disabled = slips.length === 0;
    updateSummary();
    if (heardFilterEl.value === "slip") {
      renderList();
      windowEl.focus({ preventScroll: true });
    }
    routeResult.textContent = index >= 0
      ? `Slip lifted · ${album.title} is back in the open strip.`
      : `Slip left · ${album.title} is waiting in the footer.`;
    persistState();
  }

  // ─── Heard toggle ─────────────────────────────────────────────────────

  function toggleHeard(album) {
    const wasUnheard = !heard.has(album.id);
    if (heard.has(album.id)) heard.delete(album.id);
    else {
      heard.add(album.id);
      incrementSessionHeard();
    }
    const currentIndex = visibleItems.findIndex((item) => item.id === album.id);
    const wasVisible   = currentIndex >= 0;
    const previousTop  = windowEl.scrollTop;

    if (heardFilterEl.value === "all") {
      const row = rendered.get(album.id);
      if (row) updateHeardButton(row, album);
      updateCategoryCuts();
      updateSummary();
      updateProgress();
      applyWearClasses();
      queueRender();
      persistState();
      return;
    }

    renderList();
    if (wasVisible) {
      windowEl.scrollTop = previousTop;
      queueRender();
      const next = visibleItems.slice(currentIndex).find((item) => item.type === "album");
      if (next) {
        const nextIndex = itemIndexById.get(next.id);
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (!rendered.has(next.id)) {
            windowEl.scrollTop = offsets[nextIndex];
            queueRender();
          }
          requestAnimationFrame(() => rendered.get(next.id)?.querySelector(".heard-toggle")?.focus({ preventScroll: true }));
        }));
      } else {
        windowEl.focus({ preventScroll: true });
      }
    }
    updateCategoryCuts();
    updateSummary();
    updateProgress();
    persistState();
  }

  // ─── Art / JSONP ─────────────────────────────────────────────────────

  function requestLookup(album, force = false) {
    const cached = artCache[album.id];
    if (!force && cached) {
      const row = rendered.get(album.id);
      if (row) {
        applyCache(row, album, cached);
        // remove shimmer
        row.querySelector(".cover-slot")?.classList.remove("is-loading");
      }
      return;
    }
    if (attempted.has(album.id)) return;
    attempted.add(album.id);
    lookupQueue.push({ album, force });
    pumpLookups();
  }

  function pumpLookups() {
    while (lookupQueue.length && artCache[lookupQueue[0].album.id]) {
      const { album } = lookupQueue.shift();
      const row = rendered.get(album.id);
      if (row) {
        applyCache(row, album, artCache[album.id]);
        row.querySelector(".cover-slot")?.classList.remove("is-loading");
      }
    }
    if (activeLookups >= 3 || !lookupQueue.length || lookupTimer) return;
    const wait = Math.max(0, 3000 - (Date.now() - lastLookupStarted));
    lookupTimer = window.setTimeout(() => {
      lookupTimer = 0;
      const task = lookupQueue.shift();
      if (!task) return;
      if (artCache[task.album.id]) {
        const row = rendered.get(task.album.id);
        if (row) {
          applyCache(row, task.album, artCache[task.album.id]);
          row.querySelector(".cover-slot")?.classList.remove("is-loading");
        }
        pumpLookups();
        return;
      }
      activeLookups += 1;
      lastLookupStarted = Date.now();
      lookupAlbum(task.album).finally(() => {
        activeLookups -= 1;
        pumpLookups();
      });
      pumpLookups();
    }, wait);
  }

  async function lookupAlbum(album) {
    const query    = `${album.title} ${album.artist}`;
    const endpoint = new URL("https://itunes.apple.com/search");
    endpoint.searchParams.set("term",   query);
    endpoint.searchParams.set("entity", "album");
    endpoint.searchParams.set("limit",  "50");
    endpoint.searchParams.set("country","us");
    endpoint.searchParams.set("media",  "music");
    try {
      const payload = await appleJsonp(endpoint, 14000);
      const result  = chooseResult(album, Array.isArray(payload.results) ? payload.results : []);
      const value   = result
        ? { state: "found", artwork: result.artworkUrl100 || "", url: safeAppleUrl(result.collectionViewUrl), at: Date.now() }
        : { state: "missing", at: Date.now() };
      artCache[album.id] = value;
      persistArtCache();
      statusError = "";
      const row = rendered.get(album.id);
      if (row) {
        applyCache(row, album, value);
        row.querySelector(".cover-slot")?.classList.remove("is-loading");
      }
    } catch (error) {
      const value = { state: "error", message: error instanceof Error ? error.message : "Lookup failed", at: Date.now() };
      artCache[album.id] = value;
      const row = rendered.get(album.id);
      if (row) {
        applyCache(row, album, value);
        row.querySelector(".cover-slot")?.classList.remove("is-loading");
      }
      statusError = "Apple artwork lookup failed; use Retry on an album or keep browsing.";
    } finally {
      updateFooter();
    }
  }

  function appleJsonp(endpoint, timeoutMs) {
    return new Promise((resolve, reject) => {
      const callbackName = `__albumApple_${Date.now().toString(36)}_${++jsonpSequence}`;
      const script = document.createElement("script");
      let settled  = false;
      const timer  = window.setTimeout(() => finish(new Error("Apple artwork lookup timed out.")), timeoutMs);
      const cleanup = () => {
        window.clearTimeout(timer);
        script.remove();
        try { delete window[callbackName]; }
        catch { window[callbackName] = undefined; }
      };
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) reject(error);
        else resolve(value);
      };
      window[callbackName] = (value) => finish(null, value);
      script.async = true;
      script.referrerPolicy = "strict-origin";
      script.onerror = () => finish(new Error("Apple artwork lookup could not be reached."));
      endpoint.searchParams.set("callback", callbackName);
      script.src = endpoint.href;
      document.head.append(script);
    });
  }

  function safeAppleUrl(value) {
    try {
      const url = new URL(value);
      if (url.protocol === "https:" && (url.hostname === "music.apple.com" || url.hostname === "itunes.apple.com")) return url.href;
    } catch {}
    return "";
  }

  function chooseResult(album, results) {
    const wantedTitle  = normalize(album.title);
    const wantedArtist = normalize(album.artist);
    let best = null, bestScore = -1;
    for (const result of results) {
      if (!result.collectionName || !result.artistName || !safeAppleUrl(result.collectionViewUrl)) continue;
      const title  = normalize(result.collectionName);
      const artist = normalize(result.artistName);
      const titleScore  = title  === wantedTitle  ? 1 : title.includes(wantedTitle)   || wantedTitle.includes(title)   ? .88 : wordSimilarity(wantedTitle, title);
      const artistScore = artist === wantedArtist ? 1 : artist.includes(wantedArtist) || wantedArtist.includes(artist) ? .9  : wordSimilarity(wantedArtist, artist);
      const score = titleScore * .72 + artistScore * .28;
      if (score > bestScore) { best = result; bestScore = score; }
    }
    if (bestScore < .82 || bestScore < .72 + .28 * .45) return null;
    return best;
  }

  function wordSimilarity(first, second) {
    const a = new Set(first.split(" ").filter(Boolean));
    const b = new Set(second.split(" ").filter(Boolean));
    if (!a.size || !b.size) return 0;
    let common = 0;
    for (const word of a) if (b.has(word)) common += 1;
    return common / (a.size + b.size - common);
  }

  function applyCache(row, album, cached) {
    if (!row || !cached) return;
    const cover = row.querySelector(".cover-slot");
    const links = row.querySelectorAll(".cover-link, .record-link");
    if (cached.state === "found") {
      if (cached.url) for (const link of links) link.href = cached.url;
      if (cached.artwork && cover && !cover.querySelector("img")) {
        const image = document.createElement("img");
        image.alt      = "";
        image.loading  = "lazy";
        image.decoding = "async";
        image.src = cached.artwork;
        image.addEventListener("error", () => {
          image.remove();
          cached.state = "missing";
          delete cached.artwork;
          persistArtCache();
          if (rendered.get(album.id) === row) showCoverNote(cover, "Art unavailable");
          updateFooter();
        }, { once: true });
        image.addEventListener("load", () => {
          cover.classList.remove("is-loading");
          const note = cover.querySelector(".cover-note");
          if (note) note.remove();
        }, { once: true });
        cover.replaceChildren(image);
      } else if (!cached.artwork) {
        cover.classList.remove("is-loading");
        showCoverNote(cover, "No artwork");
      }
    } else if (cached.state === "missing") {
      cover.classList.remove("is-loading");
      showCoverNote(cover, "No match");
    } else if (cached.state === "error") {
      if (!cover) return;
      cover.classList.remove("is-loading");
      const retry = document.createElement("button");
      retry.className = "cover-note retry-lookup";
      retry.type = "button";
      retry.textContent = "Retry";
      retry.setAttribute("aria-label", `Retry Apple lookup for ${album.title} by ${album.artist}`);
      retry.addEventListener("click", () => {
        delete artCache[album.id];
        attempted.delete(album.id);
        cover.replaceChildren();
        cover.classList.add("is-loading");
        requestLookup(album, true);
      }, { once: true });
      cover.replaceChildren(retry);
    }
  }

  function showCoverNote(cover, text) {
    if (!cover || cover.querySelector("img")) return;
    const note = document.createElement("span");
    note.className = "cover-note";
    note.textContent = text;
    cover.replaceChildren(note);
  }

  // ─── Position / footer ────────────────────────────────────────────────

  function updatePosition(start, end) {
    // don't overwrite streak flash
    if (streakTimer) return;
    if (!visibleItems.length) {
      positionEl.textContent = "No albums in this cut";
      return;
    }
    let current = null;
    for (let index = start; index < end; index += 1) {
      if (visibleItems[index].type === "album") {
        current = visibleItems[index].album;
        break;
      }
    }
    const heardCount = heard.size;
    const linger     = current ? formatAttention(attention[current.id] || 0) : "0s";
    positionEl.textContent = current
      ? `${String(current.catalogIndex).padStart(4, "0")} / ${albums.length.toLocaleString()} · ${heardCount} heard · ${filteredCount.toLocaleString()} in cut · ${linger} linger`
      : `${heardCount} heard · ${filteredCount.toLocaleString()} in cut`;
  }

  function formatAttention(seconds) {
    const value = Math.max(0, Math.floor(seconds));
    if (value < 60) return `${value}s`;
    return `${Math.floor(value / 60)}m ${value % 60}s`;
  }

  function updateFooter() {
    const errors  = Object.values(artCache).filter((item) => item?.state === "error").length;
    const missing = Object.values(artCache).filter((item) => item?.state === "missing").length;
    const details = [];
    if (errors)  details.push(`${errors} Apple lookup failure${errors === 1 ? "" : "s"}; retry on a record`);
    if (missing) details.push(`${missing} without a match`);
    if (statusError)  details.push(statusError);
    if (storageError) details.push("Listening marks could not be saved in this browser.");
    connectionEl.textContent = details.join(" · ");
    connectionEl.classList.toggle("error", Boolean(statusError || storageError || errors));
  }

  // ─── Attention / current place ────────────────────────────────────────

  function currentPlaceId() {
    if (!visibleItems.length) return state.placeId || "";
    const index = lowerBound(windowEl.scrollTop + 8);
    for (let cursor = index; cursor < visibleItems.length; cursor += 1) {
      if (visibleItems[cursor].type === "album") return visibleItems[cursor].id;
    }
    return visibleItems.find((item) => item.type === "album")?.id || "";
  }

  function accrueAttention() {
    if (!albums.length || !visibleItems.length || document.visibilityState !== "visible") {
      lastAttentionAt = Date.now();
      return;
    }
    const now     = Date.now();
    const elapsed = Math.min(5, Math.max(0, (now - lastAttentionAt) / 1000));
    if (currentAttentionId && elapsed > 0) {
      attention[currentAttentionId] = Math.min(3600, (attention[currentAttentionId] || 0) + elapsed);
      if (now - lastAttentionPersist > 15000) {
        lastAttentionPersist = now;
        persistState(currentAttentionId);
      }
    }
    const visibleId = currentPlaceId();
    if (visibleId) currentAttentionId = visibleId;
    lastAttentionAt = now;
    markCurrentRow(currentAttentionId);
    applyWearClasses();
  }

  function markCurrentRow(id = currentPlaceId()) {
    for (const element of rendered.values()) {
      if (!element.classList.contains("album-row")) continue;
      const active = element.dataset.albumId === id;
      element.classList.toggle("is-current", active);
      element.setAttribute("aria-current", active ? "true" : "false");
    }
  }

  // ─── NEW: Idle drift ──────────────────────────────────────────────────

  function scheduleIdleDrift() {
    window.clearTimeout(idleTimer);
    stopDrift();
    idleTimer = window.setTimeout(startDrift, IDLE_DELAY);
  }

  function startDrift() {
    if (isDrifting || !albums.length) return;
    isDrifting = true;
    windowEl.classList.add("is-drifting");
    animateDrift();
  }

  function animateDrift() {
    if (!isDrifting) return;
    // stop at bottom; wrap back to top of next unheard section
    const maxScroll = tapeEl.scrollHeight - windowEl.clientHeight;
    if (windowEl.scrollTop >= maxScroll) {
      // silently jump to first unheard album
      const firstUnheard = albums.find((a) => !heard.has(a.id));
      if (firstUnheard) {
        const idx = itemIndexById.get(firstUnheard.id);
        if (idx !== undefined) windowEl.scrollTop = offsets[idx];
      }
    } else {
      windowEl.scrollTop += DRIFT_SPEED;
    }
    accrueAttention();
    queueRender();
    driftFrame = requestAnimationFrame(animateDrift);
  }

  function stopDrift() {
    if (!isDrifting) return;
    isDrifting = false;
    windowEl.classList.remove("is-drifting");
    cancelAnimationFrame(driftFrame);
    driftFrame = 0;
  }

  function resetIdle() {
    stopDrift();
    scheduleIdleDrift();
  }

  // ─── NEW: Scan momentum ───────────────────────────────────────────────

  function handleScrollVelocity() {
    const now    = Date.now();
    const dy     = Math.abs(windowEl.scrollTop - lastScrollY);
    const dt     = now - lastScrollTime || 1;
    const vel    = dy / dt;  // px/ms
    lastScrollY    = windowEl.scrollTop;
    lastScrollTime = now;

    window.clearTimeout(scrollVelTimer);

    if (vel > 3.5) {
      if (!isScanning) {
        isScanning = true;
        windowEl.classList.add("is-scanning");
      }
      scrollVelTimer = window.setTimeout(() => {
        isScanning = false;
        windowEl.classList.remove("is-scanning");
      }, 280);
    }
  }

  // ─── Navigation ───────────────────────────────────────────────────────

  function takeSlip() {
    if (!slips.length) {
      routeResult.textContent = "No paper slips are waiting. Leave one beside a record first.";
      return;
    }
    const valid = slips.filter((id) => albums.some((album) => album.id === id));
    if (!valid.length) {
      slips = [];
      updateSummary();
      persistState();
      routeResult.textContent = "The paper slips were empty and have been cleared.";
      return;
    }
    const current  = albums.find((album) => album.id === currentPlaceId());
    const unread   = valid.filter((id) => !heard.has(id));
    const chosenId = unread[0] || valid[0];
    const album    = albums.find((item) => item.id === chosenId);
    slips = [...valid.filter((id) => id !== chosenId), chosenId];
    updateSummary();
    jumpToAlbum(album, `Slip · ${album.title} is back in your hand${current ? ` from after ${current.title}` : ""}.`);
  }

  function jumpToAlbum(album, message) {
    if (!album) return;
    searchEl.value      = "";
    categoryEl.value    = "all";
    heardFilterEl.value = "all";
    renderList();
    const index = itemIndexById.get(album.id);
    if (index !== undefined) windowEl.scrollTop = offsets[index];
    queueRender();
    routeResult.textContent = message;
    persistState(album.id);
    resetIdle();
  }

  function continueToNextUnheard() {
    if (!albums.length) return;
    const currentId    = currentPlaceId();
    const currentIndex = albums.findIndex((album) => album.id === currentId);
    for (let distance = 1; distance <= albums.length; distance += 1) {
      const album = albums[(currentIndex + distance + albums.length) % albums.length];
      if (!heard.has(album.id)) {
        jumpToAlbum(album, `Next unheard · ${String(album.catalogIndex).padStart(4, "0")} / ${albums.length}`);
        return;
      }
    }
    routeResult.textContent = "Every album is marked heard. You made it through the whole strip.";
  }

  function chooseDetourAlbum(excludedIds = []) {
    const excluded = new Set(excludedIds);
    const options  = categories.map((category) => {
      const entries   = albums.filter((album) => album.categoryId === category.id);
      const completed = entries.filter((album) => heard.has(album.id)).length;
      return { category, entries, completed, fraction: entries.length ? completed / entries.length : 1 };
    }).filter((item) => item.completed < item.entries.length);
    if (!options.length) return null;

    const lowest     = Math.min(...options.map((item) => item.fraction));
    let candidates   = options
      .filter((item) => item.fraction <= lowest + 0.06)
      .flatMap((item) => item.entries
        .filter((album) => !heard.has(album.id) && !excluded.has(album.id))
        .map((album) => ({ album, category: item.category, fraction: item.fraction })));
    if (!candidates.length) return null;

    const freshCut = candidates.filter((item) => item.category.id !== lastDetourCategory);
    if (freshCut.length) candidates = freshCut;
    const unseenRecently = candidates.filter((item) => !detourHistory.includes(item.album.id));
    if (unseenRecently.length) candidates = unseenRecently;
    const current = albums.find((album) => album.id === currentPlaceId());
    if (current) {
      const differentArtist = candidates.filter((item) => normalize(item.album.artist) !== normalize(current.artist));
      if (differentArtist.length) candidates = differentArtist;
    }
    return weightedChoice(candidates, (item) => {
      const albumPull    = resonance[item.album.id] || 0;
      const categoryPull = categoryResonance(item.category.id);
      const lingerPull   = Math.min(3, (attention[item.album.id] || 0) / 30);
      return 1 + albumPull * 3 + categoryPull + lingerPull;
    });
  }

  function categoryResonance(categoryId) {
    const category = categories.find((item) => item.id === categoryId);
    if (!category || !category.count) return 0;
    const total = albums
      .filter((album) => album.categoryId === categoryId)
      .reduce((sum, album) => sum + (resonance[album.id] || 0), 0);
    return Math.min(3, total / category.count);
  }

  function weightedChoice(items, weightFor) {
    if (!items.length) return null;
    const weights = items.map((item) => Math.max(0.01, weightFor(item)));
    const total   = weights.reduce((sum, weight) => sum + weight, 0);
    let cursor    = Math.random() * total;
    for (let index = 0; index < items.length; index += 1) {
      cursor -= weights[index];
      if (cursor <= 0) return items[index];
    }
    return items[items.length - 1];
  }

  function rememberRoute(choice) {
    lastDetourCategory = choice.category.id;
    detourHistory = [...detourHistory.filter((id) => id !== choice.album.id), choice.album.id].slice(-6);
  }

  function makeDetour() {
    const choice = chooseDetourAlbum();
    if (!choice) {
      routeResult.textContent = "Every album is marked heard. No detour left to find.";
      return;
    }
    rememberRoute(choice);
    const percent = Math.round(choice.fraction * 100);
    jumpToAlbum(choice.album, `Detour · ${choice.category.name} is among your least-heard cuts (${percent}% heard).`);
  }

  // ─── Echo ─────────────────────────────────────────────────────────────

  function noteTokensSet(value) {
    return new Set(normalize(value).split(/\s+/).filter((word) => word.length >= 4 && !NOTE_COMMON_WORDS.has(word)));
  }

  function findNoteEcho(sourceAlbum) {
    const note  = notes[sourceAlbum.id] || "";
    const words = noteTokensSet(note);
    if (!words.size) {
      routeResult.textContent = "Echo needs a specific word in the note to trace into the catalog.";
      return;
    }

    const candidates = [];
    for (const album of albums) {
      if (album.id === sourceAlbum.id || heard.has(album.id)) continue;
      const category = categories.find((item) => item.id === album.categoryId);
      if (!category) continue;
      const fields = [
        { name: "title or artist",  weight: 3, words: noteTokensSet(`${album.title} ${album.artist}`) },
        { name: `${category.name} cut`, weight: 2, words: noteTokensSet(`${category.group} ${category.name}`) },
        { name: "cut description",  weight: 1, words: noteTokensSet(category.description) }
      ];
      let score = 0;
      const matchList = [];
      for (const word of words) {
        const field = fields.find((item) => item.words.has(word));
        if (field) { score += field.weight; matchList.push({ word, field: field.name, weight: field.weight }); }
      }
      if (score) candidates.push({ album, category, score, matches: matchList });
    }

    if (!candidates.length) {
      const sideCut = chooseDetourAlbum([sourceAlbum.id]);
      if (!sideCut) {
        routeResult.textContent = "Echo found no shared catalog words, and every other album is heard.";
        return;
      }
      rememberRoute(sideCut);
      jumpToAlbum(sideCut.album, `Echo · no shared catalog word surfaced, so this opens a least-heard side cut: ${sideCut.category.name}.`);
      return;
    }

    const bestScore = Math.max(...candidates.map((item) => item.score));
    let shortlist   = candidates.filter((item) => item.score === bestScore);
    const otherArtist = shortlist.filter((item) => normalize(item.album.artist) !== normalize(sourceAlbum.artist));
    if (otherArtist.length) shortlist = otherArtist;
    const otherCut = shortlist.filter((item) => item.category.id !== sourceAlbum.categoryId);
    if (otherCut.length) shortlist = otherCut;
    const notRecent = shortlist.filter((item) => !detourHistory.includes(item.album.id));
    if (notRecent.length) shortlist = notRecent;
    const choice   = weightedChoice(shortlist, (item) => 1 + (resonance[item.album.id] || 0) * 2);
    rememberRoute(choice);
    const strongest = choice.matches.sort((a, b) => b.weight - a.weight)[0];
    jumpToAlbum(choice.album, `Echo · "${strongest.word}" from your note on ${sourceAlbum.title} also lives in this record's ${strongest.field}.`);
  }

  // ─── Export / Import ──────────────────────────────────────────────────

  function exportRecord() {
    const backup = {
      schema: 1,
      exportedAt: new Date().toISOString(),
      heard: [...heard],
      notes,
      orbits: [...orbits],
      slips,
      attention,
      resonance,
      detourHistory,
      lastDetourCategory
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href     = url;
    link.download = `sonicfield-listening-record-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    routeResult.textContent = "Listening record exported to a file on this device.";
  }

  async function importRecord(file) {
    if (!file) return;
    try {
      if (file.size > 32 * 1024 * 1024) throw new Error("Listening record files must be smaller than 32 MB.");
      const backup = JSON.parse(await file.text());
      if (!backup || backup.schema !== 1 || !Array.isArray(backup.heard)
        || !backup.notes || typeof backup.notes !== "object" || Array.isArray(backup.notes)
        || (backup.orbits !== undefined && !Array.isArray(backup.orbits))
        || (backup.slips  !== undefined && !Array.isArray(backup.slips))
        || (backup.attention !== undefined && (typeof backup.attention !== "object" || Array.isArray(backup.attention)))
        || (backup.resonance !== undefined && (typeof backup.resonance !== "object" || Array.isArray(backup.resonance)))) {
        throw new Error("That file is not a Sonicfield listening record.");
      }
      const validIds = new Set(albums.map((album) => album.id));
      let heardMerged = 0;
      for (const id of backup.heard) {
        if (typeof id === "string" && validIds.has(id) && !heard.has(id)) {
          heard.add(id);
          heardMerged += 1;
        }
      }
      let orbitsMerged = 0;
      for (const id of Array.isArray(backup.orbits) ? backup.orbits : []) {
        if (typeof id === "string" && validIds.has(id) && !orbits.has(id)) {
          orbits.add(id);
          orbitsMerged += 1;
        }
      }
      let slipsMerged = 0;
      for (const id of Array.isArray(backup.slips) ? backup.slips : []) {
        if (typeof id === "string" && validIds.has(id) && !slips.includes(id)) {
          slips.push(id);
          slipsMerged += 1;
        }
      }
      for (const [id, seconds] of Object.entries(backup.attention || {})) {
        if (!validIds.has(id) || !Number.isFinite(seconds) || seconds <= 0) continue;
        attention[id] = Math.min(3600, Math.max(attention[id] || 0, seconds));
      }
      let pullsMerged = 0;
      for (const [id, level] of Object.entries(backup.resonance || {})) {
        if (!validIds.has(id) || !Number.isFinite(level) || level <= 0) continue;
        const incoming = Math.min(3, Math.max(1, Math.round(level)));
        if (incoming > (resonance[id] || 0)) { resonance[id] = incoming; pullsMerged += 1; }
      }
      let notesMerged = 0;
      for (const [id, note] of Object.entries(backup.notes)) {
        if (!validIds.has(id) || typeof note !== "string" || !note.trim()) continue;
        const incoming = note.slice(0, 4000);
        if (!notes[id]) {
          notes[id] = incoming;
          notesMerged += 1;
        } else if (notes[id] !== incoming && !notes[id].includes(incoming)) {
          notes[id] = `${notes[id]}\n\n[Imported note]\n${incoming}`.slice(0, 4000);
          notesMerged += 1;
        }
      }
      if (Array.isArray(backup.detourHistory)) {
        detourHistory = [...new Set([...detourHistory, ...backup.detourHistory.filter((id) => typeof id === "string" && validIds.has(id))])].slice(-6);
      }
      if (categories.some((category) => category.id === backup.lastDetourCategory))
        lastDetourCategory = backup.lastDetourCategory;
      updateSummary();
      renderList();
      persistState();
      routeResult.textContent = `Merged ${heardMerged} heard mark${heardMerged === 1 ? "" : "s"}, ${orbitsMerged} orbit mark${orbitsMerged === 1 ? "" : "s"}, ${pullsMerged} pull${pullsMerged === 1 ? "" : "s"}, ${slipsMerged} slip${slipsMerged === 1 ? "" : "s"}, and ${notesMerged} note${notesMerged === 1 ? "" : "s"}.`;
    } catch (error) {
      routeResult.textContent = error instanceof Error ? error.message : "Could not read that listening record.";
    } finally {
      importFileEl.value = "";
    }
  }

  // ─── Restore ─────────────────────────────────────────────────────────

  function restorePlace() {
    if (!state.placeId) return;
    const index = itemIndexById.get(state.placeId);
    if (index !== undefined) windowEl.scrollTop = offsets[index];
    else if (Number.isFinite(state.scrollTop)) windowEl.scrollTop = Math.max(0, state.scrollTop);
    queueRender();
  }

  function handleFile(file) {
    if (!file) return;
    file.text().then(initialize).catch(() => {
      positionEl.textContent = "The selected file could not be read.";
    });
  }

  // ─── Keyboard tab traversal ───────────────────────────────────────────

  function adjacentAlbum(index, direction) {
    for (let cursor = index + direction; cursor >= 0 && cursor < visibleItems.length; cursor += direction) {
      if (visibleItems[cursor].type === "album") return { item: visibleItems[cursor], index: cursor };
    }
    return null;
  }

  windowEl.addEventListener("keydown", (event) => {
    if (event.key !== "Tab" || !albums.length) return;
    const activeRow = document.activeElement.closest?.(".album-row");
    if (!activeRow) return;
    const currentIndex = Number(activeRow.dataset.itemIndex);
    if (!Number.isInteger(currentIndex)) return;
    if (!event.shiftKey && document.activeElement.classList.contains("heard-toggle")) {
      const next = adjacentAlbum(currentIndex, 1);
      if (next && !rendered.has(next.item.id)) {
        event.preventDefault();
        windowEl.scrollTop = offsets[next.index];
        queueRender();
        requestAnimationFrame(() => requestAnimationFrame(() => rendered.get(next.item.id)?.querySelector(".cover-link")?.focus({ preventScroll: true })));
      }
    } else if (event.shiftKey && document.activeElement.classList.contains("cover-link")) {
      const previous = adjacentAlbum(currentIndex, -1);
      if (previous && !rendered.has(previous.item.id)) {
        event.preventDefault();
        windowEl.scrollTop = offsets[previous.index];
        queueRender();
        requestAnimationFrame(() => requestAnimationFrame(() => rendered.get(previous.item.id)?.querySelector(".heard-toggle")?.focus({ preventScroll: true })));
      }
    }
  });

  // ─── Event wiring ─────────────────────────────────────────────────────

  searchEl.addEventListener("input", () => {
    windowEl.scrollTop = 0;
    renderList();
    schedulePersist();
    resetIdle();
  });
  categoryEl.addEventListener("change", () => {
    windowEl.scrollTop = 0;
    renderList();
    schedulePersist();
    resetIdle();
  });
  heardFilterEl.addEventListener("change", () => {
    windowEl.scrollTop = 0;
    renderList();
    schedulePersist();
    resetIdle();
  });
  windowEl.addEventListener("scroll", () => {
    handleScrollVelocity();
    accrueAttention();
    queueRender();
    schedulePersist();
    resetIdle();
  }, { passive: true });
  window.addEventListener("resize", () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => renderList(), 100);
    resetIdle();
  });
  window.addEventListener("pagehide", () => { if (albums.length) persistState(); });
  document.addEventListener("visibilitychange", () => {
    if (albums.length && document.visibilityState === "hidden") persistState();
    if (document.visibilityState === "visible") resetIdle();
  });
  // reset idle on any user interaction
  ["pointerdown","keydown","touchstart"].forEach((ev) => {
    window.addEventListener(ev, () => { if (albums.length) resetIdle(); }, { passive: true });
  });

  fileEl.addEventListener("change", () => handleFile(fileEl.files?.[0]));
  continueButton.addEventListener("click", () => { continueToNextUnheard(); resetIdle(); });
  detourButton.addEventListener("click", ()   => { makeDetour(); resetIdle(); });
  slipButton.addEventListener("click", ()     => { takeSlip(); resetIdle(); });
  exportButton.addEventListener("click", exportRecord);
  importFileEl.addEventListener("change", () => importRecord(importFileEl.files?.[0]));

  // ─── Alt-key shortcuts ────────────────────────────────────────────────

  windowEl.addEventListener("keydown", (event) => {
    if (!albums.length || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.target.matches?.("input, textarea, select, button, a")) return;
    const row   = event.target.closest?.(".album-row") || document.activeElement.closest?.(".album-row");
    const album = row ? albums.find((item) => item.id === row.dataset.albumId) : null;
    const key   = event.key.toLowerCase();

    if (key === "n") {
      event.preventDefault();
      continueToNextUnheard();
    } else if (key === "d") {
      event.preventDefault();
      makeDetour();
    } else if (key === "r") {
      event.preventDefault();
      takeSlip();
    } else if (album && key === "s") {
      event.preventDefault();
      toggleSlip(album, row.querySelector(".slip-toggle"));
    } else if (album && key === "o") {
      event.preventDefault();
      toggleOrbit(album, row.querySelector(".orbit-toggle"));
    } else if (album && key === "p") {
      event.preventDefault();
      cycleResonance(album, row.querySelector(".resonance-toggle"));
    } else if (album && key === "e" && notes[album.id]?.trim()) {
      event.preventDefault();
      findNoteEcho(album);
    } else if (album && key === "h") {
      // NEW: Alt+H = mark heard + jump to next unheard (compound action)
      event.preventDefault();
      if (!heard.has(album.id)) {
        const toggleEl = row.querySelector(".heard-toggle");
        if (toggleEl) triggerHeardStamp(toggleEl);
        toggleHeard(album);
      }
      continueToNextUnheard();
    }
  });

  // NEW: Alt+/ focuses search from anywhere
  document.addEventListener("keydown", (event) => {
    if (!albums.length) return;
    if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.key === "/") {
      event.preventDefault();
      searchEl.focus();
      searchEl.select();
      resetIdle();
    }
  });

  // ─── Timers ───────────────────────────────────────────────────────────

  attentionTimer = window.setInterval(accrueAttention, 1000);
  window.addEventListener("pagehide", () => {
    window.clearInterval(attentionTimer);
    window.clearTimeout(idleTimer);
    cancelAnimationFrame(driftFrame);
  }, { once: true });

  // ─── Boot ─────────────────────────────────────────────────────────────

  loadSource();
})();
