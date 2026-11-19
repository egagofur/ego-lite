# Final report

Baseline: `f499162`, unmodified. Final: the same commit plus the changes in
[`implementation-plan.md`](implementation-plan.md) (O1–O7). Same machine,
same Ego Lite app, same workload (`scripts/bench/live.mjs --runs 3 --public`),
same tokenizer. Raw summaries:
[`data/baseline-summary.json`](data/baseline-summary.json),
[`data/final-summary.json`](data/final-summary.json).

**Measured vs estimated.** All numbers below are measured. Token counts use
`o200k_base` (GPT-4o/Codex tokenizer) as a proxy; Claude's tokenizer is not
available offline, so absolute Claude token counts are not claimed, only the
relative change under a standard BPE tokenizer. Live public-page numbers
depend on the page served at that moment; the frozen-corpus table removes
that variable.

## Token reduction

### Identical input (frozen corpus)

`scripts/bench/offline.mjs` re-applies the final compaction to the exact
snapshot bodies captured on the baseline build (header excluded on both
sides).

| Snapshot | Baseline | Final default | Δ | `interactive: true` | Δ |
|---|---:|---:|---:|---:|---:|
| sign-in form | 147 | 124 | −15.6 % | 89 | −39.5 % |
| after sign-in | 108 | 69 | −36.1 % | 44 | −59.3 % |
| dashboard viewport | 3238 | 2210 | −31.7 % | 1223 | −62.2 % |
| dashboard full | 3529 | 2418 | −31.5 % | 1412 | −60.0 % |
| dashboard after DOM change | 4097 | 2806 | −31.5 % | 1627 | −60.3 % |
| Wikipedia viewport | 3665 | 2819 | −23.1 % | 1856 | −49.4 % |
| Wikipedia full | 52298 | 41848 | −20.0 % | 27050 | −48.3 % |
| Python docs viewport | 2494 | 2261 | −9.3 % | 1121 | −55.1 % |
| Python docs full | 18723 | 17494 | −6.6 % | 4427 | −76.4 % |
| GitHub viewport | 4644 | 3862 | −16.8 % | 2685 | −42.2 % |
| GitHub full | 47366 | 41016 | −13.4 % | 27625 | −41.7 % |
| MDN viewport | 2753 | 2227 | −19.1 % | 1516 | −44.9 % |
| MDN full | 78234 | 66523 | −15.0 % | 42141 | −46.1 % |
| httpbin form | 343 | 341 | −0.6 % | 228 | −33.5 % |
| **Corpus total** (16 snapshots) | **226079** | **189176** | **−16.3 %** | **114910** | **−49.2 %** |

Default output is lossless on this corpus: every ref is kept, every
name/text literal still appears, and every ref's original absolute URL is
recovered by `new URL(url ?? loc=href, pageUrl)` (16 snapshots, 0 mismatches).
The check found one bug during development (an empty `#` fragment was
dropped), which is fixed and covered by a unit test.

Text-heavy pages gain least (Python docs −7 %): their tokens are body text,
which the default mode keeps by design. Link- and table-heavy pages gain most.

### Live end-to-end (string printed by `page.snapshot()`, header included)

| Phase | Baseline tokens | Final tokens | Δ |
|---|---:|---:|---:|
| task: snapshot 1 + 2 | 189 + 148 = 337 | 177 + 137 = 314 | −6.8 % |
| dashboard viewport | 3280 | 2263 | −31.0 % |
| dashboard full | 3571 | 2471 | −30.8 % |
| dashboard after DOM change | 4139 | 2859 | −30.9 % |
| Wikipedia viewport / full | 3709 / 52342 | 3023 / 41892 | −18.5 % / −20.0 % |
| GitHub viewport / full | 4712 / 47434 | 3928 / 41086 | −16.6 % / −13.4 % |
| MDN viewport / full | 2809 / 78290 | 2289 / 66585 | −18.5 % / −15.0 % |
| httpbin form | 389 | 389 | 0 % |

The header now carries the Page URL (+5–15 tokens), so tiny pages see a
smaller net gain than the body alone; the URL also replaces a separate
`page.url()` round an agent would otherwise spend to confirm navigation.

## Diff snapshots (O8, opt-in)

Measured live, 3 runs, medians ([`data/diff-summary.json`](data/diff-summary.json)).
`check:*` are plain snapshots taken right after, for comparison and
verification.

| Observation (dashboard fixture, full page) | Plain snapshot | With `diff` | Δ |
|---|---:|---:|---:|
| first look (`diff: true`) | 2471 | 2480 | +0.4 % (id line) |
| after "Load more" (5 rows added) | 2859 | 566 | −80.2 % |
| repeat, page unchanged | 2859 | 75 | −97.4 % |
| after typing into a field | 2876 | 307 | −89.3 % |

| Public page, viewport | Plain | Unchanged repeat | After 600 px scroll |
|---|---:|---:|---:|
| Wikipedia | 3023 | 70 | 2988 (full: new content) |
| Python docs | 2323 | 83 | 2180 (full) |
| GitHub | 3939 | 81 | 4032 (full) |
| MDN | 2289 | 84 | 1511 (diff) |
| httpbin form | 389 | 70 | 70 (page fits; unchanged) |

Agent-flow totals on the dashboard (observe → act → observe → re-observe):

| Flow | Tokens | vs original baseline |
|---|---:|---:|
| Original build, plain snapshots (3571 + 4139 + 4139) | 11849 | – |
| This branch, plain snapshots (2471 + 2859 + 2859) | 8189 | −30.9 % |
| This branch, `diff` snapshots (2480 + 566 + 75) | 3121 | **−73.7 %** |

Every additional re-observation of the same Page costs 75–600 tokens instead
of a full snapshot, so longer sessions on one Page go past 80 %. Scrolling a
viewport changes most of its lines and correctly falls back to the full
snapshot, so reading a long page by scrolling gains little; `full_page` with
`diff` covers that case.

**Quality check:** the benchmark rebuilds every diff chain (base + each
unchanged/diff output) and compares it with the plain snapshot taken right
after: **21/21 exact**, including the five public sites. The real-browser E2E
case "Page snapshot diff" asserts the same against a fresh full snapshot, and
a unit test applies 300 randomized edits.

## CDP, latency, CPU, memory

| Metric | Baseline | Final | Note |
|---|---:|---:|---|
| `Target.getTargets` per snapshot | 3 | 2 | O6 |
| `Page.getFrameTree` per snapshot (single frame) | 5–7 | 5–6 | O6 |
| CDP calls, dashboard viewport / full / repeat | 48 / 56 / 61 | 46 / 54 / 59 | −2 per snapshot |
| CDP calls, screenshot | 4 | 3 | O7 |
| Snapshot ms, sum of 6 local snapshots per run | 628 / 316 / 282 | 331 / 290 / 302 | within run-to-run noise after run 1 |
| Screenshot ms (median) | 94 | 63 | one round trip fewer |
| Whole workload, harness CPU user / sys (median) | 880 / 438 ms | 883 / 310 ms | no material change |
| Heap at run start | 6.6 MB | 6.3 MB | constant: nothing retained between runs |
| Heap at run end | 57 / 100 / 9.5 MB | 89 / 89 / 89 MB | GC-timing dependent; not attributable |
| Success, local task phases | 3/3 | 3/3 | |
| Success, public phases | 33/45 | 45/45 | baseline misses were browser renderer hangs |

Total CDP calls per run across the local phases moved 361 → 366: the
snapshot path saves 2–3 calls each, but which phase pays for a session
re-attach after the form's cross-document navigation varies run to run
(`task:observe2` absorbed `Target.attachToTarget` + 4 domain enables in two
final runs). Snapshot latency is dominated by the native capture and the
per-locator `DOM.describeNode` validation, which were deliberately kept.

Harness idle CPU is zero before and after: there is no resident harness
process between invocations. Browser idle CPU belongs to Ego Lite.

## Regression testing

| Check | Result |
|---|---|
| `npm test` (build, skill-translation guard, guide-size guard, `tsc --noEmit`, unit tests) | pass, 676/676 (baseline 662; +14 new) |
| `npm run style:check` | pass |
| `npm run validate:site-skills` | pass |
| `npm run e2e` real browser, final code | pass, 85/85 cases (83 existing + "Page snapshot compact output", 17 assertions + "Page snapshot diff", 11 assertions) |

E2E history during the work, for transparency: one intermediate full run had
a single failure, `Page click hit target`, with `CDP request timed out:
Target.getTargets` (a browser-process timeout). The case passed in every
other full run and 3/3 isolated reruns; the click path was not changed. A
review of O6 then added a fallback for an out-of-process frame session that
detaches between capture and the document check (with a unit test); the
final full run above is on that code.

Scenario coverage from the mission, by where it is exercised: navigation,
page summary, interactive elements, locate, click, fill, navigate between
pages, dynamic DOM, stale refs, multiple tabs, multiple TaskSpaces, dialogs,
failed-operation recovery — existing E2E cases (`navigation`, `page labels`,
`page-ref-*`, `page-dialogs`, `page-pending-navigation`,
`page-evaluate-timeout`, `task-space`, `workflow-chains`) plus the new
compact-output case. Browser disconnection/reconnection is covered by unit
tests (session loss and re-attach in `browser-runtime`), not by a real
browser restart.

## Breaking or visible changes

- Snapshot text: link/button/heading/cell text is printed as the node name;
  same-origin `url=` values are root-relative or omitted when `loc=href:`
  gives the target. Refs, locators and text are unchanged.
- Header: `[p1 "Title" <url> | space … — p1*, p2 "Other"]` (URL added;
  current Page's title not repeated).
- New: `page.snapshot({ interactive: true })`, `page.snapshot({ diff })`;
  `page.goto("/path")`. `diff` stores the last diff snapshot body per Page
  under the state directory (`snapshot-bases/`), removed when the Page or
  task ends.
- No API removed; no option's default changed; v1 helpers get the text
  folding (shared compaction) but not the URL rewrite (no header there).

## Remaining bottlenecks

1. Large-page locator validation: one `DOM.describeNode` per advertised
   locator (534 on Wikipedia full page) and full AX trees per frame for role
   locators (~8 MB inbound on MDN). Needs a batch primitive in the native
   bridge or native-side validation.
2. Diff mode only helps when the agent opts in; scrolling a viewport still
   reprints most of it.
3. The Skill body (~25 KB) is the largest fixed per-session cost; trimming it
   needs agent-behavior evals.
4. Indentation (9–13 %) and `[ref=` metadata (10–14 %) are the largest
   remaining structural costs; changing the tree encoding would break the
   documented format.
5. Renderer hangs on some public sites are browser-side.

## Reproduce

```bash
cd package/ego-browser
npm ci && npm run build
mkdir -p /tmp/tok && (cd /tmp/tok && npm init -y >/dev/null && npm i js-tiktoken@1.0.21)
BENCH_TOKENIZER_DIR=/tmp/tok node scripts/bench/live.mjs --label final --runs 3 --public
BENCH_TOKENIZER_DIR=/tmp/tok node scripts/bench/offline.mjs node_modules/.cache/ego-browser-bench/<baseline>.json
```

Without `BENCH_TOKENIZER_DIR`, token counts fall back to `ceil(chars / 4)`
and are labelled as estimates.
