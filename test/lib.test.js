// node test/lib.test.js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseJsonl, toJsonl, captureOrder, forTerminal, trimQuote, formatCompact } from "../mods/term-annotate/lib.js";

const a = (id, sel, comment, createdAt, ctx = {}, kind) => ({ selectedText: sel, capturedAt: createdAt, context: ctx, id, comment, createdAt, ...(kind ? { kind } : {}) });
const one = a("1", "  use the reply review.\n", "Is this the TUI?", "2026-10-30T06:00:57.177Z", { terminal_id: "t1" });
const two = a("2", "first\n\n  second  \nthird\nlast", "Fix\nboth", "2026-10-30T06:00:00.000Z", { terminal_id: "t1" });
const ok = a("3", "npm test passed", "", "2026-10-30T07:00:00.000Z", { terminal_id: "t1" }, "ok");
const del = a("4", "rm -rf build", " and this ", "2026-10-30T08:00:00.000Z", { terminal_id: "t2" }, "delete");
const note = a("5", "", "General note", "2026-10-30T09:00:00.000Z", { terminal_id: "t2" });

assert.equal(formatCompact(forTerminal([one, two, ok], "t1")),
`Notes on your terminal output:

> first
> …
> last
Fix
both

> use the reply review.
Is this the TUI?

> npm test passed
✓ looks good`);

assert.equal(formatCompact([del, note]),
`Notes on your terminal output:

> rm -rf build
✗ remove/undo this
and this

General note`);

assert.deepEqual(trimQuote("a\nb"), ["a", "b"]);
assert.deepEqual(trimQuote("x".repeat(5), 3), ["xxx…"]);
assert.deepEqual(forTerminal([one, two, del, { id: "6", context: {} }], "t2").map((x) => x.id), ["4"]);
assert.deepEqual(captureOrder([one, two]).map((x) => x.id), ["2", "1"]);
assert.deepEqual(parseJsonl(toJsonl([one, two]) + "\n"), [one, two]);

// The TUI's own archive file parses as-is (read only).
try {
  const sets = parseJsonl(readFileSync(`${process.env.HOME}/.local/state/herdr/plugins/annotate/archives.jsonl`, "utf8"));
  assert.ok(sets.every((s) => s.version === 1 && Array.isArray(s.annotations)));
  formatCompact(sets.flatMap((s) => s.annotations));
} catch (e) { if (e.code !== "ENOENT") throw e; }

console.log("ok");
