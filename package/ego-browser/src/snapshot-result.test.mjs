import test from "node:test";
import assert from "node:assert/strict";

import {
  compactSnapshotContent,
  compactSnapshotResult,
  compactSnapshotUrls,
  filterInteractiveSnapshot,
  preparePageSnapshotResult,
  rewriteSnapshotRefIds,
  sanitizeSnapshotLocators,
  validateSnapshotLocator,
} from "../dist/src/snapshot-result.js";

test("public ref rewriting changes metadata once without changing quoted content or locators", () => {
  const input = [
    'button "literal \\"[ref=1]\\"" [ref=1, loc=css:[data-ref="[ref=1]"]]',
    '  button "Second" [ref=2]',
    '  text "keep [ref=1]"',
    "button [ref=99]",
    "",
  ].join("\r\n");
  assert.equal(
    rewriteSnapshotRefIds(
      input,
      new Map([
        ["1", "2"],
        ["2", "3"],
      ]),
    ),
    [
      'button "literal \\"[ref=1]\\"" [ref=2, loc=css:[data-ref="[ref=1]"]]',
      '  button "Second" [ref=3]',
      '  text "keep [ref=1]"',
      "button [ref=99]",
      "",
    ].join("\r\n"),
  );
});

test("snapshot compaction removes only redundant text and containers", () => {
  const content = [
    "root",
    "  container",
    "  container",
    "    container",
    "      button [ref=1, loc=unstable]",
    '        text "Save"',
    "  container",
    '    text "A"',
    '    text "B"',
    "  text",
    '  text " "',
    '  text "​"',
    '  container "Section"',
    '    text "Title"',
    "  container [ref=2, loc=ambiguous]",
    "  button [ref=3, loc=css:#confirm]",
    "  button [ref=5, loc=css:[loc=unstable]]",
    "  anchor [ref=6, loc=unstable, url=https://example.com/item]",
    '  text "literal [ref=9, loc=unstable]"',
    "  image",
    "  svg_root",
    "  canvas",
    "  iframe [ref=4, loc=unstable]",
    "    root",
    "  list",
    "    list_item",
    "  table",
    "    table_row",
    "      table_cell",
  ].join("\n");

  const compact = [
    "root",
    '  button "Save" [ref=1]',
    "  container",
    '    text "A"',
    '    text "B"',
    '  container "Section"',
    '    text "Title"',
    "  container [ref=2]",
    "  button [ref=3, loc=css:#confirm]",
    "  button [ref=5, loc=css:[loc=unstable]]",
    "  anchor [ref=6, url=https://example.com/item]",
    '  text "literal [ref=9, loc=unstable]"',
    "  image",
    "  svg_root",
    "  canvas",
    "  iframe [ref=4]",
    "    root",
    "  list",
    "    list_item",
    "  table",
    "    table_row",
    "      table_cell",
  ].join("\n");

  assert.equal(compactSnapshotContent(content), compact);
  assert.equal(compactSnapshotContent(compact), compact);
  assert.equal(
    compactSnapshotContent("snapshot unavailable"),
    "snapshot unavailable",
  );
});

test("snapshot compaction folds a lone text child only into its accessible name", () => {
  const content = [
    "root",
    "  anchor [ref=1, loc=href:/docs, url=https://example.com/docs]",
    '    text "Docs"',
    '  button "Search" [ref=2]',
    '    text "Search"',
    '  button "Close" [ref=3]',
    '    text "X"',
    "  heading",
    '    text "Orders \\"2024\\""',
    "  table_cell",
    '    text "Paid"',
    '  textbox "Email" [ref=4]',
    '    text "agent@example.com"',
    "  paragraph",
    '    text "Body copy"',
    "  list_item",
    '    text "Item"',
    "  anchor [ref=5]",
    '    text "Two"',
    '    text "children"',
    "  anchor [ref=6]",
    '    text "Nested"',
    "      image",
  ].join("\n");

  const compact = [
    "root",
    '  anchor "Docs" [ref=1, loc=href:/docs, url=https://example.com/docs]',
    '  button "Search" [ref=2]',
    '  button "Close" [ref=3]',
    '    text "X"',
    '  heading "Orders \\"2024\\""',
    '  table_cell "Paid"',
    '  textbox "Email" [ref=4]',
    '    text "agent@example.com"',
    "  paragraph",
    '    text "Body copy"',
    "  list_item",
    '    text "Item"',
    "  anchor [ref=5]",
    '    text "Two"',
    '    text "children"',
    "  anchor [ref=6]",
    '    text "Nested"',
    "      image",
  ].join("\n");

  assert.equal(compactSnapshotContent(content), compact);
  assert.equal(compactSnapshotContent(compact), compact);
});

test("snapshot URLs are shortened against the Page URL without losing the target", () => {
  const page = "https://shop.example.com/catalog/list?page=2";
  const content = [
    '[p1 "Shop" https://shop.example.com/catalog/list?page=2 | space "s"(1)]',
    "root",
    "  anchor [ref=1, loc=href:/catalog/item?id=7, url=https://shop.example.com/catalog/item?id=7]",
    "  anchor [ref=2, url=https://shop.example.com/a,b/c#top]",
    "  anchor [ref=3, loc=href:item?id=8, url=https://shop.example.com/catalog/item?id=8]",
    "  anchor [ref=4, loc=href:/other, url=https://shop.example.com/different]",
    "  anchor [ref=5, url=https://cdn.example.com/file.pdf]",
    "  anchor [ref=6, url=javascript:void(0)]",
    '  anchor "url=https://shop.example.com/x" [ref=7]',
    '  anchor [ref=8, loc=css:a[href="/x"], url=https://shop.example.com/x]',
    "  anchor [ref=9, url=https://shop.example.com/top#]",
    "  anchor [ref=10, url=https://shop.example.com/q?]",
    "",
  ].join("\n");
  const compact = compactSnapshotUrls(content, page);
  assert.equal(
    compact,
    [
      '[p1 "Shop" https://shop.example.com/catalog/list?page=2 | space "s"(1)]',
      "root",
      "  anchor [ref=1, loc=href:/catalog/item?id=7]",
      "  anchor [ref=2, url=/a,b/c#top]",
      "  anchor [ref=3, loc=href:item?id=8]",
      "  anchor [ref=4, loc=href:/other, url=/different]",
      "  anchor [ref=5, url=https://cdn.example.com/file.pdf]",
      "  anchor [ref=6, url=javascript:void(0)]",
      '  anchor "url=https://shop.example.com/x" [ref=7]',
      '  anchor [ref=8, loc=css:a[href="/x"], url=/x]',
      "  anchor [ref=9, url=/top#]",
      "  anchor [ref=10, url=/q?]",
      "",
    ].join("\n"),
  );
  // Every shortened value still resolves to the original absolute URL.
  assert.equal(
    new URL("/a,b/c#top", page).href,
    "https://shop.example.com/a,b/c#top",
  );
  assert.equal(compactSnapshotUrls(compact, page), compact);
  assert.equal(compactSnapshotUrls(content, "about:blank"), content);
  assert.equal(compactSnapshotUrls(content, "not a url"), content);
});

test("interactive snapshot keeps actionable nodes and orientation only", () => {
  const content = [
    "root",
    "  container",
    '    heading "Orders"',
    "    paragraph",
    '      text "Recent orders for your store."',
    "    unordered_list",
    "      list_item",
    '        anchor "Overview" [ref=1, url=/overview]',
    "      list_item",
    "        anchor [ref=2, url=/orders]",
    "          image",
    '          text "Orders"',
    '          text "(12)"',
    '    textbox "Email" [ref=3]',
    '      text "agent@example.com"',
    "    dialog",
    '      button "Close" [ref=4]',
    "  iframe [ref=5]",
    "    root",
    '      button "Pay" [ref=6]',
  ].join("\n");
  assert.equal(
    filterInteractiveSnapshot(content),
    [
      "root",
      '  heading "Orders"',
      '  anchor "Overview" [ref=1, url=/overview]',
      '  anchor "Orders (12)" [ref=2, url=/orders]',
      '  textbox "Email" [ref=3]',
      '    text "agent@example.com"',
      "  dialog",
      '    button "Close" [ref=4]',
      "  iframe [ref=5]",
      "    root",
      '      button "Pay" [ref=6]',
    ].join("\n"),
  );
  const long = `root\n  button [ref=1]\n    text "${"x".repeat(150)}"\n    text "y"`;
  assert.equal(
    filterInteractiveSnapshot(long),
    `root\n  button "${"x".repeat(100)}…" [ref=1]`,
  );
  assert.equal(filterInteractiveSnapshot("no tree"), "no tree");
});

test("snapshot compaction omits unusable locator statuses from refs", () => {
  const result = {
    content: [
      "root",
      "  button [ref=1, loc=unstable]",
      "  button [ref=2, loc=ambiguous]",
      "  button [ref=3, loc=css:#save]",
    ].join("\n"),
    refs: [
      { refId: 1, backendNodeId: 1, loc: "unstable" },
      { refId: 2, backendNodeId: 2, loc: "ambiguous" },
      { refId: 3, backendNodeId: 3, loc: "css:#save" },
    ],
  };

  compactSnapshotResult(result);

  assert.equal(
    result.content,
    [
      "root",
      "  button [ref=1]",
      "  button [ref=2]",
      "  button [ref=3, loc=css:#save]",
    ].join("\n"),
  );
  assert.equal(result.refs[0].loc, undefined);
  assert.equal(result.refs[1].loc, undefined);
  assert.equal(result.refs[2].loc, "css:#save");
});

test("snapshot locator validation batches DOM queries and object cleanup", async () => {
  const calls = [];
  const services = {
    async cdp(method, params, sessionId) {
      calls.push([method, params, sessionId]);
      if (method === "Runtime.evaluate" && params.returnByValue) {
        return { result: { value: [1, 1] } };
      }
      if (method === "Runtime.evaluate") {
        return { result: { objectId: "locator-batch" } };
      }
      if (method === "Runtime.getProperties") {
        return {
          result: [
            { name: "0", value: { objectId: "node:10" } },
            { name: "1", value: { objectId: "node:11" } },
          ],
        };
      }
      if (method === "DOM.describeNode") {
        return {
          node: {
            backendNodeId: Number(params.objectId.slice("node:".length)),
          },
        };
      }
      if (method === "Runtime.releaseObjectGroup") return {};
      throw new Error(`unexpected CDP method: ${method}`);
    },
  };
  const result = {
    content: [
      "button A [ref=10, loc=css:#a]",
      "button B [ref=11, loc=css:#b]",
    ].join("\n"),
    refs: [
      { backendNodeId: 10, loc: "css:#a" },
      { backendNodeId: 11, loc: "css:#b" },
    ],
  };

  await preparePageSnapshotResult(services, "session:page", new Map(), result);

  assert.equal(result.refs[0].loc, "css:#a");
  assert.equal(result.refs[1].loc, "css:#b");
  assert.equal(
    calls.filter(([method]) => method === "Runtime.evaluate").length,
    2,
  );
  assert.equal(
    calls.filter(([method]) => method === "Runtime.getProperties").length,
    1,
  );
  assert.equal(
    calls.filter(([method]) => method === "DOM.describeNode").length,
    2,
  );
  assert.equal(
    calls.filter(([method]) => method === "Runtime.releaseObjectGroup").length,
    1,
  );
  assert.equal(
    calls.some(([method]) => method === "Runtime.releaseObject"),
    false,
  );
});

test("DOM locator validation keeps healthy contexts when one count fails", async () => {
  const cdp = {
    async sendRaw(method, params, sessionId) {
      if (sessionId === "session:detached") {
        throw new Error("frame detached");
      }
      if (method === "Runtime.evaluate" && params.returnByValue) {
        return { result: { value: [1] } };
      }
      if (method === "Runtime.evaluate") {
        return { result: { objectId: "locator-batch" } };
      }
      if (method === "Runtime.getProperties") {
        return {
          result: [{ name: "0", value: { objectId: "node:10" } }],
        };
      }
      if (method === "DOM.describeNode") {
        return { node: { backendNodeId: 10 } };
      }
      if (method === "Runtime.releaseObjectGroup") return {};
      throw new Error(`unexpected CDP method: ${method}`);
    },
  };

  assert.equal(
    await validateSnapshotLocator(
      cdp,
      "session:page",
      new Map([["frame-detached", "session:detached"]]),
      { backendNodeId: 10, loc: "css:#save" },
    ),
    true,
  );
});

test("DOM locator validation keeps the Page when an iframe world disappears", async () => {
  const cdp = {
    async sendRaw(method, params) {
      if (method === "Page.createIsolatedWorld") {
        throw new Error("frame detached");
      }
      if (method === "Runtime.evaluate" && params.returnByValue) {
        return { result: { value: [1] } };
      }
      if (method === "Runtime.evaluate") {
        return { result: { objectId: "locator-batch" } };
      }
      if (method === "Runtime.getProperties") {
        return {
          result: [{ name: "0", value: { objectId: "node:10" } }],
        };
      }
      if (method === "DOM.describeNode") {
        return { node: { backendNodeId: 10 } };
      }
      if (method === "Runtime.releaseObjectGroup") return {};
      throw new Error(`unexpected CDP method: ${method}`);
    },
  };

  assert.equal(
    await validateSnapshotLocator(
      cdp,
      "session:page",
      new Map([["frame-detached", "session:page"]]),
      { backendNodeId: 10, loc: "css:#save" },
    ),
    true,
  );
});

test("role locator validation keeps healthy trees when one frame detaches", async () => {
  const cdp = {
    async sendRaw(method, _params, sessionId) {
      assert.equal(method, "Accessibility.getFullAXTree");
      if (sessionId === "session:detached") {
        throw new Error("frame detached");
      }
      return {
        nodes: [
          {
            backendDOMNodeId: 10,
            ignored: false,
            role: { value: "button" },
            name: { value: "Save" },
          },
        ],
      };
    },
  };

  assert.equal(
    await validateSnapshotLocator(
      cdp,
      "session:page",
      new Map([["frame-detached", "session:detached"]]),
      {
        backendNodeId: 10,
        loc: 'role:button[name="Save"]',
      },
    ),
    true,
  );
});

test("invalid native snapshot locators are hidden without removing their refs", async () => {
  const result = {
    content: [
      'textfield "Prompt" [ref=10, loc=css:#prompt, url=https://example.com/prompt]',
      'text "literal ref=10, loc=css:#prompt"',
      'button "Save" [ref=11, loc=role:button[name="Save"]]',
    ].join("\n"),
    refs: [
      {
        backendNodeId: 10,
        role: "textfield",
        name: "Prompt",
        loc: "css:#prompt",
      },
      {
        backendNodeId: 11,
        role: "button",
        name: "Save",
        loc: 'role:button[name="Save"]',
      },
    ],
  };

  await sanitizeSnapshotLocators(
    result,
    async (ref) => ref.backendNodeId === 11,
  );

  assert.equal(
    result.content,
    [
      'textfield "Prompt" [ref=10, url=https://example.com/prompt]',
      'text "literal ref=10, loc=css:#prompt"',
      'button "Save" [ref=11, loc=role:button[name="Save"]]',
    ].join("\n"),
  );
  assert.equal(result.refs[0].loc, undefined);
  assert.equal(result.refs[1].loc, 'role:button[name="Save"]');
});

test("stable locator validation requires one match for the original backend node", async () => {
  const responses = new Map([
    ["zero", { count: 0 }],
    ["duplicate", { count: 2 }],
    ["wrong", { count: 1, resolvedBackendNodeId: 99 }],
    ["same", { count: 1, resolvedBackendNodeId: 10 }],
  ]);

  const cdp = {
    async sendRaw(method, params) {
      if (method === "Runtime.evaluate") {
        const key = [...responses.keys()].find((candidate) =>
          params.expression.includes(`#${candidate}`),
        );
        const response = responses.get(key);
        if (params.returnByValue) {
          return { result: { value: [response.count] } };
        }
        return {
          result: { objectId: `batch:${response.resolvedBackendNodeId}` },
        };
      }
      if (method === "Runtime.getProperties") {
        const backendNodeId = params.objectId.slice("batch:".length);
        return {
          result: [{ name: "0", value: { objectId: `node:${backendNodeId}` } }],
        };
      }
      if (method === "DOM.describeNode") {
        return {
          node: {
            backendNodeId: Number(params.objectId.slice("node:".length)),
          },
        };
      }
      if (method === "Runtime.releaseObjectGroup") return {};
      return {};
    },
  };

  for (const [selector, expected] of [
    ["zero", false],
    ["duplicate", false],
    ["wrong", false],
    ["same", true],
  ]) {
    assert.equal(
      await validateSnapshotLocator(cdp, "session:page", new Map(), {
        backendNodeId: 10,
        loc: `css:#${selector}`,
      }),
      expected,
      selector,
    );
  }
});

test("Page snapshots preserve native ref provenance", async () => {
  const result = {
    refs: [
      {
        refId: 1,
        backendNodeId: 6,
        role: "textbox",
        name: "",
      },
      {
        refId: 17,
        backendNodeId: 6,
        role: "textbox",
        name: "",
        frameId: "frame-oopif",
      },
    ],
  };
  const services = {
    async cdp(_method, _params, sessionId) {
      if (sessionId === "session:oopif") {
        return {
          nodes: [
            {
              backendDOMNodeId: 6,
              role: { value: "textbox" },
              name: { value: "" },
            },
          ],
        };
      }
      return { nodes: [] };
    },
  };

  await preparePageSnapshotResult(
    services,
    "session:page",
    new Map([["frame-oopif", "session:oopif"]]),
    result,
  );

  assert.deepEqual(result.refs, [
    {
      refId: 1,
      backendNodeId: 6,
      role: "textbox",
      name: "",
      frameProvenance: "page",
    },
    {
      refId: 17,
      backendNodeId: 6,
      role: "textbox",
      name: "",
      frameId: "frame-oopif",
      frameProvenance: "frame",
    },
  ]);
});

test("Page snapshots backfill missing frame provenance from a unique locator", async () => {
  const result = {
    content: [
      "iframe [ref=12]",
      "root",
      '  button "Run iframe action" [ref=21, loc=role:button[name="Run iframe action"]]',
    ].join("\n"),
    refs: [
      {
        refId: 21,
        backendNodeId: 21,
        role: "button",
        name: "Run iframe action",
        loc: 'role:button[name="Run iframe action"]',
      },
    ],
  };
  const services = {
    async cdp(method, params, sessionId) {
      assert.equal(method, "Accessibility.getFullAXTree");
      if (sessionId === "session:page" && params.frameId === "frame-same") {
        return {
          nodes: [
            {
              backendDOMNodeId: 21,
              ignored: false,
              role: { value: "button" },
              name: { value: "Run iframe action" },
            },
          ],
        };
      }
      return { nodes: [] };
    },
  };

  await preparePageSnapshotResult(
    services,
    "session:page",
    new Map([
      ["frame-same", "session:page"],
      ["frame-oopif", "session:oopif"],
    ]),
    result,
  );

  assert.equal(result.refs[0].frameId, "frame-same");
  assert.equal(result.refs[0].frameProvenance, "frame");
});

test("Page snapshots do not invent frame provenance for an ambiguous backend node", async () => {
  const result = {
    content: [
      "iframe [ref=12]",
      "root",
      '  button "Duplicate action" [ref=21, loc=role:button[name="Duplicate action"]]',
    ].join("\n"),
    refs: [
      {
        refId: 21,
        backendNodeId: 21,
        role: "button",
        name: "Duplicate action",
        loc: 'role:button[name="Duplicate action"]',
      },
    ],
  };
  const services = {
    async cdp(method, params, sessionId) {
      assert.equal(method, "Accessibility.getFullAXTree");
      const isFirstFrame =
        sessionId === "session:page" && params.frameId === "frame-first";
      const isSecondFrame = sessionId === "session:second";
      return isFirstFrame || isSecondFrame
        ? {
            nodes: [
              {
                backendDOMNodeId: 21,
                ignored: false,
                role: { value: "button" },
                name: { value: "Duplicate action" },
              },
            ],
          }
        : { nodes: [] };
    },
  };

  await preparePageSnapshotResult(
    services,
    "session:page",
    new Map([
      ["frame-first", "session:page"],
      ["frame-second", "session:second"],
    ]),
    result,
  );

  assert.equal(result.refs[0].frameId, undefined);
  assert.equal(result.refs[0].frameProvenance, "unknown");
});

test("frame provenance ignores a ref token inside an accessible name", async () => {
  const result = {
    content: [
      "root",
      '  link "See [ref=3] in the spec" [ref=3]',
      "  iframe [ref=12]",
      "    root",
      '      link "See [ref=3] in the spec" [ref=42]',
    ].join("\n"),
    refs: [
      {
        refId: 3,
        backendNodeId: 3,
        role: "link",
        name: "See [ref=3] in the spec",
      },
      {
        refId: 42,
        backendNodeId: 42,
        role: "link",
        name: "See [ref=3] in the spec",
      },
    ],
  };

  await preparePageSnapshotResult(
    {
      async cdp() {
        return { nodes: [] };
      },
    },
    "session:page",
    new Map([["frame-child", "session:page"]]),
    result,
  );

  assert.equal(
    result.refs[0].frameProvenance,
    "page",
    "the page-owned ref must not be re-homed by a quoted ref token",
  );
  assert.equal(
    result.refs[1].frameProvenance,
    "frame",
    "the frame-owned ref must still be recognised as a frame descendant",
  );
  assert.equal(result.refs[1].frameId, "frame-child");
});
