// term-annotate v2: comment on terminal text and hand the comments to a coding agent.
//
// One mod, two roles (props().role):
//   (none)  the sidebar panel in a layout block. It lists the focused terminal's
//           annotations and watches the PRIMARY selection to open the popup.
//   popup   the bar at the selection: looks good (a) · comment (c) · delete (d).

import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import {
  props, exec, theme, settings, notify, openOverlay, closeOverlay,
  focused, spaces, agents, panes, appHome, window, layout, shared, setShared,
} from "herdr";
import * as fs from "fs/promises";
import { randomUUID } from "crypto";
import { parseJsonl, toJsonl, forTerminal, trimQuote, formatCompact, KIND_TEXT } from "./lib.js";

const MOD = "term-annotate";
const ACTIVE = "annotations.jsonl";
const ARCHIVE = "archives.jsonl";
const REV = `${MOD}.rev`; // bumped after the popup saves, so the panel reloads
const POPUP = `${MOD}.popup`; // when the popup opened; null once it closed
const POLL_MS = 250;
const dir = () => `${appHome()}/state/${MOD}`;
const now = () => new Date().toISOString();
const sleep = (cx, ms) => new Promise((r) => cx.timer.after(ms, () => r()));
const toast = (title, body, level = "info") => notify({ title, body, level, timeout: 4000 });
const errText = (e) => String(e?.message ?? e);
const findNode = (n, id) => n?.id === id ? n : (n?.children ?? []).reduce((r, c) => r ?? findNode(c, id), null);
// The popup follows the Annotate section: on while it is the shown side-panel section.
const sectionOpen = () => {
  const root = layout(), panel = findNode(root, "panel");
  return Boolean(panel && !panel.hidden && findNode(root, "panel-body")?.active === "annotate");
};

// ---- store ---------------------------------------------------------------

async function readJsonl(name) {
  const p = `${dir()}/${name}`;
  if (!(await fs.exists(p))) return [];
  return parseJsonl(await fs.readFile(p, "utf8")); // throws on a bad line: never overwrite what we can't read
}
async function writeJsonl(name, records) {
  await fs.mkdir(dir(), { recursive: true });
  await fs.writeFile(`${dir()}/${name}`, toJsonl(records));
}
async function updateActive(fn) {
  await writeJsonl(ACTIVE, fn(await readJsonl(ACTIVE)));
}
// Moves these annotations into one archive set.
async function archive(list) {
  const ids = new Set(list.map((a) => a.id));
  const set = { version: 1, id: randomUUID(), archivedAt: now(), annotations: list };
  await writeJsonl(ARCHIVE, [...(await readJsonl(ARCHIVE)), set]);
  await updateActive((all) => all.filter((a) => !ids.has(a.id)));
  return set.id;
}
// Undo: takes an archive set back out and puts its annotations back in the list.
async function unarchive(setId) {
  const sets = await readJsonl(ARCHIVE), set = sets.find((x) => x.id === setId);
  if (!set) return;
  await writeJsonl(ARCHIVE, sets.filter((x) => x !== set));
  await updateActive((all) => [...all, ...set.annotations.filter((a) => !all.some((b) => b.id === a.id))]);
}
function record(selectedText, terminal, comment, kind) {
  const at = now();
  return { selectedText, capturedAt: at, context: context(terminal), id: randomUUID(), comment, createdAt: at, ...(kind ? { kind } : {}) };
}

// ---- clipboard (Wayland) ---------------------------------------------------

async function primary() {
  const r = await exec("wl-paste", ["--primary", "--no-newline", "--type", "text"]);
  return r.code === 0 ? r.stdout : "";
}
async function clipWrite(text) {
  // wl-copy forks a server that would hold exec's pipes open; detach its output.
  const r = await exec("sh", ["-c", 'printf %s "$1" | wl-copy >/dev/null 2>&1', "sh", text]);
  if (r.code !== 0) throw new Error("wl-copy failed");
}

// ---- where a terminal is ---------------------------------------------------

// The TUI's context fields for a terminal, plus terminal_id.
function context(terminal) {
  const pane = panes().find((p) => p.terminal === terminal);
  const space = spaces().find((s) => s.tabs.some((t) => t.id === pane?.tab));
  const agent = agents().find((a) => a.address === terminal);
  return {
    workspace_id: space?.id,
    workspace_label: space?.name,
    tab_id: pane?.tab,
    tab_label: space?.tabs.find((t) => t.id === pane?.tab)?.name,
    focused_pane_id: pane?.pane,
    focused_pane_cwd: pane?.cwd ?? undefined,
    focused_pane_agent: agent?.app ?? pane?.program?.key ?? undefined,
    terminal_id: terminal,
  };
}

// ---- view ------------------------------------------------------------------

export default class TermAnnotate extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.role = p.role ?? "panel";
    this.handle = cx.focus_handle();
    if (this.role === "popup") {
      this.input = null; // set in comment mode
      if (p.overlay) setShared(POPUP, Date.now());
      this.handle.focus();
      cx.timer.after(300, () => { if (!this.input) this.handle.focus(); });
      return;
    }
    this.term = focused()?.terminal ?? null;
    this.all = [];
    this.sel = null; // selected card id
    this.edit = null; // its InputState
    this.adding = null; // InputState of a new free note
    this.error = null;
    this.rev = shared(REV);
    this.reload(cx);
    this.watch(cx);
  }

  async close() {
    if (this.role === "popup") setShared(POPUP, null);
  }

  // ---- panel: data

  reload(cx) {
    cx.spawn(async (cx) => {
      try {
        this.all = await readJsonl(ACTIVE);
        this.error = null;
      } catch (e) { this.error = errText(e); }
      cx.notify();
    });
  }

  // Runs a store change from a click, then reloads.
  act(cx, fn) {
    cx.spawn(async (cx) => {
      try { await fn(); this.error = null; } catch (e) { this.error = errText(e); }
      this.reload(cx);
    });
  }

  // Polls PRIMARY while this window is active and a terminal has focus. A selection opens the
  // popup once its text has held still for one poll. Coming back to the window, or closing the
  // popup, re-reads PRIMARY as the baseline, so other apps' and dismissed selections never pop.
  // ponytail: a 250 ms wl-paste poll; switch to `wl-paste --primary --watch` if it ever shows up in CPU.
  watch(cx) {
    let last = null, pending = null;
    cx.spawn(async (cx) => {
      for (;;) {
        await sleep(cx, POLL_MS);
        if (shared(REV) !== this.rev) { this.rev = shared(REV); this.reload(cx); }
        const f = focused();
        if (f?.terminal && f.terminal !== this.term) { this.term = f.terminal; this.cancel(); cx.notify(); }
        const popupOpen = Date.now() - (Number(shared(POPUP)) || 0) < 300000;
        if (!sectionOpen() || !window()?.active || !f?.terminal || popupOpen) { last = null; continue; }
        const text = await primary();
        if (last === null || text === last) { last = text; pending = null; continue; }
        if (text !== pending) { pending = text; continue; }
        last = text; pending = null;
        if (text.trim() && focused()?.terminal === f.terminal) this.popup(text, f.terminal);
      }
    });
  }

  popup(quote, terminal) {
    setShared(POPUP, Date.now());
    openOverlay({ mod: MOD, kind: "popup", at: "pointer", width: 420, height: 46, props: { role: "popup", quote, terminal } });
  }

  cancel() { this.sel = null; this.edit = null; this.adding = null; }

  select(a, cx) {
    if (this.sel === a.id) return;
    this.cancel();
    this.sel = a.id;
    this.edit = InputState.new({ value: a.comment ?? "", placeholder: "Comment…" });
    this.edit.on("submit", (_e, cx) => this.saveEdit(cx));
    this.edit.focus();
    cx.notify();
  }

  saveEdit(cx) {
    const id = this.sel, comment = this.edit.value().trim();
    this.cancel();
    this.act(cx, () => updateActive((all) => all.map((a) => (a.id === id ? { ...a, comment } : a))));
  }

  startAdd(cx) {
    if (!this.term) return toast("Annotate", "Focus a terminal first.", "warning");
    this.cancel();
    this.adding = InputState.new({ placeholder: "Note on this pane…" });
    this.adding.on("submit", (_e, cx) => {
      const comment = this.adding.value().trim();
      const rec = record("", this.term, comment);
      this.cancel();
      if (comment) this.act(cx, () => updateActive((all) => [...all, rec]));
      else cx.notify();
    });
    this.adding.focus();
    cx.notify();
  }

  copyAll(list, cx) {
    this.act(cx, async () => {
      await clipWrite(formatCompact(list));
      this.undo = { set: await archive(list), term: this.term, text: `${list.length} copied` };
    });
  }

  send(list, cx) {
    const term = this.term;
    // hc send types into the terminal and presses Enter: a shell would run the text.
    if (!agents().some((a) => a.address === term)) return toast("Not an agent", "Send works on a coding agent's pane. Use Copy all instead.", "warning");
    this.act(cx, async () => {
      const r = await exec("hc", ["send", term, formatCompact(list)], { timeout: 120000 });
      if (r.code !== 0) return toast("Not sent", `${r.stderr.trim() || "hc send failed"}. Annotations kept.`, "error");
      this.undo = { set: await archive(list), term, text: `${list.length} sent to agent` };
    });
  }

  // ---- popup

  savePopup(cx, kind, comment = "") {
    const p = props();
    const rec = record(p.quote, p.terminal, comment, kind);
    cx.spawn(async () => {
      try { await updateActive((all) => [...all, rec]); setShared(REV, rec.id); }
      catch (e) { toast("Annotation not saved", errText(e), "error"); }
      closeOverlay(p.overlay);
    });
  }

  commentMode(cx) {
    this.input = InputState.new({ placeholder: "Comment… (Enter saves, Esc cancels)" });
    this.input.on("submit", (_e, cx) => {
      const c = this.input.value().trim();
      if (c) this.savePopup(cx, undefined, c);
    });
    this.input.focus();
    cx.notify();
  }

  popupKey(e, cx) {
    const m = e.modifiers;
    if (e.key === "escape") { closeOverlay(props().overlay); cx.stop_propagation(); return; }
    if (this.input || m.control || m.alt || m.platform) return;
    const act = { a: () => this.savePopup(cx, "ok"), c: () => this.commentMode(cx), d: () => this.savePopup(cx, "delete") }[e.key];
    if (act) { act(); cx.stop_propagation(); }
  }

  // ---- render

  button(t, id, label, onClick, kind = "plain") {
    const primary = kind === "primary";
    return h_flex().id(id).h(26).px(10).items_center().rounded(7).border_1().border_color(primary ? t.solid : t.input)
      .bg(primary ? t.solid : t.raised).text_color(primary ? t.solid_foreground : t.foreground).text_size(12)
      .cursor_pointer().hover((s) => s.opacity(0.88))
      .on_click((_e, cx) => { cx.stop_propagation(); onClick(cx); }).child(label);
  }

  mono() { return settings().font_family ?? "JetBrains Mono"; }

  render() {
    const t = theme();
    return this.role === "popup" ? this.renderPopup(t) : this.renderPanel(t);
  }

  renderPopup(t) {
    const root = h_flex().id("ta-popup").track_focus(this.handle).on_key_down((e, cx) => this.popupKey(e, cx))
      .size_full().px(8).gap(6).items_center().bg(t.popover).text_color(t.foreground).text_size(12.5);
    if (this.input) {
      return root
        .child(Input.new(this.input).flex_1().h(30).px(8).rounded(7).border_1().border_color(t.accent).bg(t.background).text_size(12.5))
        .child(this.button(t, "ta-p-save", "Save", (cx) => {
          const c = this.input.value().trim();
          if (c) this.savePopup(cx, undefined, c);
        }, "primary"));
    }
    const item = (id, label, key, fn) => h_flex().id(id).h(30).px(10).gap(6).items_center().rounded(7).cursor_pointer()
      .hover((s) => s.bg(t.hover)).on_click((_e, cx) => fn(cx))
      .child(label).child(div().text_color(t.dim).text_size(11).child(`(${key})`));
    return root
      .child(item("ta-p-ok", "👍 looks good", "a", (cx) => this.savePopup(cx, "ok")))
      .child(item("ta-p-c", "💬 comment", "c", (cx) => this.commentMode(cx)))
      .child(item("ta-p-d", "✕ delete", "d", (cx) => this.savePopup(cx, "delete")));
  }

  card(t, a) {
    const selected = this.sel === a.id;
    const quote = trimQuote(a.selectedText, 300);
    const tag = a.kind && div().px(6).py(1).rounded(5).text_size(10.5).font_semibold()
      .bg(a.kind === "ok" ? t.done : t.blocked).text_color(t.background).child(KIND_TEXT[a.kind]);
    return v_flex().id(`c-${a.id}`).gap(6).p(8).rounded(8).border_1().cursor_pointer()
      .border_color(selected ? t.accent : t.border).bg(selected ? t.selected : t.surface)
      .hover((s) => s.border_color(t.accent))
      .on_click((_e, cx) => this.select(a, cx))
      .when(Boolean(tag) || selected, (el) => el.child(h_flex().items_center().gap(6)
        .child(tag || div())
        .child(div().flex_1())
        .when(selected, (el) => el.child(h_flex().id(`x-${a.id}`).w(20).h(20).justify_center().items_center().rounded(5)
          .text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.blocked))
          .on_click((_e, cx) => {
            cx.stop_propagation();
            this.cancel();
            this.act(cx, () => updateActive((all) => all.filter((x) => x.id !== a.id)));
          })
          .child("✕")))))
      .when(quote.length > 0, (el) => el.child(v_flex().px(6).py(4).rounded(6).bg(t.background)
        .font_family(this.mono()).text_size(11.5).text_color(t.muted)
        .children(quote.map((l, i) => div().id(`q-${a.id}-${i}`).truncate().child(l)))))
      .child(selected
        ? h_flex().gap(6).items_center()
            .child(Input.new(this.edit).flex_1().h(28).px(8).rounded(7).border_1().border_color(t.accent).bg(t.background).text_size(12.5))
            .child(this.button(t, `s-${a.id}`, "Save", (cx) => this.saveEdit(cx), "primary"))
        : a.comment ? div().text_size(12.5).child(a.comment) : div());
  }

  renderPanel(t) {
    const list = this.term ? forTerminal(this.all, this.term) : [];
    const pane = panes().find((p) => p.terminal === this.term);
    const header = h_flex().items_center().gap(8).px(12).h(40).border_b_1().border_color(t.border)
      .child(v_flex().flex_1().min_w(0)
        .child(div().text_size(13).font_semibold().truncate().child(pane?.title || this.term || "No terminal"))
        .child(div().text_size(10.5).text_color(t.dim).child(`${list.length} annotation(s)`)));
    const cards = list.map((a) => this.card(t, a));
    if (this.adding) {
      cards.unshift(v_flex().id("ta-add-card").p(8).rounded(8).border_1().border_color(t.accent).bg(t.selected)
        .child(Input.new(this.adding).h(28).px(8).rounded(7).border_1().border_color(t.input).bg(t.background).text_size(12.5)));
    }
    const empty = v_flex().p(16).gap(10).text_size(12).text_color(t.dim)
      .child(this.term ? "Select text in this terminal to annotate it, or add a note." : "Focus a terminal.");
    const undo = this.undo?.term === this.term && h_flex().gap(8).px(12).py(6).items_center().border_t_1().border_color(t.border)
      .text_size(11.5).text_color(t.dim).child(div().flex_1().child(this.undo.text))
      .child(this.button(t, "ta-undo", "Undo", (cx) => { const u = this.undo; this.undo = null; this.act(cx, () => unarchive(u.set)); }));
    const footer = h_flex().gap(6).px(12).py(8).items_center().border_t_1().border_color(t.border)
      .child(this.button(t, "ta-add", "+ Add", (cx) => this.startAdd(cx)))
      .child(div().flex_1())
      .when(list.length > 0, (el) => el
        .child(this.button(t, "ta-copy", "Copy all", (cx) => this.copyAll(list, cx)))
        .child(this.button(t, "ta-send", "Send to agent", (cx) => this.send(list, cx), "primary")));
    return v_flex().id("ta-panel")
      .on_key_down((e, cx) => { if (e.key === "escape" && (this.sel || this.adding)) { this.cancel(); cx.notify(); cx.stop_propagation(); } })
      .size_full().min_h(0).bg(t.chrome).text_color(t.foreground).text_size(12.5)
      .child(header)
      .child(v_flex().id("ta-list").flex_1().min_h(0).overflow_y_scrollbar().p(10).gap(8)
        .children(cards.length ? cards : [empty]))
      .when(Boolean(undo), (el) => el.child(undo))
      .when(Boolean(this.error), (el) => el.child(div().px(12).py(4).text_size(11.5).text_color(t.blocked).child(this.error)))
      .child(footer);
  }
}
