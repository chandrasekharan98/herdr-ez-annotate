# term-annotate

Select text in any terminal and press `ctrl-b a`. A dialog shows the selection and takes
a comment. Later, `ctrl-b ctrl-s` sends every saved comment to the focused coding agent
as one Markdown message, or `ctrl-b ctrl-v` pastes it into the agent's prompt so you can
review it before sending. `ctrl-b m` lists, edits, archives and restores them.

![term-annotate](preview.png)

## What you see

- **Annotate selection** dialog (760x560, modal). Title at 15px semibold, "Ctrl+Enter save ·
  Esc cancel" at 11px in `dim`. Then a source line (space / tab · agent · folder, 11px in
  `dim`). Then the selection in the terminal font at 12px, `muted` on `background`,
  bordered in `border`, radius 8, at most 30 lines of 400 chars. Then a 110px textarea
  with an `accent` border, and Cancel (`raised`) and Save (`solid`) buttons at 28px.
- **Annotate terminal output** dialog (900x680). The same, but the quote is the last 200
  lines of `hc read`, scrolled to the bottom. Click a line to pick it, shift-click to
  extend, click a single picked line again to clear. Picked lines use `selection`. With
  none picked, the comment covers all lines.
- **Annotations** dialog (820x640). Tabs "Active (n)" and "Archived (n)". Active cards
  (`surface`, `border`, radius 8) show #n, the source, the time, the first 3 lines of the
  selection and the comment, with Edit / Archive / Delete. Archived sets show their count,
  date, the first 3 comments, and Restore / Delete. Footer: "Import from TUI" (only when
  the TUI store exists), "Copy all", "Copy & archive all".
- Toasts for every outcome (saved, copied, sent, nothing selected, errors).

## How it behaves

- Delete asks twice: the first click turns the button into "Really delete?" in `blocked`.
- Edit swaps the comment for a textarea. Ctrl+Enter or Save stores it. An empty comment
  is refused.
- Send refuses a terminal that isn't an agent (`agents()`). `hc send` refuses a blocked
  agent. On failure nothing is archived.
- Agent status isn't shown. Every action targets `focused().terminal` when the key is
  pressed.

## Built from

- One mod, `mods/term-annotate/` (`main.js`, pure `lib.js`), `mod.json`
  `{"place":"none","overlay":{"kind":"window","frame":"none","width":1,"height":1,"at":{"x":0,"y":0}}}`.
- Roles by `props().role`. With none (from `mod.open`) it opens
  `openOverlay({mod, kind:"window", frame:"none", key, keep:true, width:1, height:1,
  props:{role:"daemon"}})` and closes itself. `daemon` loops on `nextCommand()`.
  `capture`, `terminal` and `manage` are `kind:"dialog", modal:true` overlays of the same mod.
- Commands: `terminal.copy`, `terminal.paste`. Programs: `wl-paste --no-newline --type
  text`, `wl-copy` (through `sh -c '… >/dev/null'` so its forked server doesn't hold the
  pipe), `wl-copy --clear`, `hc read <t> --lines 200`, `hc send <t> <md>`.
- Store: `fs/promises` under `~/.config/herdr-app/state/term-annotate/`, in the TUI
  plugin's JSONL schema. `crypto.randomUUID` for ids.
- Markdown: `# Annotations on terminal selections`, then `## Annotation N (space / tab)`,
  ``In: `cwd` ``, `Comment on: "…"` (or a fenced block for several lines, the fence longer
  than any backtick run inside), and the comment as `> ` lines. Oldest first.

## Watch out

- `<mod>.<command>` keys reach only loaded copies. A `place:"none"` mod with no copy
  silently has no commands, hence the resident window. A layout switch closes windows;
  kept ones come back with their layout.
- Run `terminal.copy` before opening any overlay, or the dialog has the keyboard and
  nothing is copied. The same goes for `terminal.paste`.
- Wayland clipboard updates are asynchronous. Poll `wl-paste` a few times after the copy,
  and wait about 150 ms after `wl-copy` before `terminal.paste`.
- `hc read` of a working agent gives only its screen and appends an `[hc] …` note. Drop it.
- Don't write the store under `mods/`: saving there reloads the mod.

## Done when

- `herdr-app check mods/term-annotate` passes and `node test/lib.test.js` prints `ok`.
- After `herdr-app do mod.open --name term-annotate`, `herdr-app status` lists a
  `term-annotate` overlay and nothing is visible.
- `herdr-app do term-annotate.manage` and `term-annotate.terminal` open their dialogs.
- Select text, press `ctrl-b a`, type, Ctrl+Enter: a line appears in `annotations.jsonl`.
- `ctrl-b ctrl-v` in a Claude Code pane fills the prompt without submitting it.
