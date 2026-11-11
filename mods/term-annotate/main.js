// term-annotate: comment on terminal text and hand the comments to a coding agent.
//
// One mod, four roles (props().role):
//   (none)   opened by `mod.open`: starts the resident copy below and closes itself.
//   daemon   an invisible kept 1x1 window. It exists so keys.json's
//            "term-annotate.<command>" has a loaded copy to reach; it runs commands
//            while the terminal still has the keyboard (terminal.copy / terminal.paste).
//   capture | terminal   the comment dialog (a selection, or recent terminal output).
//   manage   the list of active and archived annotations.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, TextareaState, Textarea, ScrollHandle } from "gpui-base";
import {
  props, run, exec, hc, theme, settings, notify, nextCommand, openOverlay, closeOverlay,
  focused, spaces, agents, panes, appHome, home,
} from "herdr";
import * as fs from "fs/promises";
import { randomUUID } from "crypto";
import { parseJsonl, toJsonl, captureOrder, mergeById, formatMarkdown, tailLines } from "./lib.js";

const MOD = "term-annotate";
const ACTIVE = "annotations.jsonl";
const ARCHIVE = "archives.jsonl";
const REVIEW_LINES = 200;
const dir = () => `${appHome()}/state/${MOD}`;
const tuiDir = () => `${home()}/.local/state/herdr/plugins/annotate`;
const now = () => new Date().toISOString();
const sleep = (cx, ms) => new Promise((r) => cx.timer.after(ms, () => r()));
const toast = (title, body, level = "info") => notify({ title, body, level, timeout: 4000 });

// ---- store ---------------------------------------------------------------

async function readJsonl(name, folder = dir()) {
  const p = `${folder}/${name}`;
  if (!(await fs.exists(p))) return [];
  return parseJsonl(await fs.readFile(p, "utf8")); // throws on a bad line: never overwrite what we can't read
}
async function writeJsonl(name, records) {
  await fs.mkdir(dir(), { recursive: true });
  await fs.writeFile(`${dir()}/${name}`, toJsonl(records));
}
async function addAnnotation(rec) {
  await writeJsonl(ACTIVE, [...(await readJsonl(ACTIVE)), rec]);
}
// Moves these annotations into one archive set.
async function archive(list) {
  const ids = new Set(list.map((a) => a.id));
  const set = { version: 1, id: randomUUID(), archivedAt: now(), annotations: list };
  await writeJsonl(ARCHIVE, [...(await readJsonl(ARCHIVE)), set]);
  await writeJsonl(ACTIVE, (await readJsonl(ACTIVE)).filter((a) => !ids.has(a.id)));
}

// ---- clipboard (Wayland) ---------------------------------------------------

async function clipRead() {
  const r = await exec("wl-paste", ["--no-newline", "--type", "text"]);
  return r.code === 0 ? r.stdout : "";
}
async function clipWrite(text) {
  // wl-copy forks a server that would hold exec's pipes open; detach its output.
  const r = await exec("sh", ["-c", 'printf %s "$1" | wl-copy >/dev/null 2>&1', "sh", text]);
  if (r.code !== 0) throw new Error("wl-copy failed");
}

// ---- where a command came from -------------------------------------------

function source() {
  const f = focused();
  if (!f?.terminal) return null;
  const space = spaces().find((s) => s.id === f.space);
  const tab = space?.tabs.find((t) => t.id === f.tab);
  const agent = agents().find((a) => a.address === f.terminal);
  const pane = panes().find((p) => p.terminal === f.terminal);
  return {
    terminal: f.terminal,
    agent,
    context: {
      workspace_id: f.space,
      workspace_label: space?.name,
      tab_id: f.tab,
      tab_label: tab?.name,
      focused_pane_id: f.pane ?? undefined,
      focused_pane_cwd: f.cwd ?? pane?.cwd ?? undefined,
      focused_pane_agent: agent?.app ?? pane?.program?.key ?? undefined,
      terminal_id: f.terminal,
    },
  };
}

function dialog(props, width = 760, height = 560) {
  openOverlay({ mod: MOD, kind: "dialog", modal: true, width, height, props });
}

// ---- daemon commands -------------------------------------------------------

const COMMANDS = {
  async capture(cx) {
    const src = source();
    if (!src) return toast("Annotate", "Focus a terminal first.", "warning");
    // No selection API: copy it. Clear first so a stale clipboard isn't taken for a selection.
    // ponytail: a non-text clipboard (image) is lost when nothing was selected.
    const prev = await clipRead();
    await exec("wl-copy", ["--clear"]);
    run("terminal.copy");
    let text = "";
    for (let i = 0; i < 4 && !text; i++) { await sleep(cx, 60); text = await clipRead(); }
    if (!text.trim()) {
      if (prev) await clipWrite(prev);
      return toast("Nothing selected", "Select text in the terminal, then annotate.", "warning");
    }
    dialog({ role: "capture", selectedText: text, capturedAt: now(), context: src.context });
  },

  async terminal() {
    const src = source();
    if (!src) return toast("Annotate", "Focus a terminal first.", "warning");
    const r = await hc(["read", src.terminal, "--lines", String(REVIEW_LINES)]);
    if (r.code !== 0) return toast("Couldn't read the terminal", r.stderr.trim(), "error");
    const lines = tailLines(r.stdout, REVIEW_LINES);
    if (!lines.length) return toast("Annotate", "The terminal has no output yet.", "warning");
    dialog({ role: "terminal", lines, capturedAt: now(), context: src.context }, 900, 680);
  },

  async manage() { dialog({ role: "manage" }, 820, 640); },

  async "copy-context"() { await copyOut(false); },
  async "copy-archive"() { await copyOut(true); },

  async "send-archive"() {
    const { src, list } = await agentAndList();
    if (!list) return;
    const r = await exec("hc", ["send", src.terminal, formatMarkdown(list)], { timeout: 120000 });
    if (r.code !== 0) return toast("Not sent", `${r.stderr.trim() || "hc send failed"}. Annotations kept.`, "error");
    await archive(list);
    toast("Sent to agent", `${list.length} annotation(s) sent and archived.`, "success");
  },

  async "paste-archive"(cx) {
    const { list } = await agentAndList();
    if (!list) return;
    // hc send always presses Enter; the app's own paste (bracketed, no Enter) does not.
    await clipWrite(formatMarkdown(list));
    await sleep(cx, 150); // let the window see the new clipboard before it pastes
    run("terminal.paste");
    await archive(list);
    toast("Pasted into prompt", `${list.length} annotation(s) archived. Press Enter to send.`, "success");
  },
};

async function copyOut(andArchive) {
  const list = captureOrder(await readJsonl(ACTIVE));
  if (!list.length) return toast("No annotations", "Nothing to copy.", "warning");
  await clipWrite(formatMarkdown(list));
  if (andArchive) await archive(list);
  toast("Copied", `${list.length} annotation(s) copied as Markdown${andArchive ? " and archived" : ""}.`, "success");
}

async function agentAndList() {
  const src = source();
  if (!src?.agent) { toast("Focus an agent", "Focus the coding agent's terminal first.", "warning"); return {}; }
  const list = captureOrder(await readJsonl(ACTIVE));
  if (!list.length) { toast("No annotations", "Nothing to send.", "warning"); return {}; }
  return { src, list };
}

// ---- view ------------------------------------------------------------------

export default class TermAnnotate extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.role = p.role;
    if (!this.role) {
      // Opened by mod.open (absent under `herdr-app check`): become the resident copy.
      if (p.overlay) {
        openOverlay({ mod: MOD, kind: "window", frame: "none", key: MOD, keep: true, width: 1, height: 1, at: { x: 0, y: 0 }, props: { role: "daemon" } });
        closeOverlay(p.overlay);
        toast("Annotate ready", "ctrl-b a annotates a selection; ctrl-b m manages.");
      }
      return;
    }
    if (this.role === "daemon") {
      cx.spawn(async (cx) => {
        for (;;) {
          const c = await nextCommand();
          try { await COMMANDS[c]?.(cx); } catch (e) { toast("Annotate failed", String(e?.message ?? e), "error"); }
        }
      });
      return;
    }
    this.handle = cx.focus_handle();
    this.error = null;
    if (this.role === "manage") {
      this.tab = "active";
      this.editing = null;
      this.confirm = null;
      this.reload(cx);
      this.handle.focus();
      return;
    }
    this.sel = null; // terminal role: {a, b} line range
    this.comment = TextareaState.new({ placeholder: "Your comment for the agent…", rows: 5 });
    this.comment.focus();
    cx.timer.after(600, () => this.comment.focus());
    if (this.role === "terminal") {
      this.scroll = ScrollHandle.new();
      this.scroll.scroll_to_item((p.lines?.length ?? 1) - 1);
    }
  }

  reload(cx) {
    cx.spawn(async (cx) => {
      try {
        this.active = captureOrder(await readJsonl(ACTIVE));
        this.archives = (await readJsonl(ARCHIVE)).reverse();
        this.tuiExists = await fs.exists(`${tuiDir()}/${ARCHIVE}`) || await fs.exists(`${tuiDir()}/${ACTIVE}`);
      } catch (e) { this.error = String(e?.message ?? e); }
      cx.notify();
    });
  }

  // Runs a store change from a click, then reloads the list.
  act(cx, fn) {
    cx.spawn(async (cx) => {
      try { await fn(); this.error = null; } catch (e) { this.error = String(e?.message ?? e); }
      this.confirm = null;
      this.reload(cx);
    });
  }

  save(cx) {
    const p = props();
    const comment = this.comment.value().trim();
    if (!comment) { this.error = "Write a comment first."; cx.notify(); return; }
    let selectedText = p.selectedText;
    if (this.role === "terminal") selectedText = (this.sel ? p.lines.slice(this.sel.a, this.sel.b + 1) : p.lines).join("\n");
    const rec = { selectedText, capturedAt: p.capturedAt, context: p.context, id: randomUUID(), comment, createdAt: now() };
    cx.spawn(async (cx) => {
      try {
        await addAnnotation(rec);
        closeOverlay(p.overlay);
        toast("Annotation saved", comment.slice(0, 80), "success");
      } catch (e) { this.error = String(e?.message ?? e); cx.notify(); }
    });
  }

  key(e, cx) {
    if (e.key === "escape") { closeOverlay(props().overlay); cx.stop_propagation(); }
    else if (e.key === "enter" && (e.modifiers.control || e.modifiers.platform) && this.comment) { this.save(cx); cx.stop_propagation(); }
    else if (e.key === "enter" && (e.modifiers.control || e.modifiers.platform) && this.editing) { this.saveEdit(cx); cx.stop_propagation(); }
  }

  render(cx) {
    if (!this.role || this.role === "daemon") return div();
    const t = theme();
    const body = this.role === "manage" ? this.renderManage(t) : this.renderComment(t);
    return v_flex().id("ta-root").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .size_full().min_h(0).p(18).gap(10).bg(t.popover).text_color(t.foreground).text_size(13)
      .child(body);
  }

  // -- shared bits

  button(t, id, label, onClick, kind = "plain") {
    const primary = kind === "primary", danger = kind === "danger";
    const bg = primary ? t.solid : danger ? t.blocked : t.raised;
    const fg = primary ? t.solid_foreground : danger ? t.background : t.foreground;
    return h_flex().id(id).h(28).px(12).items_center().rounded(7).border_1().border_color(primary || danger ? bg : t.input)
      .bg(bg).text_color(fg).text_size(12).cursor_pointer().hover((s) => s.opacity(0.88))
      .on_click((_e, cx) => onClick(cx)).child(label);
  }

  header(t, title, hint) {
    return h_flex().items_center().gap(8)
      .child(div().flex_1().text_size(15).font_semibold().child(title))
      .child(div().text_size(11).text_color(t.dim).child(hint));
  }

  mono() { return settings().font_family ?? "JetBrains Mono"; }

  where(t, c) {
    const bits = [[c?.workspace_label, c?.tab_label].filter(Boolean).join(" / "), c?.focused_pane_agent, c?.focused_pane_cwd].filter(Boolean);
    return div().text_size(11).text_color(t.dim).truncate().child(bits.join(" · "));
  }

  // -- capture / terminal dialog

  renderComment(t) {
    const p = props() ?? {};
    const isTerm = this.role === "terminal";
    let quote;
    if (isTerm) {
      const lines = p.lines ?? [];
      const inSel = (i) => this.sel && i >= this.sel.a && i <= this.sel.b;
      quote = v_flex().id("ta-lines").flex_1().min_h(0).overflow_y_scrollbar().track_scroll(this.scroll)
        .rounded(8).border_1().border_color(t.border).bg(t.background).py(4).font_family(this.mono()).text_size(12)
        .children(lines.map((l, i) => div().id(`l${i}`).px(10).truncate().cursor_pointer()
          .bg(inSel(i) ? t.selection : t.background).text_color(inSel(i) ? t.foreground : t.muted)
          .hover((s) => s.bg(inSel(i) ? t.selection : t.hover))
          .on_click((e, cx) => {
            if (e.modifiers.shift && this.sel) this.sel = { a: Math.min(this.sel.a, i), b: Math.max(this.sel.b, i) };
            else this.sel = this.sel && this.sel.a === i && this.sel.b === i ? null : { a: i, b: i };
            cx.notify();
          })
          .child(l || " ")));
    } else {
      const text = p.selectedText ?? "";
      const all = text.split("\n");
      const shown = all.slice(0, 30).map((l) => (l.length > 400 ? l.slice(0, 400) + "…" : l));
      if (all.length > 30) shown.push(`… ${all.length - 30} more lines`);
      quote = v_flex().id("ta-quote").flex_1().min_h(0).overflow_y_scrollbar().rounded(8).border_1().border_color(t.border)
        .bg(t.background).px(10).py(6).font_family(this.mono()).text_size(12).text_color(t.muted)
        .children(shown.map((l, i) => div().id(`q${i}`).child(l || " ")));
    }
    const what = isTerm
      ? (this.sel ? `Lines ${this.sel.a + 1}–${this.sel.b + 1} of ${p.lines.length} · click / shift-click to pick lines`
                  : `All ${p.lines?.length ?? 0} lines · click / shift-click to pick lines`)
      : `${(p.selectedText ?? "").length} characters selected`;
    return v_flex().size_full().min_h(0).gap(10)
      .child(this.header(t, isTerm ? "Annotate terminal output" : "Annotate selection", "Ctrl+Enter save · Esc cancel"))
      .child(this.where(t, p.context))
      .child(div().text_size(11.5).text_color(t.dim).child(what))
      .child(quote)
      .child(div().rounded(8).border_1().border_color(t.accent).bg(t.background).p(2)
        .child(Textarea.new(this.comment).h(110).px(8).py(6).text_size(13).text_color(t.foreground)))
      .when(Boolean(this.error), (el) => el.child(div().text_size(12).text_color(t.blocked).child(this.error)))
      .child(h_flex().gap(8).justify_end()
        .child(this.button(t, "ta-cancel", "Cancel", () => closeOverlay(p.overlay)))
        .child(this.button(t, "ta-save", "Save", (cx) => this.save(cx), "primary")));
  }

  // -- manage

  saveEdit(cx) {
    const id = this.editing, comment = this.editState.value().trim();
    if (!comment) { this.error = "A comment can't be empty."; cx.notify(); return; }
    this.editing = null;
    this.act(cx, async () => writeJsonl(ACTIVE, (await readJsonl(ACTIVE)).map((a) => (a.id === id ? { ...a, comment } : a))));
  }

  // A two-step button: the first click arms it, the second runs.
  confirmButton(t, id, label, onConfirm) {
    return this.confirm === id
      ? this.button(t, id, `Really ${label.toLowerCase()}?`, onConfirm, "danger")
      : this.button(t, id, label, (cx) => { this.confirm = id; cx.notify(); });
  }

  renderManage(t) {
    const active = this.active ?? [], archives = this.archives ?? [];
    const tabBtn = (id, label) => div().id(`tab-${id}`).px(10).py(4).rounded(6).cursor_pointer().text_size(12.5)
      .bg(this.tab === id ? t.selected : t.popover).text_color(this.tab === id ? t.foreground : t.muted)
      .hover((s) => s.bg(t.hover)).on_click((_e, cx) => { this.tab = id; this.confirm = null; this.editing = null; cx.notify(); })
      .child(label);
    const quote = (text) => {
      const lines = (text ?? "").split("\n");
      const shown = lines.slice(0, 3).join("\n") + (lines.length > 3 ? `\n… ${lines.length - 3} more lines` : "");
      return div().px(8).py(4).rounded(6).bg(t.background).font_family(this.mono()).text_size(11.5).text_color(t.muted).child(shown);
    };
    const when = (iso) => (iso ? new Date(iso).toLocaleString() : "");

    const activeRows = active.map((a, i) => {
      const editing = this.editing === a.id;
      return v_flex().id(`a-${a.id}`).gap(6).p(10).rounded(8).border_1().border_color(editing ? t.accent : t.border).bg(t.surface)
        .child(h_flex().gap(8).items_center()
          .child(div().text_size(12).font_semibold().child(`#${i + 1}`))
          .child(div().flex_1().min_w(0).child(this.where(t, a.context)))
          .child(div().text_size(11).text_color(t.dim).child(when(a.createdAt))))
        .child(quote(a.selectedText))
        .child(editing
          ? div().rounded(6).border_1().border_color(t.input).bg(t.background).p(2)
              .child(Textarea.new(this.editState).h(80).px(6).py(4).text_size(13).text_color(t.foreground))
          : div().text_size(13).child(a.comment))
        .child(h_flex().gap(6).justify_end().children(editing
          ? [this.button(t, `c-${a.id}`, "Cancel", (cx) => { this.editing = null; cx.notify(); }),
             this.button(t, `s-${a.id}`, "Save", (cx) => this.saveEdit(cx), "primary")]
          : [this.button(t, `e-${a.id}`, "Edit", (cx) => {
               this.editing = a.id;
               this.editState = TextareaState.new({ value: a.comment, rows: 3 });
               this.editState.focus();
               cx.notify();
             }),
             this.button(t, `ar-${a.id}`, "Archive", (cx) => this.act(cx, () => archive([a]))),
             this.confirmButton(t, `d-${a.id}`, "Delete", (cx) => this.act(cx, async () =>
               writeJsonl(ACTIVE, (await readJsonl(ACTIVE)).filter((x) => x.id !== a.id))))]));
    });

    const archiveRows = archives.map((s) => v_flex().id(`s-${s.id}`).gap(6).p(10).rounded(8).border_1().border_color(t.border).bg(t.surface)
      .child(h_flex().gap(8).items_center()
        .child(div().flex_1().text_size(12).font_semibold().child(`${s.annotations.length} annotation(s)`))
        .child(div().text_size(11).text_color(t.dim).child(`archived ${when(s.archivedAt)}`)))
      .children(s.annotations.slice(0, 3).map((a, i) => div().id(`sa-${s.id}-${i}`).text_size(12.5).truncate().child(`• ${a.comment}`)))
      .child(h_flex().gap(6).justify_end()
        .child(this.button(t, `r-${s.id}`, "Restore", (cx) => this.act(cx, async () => {
          await writeJsonl(ACTIVE, mergeById(await readJsonl(ACTIVE), s.annotations));
          await writeJsonl(ARCHIVE, (await readJsonl(ARCHIVE)).filter((x) => x.id !== s.id));
        })))
        .child(this.confirmButton(t, `ds-${s.id}`, "Delete", (cx) => this.act(cx, async () =>
          writeJsonl(ARCHIVE, (await readJsonl(ARCHIVE)).filter((x) => x.id !== s.id)))))));

    const rows = this.tab === "active" ? activeRows : archiveRows;
    const empty = this.active === undefined ? "Loading…" : this.tab === "active"
      ? "No annotations. Select terminal text and press ctrl-b a." : "Nothing archived yet.";
    const footer = h_flex().gap(8).items_center()
      .when(Boolean(this.tuiExists), (el) => el.child(this.button(t, "ta-import", "Import from TUI", (cx) => this.act(cx, async () => {
        // Copies the TUI plugin's store (never moves it); ids already here are skipped.
        await writeJsonl(ACTIVE, mergeById(await readJsonl(ACTIVE), await readJsonl(ACTIVE, tuiDir())));
        await writeJsonl(ARCHIVE, mergeById(await readJsonl(ARCHIVE), await readJsonl(ARCHIVE, tuiDir())));
        toast("Imported", "TUI annotations copied.", "success");
      }))))
      .child(div().flex_1())
      .when(this.tab === "active" && active.length > 0, (el) => el
        .child(this.button(t, "ta-copy", "Copy all", (cx) => this.act(cx, () => copyOut(false))))
        .child(this.button(t, "ta-copyar", "Copy & archive all", (cx) => this.act(cx, () => copyOut(true)), "primary")));

    return v_flex().size_full().min_h(0).gap(10)
      .child(this.header(t, "Annotations", "Esc"))
      .child(h_flex().gap(4).child(tabBtn("active", `Active (${active.length})`)).child(tabBtn("archive", `Archived (${archives.length})`)))
      .child(v_flex().id("ta-list").flex_1().min_h(0).overflow_y_scrollbar().gap(8)
        .children(rows.length ? rows : [div().p(20).text_color(t.dim).child(empty)]))
      .when(Boolean(this.error), (el) => el.child(div().text_size(12).text_color(t.blocked).child(this.error)))
      .child(footer);
  }
}
