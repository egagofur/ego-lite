# Baseline benchmark

Build: `main` at `f499162` (v2.2.1-beta.3 merge), unmodified. Measured
2026-11-19 on macOS (Darwin 27.2), Ego Lite installed app, Node 22 host.
Raw summary: [`data/baseline-summary.json`](data/baseline-summary.json).

## Method

`package/ego-browser/scripts/bench/live.mjs` runs the checkout's bundle
through the installed CLI with `--sdk-path` (same mechanism as `npm run e2e`)
and wraps `globalThis.ego` in a Proxy inside the run, so every CDP command,
every inbound CDP message, and every native `ego.snapshot()` call is counted
per phase without modifying the runtime. Each run uses a fresh task space,
closed with `finish({ keep: [] })`.

Workload per run (identical across runs and builds):

| Phase | What it does |
|---|---|
| `task:*` | representative agent task on a local fixture: goto sign-in form → snapshot → fill 2 fields + click + `waitForURL` → snapshot |
| `app:*` | local dashboard fixture (nav, search, 25-row table, form, footer): viewport snapshot, full-page snapshot, click "Load more" + full snapshot (dynamic DOM), unchanged repeat full snapshot, screenshot |
| public | Wikipedia article, docs.python.org page, GitHub repo page, MDN page, httpbin form: goto, viewport snapshot, full-page snapshot |

Tokens: `js-tiktoken` `o200k_base` (the GPT-4o/Codex tokenizer), counted on
the exact string `page.snapshot()` returns. **Claude's tokenizer is not
available offline; these counts are a measured proxy, not Claude token
counts.** Relative changes transfer well between BPE tokenizers; absolute
counts do not.

Runs: 3. Values are medians. Run 3 hit browser-side renderer hangs on the
public pages (`Page.getFrameTree` unanswered for 15 s, cascading through every
later public page in the same Page); local-fixture phases were unaffected.
Public-page latency medians therefore include one hung run and are only
indicative. Hacker News was replaced after an earlier attempt was
rate-limited.

## Local fixtures (stable)

| Phase | ms | CDP calls | CDP out B | CDP in B | Output tokens |
|---|---:|---:|---:|---:|---:|
| task:goto | 899 | 11 | 1294 | 17286 | – |
| task:observe1 (snapshot) | 31 | 18 | 8134 | 21234 | 189 |
| task:act (fill ×2, click, waitForURL) | 349 | 55 | 113712 | 59477 | – |
| task:observe2 (snapshot) | 25 | 19 | 8371 | 23803 | 148 |
| app:goto | 253 | 12 | 1459 | 23828 | – |
| app:viewport | 35 | 48 | 94532 | 36497 | 3280 |
| app:full | 27 | 56 | 117359 | 40951 | 3571 |
| app:dynamic (click + full) | 156 | 81 | 174540 | 318577 | 4139 |
| app:repeat (unchanged full) | 37 | 61 | 132405 | 43238 | 4139 |
| app:screenshot | 94 | 4 | 767 | 236997 | 36 |

Representative task total (two snapshots): **337 output tokens**, 103 CDP
calls. Success: 3/3 runs.

## Public pages (indicative)

| Page | viewport tokens | full-page tokens | full-page CDP calls | full-page ms |
|---|---:|---:|---:|---:|
| Wikipedia | 3709 | 52342 | 550 | 3643 |
| docs.python.org | 2560 | 18789 | 36 | 73 |
| GitHub repo | 4712 | 47434 | 507 | 2555 |
| MDN | 2809 | 78290 | 545 | 5406 |
| httpbin form | 389 | 389 | 23 | 106 |

Success: run 1 15/15 phases, run 2 14/15, run 3 4/15 (renderer hang).

## Where snapshot tokens go

Share of tokens per line component (`o200k_base`, run 1):

| Snapshot | url= | loc= | [ref=N | indentation | text lines | role-only lines |
|---|---:|---:|---:|---:|---:|---:|
| app full | 19.4 % | 12.3 % | 13.0 % | 12.5 % | 28.9 % | 14.6 % |
| Wikipedia full | 30.3 % | 13.6 % | 10.4 % | 8.9 % | 32.0 % | 6.4 % |
| GitHub full | 23.2 % | 13.9 % | 11.6 % | 8.9 % | 38.4 % | 5.2 % |
| MDN full | 28.8 % | 7.7 % | 14.2 % | 9.4 % | 36.9 % | 4.4 % |

Of ~9k ref-bearing lines in the corpus, 5,932 carry `url=`; 2,851 carry both
`loc=href:` and `url=` for the same target. ~10k `text` lines are the only
child of a link, button, heading, or cell.

## CDP per snapshot

`app:viewport` (48 calls): `DOM.describeNode` 31, `Page.getFrameTree` 7,
`Runtime.evaluate` 4, `Target.getTargets` 3, `Target.activateTarget`,
`Runtime.getProperties`, `Runtime.releaseObjectGroup` 1 each.
`wikipedia:full`: `DOM.describeNode` 534 of 550.
`mdn:full`: 56 `Accessibility.getFullAXTree` and 15 iframe attaches; ~8.5 MB
inbound.

## CPU and memory

The CLI runs scripts in a long-lived embedded Node host, so RSS includes the
host and carries over between runs (71–148 MB at start). Heap used at the
start of each run is constant (6.6 MB, 6.6 MB, 6.6 MB), so nothing is retained
between runs. Peak heap at the end of a run with three large full-page
snapshots: 57–100 MB. Harness CPU for the whole workload: ≈ 0.9 s user +
0.4–0.5 s system. There is no harness process between runs, so harness idle
CPU is zero by construction; browser idle CPU belongs to Ego Lite and is
unaffected by this repository.

## Other baselines

- Unit tests: 662/662 pass (`npm test`, 20 s wall).
- Skill body printed per session: 24,628 bytes.
- Bundle: `dist/out/index.js` 921 KB; one runtime dependency (`acorn`).
