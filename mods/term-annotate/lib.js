// Pure store and formatting logic, shared with test/lib.test.js.
// Records match the herdr TUI annotate plugin (annotations.jsonl / archives.jsonl):
//   annotation: {selectedText, capturedAt, context, id, comment, createdAt, kind?}
//   archive set: {version: 1, id, archivedAt, annotations: [annotation...]}
// `kind` ("ok" | "delete") and `context.terminal_id` are v2 extras; the TUI ignores them.

export function parseJsonl(text) {
  return (text ?? "").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
}

export function toJsonl(records) {
  return records.map((r) => JSON.stringify(r) + "\n").join("");
}

// Oldest first by createdAt; stable, so equal or unparsable times keep store order.
export function captureOrder(annotations) {
  const t = (a) => Date.parse(a.createdAt) || 0;
  return [...annotations].sort((a, b) => t(a) - t(b));
}

export function forTerminal(annotations, terminal) {
  return captureOrder(annotations.filter((a) => a.context?.terminal_id === terminal));
}

export const KIND_TEXT = { ok: "✓ looks good", delete: "✗ remove/undo this" };

// A quote's non-blank lines, more than two cut to first, "…", last; each line at most `max` chars.
export function trimQuote(text, max = 160) {
  const lines = (text ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const cut = (l) => (l.length > max ? l.slice(0, max) + "…" : l);
  return (lines.length > 2 ? [lines[0], "…", lines[lines.length - 1]] : lines).map(cut);
}

// One token-lean block for an agent: `> quote` lines, then the verdict and/or comment.
export function formatCompact(annotations) {
  const items = annotations.map((a) => [
    ...trimQuote(a.selectedText).map((l) => `> ${l}`),
    KIND_TEXT[a.kind],
    (a.comment ?? "").trim(),
  ].filter(Boolean).join("\n"));
  return ["Notes on your terminal output:", ...items].join("\n\n");
}
