#!/usr/bin/env node
// Install this checkout's built runtime as the Ego Lite debug override, so a
// plain `ego-browser nodejs` / `ego-browser skill` (and every agent that runs
// them) uses it without `--sdk-path`.
//
//   npm run install:local            build, then install
//   npm run install:local -- --remove  remove the override (back to bundled)
//
// The override directory is the one the CLI checks after `--sdk-path`:
// ~/Library/Application Support/Citro Labs/debug (macOS). The installed
// Ego Lite app is never modified.

import { execFileSync } from "node:child_process";
import { cp, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const builtDir = join(packageDir, "dist", "out");

if (process.platform !== "darwin") {
  console.error(
    "install:local supports macOS only; elsewhere pass --sdk-path to ego-browser instead.",
  );
  process.exit(1);
}
const overrideDir = join(
  homedir(),
  "Library",
  "Application Support",
  "Citro Labs",
  "debug",
);

if (process.argv.includes("--remove")) {
  await rm(overrideDir, { recursive: true, force: true });
  console.log(`Removed ${overrideDir}; ego-browser uses the bundled runtime.`);
  process.exit(0);
}

await stat(join(builtDir, "index.js")).catch(() => {
  console.error(`No build at ${builtDir}; run npm run build first.`);
  process.exit(1);
});
// Replace, not merge, so files removed from the build do not linger.
await rm(overrideDir, { recursive: true, force: true });
await cp(builtDir, overrideDir, { recursive: true });
console.log(`Installed ${builtDir} -> ${overrideDir}`);

try {
  const firstLine = execFileSync("ego-browser", ["skill"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).split("\n")[0];
  console.log(
    firstLine.includes("source=debug-sdk")
      ? "Verified: ego-browser now loads this build."
      : `Warning: ego-browser did not report the override (${firstLine}).`,
  );
} catch {
  console.log("Installed; could not run `ego-browser skill` to verify.");
}
