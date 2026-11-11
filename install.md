# Install term-annotate v2

Linux/Wayland only: needs `wl-paste` and `wl-copy` (package `wl-clipboard`).

1. Copy the mod (never over an existing folder of that name):

   ```sh
   cp -r mods/term-annotate ~/.config/herdr-app/mods/term-annotate
   herdr-app check ~/.config/herdr-app/mods/term-annotate
   ```

   If an older `term-annotate` folder is there, move it aside first
   (`mv ~/.config/herdr-app/mods/term-annotate ~/term-annotate.bak`). The store
   (`state/term-annotate/`) is kept and read as-is. v2 binds no keys and opens no kept window.

2. Clone the main layout as `annotate` with the panel on the right. `main.json` is not
   touched. This writes a new file, then switches to it:

   ```sh
   python3 - <<'PY'
   import json, os
   home = os.path.expanduser("~/.config/herdr-app/layouts")
   out = f"{home}/annotate.json"
   assert not os.path.exists(out), "layouts/annotate.json exists: pick another name"
   lay = json.load(open(f"{home}/main.json"))
   def find(n, i):
       if n.get("id") == i: return n
       for c in n.get("children", []):
           r = find(c, i)
           if r: return r
   find(lay, "work-body")["children"].append({
       "id": "annotate", "type": "block", "size": {"px": 320}, "min": 240, "max": 640,
       "radius": 10, "border": {"width": 1, "color": "border"}, "background": "chrome",
       "content": {"mod": "term-annotate"}})
   json.dump(lay, open(out, "w"), indent=2)
   PY
   herdr-app do layout.switch --name annotate
   herdr-app status   # no layout.error, no mod error
   ```

   `ctrl-shift-l` (or `layout.switch --name main`) goes back; deleting `layouts/annotate.json`
   removes it. Hide the panel with `herdr-app do layout.toggle --id annotate`.

No keys to bind. The popup works only while the `annotate` layout shows, since the panel is
what watches the selection.
