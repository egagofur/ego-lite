# Repository audit — token and resource efficiency

Scope: the open-source `ego-browser` harness in `package/ego-browser` and the
agent Skill. The browser, the native bindings (`globalThis.ego`), and the
native snapshot serializer are closed source and out of scope; they are
treated as fixed inputs.

## Architecture

```text
agent ── heredoc JS ──► ego-browser CLI (Ego Lite app)
                          │ loads dist/out/index.js (--sdk-path for local builds)
                          ▼
                 runMain() → helpers injected into an async function
                          │
          TaskSpace / Page (page-model.ts) ─── page-ledger.ts (JSON per space)
                          │                   page-ref-registry.ts (@N refs)
                          ▼
     browser-runtime.ts: rawCdp() → ego.sendCDPMessage / ego.onCDPMessage
                         session cache (2 s TTL), event queue (10k cap)
                          │
     ego.snapshot() (native) → observe.snapshot() → compactSnapshotResult()
                          │
     Page.snapshot(): document check, locator validation, ref registration,
                      header, viewport-overflow hint → string printed by agent
```

Each agent round is a new CLI invocation. There is no resident harness process
between rounds: task spaces, page labels and refs persist in the page ledger
files, and all JavaScript state is rebuilt per run.

## Important modules

| Module | Lines | Role |
|---|---:|---|
| `page-model.ts` | 4.5k | TaskSpace/Page API, snapshot assembly, action boundaries |
| `element-resolver.ts` | 2.6k | `@N`, `loc=`, `xpath=`, CSS resolution; snapshot locator validation |
| `driver/page-actions.ts` | 2.0k | click/fill/press/etc. on Pages |
| `browser-runtime.ts` | 1.8k | CDP transport, sessions, OOPIF attach, events, dialogs |
| `driver/page-waits.ts` | 1.2k | waitFor* |
| `page-ledger.ts` | 0.9k | versioned JSON ledger per space |
| `snapshot-result.ts` | 0.5k | snapshot text compaction, locator sanitizing, frame provenance |
| `public-api-schema.ts` | 0.8k | v2 API source of truth (validation + `help()`) |

## Snapshot path (the dominant token producer)

1. `Page.snapshot()` activates the target and reads the page's documents
   (`Page.getFrameTree` per session, via `ensureFrameSessions`).
2. `ego.snapshot()` returns `{ content, refs }`; `observe.snapshot()` compacts
   empty text and single-child containers.
3. `preparePageSnapshotResult()` validates every advertised `loc=` (batched
   count + object resolution, then one `DOM.describeNode` per locator; role
   locators fetch the full AX tree per frame) and backfills frame ids.
4. Documents are read again; a capture that straddled a commit is retried
   (≤ 2 retries).
5. Refs are registered and saved to the ledger; native ref ids are rewritten.
6. A header line (`[p1 "Title" | space …]`) is prepended, plus a
   `[more content …]` hint for viewport snapshots.

Line format: `role "name" [ref=N, loc=…, url=…]`, two-space indentation;
`url=` is always last and its value may contain commas.

## Dependencies

- Runtime: `acorn` only — used by `run.ts` (script parsing), `cdp-eval.ts`
  (expression wrapping) and `help-runtime.ts` (JSDoc for `help()`). Required.
- Dev: rollup, esbuild, typescript, prettier, lefthook, tslib, `@types/node`.
  All referenced by `scripts/build.mjs`, `package.json` scripts or hooks.
- Bundle: `dist/out/index.js` ≈ 0.92 MB, loaded once per invocation.

No unused or duplicate dependency was found; none is removed.

## Bottlenecks found

| # | Area | Evidence (baseline, see `baseline.md`) |
|---|---|---|
| B1 | `url=` metadata | 19–30 % of snapshot tokens; same-origin absolute URLs repeat the origin on every link and often repeat the `loc=href:` path |
| B2 | Text-only child lines | `anchor [ref]` + child `text "Docs"` costs an extra line (indent + `text` + newline) for ~5k links/buttons/cells per corpus |
| B3 | Header | current Page title printed twice (lead + inventory); Page URL never printed, so agents call `page.url()` separately |
| B4 | No cheap "what can I click" view | agents must read the full tree (body text included) to choose a target; native `interactiveOnly` drops link text, so it is not usable as is |
| B5 | Snapshot CDP overhead | 18–61 CDP calls for small pages; 500+ on large pages (one `DOM.describeNode` per validated locator); `Target.getTargets`/`Page.getFrameTree` read 3×/7× per snapshot |
| B6 | Screenshot | two sequential `Runtime.evaluate` round trips before capture |
| B7 | Skill text | `skill-body/SKILL.md` ≈ 24 KB (~6k tokens) printed once per session |
| B8 | Large-page role-locator validation | MDN full-page: 56 `Accessibility.getFullAXTree` calls, ~8 MB inbound CDP per snapshot (ad iframes multiply contexts and trigger document-change retries) |

## Technical debt and observations

- Repeated snapshots of an unchanged page cost the full snapshot again; there
  is no diff mode. A diff needs the previous text persisted per Page (ledger
  growth, write amplification) and a stable invalidation rule — deferred.
- The documented native compaction contract
  (`docs/native-snapshot-ref-requirement.md`) explicitly keeps list items,
  images and SVG roots. The harness respects it: no structural node is
  removed by default.
- Public sites intermittently hung the renderer during the benchmark
  (`Page.getFrameTree` unanswered for 15 s, then cascading to later pages in
  the same Page). This is browser-side; the harness reports it correctly.
- The CDP bridge exposes no batch call, so per-node `DOM.describeNode` for
  locator validation cannot be reduced without weakening the "locator
  resolves uniquely to the same node" guarantee.

## Risk assessment

| Change class | Risk | Mitigation |
|---|---|---|
| Snapshot text format | Agents or tests parsing `url=` or child `text` lines | Lossless rules only; corpus verification (every name/text literal and every link URL recoverable); `goto()` accepts the relative form |
| New opt-in option | Unknown option rejected by older SDKs | Opt-in only; documented in `help()` and Skill |
| CDP call reuse | Missing a frame change between capture and check | Reuse only frame sessions read after the same capture |
| Header change | Scripts matching the old header | Fields kept; only the duplicate title removed and URL appended |
