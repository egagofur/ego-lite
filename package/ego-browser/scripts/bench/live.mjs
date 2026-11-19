#!/usr/bin/env node
// Real-browser observation benchmark for the Page API.
//
// Runs the current checkout's bundle through the installed Ego Lite CLI
// (`--sdk-path`), the same way `npm run e2e` does, against local fixture pages
// and (with --public) a few public pages. The inner script wraps
// `globalThis.ego` in a Proxy so every CDP command, every inbound CDP message
// and every native snapshot call is counted per phase without touching the
// runtime source.
//
//   node scripts/bench/live.mjs --label baseline --runs 3 [--public] [--out DIR]
//
// Output: <out>/<label>.json (per-run raw measurements, including the exact
// snapshot strings the agent would read) and a Markdown summary on stdout.
// Tokens are counted with js-tiktoken o200k_base when BENCH_TOKENIZER_DIR
// points at a directory where `js-tiktoken` is installed; otherwise they are
// estimated as ceil(chars / 4) and labelled as such.

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveEgoBrowserCli } from "../real-browser-e2e/ego-browser-cli.mjs";
import { countTokens, tokenizerLabel } from "./tokens.mjs";

const benchDir = dirname(fileURLToPath(import.meta.url));
const packageDir = join(benchDir, "..", "..");
const sdkPath = join(packageDir, "dist", "out", "index.js");

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  return value === undefined || value.startsWith("--") ? true : value;
}

const label = String(arg("label", "run"));
const runs = Number(arg("runs", 3));
const includePublic = Boolean(arg("public", false));
const outDir = String(
  arg("out", join(packageDir, "node_modules", ".cache", "ego-browser-bench")),
);

export const PUBLIC_PAGES = [
  ["wikipedia", "https://en.wikipedia.org/wiki/Web_browser"],
  ["python-docs", "https://docs.python.org/3/library/json.html"],
  ["github", "https://github.com/nodejs/node"],
  ["mdn", "https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input"],
  ["httpbin-form", "https://httpbin.org/forms/post"],
];

async function startServer() {
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, "http://x").pathname;
    const file = path === "/" ? "app.html" : path.slice(1);
    if (!/^[a-z]+\.html$/.test(file)) {
      res.writeHead(404).end();
      return;
    }
    try {
      const body = await readFile(join(benchDir, "fixtures", file));
      res.writeHead(200, {
        "content-type": extname(file) === ".html" ? "text/html" : "text/plain",
        "cache-control": "no-store",
      });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server;
}

function innerScript({ origin, outFile, publicPages }) {
  return `
const OUT = ${JSON.stringify(outFile)};
const ORIGIN = ${JSON.stringify(origin)};
const PUBLIC = ${JSON.stringify(publicPages)};
const { writeFile } = await import("node:fs/promises");
const real = globalThis.ego;
const phases = {};
let phase = "setup";
let onMessage;
const bucket = () => (phases[phase] ??= { cdpCalls: 0, methods: {}, outBytes: 0, inBytes: 0, inMessages: 0, nativeSnapshots: 0, nativeBytes: 0, ms: 0 });
globalThis.ego = new Proxy(real, {
  get(target, key) {
    if (key === "sendCDPMessage") return (payload) => {
      const b = bucket(); b.cdpCalls++; b.outBytes += payload.length;
      const method = JSON.parse(payload).method; b.methods[method] = (b.methods[method] || 0) + 1;
      return target.sendCDPMessage(payload);
    };
    if (key === "snapshot") return async (options) => {
      const b = bucket(); b.nativeSnapshots++;
      const result = await target.snapshot(options);
      b.nativeBytes += (result?.content || "").length;
      return result;
    };
    if (key === "onCDPMessage") return onMessage;
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  },
  set(target, key, value) {
    if (key === "onCDPMessage") {
      onMessage = value;
      target.onCDPMessage = typeof value === "function"
        ? (payload) => { const b = bucket(); b.inBytes += payload.length; b.inMessages++; return value(payload); }
        : value;
      return true;
    }
    target[key] = value;
    return true;
  },
});
const outputs = {};
async function step(name, fn) {
  phase = name;
  const start = performance.now();
  try {
    const value = await fn();
    if (typeof value === "string") outputs[name] = value;
    return value;
  } catch (error) {
    outputs[name] = "ERROR: " + (error?.message || String(error));
    bucket().error = String(error?.stack || error).slice(0, 1200);
  } finally {
    bucket().ms += performance.now() - start;
    phase = "between";
  }
}
const mem0 = process.memoryUsage();
const cpu0 = process.cpuUsage();
const t0 = performance.now();
const task = await taskSpace("ego-bench-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7));
const page = task.page("p1");
try {
  // Representative agent task: sign in through a form.
  await step("task:goto", () => page.goto(ORIGIN + "/form.html"));
  await step("task:observe1", () => page.snapshot());
  await step("task:act", async () => {
    await page.fill("loc=css:#user", "agent@example.com");
    await page.fill("loc=css:#pass", "not-a-real-secret");
    await page.click("loc=role:button[name='Sign in']");
    await page.waitForURL(/done\\.html/);
  });
  await step("task:observe2", () => page.snapshot());

  // Dashboard: viewport, full page, dynamic change, unchanged repeat.
  await step("app:goto", () => page.goto(ORIGIN + "/app.html"));
  await step("app:viewport", () => page.snapshot());
  await step("app:full", () => page.snapshot({ scope: "full_page" }));
  await step("app:dynamic", async () => {
    await page.click("loc=role:button[name='Load more orders']");
    return page.snapshot({ scope: "full_page" });
  });
  await step("app:repeat", () => page.snapshot({ scope: "full_page" }));
  await step("app:screenshot", () => page.screenshot());

  // The same observations as app:full / app:dynamic / app:repeat, taken with
  // diff ids; check:* are plain snapshots used only to verify reconstruction.
  const idOf = (text) => text?.split("\\n")[1]?.match(/snapshot id (d\\d+)\\]$/)?.[1];
  await step("flow:goto", () => page.goto(ORIGIN + "/app.html"));
  let id = idOf(await step("flow:full", () => page.snapshot({ scope: "full_page", diff: true })));
  id = idOf(await step("flow:dynamic", async () => {
    await page.click("loc=role:button[name='Load more orders']");
    return page.snapshot({ scope: "full_page", diff: id });
  }));
  await step("check:dynamic", () => page.snapshot({ scope: "full_page" }));
  id = idOf(await step("flow:repeat", () => page.snapshot({ scope: "full_page", diff: id })));
  id = idOf(await step("flow:fill", async () => {
    await page.fill("loc=css:#name", "Ada Lovelace");
    return page.snapshot({ scope: "full_page", diff: id });
  }));
  await step("check:fill", () => page.snapshot({ scope: "full_page" }));

  for (const [name, url] of PUBLIC) {
    await step(name + ":goto", () => page.goto(url, { timeout: 30000 }));
    await step(name + ":viewport", () => page.snapshot());
    await step(name + ":full", () => page.snapshot({ scope: "full_page" }));
    let pid = idOf(await step(name + ":vdiff1", () => page.snapshot({ diff: true })));
    pid = idOf(await step(name + ":vrepeat", () => page.snapshot({ diff: pid })));
    await step(name + ":vscroll", async () => {
      await page.mouse.wheel(0, 600);
      await page.waitForTimeout(300);
      return page.snapshot({ diff: pid });
    });
    await step(name + ":vcheck", () => page.snapshot());
  }
} finally {
  phase = "teardown";
  await task.finish({ keep: [] }).catch(() => {});
}
const mem1 = process.memoryUsage();
const cpu = process.cpuUsage(cpu0);
await writeFile(OUT, JSON.stringify({
  totalMs: performance.now() - t0,
  cpuUserMs: cpu.user / 1000,
  cpuSystemMs: cpu.system / 1000,
  memStart: { rss: mem0.rss, heapUsed: mem0.heapUsed },
  memEnd: { rss: mem1.rss, heapUsed: mem1.heapUsed },
  phases,
  outputs,
}));
`;
}

function runCli(cli, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(cli, ["nodejs", "--sdk-path", sdkPath], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve(output)
        : reject(new Error(`CLI exited ${code}: ${output.slice(-2000)}`)),
    );
    child.stdin.end(input);
  });
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return NaN;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export async function summarize(results) {
  const phaseNames = [
    ...new Set(results.flatMap((r) => Object.keys(r.phases))),
  ].filter((name) => !["between"].includes(name));
  const rows = [];
  for (const name of phaseNames) {
    const items = results.map((r) => r.phases[name]).filter(Boolean);
    const outputs = results.map((r) => r.outputs[name]).filter((v) => v);
    const text = outputs[0] ?? "";
    rows.push({
      phase: name,
      ms: median(items.map((p) => p.ms)),
      cdpCalls: median(items.map((p) => p.cdpCalls)),
      outBytes: median(items.map((p) => p.outBytes)),
      inBytes: median(items.map((p) => p.inBytes)),
      nativeSnapshots: median(items.map((p) => p.nativeSnapshots)),
      outputChars: text.startsWith("ERROR") ? 0 : text.length,
      outputTokens: text.startsWith("ERROR") ? 0 : await countTokens(text),
      errors: items.filter((p) => p.error).length,
      methods: items[0]?.methods ?? {},
    });
  }
  return {
    tokenizer: await tokenizerLabel(),
    runs: results.length,
    totalMs: median(results.map((r) => r.totalMs)),
    cpuUserMs: median(results.map((r) => r.cpuUserMs)),
    cpuSystemMs: median(results.map((r) => r.cpuSystemMs)),
    rssStartMB: median(results.map((r) => r.memStart.rss / 2 ** 20)),
    rssEndMB: median(results.map((r) => r.memEnd.rss / 2 ** 20)),
    heapEndMB: median(results.map((r) => r.memEnd.heapUsed / 2 ** 20)),
    rows,
  };
}

/**
 * Rebuild each diff-based observation from the previous one and compare it
 * with the plain snapshot taken right after it. Local fixtures must match
 * exactly; a live public page may legitimately change in between.
 */
export async function verifyDiffFlows(results) {
  const { applySnapshotDiff } = await import(
    join(packageDir, "dist", "src", "snapshot-diff.js")
  );
  const body = (text) => text.split("\n").slice(2).join("\n");
  const plain = (text) => text.split("\n").slice(1).join("\n");
  const next = (previous, text) => {
    const note = text.split("\n")[1] ?? "";
    if (note.startsWith("[unchanged")) return previous;
    if (note.startsWith("[changes"))
      return applySnapshotDiff(previous, body(text));
    return body(text);
  };
  const checks = [];
  for (const [index, run] of results.entries()) {
    const out = run.outputs;
    const chains = [
      ["app", ["flow:full", "flow:dynamic"], "check:dynamic"],
      [
        "app",
        ["flow:full", "flow:dynamic", "flow:repeat", "flow:fill"],
        "check:fill",
      ],
      ...PUBLIC_PAGES.map(([name]) => [
        name,
        [`${name}:vdiff1`, `${name}:vrepeat`, `${name}:vscroll`],
        `${name}:vcheck`,
      ]),
    ];
    for (const [name, steps, check] of chains) {
      if (
        !steps.every((step) => out[step]?.includes("snapshot id")) ||
        !out[check] ||
        out[check].startsWith("ERROR")
      )
        continue;
      let current = "";
      try {
        for (const step of steps) current = next(current, out[step]);
        checks.push({
          run: index,
          name,
          check,
          exact: current === plain(out[check]),
        });
      } catch (error) {
        checks.push({
          run: index,
          name,
          check,
          exact: false,
          error: error.message,
        });
      }
    }
  }
  return checks;
}

export function markdown(summary) {
  const lines = [
    `Runs: ${summary.runs}; tokenizer: ${summary.tokenizer}`,
    `Total ${summary.totalMs.toFixed(0)} ms; CPU user ${summary.cpuUserMs.toFixed(0)} ms / sys ${summary.cpuSystemMs.toFixed(0)} ms; RSS ${summary.rssStartMB.toFixed(1)} → ${summary.rssEndMB.toFixed(1)} MB; heap ${summary.heapEndMB.toFixed(1)} MB`,
    "",
    "| Phase | ms (median) | CDP calls | CDP out B | CDP in B | Output chars | Output tokens |",
    "|---|---:|---:|---:|---:|---:|---:|",
  ];
  for (const row of summary.rows) {
    lines.push(
      `| ${row.phase}${row.errors ? " ⚠" : ""} | ${row.ms.toFixed(0)} | ${row.cdpCalls} | ${row.outBytes} | ${row.inBytes} | ${row.outputChars} | ${row.outputTokens} |`,
    );
  }
  return lines.join("\n");
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const cli = resolveEgoBrowserCli();
  const server = await startServer();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const results = [];
  try {
    for (let i = 0; i < runs; i += 1) {
      const outFile = join(outDir, `${label}-run${i}.json`);
      await runCli(
        cli,
        innerScript({
          origin,
          outFile,
          publicPages: includePublic ? PUBLIC_PAGES : [],
        }),
      );
      results.push(JSON.parse(await readFile(outFile, "utf8")));
      process.stderr.write(`run ${i + 1}/${runs} done\n`);
    }
  } finally {
    server.close();
  }
  const summary = await summarize(results);
  summary.diffChecks = await verifyDiffFlows(results);
  await writeFile(
    join(outDir, `${label}.json`),
    JSON.stringify({ summary, results }, null, 2),
  );
  console.log(markdown(summary));
  const exact = summary.diffChecks.filter((check) => check.exact).length;
  console.log(
    `\nDiff reconstruction: ${exact}/${summary.diffChecks.length} exact`,
  );
  for (const check of summary.diffChecks.filter((item) => !item.exact)) {
    console.log(
      `  mismatch run ${check.run} ${check.name} vs ${check.check}${check.error ? `: ${check.error}` : ""}`,
    );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
