#!/usr/bin/env python3
"""Install, update or remove Herdr Easy Annotate for the Herdr desktop app.

    python3 install.py               install, or update (run it again)
    python3 install.py --uninstall   remove it; saved annotations stay

Works on Linux, macOS and Windows (`py install.py`). Python standard library only.
Run from a clone, or piped from GitHub, in which case it downloads the repository.
"""
import io, json, os, shutil, subprocess, sys, tarfile, urllib.request
from pathlib import Path

REPO = "chandrasekharan98/herdr-ez-annotate"
MOD, TABS, LAYOUT = "ez-annotate", "tabs-annotate", "annotate"
HOME = Path(os.environ.get("EZ_ANNOTATE_HERDR_HOME") or Path.home() / ".config" / "herdr-app")
KEYS = {"ctrl-shift-a": f"{MOD}.selection", "cmd-shift-a": f"{MOD}.selection"}
BLOCK = {"id": "annotate", "type": "block", "content": {"mod": MOD}}


def fail(msg):
    sys.exit(f"ez-annotate: {msg}")


def herdr(*args):
    """Runs herdr-app if it is on PATH; returns False when it isn't."""
    try:
        return subprocess.run(["herdr-app", *args], check=False).returncode == 0
    except FileNotFoundError:
        return False


def source():
    here = Path(__file__).resolve().parent if "__file__" in globals() else None
    if here and (here / "mods" / MOD / "main.js").exists():
        return here / "mods" / MOD
    url = f"https://codeload.github.com/{REPO}/tar.gz/main"
    print(f"Downloading {url}")
    data = urllib.request.urlopen(url, timeout=60).read()
    out = HOME / "state" / MOD / "download"
    shutil.rmtree(out, ignore_errors=True)
    with tarfile.open(fileobj=io.BytesIO(data)) as tar:
        tar.extractall(out, filter="data") if hasattr(tarfile, "data_filter") else tar.extractall(out)
    return next(out.glob(f"*/mods/{MOD}"))


def find(node, id):
    if node.get("id") == id:
        return node
    for child in node.get("children", []):
        hit = find(child, id)
        if hit:
            return hit
    return None


def patch_tabs():
    """Re-forks Herdr's current `tabs` mod with an Annotate button, so updates to tabs are picked up."""
    src = HOME / "mods" / "tabs" / "main.js"
    if not src.exists():
        fail(f"{src} not found: is the Herdr app installed and started once?")
    s = src.read_text(encoding="utf-8")

    def sub(a, b):
        nonlocal s
        if a not in s:
            fail("Herdr's tabs mod has changed and can't be patched. Ask your Herdr agent to "
                 "follow RECIPE.md, or open an issue.")
        s = s.replace(a, b, 1)

    sub(' } from "herdr";', ', nextCommand } from "herdr";')
    sub("export default class", """// fork: shows or hides a side-panel section, as its top-bar button does.
function togglePanel(id) {
  const root = layout(), panel = find(root, "panel"), body = find(root, "panel-body");
  if (panel && !panel.hidden && body?.active === id) run("layout.hide", { id: "panel" });
  else { run("layout.select", { stack: "panel-body", child: id }); run("layout.show", { id: "panel" }); }
}

export default class""")
    sub("  init() {", """  init(_props, cx) {
    // fork: keys.json "tabs-annotate.files" / ".changes" / ".annotate" toggle that section.
    cx.spawn(async (cx) => { for (;;) { const c = await nextCommand(); if (["files", "changes", "annotate"].includes(c)) togglePanel(c); cx.notify(); } });""")
    sub('const enabled = shared("workspace.panels") ?? ["files", "changes"];',
        'const enabled = [...(shared("workspace.panels") ?? ["files", "changes"]), "annotate"]; // fork: ez-annotate')
    changes = '      .when(enabled.includes("changes"), el => el.child(panelButton("changes", "Changes", "mods/changes/changes.svg")))\n'
    sub(changes, changes + f'      .child(panelButton("annotate", "Annotate", "mods/{MOD}/annotate.svg"))\n')

    dst = HOME / "mods" / TABS
    shutil.rmtree(dst, ignore_errors=True)
    shutil.copytree(src.parent, dst)
    (dst / "main.js").write_text(s, encoding="utf-8")
    (dst / "mod.json").write_text('{ "place": "none", "title": "Tabs (with Annotate)" }\n', encoding="utf-8")


def read_json(path, default):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def install():
    mod = HOME / "mods" / MOD
    new = source()
    if mod.exists():
        shutil.rmtree(mod)
    shutil.copytree(new, mod)
    shutil.rmtree(HOME / "state" / MOD / "download", ignore_errors=True)
    patch_tabs()

    # The `annotate` layout: a clone of `main` (kept if it exists, so your edits stay).
    path = HOME / "layouts" / f"{LAYOUT}.json"
    lay = read_json(path, None) or read_json(HOME / "layouts" / "main.json", None)
    if not lay or not find(lay, "panel-body") or not find(lay, "tabs"):
        fail("layouts/main.json has no panel-body or tabs block; ask your Herdr agent to follow RECIPE.md.")
    body = find(lay, "panel-body")
    body["children"] = [c for c in body.get("children", []) if c.get("id") != "annotate"] + [BLOCK]
    find(lay, "tabs")["content"]["mod"] = TABS
    write_json(path, lay)

    keys_path = HOME / "keys.json"
    keys = read_json(keys_path, {})
    glob = keys.setdefault("global", {})
    taken = [k for k in KEYS if k in glob and glob[k] != KEYS[k]]
    glob.update({k: v for k, v in KEYS.items() if k not in glob})
    write_json(keys_path, keys)

    herdr("check", str(mod))
    herdr("check", str(HOME / "mods" / TABS))
    switched = herdr("do", "layout.switch", "--name", LAYOUT)
    print(f"\nHerdr Easy Annotate installed in {mod}")
    if not switched:
        print(f"Switch to the '{LAYOUT}' layout in Herdr (ctrl-shift-l).")
    if taken:
        print(f"Already bound, left alone: {', '.join(taken)}. Bind '{MOD}.selection' yourself in keys.json.")
    print("Open the Annotate section in the top bar, then select text in a terminal.")


def uninstall():
    shutil.rmtree(HOME / "mods" / MOD, ignore_errors=True)
    shutil.rmtree(HOME / "mods" / TABS, ignore_errors=True)
    path = HOME / "layouts" / f"{LAYOUT}.json"
    lay = read_json(path, None)
    if lay:
        body = find(lay, "panel-body")
        if body:
            body["children"] = [c for c in body.get("children", []) if c.get("id") != "annotate"]
        if find(lay, "tabs"):
            find(lay, "tabs")["content"]["mod"] = "tabs"
        herdr("do", "layout.switch", "--name", "main")
        if lay == read_json(HOME / "layouts" / "main.json", None):
            path.unlink()
        else:
            write_json(path, lay)  # it has other changes of yours: keep it, minus Annotate
    keys_path = HOME / "keys.json"
    keys = read_json(keys_path, None)
    if keys and "global" in keys:
        keys["global"] = {k: v for k, v in keys["global"].items() if v != f"{MOD}.selection"}
        write_json(keys_path, keys)
    print(f"Herdr Easy Annotate removed. Your annotations are still in {HOME / 'state' / MOD}.")


if __name__ == "__main__":
    if not HOME.exists():
        fail(f"{HOME} not found: install and start the Herdr app first (https://herdr.dev).")
    uninstall() if "--uninstall" in sys.argv else install()
