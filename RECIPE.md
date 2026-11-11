# term-annotate

Select text in any terminal and a small bar pops up at the pointer: looks good, comment or
delete. A sidebar on the right lists the focused pane's annotations as cards you can edit and
delete, and sends them to that pane's coding agent as one compact message (or copies them).

<!-- No preview.png yet: it needs a screenshot from a real window. -->

## What you see

- **Popup** (420x46, Herdr's popup frame, `popover`): one row, 12.5px, three 30px items,
  `👍 looks good (a)`, `💬 comment (c)`, `✕ delete (d)`, the key hint in `dim` at 11px, `hover`
  on hover. In comment mode the row is a 30px input (`accent` border, `background`) and a Save
  button (`solid`).
- **Sidebar panel** (320px block, `chrome`, radius 10, `border`) in a clone of `main`, after
  `panel` in `work-body`.
  - Header, 40px, bottom `border`: the pane's title (13px semibold, truncated) over
    "n annotation(s)" (10.5px `dim`); on the right a 22px pill "Popup on" (`selected`, a `done`
    dot) or "Popup off" (`raised`, `dim` dot).
  - Cards (`surface`, `border`, radius 8, 8px padding, gap 8, scrolls): an optional tag
    ("✓ looks good" on `done`, "✗ remove/undo this" on `blocked`, 10.5px semibold), the quote
    in the terminal font at 11.5px `muted` on `background` (first and last line with "…"
    between when longer than two lines, each truncated), then the comment at 12.5px. Hover
    borders in `accent`. The selected card is `selected` with an `accent` border, a 20px `✕`
    top right, and its comment as an input with a Save button.
  - Empty: "Select text in this terminal to annotate it, or add a note.".
  - Footer, top `border`: "+ Add" left; "Copy all" and "Send to agent" (`solid`) right, only
    when there are annotations. 26px buttons, radius 7.

## How it behaves

- Selecting text in a terminal (Herdr copies selections to PRIMARY) opens the popup once the
  selection holds still. `a` / click saves a "looks good" annotation, `d` a "delete" one, `c`
  asks for a comment (Enter saves a non-empty one). Esc or a click elsewhere closes it. Every
  annotation stores the quote and the terminal.
- No popup when the pill is off, the window isn't active, no terminal has focus, the
  selection is blank or unchanged, or the popup is already open. Coming back to the window
  or closing the popup takes the current selection as already seen.
- The list follows `focused().terminal` live; clicking the panel itself keeps the last pane.
- Click a card: select and edit; Enter or Save stores the comment, Esc cancels. `✕` deletes at
  once. "+ Add": an input card on top; Enter stores a note with no quote (empty: nothing).
- Copy all: the block below on the clipboard. Send to agent: refused with a toast unless the
  pane is an agent; `hc send <terminal> <block>`; on success the pane's annotations move to
  one archive set; on failure they stay and the error is toasted.
- Output: `Notes on your terminal output:`, then per annotation (oldest first, blank line
  between) `> ` quote lines, `✓ looks good` / `✗ remove/undo this`, and the comment.
- Agent status isn't shown.

## Built from

- One mod, `mods/term-annotate/` (`main.js`, pure `lib.js`), `mod.json`
  `{"place":"none","title":"Annotate"}`. Roles by `props().role`: none = the panel,
  `popup` = the bar, opened by the panel with `openOverlay({mod, kind:"popup", at:"pointer",
  width:420, height:46, props:{role:"popup", quote, terminal}})`.
- Layout: a copy of `main.json` with
  `{"id":"annotate","type":"block","size":{"px":320},"min":240,"max":640,"radius":10,
  "border":{"width":1,"color":"border"},"background":"chrome","content":{"mod":"term-annotate"}}`
  appended to `work-body`'s children (see install.md).
- Panel loop: `cx.spawn` + `cx.timer.after(250)`; `window().active`, `focused()`,
  `wl-paste --primary --no-newline --type text`. Shared keys: `term-annotate.auto` (false =
  off), `term-annotate.rev` (the popup bumps it after a save; the panel reloads),
  `term-annotate.popup` (open time; the popup's `close()` clears it, ignored after 5 min).
- `panes()` for the title and context, `agents()` for the send check, `hc send`, `wl-copy`
  through `sh -c '… >/dev/null'`. Store: `fs/promises` under
  `~/.config/herdr-app/state/term-annotate/`, TUI JSONL schema plus `context.terminal_id`
  and `kind`.

## Watch out

- Never use a hidden or 1x1 kept window for background work: it ate every mouse click in
  v1. The watcher lives in the visible panel.
- The popup can't follow the selection, only the pointer, and opens 250–500 ms after release.
- The popup's input can set PRIMARY itself; the panel doesn't poll while it is open.
- `hc send` presses Enter; to a shell that would run `> quote` as a redirect. Keep the agent
  check.
- Don't write the store under `mods/`: saving there reloads the mod.

## Done when

- `herdr-app check mods/term-annotate` passes and `node test/lib.test.js` prints `ok`.
- With the `annotate` layout shown, dragging over text in a terminal opens the bar; `a` adds a
  "✓ looks good" card for that pane and a line in `annotations.jsonl`.
- Switching panes switches the list; Send to agent in a Claude Code pane submits the block and
  empties the list.
