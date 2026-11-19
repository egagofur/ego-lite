#!/usr/bin/env node
// Offline token comparison on a frozen corpus.
//
// Re-applies the current build's snapshot compaction to the exact snapshot
// bodies captured by `live.mjs` on an earlier build, so before/after numbers
// come from identical page states instead of two different live captures.
//
//   npm run build
//   node scripts/bench/offline.mjs <baseline.json>
//
// The header line is excluded on both sides (its format changed; live runs
// measure it). Public pages are matched to their URLs from live.mjs; local
// fixture pages recover their origin from the content itself.

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { countTokens, tokenizerLabel } from "./tokens.mjs";
import { PUBLIC_PAGES } from "./live.mjs";

const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const {
  compactSnapshotContent,
  compactSnapshotUrls,
  filterInteractiveSnapshot,
} = await import(join(packageDir, "dist", "src", "snapshot-result.js"));

const LOCAL_PATHS = {
  "task:observe1": "/form.html",
  "task:observe2": "/done.html?user=agent%40example.com&pass=not-a-real-secret",
  "app:viewport": "/app.html",
  "app:full": "/app.html",
  "app:dynamic": "/app.html",
  "app:repeat": "/app.html",
};
const publicUrls = new Map(PUBLIC_PAGES);

function pageUrlFor(phase, body) {
  const [name] = phase.split(":");
  if (publicUrls.has(name)) return publicUrls.get(name);
  const origin = body.match(/https?:\/\/127\.0\.0\.1:\d+/)?.[0];
  return origin && LOCAL_PATHS[phase] ? origin + LOCAL_PATHS[phase] : undefined;
}

const file = process.argv[2];
if (!file) throw new Error("usage: offline.mjs <baseline.json>");
const { results } = JSON.parse(await readFile(file, "utf8"));
// Use the first run with a clean output for every phase.
const bodies = new Map();
for (const run of results) {
  for (const [phase, text] of Object.entries(run.outputs)) {
    if (bodies.has(phase) || typeof text !== "string") continue;
    if (text.startsWith("ERROR") || !text.includes("\nroot")) continue;
    bodies.set(phase, text.slice(text.indexOf("\n") + 1));
  }
}

const rows = [];
const totals = { before: 0, after: 0, interactive: 0 };
for (const [phase, before] of bodies) {
  const url = pageUrlFor(phase, before);
  const folded = compactSnapshotContent(before);
  const after = url ? compactSnapshotUrls(folded, url) : folded;
  const interactive = filterInteractiveSnapshot(after);
  const row = {
    phase,
    before: await countTokens(before),
    after: await countTokens(after),
    interactive: await countTokens(interactive),
    lossless:
      after.match(/\[ref=\d+/g)?.length === before.match(/\[ref=\d+/g)?.length,
  };
  rows.push(row);
  totals.before += row.before;
  totals.after += row.after;
  totals.interactive += row.interactive;
}

const pct = (a, b) => `${(((b - a) / a) * 100).toFixed(1)}%`;
console.log(`Tokenizer: ${await tokenizerLabel()}\n`);
console.log(
  "| Snapshot | Before | After (default) | Δ | Interactive (opt-in) | Δ | refs kept |",
);
console.log("|---|---:|---:|---:|---:|---:|:---:|");
for (const row of rows) {
  console.log(
    `| ${row.phase} | ${row.before} | ${row.after} | ${pct(row.before, row.after)} | ${row.interactive} | ${pct(row.before, row.interactive)} | ${row.lossless ? "all" : "NO"} |`,
  );
}
console.log(
  `| **Total** | **${totals.before}** | **${totals.after}** | **${pct(totals.before, totals.after)}** | **${totals.interactive}** | **${pct(totals.before, totals.interactive)}** | |`,
);
