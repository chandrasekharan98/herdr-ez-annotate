// node test/lib.test.js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseJsonl, toJsonl, captureOrder, mergeById, formatMarkdown, tailLines } from "../mods/term-annotate/lib.js";

const a = (id, sel, comment, createdAt, ctx = {}) => ({ selectedText: sel, capturedAt: createdAt, context: ctx, id, comment, createdAt });
const one = a("1", "  use the reply review.\n", "Is this the TUI?", "2026-10-30T06:00:57.177Z", { workspace_label: "personal", tab_label: "1", focused_pane_cwd: "/home/x" });
const two = a("2", "line ```one```\nline two", "Fix\nboth", "2026-10-30T06:00:00.000Z");

assert.equal(formatMarkdown([one, two]),
`# Annotations on terminal selections

## Annotation 1 (personal / 1)
In: \`/home/x\`
Comment on: "use the reply review."
> Is this the TUI?

## Annotation 2
Comment on:
\`\`\`\`
line \`\`\`one\`\`\`
line two
\`\`\`\`
> Fix
> both
`);

assert.deepEqual(captureOrder([one, two]).map((x) => x.id), ["2", "1"]);
assert.deepEqual(parseJsonl(toJsonl([one, two]) + "\n"), [one, two]);
assert.deepEqual(mergeById([one], [one, two]).map((x) => x.id), ["1", "2"]);
assert.deepEqual(tailLines("a  \nb\n\n  \n", 5), ["a", "b"]);
assert.deepEqual(tailLines("1\n2\n3", 2), ["2", "3"]);
assert.deepEqual(tailLines("x\n[hc] only its screen: it is working\n", 5), ["x"]);

// The TUI's own archive file parses as-is (read only).
try {
  const sets = parseJsonl(readFileSync(`${process.env.HOME}/.local/state/herdr/plugins/annotate/archives.jsonl`, "utf8"));
  assert.ok(sets.every((s) => s.version === 1 && Array.isArray(s.annotations)));
  formatMarkdown(sets.flatMap((s) => s.annotations));
} catch (e) { if (e.code !== "ENOENT") throw e; }

console.log("ok");
