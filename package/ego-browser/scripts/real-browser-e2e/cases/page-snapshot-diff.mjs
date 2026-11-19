export function pageSnapshotDiffCase() {
  return `
    const task = await taskSpace(taskName);
    const page = await newPageAt(task, baseUrl + "/?workflow=page-snapshot-diff");

    await page.evaluate(() => {
      const region = document.createElement("section");
      region.id = "diff-region";
      region.innerHTML =
        '<h2>Diff region</h2><ul id="diff-list">' +
        Array.from({ length: 30 }, (_, index) => '<li><a href="/nav-target?row=' + index + '">Row ' + index + '</a></li>').join("") +
        '</ul><input aria-label="Diff note"><button type="button" id="diff-add">Add row</button>';
      region.querySelector("#diff-add").addEventListener("click", () => {
        const item = document.createElement("li");
        item.innerHTML = '<a href="/nav-target?row=new">Row new</a>';
        document.querySelector("#diff-list").append(item);
      });
      document.body.append(region);
    });

    // Same reconstruction rule as snapshot-diff.ts applySnapshotDiff.
    const apply = (before, diff) => {
      const source = before.split("\\n");
      const output = [];
      let cursor = 0;
      const lines = diff.split("\\n");
      for (let i = 0; i < lines.length; i += 1) {
        const header = lines[i].match(/^@@ -(\\d+),(\\d+) \\+\\d+,\\d+ @@/);
        if (!header) throw new Error("malformed diff line: " + lines[i]);
        const oldStart = Number(header[2]) === 0 ? Number(header[1]) : Number(header[1]) - 1;
        while (cursor < oldStart) output.push(source[cursor++]);
        while (i + 1 < lines.length && !lines[i + 1].startsWith("@@")) {
          const line = lines[++i];
          if (line[0] === "+") { output.push(line.slice(1)); continue; }
          if (source[cursor] !== line.slice(1)) throw new Error("diff does not apply at " + (cursor + 1));
          if (line[0] === " ") output.push(line.slice(1));
          cursor += 1;
        }
      }
      while (cursor < source.length) output.push(source[cursor++]);
      return output.join("\\n");
    };
    const split = (text) => {
      const [header, note, ...rest] = text.split("\\n");
      return { header, note, rest: rest.join("\\n") };
    };
    const plainBody = async () =>
      (await page.snapshot({ scope: "full_page" })).split("\\n").slice(1).join("\\n");

    await page.waitForLoadState("networkidle");
    const first = split(await page.snapshot({ scope: "full_page", diff: true }));
    const id1 = first.note.match(/snapshot id (d\\d+)\\]$/)[1];
    assertEqual(first.rest, await plainBody(), "diff: true prints the full snapshot");

    const unchanged = split(await page.snapshot({ scope: "full_page", diff: id1 }));
    assert(
      unchanged.note.startsWith("[unchanged since " + id1 + ":"),
      "an unchanged page prints one line: " + unchanged.note + "\\n" + unchanged.rest
    );
    const id2 = unchanged.note.match(/snapshot id (d\\d+)\\]$/)[1];

    await page.click("#diff-add");
    await page.fill("loc=css:#diff-region input", "typed note");
    await page.waitForSelector("text=Row new", { state: "attached" });
    const changed = split(await page.snapshot({ scope: "full_page", diff: id2 }));
    assert(changed.note.startsWith("[changes since " + id2 + ":"), "a small change prints a diff: " + changed.note);
    const full = await plainBody();
    assertEqual(apply(first.rest, changed.rest), full, "the diff reproduces a fresh full snapshot exactly");
    assert(
      changed.rest.length * 2 < full.length,
      "the diff is smaller than half the snapshot: " + changed.rest.length + " vs " + full.length + "\\n" + changed.rest
    );
    assertIncludes(changed.rest, "Row new", "the diff shows the added row");
    assertIncludes(changed.rest, "typed note", "the diff shows the typed value");

    const stale = split(await page.snapshot({ scope: "full_page", diff: id1 }));
    assert(stale.note.includes(id1 + " is not the latest"), "a stale id prints the full snapshot: " + stale.note);
    assertEqual(stale.rest, full, "the fallback is the full snapshot");

    await page.close();
  `;
}
