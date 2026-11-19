import test from "node:test";
import assert from "node:assert/strict";

import {
  applySnapshotDiff,
  diffSnapshotBodies,
} from "../dist/src/snapshot-diff.js";

const page = (rows) =>
  [
    "root",
    '  heading "Orders"',
    "  table",
    ...rows.flatMap((row, index) => [
      "    table_row",
      `      table_cell "#${row}" [ref=${index + 1}]`,
      `      button "Refund" [ref=${100 + index}]`,
    ]),
    '  button "Load more orders" [ref=500]',
  ].join("\n");

test("identical snapshots report unchanged", () => {
  const body = page([1, 2, 3]);
  assert.deepEqual(diffSnapshotBodies(body, body), {
    kind: "unchanged",
    lines: body.split("\n").length,
  });
});

test("a small change prints a located unified diff that reproduces the new snapshot", () => {
  const rows = Array.from({ length: 40 }, (_, index) => index + 1);
  const before = page(rows);
  const after = page([...rows, 41, 42]).replace(
    'table_cell "#7" [ref=7]',
    'table_cell "#7 refunded" [ref=7]',
  );
  const diff = diffSnapshotBodies(before, after);
  assert.equal(diff.kind, "diff");
  assert.equal(applySnapshotDiff(before, diff.text), after);
  assert.equal(diff.removed, 1);
  assert.equal(diff.added, 7);
  assert.match(diff.text, /^@@ -\d+,\d+ \+\d+,\d+ @@ in table$/m);
  assert.match(diff.text, /^- {6}table_cell "#7" \[ref=7\]$/m);
  assert.match(diff.text, /^\+ {6}table_cell "#7 refunded" \[ref=7\]$/m);
  assert(diff.text.length < after.length / 4, "the diff is much smaller");
});

test("a mostly replaced snapshot falls back to the full snapshot", () => {
  const before = page([1, 2, 3, 4, 5]);
  const after = page([6, 7, 8, 9, 10]).replaceAll("Refund", "Reorder");
  assert.deepEqual(diffSnapshotBodies(before, after), { kind: "full" });
});

test("diffs round-trip on edits at the start, end, and across the tree", () => {
  const base = page(Array.from({ length: 30 }, (_, index) => index + 1));
  const lines = base.split("\n");
  const cases = [
    ["insert first", ["preface", ...lines].join("\n")],
    ["delete last", lines.slice(0, -1).join("\n")],
    ["append", [...lines, '  text "footer"'].join("\n")],
    ["empty to text", ""],
  ];
  for (const [name, after] of cases) {
    const diff = diffSnapshotBodies(base, after);
    if (diff.kind === "diff") {
      assert.equal(applySnapshotDiff(base, diff.text), after, name);
    } else {
      assert.notEqual(diff.kind, "unchanged", name);
    }
  }
});

test("random edits always round-trip exactly", () => {
  let seed = 42;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed / 2 ** 31;
  };
  let diffs = 0;
  for (let iteration = 0; iteration < 300; iteration += 1) {
    const before = page(
      Array.from({ length: 5 + Math.floor(random() * 60) }, (_, i) => i),
    ).split("\n");
    const after = [...before];
    const edits = 1 + Math.floor(random() * 8);
    for (let edit = 0; edit < edits; edit += 1) {
      const at = Math.floor(random() * (after.length + 1));
      const kind = random();
      if (kind < 0.4)
        after.splice(at, 0, `    text "added ${iteration}.${edit}"`);
      else if (kind < 0.7) after.splice(at, 1);
      else if (at < after.length) after[at] = `${after[at]} changed`;
    }
    const beforeText = before.join("\n");
    const afterText = after.join("\n");
    const diff = diffSnapshotBodies(beforeText, afterText);
    if (diff.kind === "diff") {
      diffs += 1;
      assert.equal(applySnapshotDiff(beforeText, diff.text), afterText);
    } else if (diff.kind === "unchanged") {
      assert.equal(beforeText, afterText);
    }
  }
  assert(diffs > 200, `only ${diffs} of 300 edits produced a diff`);
});
