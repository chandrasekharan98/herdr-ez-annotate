// Pure store and Markdown logic, shared with test/lib.test.js.
// Records match the herdr TUI annotate plugin (annotations.jsonl / archives.jsonl):
//   annotation: {selectedText, capturedAt, context, id, comment, createdAt}
//   archive set: {version: 1, id, archivedAt, annotations: [annotation...]}

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

// Appends records whose id is not already present.
export function mergeById(into, from) {
  const ids = new Set(into.map((r) => r.id));
  return [...into, ...from.filter((r) => !ids.has(r.id))];
}

function fenceFor(text) {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((s) => s.length));
  return "`".repeat(Math.max(3, longest + 1));
}

// Same shape as the TUI's format_annotations, plus the source folder.
export function formatMarkdown(annotations) {
  const sections = annotations.map((a, i) => {
    const c = a.context ?? {};
    const source = [c.workspace_label, c.tab_label].filter(Boolean).join(" / ");
    const where = source ? ` (${source})` : "";
    const sel = (a.selectedText ?? "").replace(/^[\r\n]+|[\r\n]+$/g, "");
    let quoted;
    if (sel.includes("\n")) {
      const f = fenceFor(sel);
      quoted = `Comment on:\n${f}\n${sel}\n${f}`;
    } else {
      quoted = `Comment on: "${sel.trim()}"`;
    }
    const cwd = c.focused_pane_cwd ? `\nIn: \`${c.focused_pane_cwd}\`` : "";
    const comment = (a.comment ?? "").trim().replace(/\r\n/g, "\n").replace(/\n/g, "\n> ");
    return `## Annotation ${i + 1}${where}${cwd}\n${quoted}\n> ${comment}`;
  });
  return `# Annotations on terminal selections\n\n${sections.join("\n\n")}\n`;
}

// Terminal output from `hc read`: right-trimmed, hc's own "[hc] ..." notes and trailing blank
// lines dropped, last `max` lines.
export function tailLines(text, max) {
  const lines = (text ?? "").replace(/\r\n/g, "\n").split("\n").map((l) => l.replace(/\s+$/, ""))
    .filter((l) => !l.startsWith("[hc] "));
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  return lines.slice(-max);
}
