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

// A fence longer than any backtick run in the text, so quoted Markdown can't close it.
const fence = (text) => "`".repeat(Math.max(3, ...(text.match(/`+/g) ?? []).map((r) => r.length + 1)));

// Plannotator's feedback shape (herdr-annotate's format.rs), so the agent reads it as annotation
// feedback, not the person typing: a `#` header naming where the notes come from, then
// `## Annotation N`, `Comment on:` the quote (inline, or fenced when it spans lines), and the
// verdict and comment as a `> ` blockquote. Quotes stay trimmed by trimQuote to keep it lean.
export function formatCompact(annotations) {
  const ctx = annotations[0]?.context ?? {};
  const where = [ctx.workspace_label, ctx.tab_label].filter(Boolean).join(" / ");
  const items = annotations.map((a, i) => {
    const q = trimQuote(a.selectedText).join("\n");
    const f = fence(q);
    const quote = !q ? null : q.includes("\n") ? `Comment on:\n${f}\n${q}\n${f}` : `Comment on: "${q}"`;
    const note = [KIND_TEXT[a.kind], (a.comment ?? "").trim()].filter(Boolean).join("\n");
    return [`## Annotation ${i + 1}`, quote, note && note.replace(/^/gm, "> ")].filter(Boolean).join("\n");
  });
  return [`# Annotations on terminal selections${where ? ` (${where})` : ""}`, ...items].join("\n\n");
}
