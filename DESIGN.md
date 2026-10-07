# SonicField UI redesign

## Current UI audit

The product already has the right raw material: a clear crate taxonomy, a 1,391-record source list, query operators, heard state, ratings, tags, notes, audio-copy checks, export/import, and a record detail sheet. The interface presented those capabilities as one long wall with a crowded toolbar. Recents and saved records had no home, recommendations were difficult to discover, and the details view mixed listening actions with a long technical form.

## Three directions considered

| Direction | Character | Interaction model | Tradeoff |
| --- | --- | --- | --- |
| Sleeve Index | A sharply typeset record catalog with dense filters and album-first browsing. | Search, filter, scan, open a sleeve. | Excellent for deliberate lookup; weak as a welcoming return point. |
| Listening Room | A personal home for returning to records, following rated-based threads, and drawing something unexpected. | Resume, discover, then enter the complete crate index. | Adds a home view and saved/recent state; keeps the full catalog one route away. |
| Field Atlas | A map-like index arranged by family, decade, and overlapping musical territory. | Move between families, eras, and crates as connected paths. | Strong exploration; more unfamiliar spatial navigation for a user who already thinks in crates. |

## Recommendation

Listening Room is implemented. It gives the archive a useful starting point without turning the catalog into a dashboard. The surface is warm paper, dark ink, hairline rules, a single oxide-red signal color, editorial serif display type, and compact system sans/mono utility text. Record sleeves remain the visual center. The circular listening stamp and the overlapping sleeve-and-disc detail transition give the interface its physical character.

## Design principles

- Lead with the collection’s own language: listening room, crate, sleeve, trail, ledger.
- Keep browsing, saving, hearing, rating, and recording copy details as direct actions.
- Use red for selection, progress, and the next action. Do not use it as ambient decoration.
- Let album art carry color. The interface itself stays paper, ink, and oxide.
- Keep detail work in one focused folio, with listening actions before classification fields.
- Suggestions come only from local ratings and collection metadata; they do not claim streaming-service taste data.

## Information architecture

```text
Listening room
├── Listening trail (recently opened)
├── Follow a thread (rated-based suggestions)
└── Choose a crate
Crates
├── Search results and decade/listening filters
└── 37 crate sections → record folio
Saved & recent
├── Saved for later
└── Recently opened
Your ledger
├── Collection and listening totals
├── Crate/decade map and rating distribution
└── Import/export
Record folio
├── Apple Music / Spotify / YouTube Music
├── Save / heard / rating
├── Classification, tags, note
└── Copy format, source, and file-header inspection
```

The primary route is always visible in the desktop masthead. The crate rail appears on the catalog route, where it is useful for direct jumps. Mobile uses a persistent four-destination bottom bar and a horizontally scrollable filter line.

## Main task flows

1. Find an album: `/` or Ctrl/Cmd+K focuses search → query operators narrow the crate index → select a sleeve → choose a streaming destination.
2. Mark a listen: open sleeve → “Mark heard” → state and crate tally update immediately; “Heard · undo” reverses it.
3. Classify a copy: open sleeve → choose rating, tags, type, or audio details → values save under existing `sf_meta`.
4. Return later: open sleeve → “Save for later” → Saved & Recent; remove from the same action in the folio.
5. Discover: home → follow a thread from 4–5 star ratings or draw an unheard record with the button / `R` shortcut.
6. Inspect or back up: Your Ledger → crate/rating summaries → export or merge an existing SonicField JSON export.

## Key-screen wireframes

Listening room, desktop:

```text
┌ SONICFIELD ─ Listening room ─ Crates ─ Saved ─ Ledger ─ Search ─ Draw ┐
│ collection / routes │ A private archive for curious ears     (stamp) │
│                     │ Your collection, still in motion.              │
│                     │ [Enter the crates] [Start with a record]       │
│                     ├─────────────────────────────────────────────────┤
│                     │ Back in the room     [recent sleeves →]        │
│                     │ Follow a thread      [rated-based sleeves]      │
│                     │ Choose a crate       [typographic crate index]  │
└─────────────────────┴─────────────────────────────────────────────────┘
```

Crate index:

```text
┌ global masthead and search ───────────────────────────────────────────┐
│ crate rail     │ Browse the crates       [decades] [listening status] │
│                │ family / crate title / short description             │
│ active crate   │ [sleeve] [sleeve] [sleeve] [sleeve]                   │
│                │ next crate …                                         │
└────────────────┴──────────────────────────────────────────────────────┘
```

Record folio:

```text
┌ overlapping sleeve and record ─────────────────────────────── close ┐
│ title / artist / year / crate / family                             │
│ [Apple Music] [Spotify] [YouTube Music] [Save] [Mark heard]         │
│ confidence or search-fallback note                                  │
│ rating · type · filed under · tags · note                           │
│ copy format · sample rate · bits · channels · source · header check │
│ neighboring sleeves                                                 │
└─────────────────────────────────────────────────────────────────────┘
```

## Component system

- Masthead: wordmark, primary routes, global search/help, draw action.
- Side index: collection count, route shortcuts, active crate links, local-storage status.
- Room sections: recent sleeves, recommendations, crate choices, first-use guidance.
- Sleeve: fixed square geometry, remote cover, title fallback, year, heard/saved marks.
- Collection heading: title, count/context, decade chips, listening-state select, clear action.
- Folio: cover/disc, streaming links, reversible saved/heard actions, classification editor, neighbors.
- Ledger: metrics, crate map, ratings, artist/crate shortcuts, data import/export.
- Feedback states: loading copy, recoverable load error, empty saved state, no-results state, and transient live toast.

## Design tokens

| Token | Value | Use |
| --- | --- | --- |
| Paper | `#e9e6dc` | Main canvas |
| Stock | `#f5f2e9` | Folio, placeholders, raised paper |
| Ink | `#25241f` | Primary text and controls |
| Soft ink | `#4c4a42` | Secondary text |
| Muted | `#77746a` | Tertiary labels |
| Rule | `#c9c4b7` | Separators and quiet borders |
| Oxide | `#bd422c` | Active state, progress, calls to action |
| Oxide wash | `#f1d8cc` | Selected/hovered paper surface |

Typography uses Georgia for expressive titles, Arial/Helvetica system sans for reading, and system monospace for data labels. Spacing follows a 4/8/12/16/24/32/48px rhythm. Corners are square except for the circular record/stamp. Shadows are limited to the active search-help panel and elevation feedback. No external font or icon downloads are required.

## Motion and state

| Trigger | Motion | Duration | Purpose |
| --- | --- | --- | --- |
| Sleeve hover/focus | Move up 4px and rotate slightly | 180ms | Make the sleeve feel selectable |
| Open folio | Paper panel enters; disc slides behind sleeve | 260–320ms | Show a physical reveal and preserve context |
| Action hover | Oxide surface, small arrow shift | 160ms | Confirm action target |
| Toast | Rise 8px and reveal | 160ms; 2.2s hold | Confirm save/remove without blocking |
| Reduced motion | Transitions collapse; sleeve and stamp stay still | Immediate | Respect the OS preference |

All loading and empty states keep the next useful action visible. An unmatched Apple record still has a search link. If local data fails to load, the page offers a retry. Errors do not clear user state.

## Responsive and accessible behavior

- Desktop: persistent masthead and route rail; four/six-column sleeves adapt to width.
- Tablet: sidebar narrows; home record rows reduce columns; filters wrap naturally.
- Mobile: masthead stacks, crate navigation becomes a sticky horizontal index, bottom route bar respects safe-area insets, and sleeve grids use two or three columns.
- Every action is a labeled button/link/select; focus has a visible outline; search shortcuts are shown beside the input.
- Escape closes the folio and search help. Tab/Shift+Tab stay inside the modal folio. The background becomes inert while the folio is open.
- Heard state is text-marked and not color-only. Status and toast updates use live regions.
- Minimum target heights are 40px for controls and 42px for rating stars.
- Reduced-motion settings disable sliding and hover movement. Text, borders, and contrast remain legible without animation.

## Performance notes

- No framework, runtime dependency, custom font, or background image.
- Sleeve aspect ratio reserves layout before the Apple CDN cover loads.
- Covers request a 320px source only as sleeves approach the viewport; the folio requests 480px on open.
- CSS motion changes transform/opacity and color, not layout dimensions.
- The album list and existing local cache remain client-side; new saved/recent keys are small additive arrays. Existing `sf_meta`, `sf_res`, and `sonicfield_heard` remain readable.

## User checks

Ask a first-time user to locate a named album, find all records by an artist, mark one heard, rate and tag another, save a third, restore it from Saved & Recent, and export their data. Repeat at a narrow mobile width and with keyboard-only input. Observe whether users understand the four destinations, the difference between heard and saved, why a suggestion appeared, and whether the Apple link opens the installed app or a useful search fallback. Check contrast and motion with system accessibility settings enabled.

## Acceptance checklist

- [x] Distinct home, crate index, saved/recent, ledger, and record folio.
- [x] Search syntax help, decade/status filters, and clear-filter recovery.
- [x] Saved records and recent visits persist in additive localStorage keys.
- [x] Suggestions use only local ratings and existing metadata.
- [x] Apple Music, Spotify, and YouTube Music actions are available per record.
- [x] Reversible heard/saved actions and keyboard shortcuts.
- [x] Desktop crate navigation and mobile destination bar.
- [x] Loading, load error, empty, no-results, and action feedback states.
- [x] Reduced-motion, keyboard focus, modal focus trap, and live feedback.
