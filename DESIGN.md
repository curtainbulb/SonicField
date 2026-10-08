# SonicField / The Null Index — rebuild rationale

Full front-end rebuild. Markup, styles, and interaction logic are new.
`lib.js` keeps its parsing/matching/search-compile/header-sniffing
functions — pure data logic with no UI in it — because it was correct and
rewriting it would only add risk. `albums.md`, `data/resolved.json`, and
`scripts/resolve.mjs` are untouched. LocalStorage keys are unchanged, so
anyone's existing marks keep working against this build.

## Theme → decisions

**Hollow / dead / anarchist, not "dark mode."** Ground is `#0b0a08`, charred
paper rather than `#000`. One desaturated accent (rust, or a cold-ash
alternate) marks the only things that are "alive": the kept mark, the
active nav line, the pulse dot, the draw button. Everything else is ink on
ash. No gradients, no glass, no shadows — hairline rules (`1px solid
#262320`) do all the separating work a card-and-shadow system would
otherwise do.

**Typography is the interface.** A serif body face (Georgia/Iowan stack)
reads like ledger prose; a monospace face carries structure — record
indices (`01.01`), crate codes, eyebrows, keyboard hints. Headlines sit in
the serif at display size because this is a record archive, not a SaaS
product; large serif type doesn't default to "AI app."

**The spine replaces the sidebar.** A left rail still makes sense
functionally — five sections and dozens of crates need to be one click
away at all times — but it's built as a typographic ledger, not a
button-and-icon dock: index numbers (`00`–`04`), hairline dividers, a
left-edge accent tick for "you are here." No pills, no icon glyphs. Below
980px it becomes a bottom index-line of five text labels; crate browsing
moves into the Index's own crate filter and into direct access, which is
faster to reach one-handed than a drawer would be.

**Record detail is a case file, not a modal.** It opens as a panel sliding
in from the right edge of the screen — an archive drawer being pulled, not
a dialog interrupting you — over a darkened backdrop, native `<dialog>` for
focus-trapping and Escape-to-close.

**Direct access (`⌘K`) is a terminal, not a Spotlight clone.** Full-bleed,
monospace, left-aligned, results read as ledger rows with a left-hand code
(`VIEW` / `ACT` / `CRATE` / `RECORD`) instead of icons. It now also indexes
crates, so "go to a crate" is one keystroke away from anywhere.

**Motion is small and load-bearing.** 120–280ms, a single confident ease,
no bounce. The record panel's entrance motion is the whole "opening a
record" moment. The one ambient animation — a slow pulse on the "local
archive" indicator — says something is alive in this device-only archive
and nowhere else; it's the only animation not tied to a state change, and
it's the first thing `prefers-reduced-motion` turns off.

**Empty and loading states are written, not generated.** "The signal ends
here," "No trace yet," "Nothing kept yet" — each is specific to the screen
it's on rather than a shared "no data" component, because the theme asks
for absence to read as intentional, not broken.

## Functional / technical notes

- **Index at scale**: lists above ~120 rows are windowed — only rows near
  the viewport are in the DOM, computed from scroll position against a
  spacer sized to the full result count — so a 1,400-record archive (or
  ten times that) stays smooth without pagination clicks. Smaller lists
  (Room's recent/suggestions, a short Kept list) render directly.
- **Every interactive element is a real `<button>` or `<a>`** with a working
  handler and a visible `:focus-visible` ring (accent-colored, offset, not
  the default browser outline and not suppressed).
- **Search syntax is unchanged** (`artist:`, `crate:`, `family:`, `tag:`,
  `shelf:`, `year:1970-1979`, `rating>=4`, `is:unheard`, leading `-` to
  negate) and gained `is:saved`.
- **Escape has one job.** A native `<dialog>` closes on Escape, but a
  focused `type="search"` field eats the first Escape to clear itself;
  direct access now forces the close explicitly so Escape is never a dead
  end there.
- **No placeholder content.** Every screen is wired to `data/resolved.json`
  and `albums.md`'s real fields; empty states only appear when the data or
  the filter genuinely produces nothing.

## Running it

Static files, no build step. Serve the folder over HTTP (`python3 -m
http.server`, or anything else) and open it — `fetch()` for `albums.md`
and `data/resolved.json` needs a real origin, not `file://`.
