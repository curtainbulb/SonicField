(function () {
  "use strict";

  const source = window.SONICFIELD_DATA;
  if (!source || !Array.isArray(source.albums) || !Array.isArray(source.categories)) {
    document.body.innerHTML = "<main style=\"padding:2rem;font-family:monospace\">The register source could not be loaded.</main>";
    return;
  }

  const STORAGE_KEY = "sonicfield-null-choir-v1";
  const CATEGORY_HEIGHT = 86;
  const ALBUM_HEIGHT = 72;
  const OVERSCAN = 5;

  const els = {
    categoryList: document.querySelector("#category-list"),
    roomTotal: document.querySelector("#room-total"),
    signalStatus: document.querySelector("#signal-status"),
    searchForm: document.querySelector("#search-form"),
    searchInput: document.querySelector("#search-input"),
    unheardToggle: document.querySelector("#unheard-toggle"),
    resultReadout: document.querySelector("#result-readout"),
    viewLabel: document.querySelector("#view-label"),
    viewPosition: document.querySelector("#view-position"),
    viewport: document.querySelector("#procession-viewport"),
    canvas: document.querySelector("#procession-canvas"),
    layer: document.querySelector("#procession-layer"),
    emptyRegister: document.querySelector("#empty-register"),
    resetView: document.querySelector("#reset-view"),
    currentRecord: document.querySelector("#current-record"),
    markSelected: document.querySelector("#mark-selected"),
    markSelectedLabel: document.querySelector("#mark-selected-label"),
    jumpSelected: document.querySelector("#jump-selected"),
    heardCount: document.querySelector("#heard-count"),
    remainingCount: document.querySelector("#remaining-count"),
    completionCount: document.querySelector("#completion-count"),
    drawButton: document.querySelector("#draw-button"),
    drawCaption: document.querySelector("#draw-caption"),
    clearProgress: document.querySelector("#clear-progress"),
    dialog: document.querySelector("#confirm-dialog"),
    confirmClear: document.querySelector("#confirm-clear"),
    toast: document.querySelector("#toast")
  };

  const albumById = new Map(source.albums.map((album) => [album.id, album]));
  const categoryById = new Map(source.categories.map((category) => [category.id, category]));
  const categoryIndex = new Map(source.categories.map((category, index) => [category.id, index]));
  const saved = readStorage();
  const sourceHeardIds = source.albums.filter((album) => album.heard).map((album) => album.id);
  const savedHeardIds = Array.isArray(saved.heardIds) ? saved.heardIds.filter((id) => albumById.has(id)) : [];

  const state = {
    query: saved.query || "",
    categoryId: saved.categoryId && (saved.categoryId === "all" || categoryById.has(saved.categoryId)) ? saved.categoryId : "all",
    unheardOnly: Boolean(saved.unheardOnly),
    heardIds: new Set([...sourceHeardIds, ...savedHeardIds]),
    selectedId: saved.selectedId && albumById.has(saved.selectedId) ? saved.selectedId : null,
    scrollTop: Number.isFinite(saved.scrollTop) ? saved.scrollTop : 0,
    units: [],
    offsets: [],
    totalHeight: 0,
    raf: 0,
    persistRaf: 0,
    toastTimer: 0
  };

  function readStorage() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    } catch (_) {
      return {};
    }
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        query: state.query,
        categoryId: state.categoryId,
        unheardOnly: state.unheardOnly,
        heardIds: Array.from(state.heardIds),
        selectedId: state.selectedId,
        scrollTop: state.scrollTop
      }));
    } catch (_) {
      // Private browsing or a disabled storage policy should not break the register.
    }
  }

  function queuePersist() {
    if (state.persistRaf) return;
    state.persistRaf = requestAnimationFrame(() => {
      state.persistRaf = 0;
      persist();
    });
  }

  function formatCount(value) {
    return new Intl.NumberFormat("en-US").format(value);
  }

  function normalize(value) {
    return String(value || "").toLocaleLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  }

  function matches(album, query) {
    if (!query) return true;
    const category = categoryById.get(album.categoryId);
    const haystack = normalize([
      album.title,
      album.artist,
      album.year,
      category && category.name,
      category && category.group,
      category && category.description
    ].join(" "));
    return haystack.includes(normalize(query));
  }

  function getFilteredAlbums() {
    return source.albums.filter((album) => {
      if (state.categoryId !== "all" && album.categoryId !== state.categoryId) return false;
      if (state.unheardOnly && state.heardIds.has(album.id)) return false;
      return matches(album, state.query);
    });
  }

  function buildUnits(filteredAlbums) {
    const groups = new Map();
    filteredAlbums.forEach((album) => {
      if (!groups.has(album.categoryId)) groups.set(album.categoryId, []);
      groups.get(album.categoryId).push(album);
    });

    const units = [];
    source.categories.forEach((category) => {
      const albums = groups.get(category.id);
      if (!albums || !albums.length) return;
      units.push({ type: "category", category, count: albums.length });
      albums.forEach((album) => units.push({ type: "album", album }));
    });
    return units;
  }

  function rebuildLayout() {
    const filteredAlbums = getFilteredAlbums();
    state.units = buildUnits(filteredAlbums);
    state.offsets = [];
    let offset = 0;
    state.units.forEach((unit) => {
      state.offsets.push(offset);
      offset += unit.type === "category" ? CATEGORY_HEIGHT : ALBUM_HEIGHT;
    });
    state.totalHeight = offset;
    els.canvas.style.height = `${Math.max(offset, 1)}px`;
    els.emptyRegister.hidden = state.units.length > 0;
    els.resultReadout.textContent = `${formatCount(filteredAlbums.length)} ${filteredAlbums.length === 1 ? "record" : "records"}`;
    els.viewLabel.textContent = state.categoryId === "all"
      ? (state.query ? "SEARCH / ALL ROOMS" : "ALL ROOMS")
      : (categoryById.get(state.categoryId)?.name || "ROOM");
    updateViewPosition();
    renderVirtual();
  }

  function findStartIndex(scrollTop) {
    let low = 0;
    let high = state.offsets.length - 1;
    let answer = 0;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      if (state.offsets[middle] <= scrollTop) {
        answer = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    return answer;
  }

  function renderVirtual() {
    if (!state.units.length) {
      els.layer.innerHTML = "";
      updateInspector();
      return;
    }

    const start = Math.max(0, findStartIndex(els.viewport.scrollTop) - OVERSCAN);
    const endPosition = els.viewport.scrollTop + els.viewport.clientHeight;
    let end = findStartIndex(endPosition) + OVERSCAN + 1;
    end = Math.min(state.units.length, end);

    const fragment = document.createDocumentFragment();
    for (let index = start; index < end; index += 1) {
      const unit = state.units[index];
      const node = unit.type === "category"
        ? createCategoryNode(unit, index)
        : createAlbumNode(unit.album, index);
      node.style.top = `${state.offsets[index]}px`;
      fragment.appendChild(node);
    }
    els.layer.replaceChildren(fragment);
    updateViewPosition();
  }

  function createCategoryNode(unit, index) {
    const node = document.createElement("div");
    const categoryNumber = categoryIndex.get(unit.category.id) + 1;
    node.className = "procession-category";
    node.dataset.index = String(index);
    node.setAttribute("role", "presentation");
    node.innerHTML = `
      <span class="category-index">${String(categoryNumber).padStart(2, "0")}</span>
      <div class="category-content">
        <p class="category-name">${escapeHtml(unit.category.name)}</p>
        <p class="category-description">${escapeHtml(unit.category.description)}</p>
      </div>
      <span class="category-count">${formatCount(unit.count)}</span>
    `;
    return node;
  }

  function createAlbumNode(album, index) {
    const heard = state.heardIds.has(album.id);
    const selected = state.selectedId === album.id;
    const node = document.createElement("article");
    node.className = "album-row";
    node.dataset.id = album.id;
    node.dataset.index = String(index);
    node.dataset.heard = String(heard);
    node.dataset.selected = String(selected);
    node.setAttribute("role", "listitem");
    node.innerHTML = `
      <span class="album-index">${String(album.position).padStart(4, "0")}</span>
      <button class="album-title-button" data-action="select" type="button" aria-label="Hold ${escapeHtml(album.title)} by ${escapeHtml(album.artist)}">
        <span class="album-title">${escapeHtml(album.title)}</span>
        <span class="album-artist">${escapeHtml(album.artist)}</span>
      </button>
      <span class="album-year">${album.year}</span>
      <span class="album-status"><span>${heard ? "ENTERED" : "UNHEARD"}</span> <button class="mark-button" data-action="toggle" type="button" aria-label="${heard ? "Unmark" : "Mark"} ${escapeHtml(album.title)} as heard" aria-pressed="${heard}"></button></span>
    `;

    const status = node.querySelector(".album-status");
    const markButton = node.querySelector(".mark-button");
    status.classList.add("album-mark");
    markButton.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleHeard(album.id);
    });
    node.querySelector("[data-action='select']").addEventListener("click", () => selectAlbum(album.id));
    return node;
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function renderCategories() {
    els.roomTotal.textContent = String(source.categories.length).padStart(2, "0");
    const fragment = document.createDocumentFragment();
    source.categories.forEach((category, index) => {
      const count = source.albums.filter((album) => album.categoryId === category.id).length;
      const heard = source.albums.filter((album) => album.categoryId === category.id && state.heardIds.has(album.id)).length;
      const button = document.createElement("button");
      button.className = "room-link";
      button.type = "button";
      button.dataset.categoryId = category.id;
      button.setAttribute("aria-current", state.categoryId === category.id ? "true" : "false");
      button.innerHTML = `
        <span class="room-index">${String(index + 1).padStart(2, "0")}</span>
        <span class="room-name">${escapeHtml(category.name)}</span>
        <span class="room-count">${count}</span>
        <span class="room-meter" aria-hidden="true"><span style="width:${count ? (heard / count) * 100 : 0}%"></span></span>
      `;
      button.addEventListener("click", () => {
        state.categoryId = state.categoryId === category.id ? "all" : category.id;
        state.scrollTop = 0;
        els.viewport.scrollTop = 0;
        renderCategories();
        rebuildLayout();
        queuePersist();
      });
      fragment.appendChild(button);
    });
    const allButton = document.createElement("button");
    allButton.className = "room-link";
    allButton.type = "button";
    allButton.dataset.categoryId = "all";
    allButton.setAttribute("aria-current", state.categoryId === "all" ? "true" : "false");
    allButton.innerHTML = `<span class="room-index">∴</span><span class="room-name">ALL ROOMS</span><span class="room-count">${source.albums.length}</span>`;
    allButton.addEventListener("click", () => {
      state.categoryId = "all";
      state.scrollTop = 0;
      els.viewport.scrollTop = 0;
      renderCategories();
      rebuildLayout();
      queuePersist();
    });
    fragment.insertBefore(allButton, fragment.firstChild);
    els.categoryList.replaceChildren(fragment);
  }

  function selectAlbum(id, shouldScroll = false) {
    if (!albumById.has(id)) return;
    state.selectedId = id;
    updateInspector();
    renderVirtual();
    queuePersist();
    if (shouldScroll) scrollToAlbum(id);
  }

  function updateInspector() {
    const album = state.selectedId ? albumById.get(state.selectedId) : null;
    if (!album) {
      els.currentRecord.innerHTML = '<p class="record-empty">Select a signal<br />to hold it here.</p>';
      els.markSelected.disabled = true;
      els.jumpSelected.disabled = true;
      return;
    }

    const category = categoryById.get(album.categoryId);
    const heard = state.heardIds.has(album.id);
    els.currentRecord.innerHTML = `
      <p class="record-room">${escapeHtml(category.group)} / ${escapeHtml(category.name)}</p>
      <h3 class="record-title">${escapeHtml(album.title)}</h3>
      <p class="record-artist">${escapeHtml(album.artist)}</p>
      <p class="record-details"><span>${album.year}</span><span>${heard ? "ENTERED" : "UNHEARD"}</span></p>
      <p class="record-description">${escapeHtml(category.description)}</p>
    `;
    els.markSelected.disabled = false;
    els.markSelectedLabel.textContent = heard ? "RETURN TO UNHEARD" : "MARK AS HEARD";
    els.jumpSelected.disabled = false;
  }

  function toggleHeard(id) {
    if (state.heardIds.has(id)) state.heardIds.delete(id);
    else state.heardIds.add(id);
    renderCategories();
    updateStats();
    updateInspector();
    rebuildLayout();
    queuePersist();
    const album = albumById.get(id);
    showToast(`${state.heardIds.has(id) ? "ENTERED" : "RETURNED TO UNHEARD"}: ${album.title}`);
  }

  function updateStats() {
    const heard = state.heardIds.size;
    const remaining = Math.max(0, source.albums.length - heard);
    const percentage = source.albums.length ? (heard / source.albums.length) * 100 : 0;
    els.heardCount.textContent = String(heard).padStart(3, "0");
    els.remainingCount.textContent = formatCount(remaining);
    els.completionCount.textContent = `${percentage.toFixed(1)}%`;
    els.signalStatus.textContent = `${formatCount(remaining)} SIGNALS UNENTERED`;
  }

  function updateViewPosition() {
    if (state.categoryId !== "all") {
      els.viewPosition.textContent = `${String(categoryIndex.get(state.categoryId) + 1).padStart(2, "0")}—${String(source.categories.length).padStart(2, "0")}`;
      return;
    }
    const currentIndex = state.units.length ? categoryIndex.get(state.units[findStartIndex(els.viewport.scrollTop)]?.category?.id) : 0;
    const room = Number.isFinite(currentIndex) ? currentIndex + 1 : 1;
    els.viewPosition.textContent = `${String(room).padStart(2, "0")}—${String(source.categories.length).padStart(2, "0")}`;
  }

  function scrollToAlbum(id) {
    const visibleIndex = state.units.findIndex((unit) => unit.type === "album" && unit.album.id === id);
    if (visibleIndex < 0) return;
    const target = Math.max(0, state.offsets[visibleIndex] - els.viewport.clientHeight * 0.32);
    els.viewport.scrollTo({ top: target, behavior: "smooth" });
    state.scrollTop = target;
    queuePersist();
  }

  function drawSignal() {
    const candidates = getFilteredAlbums();
    if (!candidates.length) {
      showToast("NO UNHEARD SIGNAL IN THIS ROOM");
      return;
    }
    const pool = candidates.filter((album) => !state.heardIds.has(album.id));
    const choicePool = pool.length ? pool : candidates;
    const choice = choicePool[Math.floor(Math.random() * choicePool.length)];
    selectAlbum(choice.id, true);
    els.drawCaption.textContent = pool.length ? "A signal has been pulled from the dark." : "Everything here is entered. One returns anyway.";
    showToast(`SUMMONED: ${choice.title}`);
  }

  function showToast(message) {
    window.clearTimeout(state.toastTimer);
    els.toast.textContent = message;
    els.toast.dataset.visible = "true";
    state.toastTimer = window.setTimeout(() => {
      els.toast.dataset.visible = "false";
    }, 2800);
  }

  function resetView() {
    state.query = "";
    state.categoryId = "all";
    state.unheardOnly = false;
    state.scrollTop = 0;
    els.searchInput.value = "";
    els.unheardToggle.setAttribute("aria-pressed", "false");
    els.viewport.scrollTop = 0;
    renderCategories();
    rebuildLayout();
    queuePersist();
  }

  els.searchForm.addEventListener("submit", (event) => event.preventDefault());
  els.searchInput.addEventListener("input", () => {
    state.query = els.searchInput.value.trim();
    state.scrollTop = 0;
    els.viewport.scrollTop = 0;
    rebuildLayout();
    queuePersist();
  });

  els.unheardToggle.addEventListener("click", () => {
    state.unheardOnly = !state.unheardOnly;
    els.unheardToggle.setAttribute("aria-pressed", String(state.unheardOnly));
    state.scrollTop = 0;
    els.viewport.scrollTop = 0;
    rebuildLayout();
    queuePersist();
  });

  els.viewport.addEventListener("scroll", () => {
    state.scrollTop = els.viewport.scrollTop;
    if (!state.raf) {
      state.raf = requestAnimationFrame(() => {
        state.raf = 0;
        renderVirtual();
      });
    }
    queuePersist();
  }, { passive: true });

  els.drawButton.addEventListener("click", drawSignal);
  els.markSelected.addEventListener("click", () => {
    if (state.selectedId) toggleHeard(state.selectedId);
  });
  els.jumpSelected.addEventListener("click", () => {
    if (state.selectedId) scrollToAlbum(state.selectedId);
  });
  els.resetView.addEventListener("click", resetView);

  els.clearProgress.addEventListener("click", () => {
    if (typeof els.dialog.showModal === "function") els.dialog.showModal();
    else if (window.confirm("Erase every mark?")) clearProgress();
  });
  els.confirmClear.addEventListener("click", (event) => {
    event.preventDefault();
    clearProgress();
    els.dialog.close();
  });

  function clearProgress() {
    state.heardIds.clear();
    updateStats();
    renderCategories();
    rebuildLayout();
    queuePersist();
    showToast("ALL MARKS ERASED");
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "/" && document.activeElement !== els.searchInput && document.activeElement?.tagName !== "INPUT") {
      event.preventDefault();
      els.searchInput.focus();
    }
    if (event.key.toLowerCase() === "r" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
      resetView();
      showToast("VIEW RESET");
    }
  });

  els.searchInput.value = state.query;
  els.unheardToggle.setAttribute("aria-pressed", String(state.unheardOnly));
  updateStats();
  renderCategories();
  rebuildLayout();
  requestAnimationFrame(() => {
    els.viewport.scrollTop = state.scrollTop;
    renderVirtual();
  });
})();
