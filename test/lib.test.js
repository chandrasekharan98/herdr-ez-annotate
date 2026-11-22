// node test/lib.test.js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseJsonl, toJsonl, captureOrder, forTerminal, trimQuote, formatCompact, typedChar, submitAction, saveHint } from "../mods/ez-annotate/lib.js";

const a = (id, sel, comment, createdAt, ctx = {}, kind) => ({ selectedText: sel, capturedAt: createdAt, context: ctx, id, comment, createdAt, ...(kind ? { kind } : {}) });
const one = a("1", "  use the reply review.\n", "Is this the TUI?", "2026-10-30T06:00:57.177Z", { terminal_id: "t1" });
const two = a("2", "first\n\n  second  \nthird\nlast", "Fix\nboth", "2026-10-30T06:00:00.000Z", { terminal_id: "t1" });
const ok = a("3", "npm test passed", "", "2026-10-30T07:00:00.000Z", { terminal_id: "t1" }, "ok");
const del = a("4", "rm -rf build", " and this ", "2026-10-30T08:00:00.000Z", { terminal_id: "t2" }, "delete");
const note = a("5", "", "General note", "2026-10-30T09:00:00.000Z", { terminal_id: "t2" });

assert.equal(formatCompact(forTerminal([one, two, ok], "t1")),
`# Annotations on terminal selections

## Annotation 1
Comment on:
\`\`\`
first
…
last
\`\`\`
> Fix
> both

## Annotation 2
Comment on: "use the reply review."
> Is this the TUI?

## Annotation 3
Comment on: "npm test passed"
> ✓ looks good`);

const where = { terminal_id: "t2", workspace_label: "api", tab_label: "server" };
assert.equal(formatCompact([{ ...del, context: where }, note]),
`# Annotations on terminal selections (api / server)

## Annotation 1
Comment on: "rm -rf build"
> ✗ remove/undo this
> and this

## Annotation 2
> General note`);

// A quote with backticks gets a longer fence.
assert.ok(formatCompact([a("7", "x ```y```\nz", "", "")]).includes("````\nx ```y```\nz\n````"));

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


// The popup bar: any key that types a character starts a comment with it. Looks good and delete
// are clicks only, so a comment can start with any letter.
const key = (k, char, mods = {}) => ({ key: k, key_char: char, modifiers: { shift: false, control: false, alt: false, platform: false, ...mods } });
assert.equal(typedChar(key("a", "a")), "a");
assert.equal(typedChar(key("c", "c")), "c");
assert.equal(typedChar(key("d", "d")), "d");
assert.equal(typedChar(key("a", "A", { shift: true })), "A");
assert.equal(typedChar(key("1", "!", { shift: true })), "!");
assert.equal(typedChar(key("space", " ")), " ");
assert.equal(typedChar(key("a", "a", { platform: true })), null);
assert.equal(typedChar(key("a", "a", { control: true })), null);
assert.equal(typedChar(key("2", "@", { alt: true })), "@"); // Option types characters on many Mac layouts
assert.equal(typedChar(key("enter", undefined)), null);
assert.equal(typedChar(key("left", undefined)), null);
assert.equal(typedChar(key("tab", "\t")), null);
// AltGr is Ctrl+Alt on Windows and types characters there (@ on a German layout).
assert.equal(typedChar(key("q", "@", { control: true, alt: true }), "windows"), "@");
assert.equal(typedChar(key("q", "@", { control: true, alt: true }), "macos"), null);
assert.equal(typedChar(key("q", "@", { control: true, alt: true }), "linux"), null);
assert.equal(typedChar(key("a", "a", { control: true }), "windows"), null);

// The comment box: Cmd+Enter (Ctrl+Enter off macOS, GPUI's "secondary") saves; Enter adds a line.
assert.equal(submitAction({ secondary: true }), "save");
assert.equal(submitAction({ secondary: true, shift: true }), "save");
assert.equal(submitAction({}), "newline");
assert.equal(submitAction({ shift: true }), "newline");
assert.equal(submitAction(undefined), "newline");
assert.equal(saveHint("macos"), "Cmd+Enter save · Enter new line · Esc cancel");
assert.equal(saveHint("linux"), "Ctrl+Enter save · Enter new line · Esc cancel");
assert.equal(saveHint("windows"), "Ctrl+Enter save · Enter new line · Esc cancel");

console.log("ok");
