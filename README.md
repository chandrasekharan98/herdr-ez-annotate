# term-annotate

A Herdr desktop-app mod: comment on terminal text and hand the comments to a coding
agent. It replaces the herdr TUI `annotate` plugin's terminal-annotation actions with
native dialogs.

## Install

1. Copy `mods/term-annotate/` to `~/.config/herdr-app/mods/term-annotate/`.
2. Merge `keys.json` into `~/.config/herdr-app/keys.json` (`global` section). Don't
   replace keys you already use.
3. Start it once: `herdr-app do mod.open --name term-annotate`. That opens an invisible,
   kept 1x1 window, which comes back on every start. Keys reach a mod only while a copy of
   it is loaded, and this window is that copy. If the keys stop working (after a layout
   switch, say), run the command again.

Linux/Wayland only for now: it uses `wl-copy` and `wl-paste` (package `wl-clipboard`).

## Keys

| Key | Command | What it does |
|---|---|---|
| `ctrl-b a` | `capture` | Annotate the focused terminal's selection |
| `ctrl-b t` | `terminal` | Annotate the last 200 lines of the focused terminal (click / shift-click picks lines) |
| `ctrl-b m` | `manage` | List annotations: edit, archive, delete, restore archives, copy, import from the TUI |
| `ctrl-b ctrl-s` | `send-archive` | Send all annotations to the focused agent (`hc send`, presses Enter), then archive |
| `ctrl-b ctrl-v` | `paste-archive` | Paste them into the focused agent's prompt without Enter, then archive |

`copy-context` and `copy-archive` exist as commands (`term-annotate.copy-context`) and as
buttons in the manager, with no default key.

In the dialogs: Ctrl+Enter saves, Esc cancels.

## Storage

`~/.config/herdr-app/state/term-annotate/annotations.jsonl` (one annotation per line) and
`archives.jsonl` (one archived set per line). The records use the TUI plugin's schema, so
either side can read the other's:

```json
{"selectedText":"…","capturedAt":"ISO","context":{"workspace_id":"…","workspace_label":"…","tab_id":"…","tab_label":"…","focused_pane_id":"…","focused_pane_cwd":"…","focused_pane_agent":"…","terminal_id":"t7"},"id":"uuid","comment":"…","createdAt":"ISO"}
{"version":1,"id":"uuid","archivedAt":"ISO","annotations":[ … ]}
```

`terminal_id` is extra; the TUI ignores it. "Import from TUI" in the manager copies
`~/.local/state/herdr/plugins/annotate/*.jsonl` in, skipping ids already present. It never
changes the TUI's files.

## Notes

- There is no selection API. `capture` clears the clipboard, runs `terminal.copy` while the
  terminal still has focus, and reads the clipboard. If nothing was selected it puts the old
  text back. If the clipboard held an image, that image is lost.
- `paste-archive` copies the Markdown to the clipboard and runs the app's `terminal.paste`.
  `hc send` always presses Enter, and `hc keys` only presses named keys. The Markdown stays
  on the clipboard afterwards.

## TODO

- Review the agent's last or newest reply (the TUI's `prefix+ctrl+o`, `prefix+shift+o`).
  This needs a map from terminal to Claude session to find the transcript. `ctrl-b ctrl-o`
  and `ctrl-b alt-o` are left free for it.
- X11 and macOS clipboard support.

## Test

`node test/lib.test.js` checks the Markdown and JSONL logic. It also parses the TUI's
archive file if there is one, read-only.
`herdr-app check ~/.config/herdr-app/mods/term-annotate` checks the mod.
