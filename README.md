# term-annotate

A Herdr desktop-app mod: comment on terminal text and hand the comments to a coding agent,
like plannotator in the herdr TUI.

- **Select text** in a terminal (drag). A small bar opens at the pointer:
  `👍 looks good (a)  💬 comment (c)  ✕ delete (d)`. Press the key or click. `c` turns the bar
  into a comment box (Enter saves, Shift+Enter adds a line, Esc cancels); card edits and
  `+ Add` use the same box. Esc or a click elsewhere dismisses it.
- **The Annotate section** (side panel, beside Files and Changes) lists only the focused pane's annotations and follows
  focus. Click a card to select it and edit its comment (Enter or Save, Esc cancels); `✕` on the
  selected card deletes it. `+ Add` writes a free note for the pane. The selection
  popup is on while the Annotate section is open, and off when it is closed or another section shows.
- **Copy all** puts the pane's annotations on the clipboard; **Send to agent** types them into
  that pane's agent and presses Enter (`hc send`). Either way they then leave the list (archived),
  and an "n copied · Undo" bar brings them back. If sending fails they stay.

What is sent is one compact block:

```
Notes on your terminal output:

> first line of the quote
> …
> last line of the quote
Rename this to fooBar

> npm test passed
✓ looks good

> rm -rf build
✗ remove/undo this
```

## Install

See [install.md](install.md): copy the mod folder, clone `main.json` as `annotate.json` with the
panel added. No keys.

Linux/Wayland only: `wl-paste` / `wl-copy` (package `wl-clipboard`).

## Storage

`~/.config/herdr-app/state/term-annotate/annotations.jsonl` (one annotation per line) and
`archives.jsonl` (one archived set per line), in the TUI plugin's schema:

```json
{"selectedText":"…","capturedAt":"ISO","context":{"workspace_id":"…","workspace_label":"…","tab_id":"…","tab_label":"…","focused_pane_id":"…","focused_pane_cwd":"…","focused_pane_agent":"…","terminal_id":"t7"},"id":"uuid","comment":"…","createdAt":"ISO","kind":"ok"}
{"version":1,"id":"uuid","archivedAt":"ISO","annotations":[ … ]}
```

`terminal_id` and `kind` (`ok` | `delete`, absent for a comment) are extra; the TUI ignores them.
v1 files are read as-is.

## Notes

- There is no selection API. The panel polls the Wayland PRIMARY selection (`wl-paste
  --primary`, every 250 ms) while the Herdr window is active and a terminal has focus, and opens
  the popup once the text holds still for one poll (so 250–500 ms after the mouse is released).
  The popup opens at the pointer then, which is where the drag ended unless the mouse moved.
- Selections made while the window was inactive, and one just dismissed, don't pop.
- The popup works only while a layout with the panel shows.
- Send refuses a pane that isn't an agent: `hc send` presses Enter, and a shell would run it.

## Test

`node test/lib.test.js` checks the formatter and JSONL logic (and parses the TUI's archive file
if there is one, read-only). `herdr-app check mods/term-annotate` checks the mod.
