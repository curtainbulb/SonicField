# SONICFIELD / NULL CHOIR

The interface treats `albums.md` as a dead broadcast log rather than a collection dashboard. A user moves through rooms in a long procession, searches the source, or summons one unheard record from the current room. The only durable action is a mark: when an album is heard, it moves from absence into the ledger.

The visual system is deliberately spare: a weighted near-black ground, hairline rules, serif reading text, monospaced indices, and one desaturated green signal for the parts that are still alive. The right-hand ledger gives the selected record a physical place without turning the archive into a grid of cards. The full list is window-rendered so the register stays light at source scale, and browser-local state preserves marks, filters, selection, and the last position.

## Run

Regenerate the data artifact whenever `albums.md` changes:

```sh
node build.mjs
```

Then open `index.html` in a browser, or serve the folder with any static file server. No dependencies or account are required.
