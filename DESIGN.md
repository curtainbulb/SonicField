# SonicField — The Null Index

## Current UI Audit

This audit is based on the source. The embedded browser blocked the local preview URL, so the rendered app could not be inspected interactively in this environment.

- The previous visual system used warm parchment, a literary serif, album-card grids, and oxide accents. It read as a gentle listening journal, not a hollow, severe archive.
- The catalog rendered every record into the page at once, then replaced the full catalog DOM for each filter and route change. With 1,391 entries, that creates unnecessary layout work and discards the user's current list elements.
- The record sheet was an aside made modal with custom background locking, focus trapping, and focus restoration. Its asynchronous catalogue lookup rebuilt the entire sheet when it returned, adding focus and interaction race conditions.
- The album list has 1,391 entries but 1,384 distinct legacy keys. Seven repeated title/artist/year entries could resolve to the wrong crate context through a key-only lookup.
- The first route depends on fetching the Markdown archive. The prior error state combined a raw fetch message with generic server guidance; the new state names the failed request and offers retry.

The new interface gives each visible entry a stable crate-and-position identity, while keeping the legacy key for local data compatibility.

## Concept 1 — The Ossuary

**Vibe:** A wall of names, organized like a memorial register.

**Interaction:** Browse an alphabetized, typographic list. Open a record into a narrow inscription panel. Search and mark records in place.

**Strength:** Quiet and emotionally direct. The archive itself supplies all visual interest.

**Cost:** Alphabetical browsing hides the user's existing crate taxonomy and weakens exploratory relationships between records.

## Concept 2 — Dead Channel

**Vibe:** A receiver left running after transmission stopped: near-black field, a single cold signal, sparse measurements.

**Interaction:** Search first, jump between recent signals, tune by era and status, and use the command palette as the main route switcher.

**Strength:** Strongest sense of a living but failing system; fast for repeated expert use.

**Cost:** Search-led navigation makes the full collection harder to understand at a glance and puts too much weight on hidden commands.

## Concept 3 — The Null Index

**Vibe:** A private instrument for cataloguing what remains. Bone text on charcoal, hairline rules, measured gaps, one rust signal.

**Interaction:** A visible route rail and crate list remain available on desktop. The index is a paged, searchable register. A command palette offers direct jumps without becoming the only navigation.

**Strength:** The structure is immediately legible; the archive stays sparse without hiding its features.

**Cost:** More typographic than image-led. Covers are present as quiet evidence, not as the interface's main event.

## Recommendation

Build **The Null Index**. It makes the product's actual structure visible, gives the 1,391-entry catalog bounded rendering, and keeps search, crate selection, saved records, ledger, and settings one direct move away. The bleakness comes from spacing, hierarchy, and material contrast rather than novelty controls or decorative effects.

## Final Design Spec

### Principles

- Give every screen one clear next action.
- Use words before icons; reserve the rust signal for active state and important actions.
- Keep the desktop route rail and crate list visible.
- Treat each record as a row in a working register, not a floating card.
- Keep personal data local and exportable.
- Use motion only to confirm a state change or expose a layer.
- Keep search, filters, and record actions reversible.

### Information architecture

    Room
    ├── Listening progress
    ├── Recently opened
    ├── Rating-based suggestions
    └── Crate entry points
    Index
    ├── Search and syntax
    ├── Crate, decade, and state filters
    └── Record detail
    Kept records
    ├── Saved
    └── Recent
    Ledger
    ├── Collection totals
    ├── Decade and rating breakdowns
    └── Crate listening progress
    Settings
    ├── Accent and list density
    ├── JSON and CSV export / JSON import
    └── Keyboard reference

### Core user flows

1. **Find a record:** Press / or focus the visible search → type a title, artist, tag, crate, family, year, or rating query → open a result.
2. **Mark it heard:** Open a record → choose Mark heard → close or continue to a nearby record. The action can be undone from the same control.
3. **Classify a copy:** Open a record → rate it → add tags, a note, format, and source details. FLAC/WAV headers can fill measured fields.
4. **Keep a record:** Open it → Keep for later → find it in Kept records. Removing the marker is reversible.
5. **Discover:** Use Follow a line for suggestions derived from local ratings and archive metadata, or press R to draw an unheard record.
6. **Carry data out:** Settings → export JSON or CSV. Import merges fields into local data.

### Key-screen wireframes

Desktop room:

    ┌ fixed routes / crate register ┬ route label · search · command · draw ┐
    │ 01 Room                       │ THE RECORDS REMAIN.      archive state │
    │ 02 Index                      │ [Open index] [Begin with a record]      │
    │ 03 Kept                       ├ recent register rows ──────────────────┤
    │ 04 Ledger                     │ follow a line · choose a crate          │
    │ 05 Settings                   └─────────────────────────────────────────┘

Index:

    ┌ visible route rail ┬ query / filters / count ───────────────────────────┐
    │ crate A            │ crate · state · decades                            │
    │ crate B            │ record / artist        crate      year     marks   │
    │ crate C            │ record row ─────────────────────────────────────── │
    │ ...                │ record row · load next                              │
    └────────────────────┴───────────────────────────────────────────────────┘

Record detail:

    ┌ record / crate position ───────────────────────────────────── close ┐
    │ cover evidence     title / artist / year / family / crate             │
    │                   Apple · Spotify · YouTube · Keep · Mark heard       │
    │                   rating · type · filed under · tags · note           │
    │                   format · sample rate · bits · source · header read   │
    │                   nearby records                                      │
    └───────────────────────────────────────────────────────────────────────┘

Mobile: short masthead, full-width search, five persistent destinations, one-column register, bottom record sheet, and horizontally scrollable decade filters.

### Components

- **Route rail:** Five labeled destinations, crate list, device-local status.
- **Top bar:** Current location, global search, command palette, random unheard action.
- **Record row:** Cover fallback, title, artist, crate, year, heard/saved/rating marks.
- **Filter register:** Crate and state selects, decade toggles, count, syntax help, clear action.
- **Record dialog:** Catalogue links, reversible heard/saved controls, rating, personal metadata, copy inspection, adjacent records.
- **Command palette:** Views, recent records, record/artist lookup, and draw action.
- **Ledger:** Count register, decade bars, rating distribution, crate progress.
- **Settings:** Accent, density, import/export, shortcut reference.
- **Feedback:** Loading, unavailable archive, empty, no-match, toast, and import result states.

### Design system

| Role | Value | Use |
| --- | --- | --- |
| Void | #11110f | Main canvas |
| Well | #171815 | Dialogs and input fields |
| Bone | #e8e3d7 | Primary text |
| Ash | #aaa69a | Secondary text |
| Dust | #79786f | Quiet labels |
| Rule | #373832 | Hairline separators |
| Rust | #ca806e | Default action / active mark |
| Cold ash | #a9c2c0 | Optional alternate accent |

Typography uses a severe system sans for reading and system monospace for coordinates, counts, and shortcuts. No remote font or icon dependency. Spacing uses 4, 8, 12, 16, 24, 32, 48, and 72px steps. Geometry is square; no ambient shadows. Album covers provide the only high-color imagery.

### Motion

| Trigger | Motion | Duration | Purpose |
| --- | --- | --- | --- |
| Open record | Side sheet enters 18px and resolves opacity | 180ms | Confirm the selected row |
| Open command | Small stepped fade and 5px rise | 130ms | Make direct access feel immediate |
| Hover / focus | Hard surface change; no scale or bounce | 120–140ms | Expose the active target |
| Toast | Opacity and 5px rise | 130ms | Confirm a reversible action |
| Reduced motion | Remove non-essential movement and transitions | Immediate | Respect the system preference |

Reduced motion follows the user's OS preference using the CSS media query documented by [MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40media/prefers-reduced-motion).

### States

- **Default:** Bone text, charcoal canvas, hairline separators.
- **Hover:** Slightly raised charcoal surface, rust text only when it clarifies an active mark.
- **Focus:** Two-pixel rust outline with offset; keyboard focus remains visible.
- **Active:** Rust line, pressed state, or explicit text mark; never color alone.
- **Loading:** Quiet status line; no blocking skeleton grid.
- **Error:** Names the failed archive request, retains local data, offers retry.
- **Empty:** Says what is absent and gives a direct next action.
- **No results:** Counts zero and offers Clear filters.
- **Success:** Short live-region toast with the changed action.

### Responsive behavior

- **Wide desktop:** 238px rail with all routes and crates; 3-column home crate list; 72-row initial index page.
- **Tablet:** Narrower persistent rail, simplified row columns, stacked ledger.
- **Mobile:** Rail replaced by persistent five-destination bottom navigation; search stays in the masthead; crate filter becomes a select; register rows collapse to title, artist, year, and marks; dialog becomes a bottom sheet.
- Safe-area insets are applied to the mobile navigation and sheet. Touch controls remain at least 44px high.

### Accessibility

- Native buttons, labels, selects, lists, and modal dialogs.
- Skip link, labeled search/filter controls, current-route states, pressed states, progress values, and live status.
- The native modal dialog uses showModal(), which enters the top layer and makes the rest of its document inert; this replaces custom background locking and hand-written focus trapping. [MDN: showModal()](https://developer.mozilla.org/en-US/docs/Web/API/HTMLDialogElement/showModal)
- Escape closes the record sheet; focus returns to the invoking row or a safe main-content target.
- Heard, saved, and rating marks use text as well as color.
- System reduced-motion preference is honored. Text and controls retain high contrast on both accent choices.

### Performance and reliability

- Static HTML/CSS/JS; no framework runtime, icon kit, remote typeface, or background animation.
- Only the first 72 matching records render. Load next expands the visible page in bounded steps.
- Covers are observed near the viewport and loaded only when the resolved archive has artwork.
- Search input is debounced; CSS motion uses opacity and transform.
- Existing localStorage keys remain intact. Unique in-page IDs distinguish repeated list entries without changing their legacy saved-data key.
- Catalogue lookup is optional and does not block opening or editing a record.

## Prototype Code

- **index.html:** semantic app frame, visible routes, search, and native dialogs.
- **style.css:** Null Index tokens, responsive layouts, record register, modal, settings, and reduced-motion behavior.
- **app.js:** route state, bounded lists, search/filtering, local annotations, command palette, import/export, and record flows.
- **lib.js and the archive data remain the existing source of record parsing, query syntax, header inspection, and release matching.**

Run the project through its existing GitHub Pages deployment or any static HTTP server from the project root. Opening index.html as a file is unsupported because the app fetches albums.md and data/resolved.json. Browsing and local marks work without catalogue access; unmatched release lookup and cover art use Apple's public catalogue.

### What to test with users

- Find a named album, search an artist, and use a query operator without instruction.
- Filter to unheard, save a record, rate and tag another, then find both in Kept and the Ledger.
- Open a repeated title in different crates and confirm the correct crate is shown.
- Export, import into a clean browser profile, and confirm the marks are restored.
- Complete the same tasks by keyboard and at 320px, tablet, and desktop widths.
- Check the dialog with a screen reader, 200% zoom, high contrast, and reduced motion.
- Ask whether the room screen makes the first action clear and whether the emptiness reads as deliberate.

## Acceptance checklist

- [x] Distinct Room, Index, Kept, Ledger, and Settings screens.
- [x] Visible desktop routes and crates; persistent mobile routes.
- [x] Search, syntax help, decade/status/crate filters, paging, command palette, and random draw.
- [x] Record detail with service links, heard/saved/rating, tags, notes, classification, and audio header inspection.
- [x] Existing personal-data keys retained; JSON/CSV export and merge import retained.
- [x] Loading, recoverable error, empty, no-match, and success feedback states.
- [x] Reduced motion, focus styles, labeled controls, native modal behavior, and 44px mobile targets.
- [x] No framework, icon package, external font, decorative gradient, or all-record first render.
- [ ] Visual browser QA at desktop/tablet/mobile widths; unavailable here because local preview navigation was blocked.
