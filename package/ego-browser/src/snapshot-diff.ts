/**
 * Line diffs between two printed snapshot bodies.
 *
 * Page refs keep their ids across snapshots of the same document, so an
 * unchanged node prints the same line and a re-observation after a small
 * change differs in a few lines. The rendered diff is a standard unified
 * diff whose hunk headers also name the nearest enclosing node, so an agent
 * can place a change in the tree without the line numbers.
 *
 * The diff is exact: `applySnapshotDiff(before, diff) === after` (verified in
 * tests and on recorded real pages). When it would not be clearly smaller
 * than the snapshot itself, the caller prints the full snapshot instead.
 */

type Edit = { op: "=" | "-" | "+"; line: string };

/** Lines of context printed around each changed region. */
const CONTEXT_LINES = 2;
/** Give up (print the full snapshot) beyond this many changed lines. */
const MAX_EDIT_DISTANCE = 4000;
/** Print a diff only when it is at most this fraction of the full text. */
const MAX_DIFF_RATIO = 0.5;

export type SnapshotDiff =
  | { kind: "unchanged"; lines: number }
  | { kind: "diff"; text: string; added: number; removed: number }
  | { kind: "full" };

export function diffSnapshotBodies(
  before: string,
  after: string,
): SnapshotDiff {
  if (before === after) {
    return { kind: "unchanged", lines: splitLines(after).length };
  }
  const a = splitLines(before);
  const b = splitLines(after);
  const edits = diffLines(a, b);
  if (!edits) return { kind: "full" };
  const text = renderUnifiedDiff(edits, b);
  if (text.length > after.length * MAX_DIFF_RATIO) return { kind: "full" };
  return {
    kind: "diff",
    text,
    added: edits.filter((edit) => edit.op === "+").length,
    removed: edits.filter((edit) => edit.op === "-").length,
  };
}

function splitLines(text: string): string[] {
  return text.length === 0 ? [] : text.split("\n");
}

/** Myers O((N+M)D) diff with common prefix/suffix trimming. */
function diffLines(a: string[], b: string[]): Edit[] | undefined {
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const middle = myers(
    a.slice(prefix, a.length - suffix),
    b.slice(prefix, b.length - suffix),
  );
  if (!middle) return undefined;
  return [
    ...a.slice(0, prefix).map((line) => ({ op: "=" as const, line })),
    ...middle,
    ...a.slice(a.length - suffix).map((line) => ({ op: "=" as const, line })),
  ];
}

function myers(a: string[], b: string[]): Edit[] | undefined {
  const n = a.length;
  const m = b.length;
  if (n === 0) return b.map((line) => ({ op: "+", line }));
  if (m === 0) return a.map((line) => ({ op: "-", line }));
  const max = Math.min(n + m, MAX_EDIT_DISTANCE);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  // trace[d] holds v[-d..d] after step d.
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= max && found < 0; d += 1) {
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])
          ? v[offset + k + 1]
          : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
    trace.push(v.slice(offset - d, offset + d + 1));
  }
  if (found < 0) return undefined;

  const edits: Edit[] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d -= 1) {
    const previous = trace[d - 1];
    const at = (k: number) => previous[k + d - 1];
    const k = x - y;
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
    const previousK = down ? k + 1 : k - 1;
    const previousX = at(previousK);
    const previousY = previousX - previousK;
    while (x > previousX && y > previousY) {
      edits.push({ op: "=", line: a[x - 1] });
      x -= 1;
      y -= 1;
    }
    if (down) {
      edits.push({ op: "+", line: b[y - 1] });
    } else {
      edits.push({ op: "-", line: a[x - 1] });
    }
    x = previousX;
    y = previousY;
  }
  while (x > 0 && y > 0) {
    edits.push({ op: "=", line: a[x - 1] });
    x -= 1;
    y -= 1;
  }
  return edits.reverse();
}

function renderUnifiedDiff(edits: Edit[], after: string[]): string {
  const output: string[] = [];
  let index = 0;
  let oldLine = 0;
  let newLine = 0;
  const positions = edits.map((edit) => {
    const position = { oldLine, newLine };
    if (edit.op !== "+") oldLine += 1;
    if (edit.op !== "-") newLine += 1;
    return position;
  });
  while (index < edits.length) {
    if (edits[index].op === "=") {
      index += 1;
      continue;
    }
    let start = Math.max(0, index - CONTEXT_LINES);
    let end = index;
    // Extend the hunk while the next change is within 2 * context lines.
    for (;;) {
      while (end < edits.length && edits[end].op !== "=") end += 1;
      let next = end;
      while (next < edits.length && edits[next].op === "=") next += 1;
      if (next < edits.length && next - end <= CONTEXT_LINES * 2) {
        end = next;
        continue;
      }
      end = Math.min(edits.length, end + CONTEXT_LINES);
      break;
    }
    const hunk = edits.slice(start, end);
    const oldCount = hunk.filter((edit) => edit.op !== "+").length;
    const newCount = hunk.filter((edit) => edit.op !== "-").length;
    const oldStart = positions[start].oldLine + (oldCount > 0 ? 1 : 0);
    const newStart = positions[start].newLine + (newCount > 0 ? 1 : 0);
    const where = enclosingNode(
      after,
      positions[start].newLine,
      Math.min(...hunk.map((edit) => indentOf(edit.line))),
    );
    output.push(
      `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@${where ? ` in ${where}` : ""}`,
    );
    for (const edit of hunk) {
      output.push(`${edit.op === "=" ? " " : edit.op}${edit.line}`);
    }
    index = end;
    start = end;
  }
  return output.join("\n");
}

/**
 * The nearest line above `lineIndex` (0-based, in the new snapshot) that is
 * less indented than every line of the hunk: the node the change sits in.
 */
function enclosingNode(
  lines: string[],
  lineIndex: number,
  hunkIndent: number,
): string {
  for (let i = Math.min(lineIndex, lines.length) - 1; i >= 0; i -= 1) {
    if (indentOf(lines[i]) < hunkIndent) {
      const text = lines[i].trim();
      return text.length > 120 ? `${text.slice(0, 120)}…` : text;
    }
  }
  return "";
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/**
 * Apply a diff produced by `diffSnapshotBodies` to the snapshot it was taken
 * against. Used to verify that a diff carries the whole new snapshot.
 */
export function applySnapshotDiff(before: string, diff: string): string {
  const source = splitLines(before);
  const output: string[] = [];
  let cursor = 0;
  const lines = diff.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const header = lines[i].match(/^@@ -(\d+),(\d+) \+\d+,\d+ @@/);
    if (!header) throw new Error(`malformed diff line: ${lines[i]}`);
    const oldCount = Number(header[2]);
    const oldStart = oldCount === 0 ? Number(header[1]) : Number(header[1]) - 1;
    while (cursor < oldStart) output.push(source[cursor++]);
    while (i + 1 < lines.length && !lines[i + 1].startsWith("@@")) {
      const line = lines[++i];
      const op = line[0];
      const text = line.slice(1);
      if (op === "+") {
        output.push(text);
        continue;
      }
      if (source[cursor] !== text) {
        throw new Error(`diff does not apply at line ${cursor + 1}`);
      }
      if (op === " ") output.push(text);
      cursor += 1;
    }
  }
  while (cursor < source.length) output.push(source[cursor++]);
  return output.join("\n");
}
