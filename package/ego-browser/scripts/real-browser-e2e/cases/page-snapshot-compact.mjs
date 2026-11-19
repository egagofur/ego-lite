export function pageSnapshotCompactCase() {
  return `
    const task = await taskSpace(taskName);
    const page = await newPageAt(task, baseUrl + "/?workflow=page-snapshot-compact");

    await page.evaluate(() => {
      const region = document.createElement("section");
      region.innerHTML =
        '<h2>Compact snapshot region</h2>' +
        '<p>Body copy that only the full snapshot prints.</p>' +
        '<a href="/nav-target?compact=unique">Compact unique link</a>' +
        '<a href="/nav-target?compact=pair">Compact pair link</a>' +
        '<a href="/nav-target?compact=pair">Compact pair link</a>' +
        '<a href="https://example.com/compact-external">Compact external link</a>' +
        '<button type="button">Compact button</button>';
      document.body.append(region);
    });

    const snapshot = await page.snapshot({ scope: "full_page" });
    const lines = snapshot.split("\\n");
    assert(
      lines[0].includes(" " + baseUrl + "/?workflow=page-snapshot-compact "),
      "the snapshot header prints the Page URL"
    );
    const lineFor = (text) => lines.find((line) => line.includes('"' + text + '"'));
    const unique = lineFor("Compact unique link");
    assert(
      /^\\s*anchor "Compact unique link" \\[ref=\\d+, loc=href:\\/nav-target\\?compact=unique\\]$/.test(unique || ""),
      "a link prints its text as its name and omits a url its loc=href already gives: " + unique
    );
    const pair = lineFor("Compact pair link");
    assert(
      (pair || "").endsWith(", url=/nav-target?compact=pair]"),
      "a same-origin url without a stable locator is relative to the Page URL: " + pair
    );
    assertIncludes(
      lineFor("Compact external link") || "",
      "url=https://example.com/compact-external]",
      "a cross-origin url stays absolute"
    );
    assertIncludes(
      lineFor("Compact button") || "",
      'button "Compact button" [ref=',
      "a button prints its text as its name"
    );
    assert(
      !lines.some((line) => line.trim() === 'text "Compact unique link"'),
      "the folded link text is not printed twice"
    );
    assertIncludes(snapshot, "Body copy that only", "the full snapshot keeps body text");

    const interactive = await page.snapshot({ scope: "full_page", interactive: true });
    assertIncludes(interactive, 'anchor "Compact unique link" [ref=', "interactive keeps links");
    assertIncludes(interactive, 'heading "Compact snapshot region"', "interactive keeps headings");
    assert(!interactive.includes("Body copy that only"), "interactive omits body text");
    assert(interactive.length < snapshot.length, "interactive is smaller than the full snapshot");

    const ref = interactive.match(/anchor "Compact unique link" \\[ref=(\\d+)/)[1];
    await page.click("@" + ref);
    await page.waitForURL(/compact=unique/);

    await page.goto("/nav-target?compact=relative");
    assertEqual(
      await page.url(),
      baseUrl + "/nav-target?compact=relative",
      "goto resolves a root-relative url against the current document"
    );

    await page.close();
  `;
}
