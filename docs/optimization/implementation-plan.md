# Implementation plan

Ranked by expected gain per unit of risk. "Default" changes apply to every
snapshot and must be lossless; anything lossy is opt-in.

| # | Change | Gain | Complexity | Regression risk | Status |
|---|---|---|---|---|---|
| O1 | Shorten same-origin `url=` against a Page URL printed in the header | high (B1) | low | low | done |
| O2 | Fold a lone text child into name-from-content roles; drop a child that repeats the name | high (B2) | low | low | done |
| O3 | Header: print Page URL, stop repeating the current title | small (B3), saves `page.url()` calls | low | low | done |
| O4 | Opt-in `snapshot({ interactive: true })` | high when used (B4) | medium | none by default | done |
| O5 | `goto("/path")` resolves against the current document | enables O1 | low | low | done |
| O6 | Reuse post-capture frame sessions for the document check (fresh read if one detached) | small (B5) | low | low | done |
| O7 | Screenshot: one `Runtime.evaluate` instead of two | small (B6) | low | low | done |
| O8 | Opt-in `snapshot({ diff })` with explicit snapshot ids | very high on re-observation | medium | none by default | done |
| D2 | Prune list items / decorative images by default | medium | low | medium | rejected |
| D3 | Batch or skip per-locator `DOM.describeNode` | latency on large pages | high | high | rejected |
| D4 | Rewrite the Skill for size | ~6k tokens/session | low | high | deferred |

## O1 — URL shortening

1. Current: every link prints its absolute URL; 2,851 lines also print the same
   target as `loc=href:`.
2. Problem: 19–30 % of snapshot tokens; the origin repeats on every link.
3. Solution: `compactSnapshotUrls(content, pageUrl)` in `snapshot-result.ts`,
   applied at the end of `Page.snapshot()`. Drop `url=` when the line's
   `loc=href:` resolves (against the Page URL) to exactly the same URL;
   otherwise print same-origin URLs as the exact serialized suffix after the
   origin (`/path?q#h`, empty `?`/`#` preserved). Other origins, non-HTTP
   schemes and unparsable values are unchanged. Only metadata is touched.
4. Benefit: 6–36 % per snapshot on the corpus.
5. Regression: agents passing a relative `url=` value to `goto()` (handled by
   O5); external parsers expecting absolute URLs.
6. Validation: unit tests for every rule; corpus check that every ref's
   original URL equals `new URL(value ?? loc, pageUrl)`.

## O2 — Text folding

1. Current: `anchor [ref=4]` followed by a child line `text "Docs"`.
2. Problem: one extra line (indentation + `text` + newline) per link, button,
   heading or cell; ~10k such lines in the corpus.
3. Solution: in `compactSnapshotNode`, when a node's only child is a text
   leaf: if the node already has that exact name, drop the child; if the node
   is unnamed and its role takes its name from content (WAI-ARIA: link,
   button, heading, tab, cell, column/row header, menu item, option, tree
   item, switch), print the text as the name. Text under any other role
   (textbox value, paragraph, list item, container) is untouched.
4. Benefit: part of the 6–36 % above; applies to v1 `snapshot()` too.
5. Regression: a consumer that distinguishes the accessible name from child
   text for these roles (they are equal by definition).
6. Validation: unit tests (positive and negative roles, escaped quotes,
   multi-child, nested child); corpus check that every name/text literal
   still appears.

## O3 — Header

`[p1 "Title" https://host/path | space "s"(1): 1 managed, 0 untracked — p1*]`.
The URL is the base for O1 and lets an agent confirm navigation without an
extra `page.url()` round. The current Page's title is no longer repeated in
the inventory. Validation: page-model test on the header shape.

## O4 — Interactive snapshot (opt-in)

1. Current: no compact way to list targets; native `interactiveOnly` loses
   link text (anchors print as `anchor [ref=16]`), so it is not exposed.
2. Solution: `filterInteractiveSnapshot()` runs on the full compacted content
   in the SDK: keeps ref-bearing nodes and root/iframe/heading/dialog lines,
   re-indents under the nearest kept ancestor, names unnamed
   name-from-content refs from their own text (capped at 100 chars, marked
   `…`), and keeps a control's own text (field value). Option is stripped
   before the native call; validated by `public-api-schema.ts`.
3. Benefit: 33–76 % fewer tokens than the baseline snapshot.
4. Regression: none unless used. Body text is omitted by design, documented
   in `help()` and the Skill.
5. Validation: unit tests; page-model test that the option never reaches
   `ego.snapshot()`.

## O5 — Relative `goto()`

`goto("/path")` (not `//host`) resolves against `location.href`. Absolute
URLs take the old path with no extra call.

## O6 / O7 — CDP round trips

- O6: `capture()` already reads frame sessions after the native snapshot; the
  following `#pageDocuments()` now reuses them instead of reading
  `Target.getTargets` + `Page.getFrameTree` again. Only the post-capture read
  is shared, so the before/after document comparison is unchanged.
- O7: screenshot reads the device pixel ratio and viewport geometry in one
  `Runtime.evaluate`.

## O8 — Diff snapshots (opt-in)

1. Current: every re-observation reprints the whole snapshot, even when an
   action changed two lines or nothing.
2. Problem: after the first look at a Page, most snapshot tokens repeat text
   the agent already has.
3. Solution (`snapshot-diff.ts`, `page-ledger.ts`, `Page.snapshot`):
   - `diff: true` prints the full snapshot plus `snapshot id dN` and stores
     that exact body as the Page's diff base (`snapshot-bases/`, outside the
     ledger, removed on close/release/finish, expired with stale ledgers).
   - `diff: "dN"` prints `[unchanged since dN …]`, or a unified diff (Myers,
     2 context lines, hunk headers name the enclosing node), and stores the
     new body as `dN+1`.
   - The full snapshot is printed instead, with the reason, when `dN` is not
     the latest base for that Page, the scope/root/interactive/marks options
     differ, the target changed, or the diff would be over half the size.
   - Diffs are only ever taken against an id the caller names. An id is only
     printed together with the text it identifies, so a diff is always
     relative to text the agent was shown — never against a snapshot from
     another conversation or one that was not printed.
4. Benefit: re-observation after a small action costs 75–566 tokens instead
   of ~2.9k on the dashboard fixture; an unchanged page costs ~75 tokens.
5. Regression: none unless used. Writing the base costs one local file write
   per `diff` snapshot; a failed write prints no id and removes the base.
6. Validation: unit tests (round trip, 300 randomized edits, fallbacks,
   stale ids, option mismatch, ledger cleanup, write failure); real-browser
   E2E rebuilding a fresh full snapshot from base + diff; benchmark
   reconstruction of every diff chain against a plain snapshot.

## Deferred / rejected
- D2: `docs/native-snapshot-ref-requirement.md` deliberately keeps list items,
  images and SVG roots; removing them by default is lossy. `interactive`
  covers the cheap-view use case instead.
- D3: the CDP bridge has no batch call; skipping `DOM.describeNode` would let
  a unique-but-wrong locator be advertised.
- D4: the Skill steers agent behavior; trimming it needs agent evals, not
  token counts. Only a 6-line note was added for the new behavior.
