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

2. Add an "Annotate" section beside Files and Changes. The built-in `tabs` mod draws those two
   buttons and has no way to add more, so this makes a copy, `tabs-annotate`, with a third button,
   and clones the main layout as `annotate` using it. `main.json` and `tabs` are not touched
   (the copy won't get app updates to `tabs`).

   ```sh
   cd ~/.config/herdr-app
   cp -r mods/tabs mods/tabs-annotate
   python3 - <<'EOF'
   import json, os
   p = "mods/tabs-annotate/main.js"; s = open(p).read()
   a = 'const enabled = shared("workspace.panels") ?? ["files", "changes"];'
   b = '      .when(enabled.includes("changes"), el => el.child(panelButton("changes", "Changes", "mods/changes/changes.svg")))\n'
   assert a in s and b in s, "tabs mod changed: add the button by hand"
   s = s.replace(a, a[:-1].replace("= shared", "= [...(shared") + ', "annotate"];').replace('["files", "changes"],', '["files", "changes"]),')
   s = s.replace(b, b + '      .child(panelButton("annotate", "Annotate", "mods/term-annotate/annotate.svg"))\n')
   open(p, "w").write(s)
   out = "layouts/annotate.json"
   assert not os.path.exists(out), "layouts/annotate.json exists: pick another name"
   lay = json.load(open("layouts/main.json"))
   def find(n, i):
       if n.get("id") == i: return n
       for c in n.get("children", []):
           r = find(c, i)
           if r: return r
   find(lay, "panel-body")["children"].append({"id": "annotate", "type": "block", "content": {"mod": "term-annotate"}})
   find(lay, "tabs")["content"]["mod"] = "tabs-annotate"
   json.dump(lay, open(out, "w"), indent=2)
   EOF
   herdr-app check mods/tabs-annotate
   herdr-app do layout.switch --name annotate
   herdr-app status   # no layout.error, no mod error
   ```

   Optional keys (`~/.config/herdr-app/keys.json`, global section): `"ctrl-b a": "tabs-annotate.annotate"`,
   `"ctrl-b f": "tabs-annotate.files"`, `"ctrl-b g": "tabs-annotate.changes"`. To make them work, the copy
   also needs a `nextCommand()` loop in `init` calling the same show/hide as its buttons.

   `ctrl-shift-l` (or `layout.switch --name main`) goes back; delete `layouts/annotate.json` and
   `mods/tabs-annotate` to remove it.

No keys needed. The popup is on exactly while the Annotate section is open, since the panel is
what watches the selection.

## Optional: workspace-save drawer and space menu

If you also use [herdr-workspace-save](https://github.com/chandrasekharan98/herdr-workspace-save),
its drawer and space right-click items can live in this same `annotate` layout. Follow
"Optional: drawer and space menu" in that repo's `app/RECIPE.md`, applying it to
`layouts/annotate.json` after step 2 above. It clones `spaces` and `menu` (as `spaces-annotate`
and `menu-annotate`) and adds a floating drawer on the `main` node; it binds no keys and leaves
the Annotate section and `tabs-annotate` alone.
