// Renders demo.html to docs/demo.gif and preview.png with headless Chromium (CDP, no npm deps).
// Run from the repo root: node docs/demo/render.mjs   (needs chromium and ffmpeg on PATH)
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const FPS = 15, W = 1000, H = 560, SCALE = 1.2; // GIF is 1200x672
const html = "file://" + resolve("docs/demo/demo.html");
const work = mkdtempSync(join(tmpdir(), "annotate-demo-"));

const chrome = spawn(process.env.CHROMIUM ?? "chromium", ["--headless=new", "--remote-debugging-port=0", "--hide-scrollbars",
  "--force-color-profile=srgb", `--user-data-dir=${work}/profile`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
const wsUrl = await new Promise((ok, fail) => {
  let buf = "";
  chrome.stderr.on("data", (d) => { buf += d; const m = buf.match(/ws:\/\/\S+/); if (m) ok(m[0]); });
  chrome.on("exit", () => fail(new Error("chromium exited:\n" + buf)));
});

const ws = new WebSocket(wsUrl);
await new Promise((ok) => ws.addEventListener("open", ok, { once: true }));
let seq = 0; const waiting = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (waiting.has(m.id)) { const [ok, fail] = waiting.get(m.id); waiting.delete(m.id); m.error ? fail(new Error(m.error.message)) : ok(m.result); }
});
const send = (method, params = {}, sessionId) => new Promise((ok, fail) => {
  const id = ++seq; waiting.set(id, [ok, fail]); ws.send(JSON.stringify({ id, method, params, sessionId }));
});

const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
const page = (m, p) => send(m, p, sessionId);
await page("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: SCALE, mobile: false });
await page("Page.navigate", { url: html + "#t=0" });
await new Promise((r) => setTimeout(r, 1500));
const evalJs = (expression) => page("Runtime.evaluate", { expression, awaitPromise: true });
await evalJs("document.fonts.ready");
const shot = async (file) => {
  await evalJs("new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))");
  const { data } = await page("Page.captureScreenshot", { format: "png" });
  writeFileSync(file, Buffer.from(data, "base64"));
};

const loop = (await evalJs("LOOP")).result.value;
const n = Math.round(loop * FPS);
for (let i = 0; i < n; i++) {
  await evalJs(`render(${i / FPS})`);
  await shot(join(work, `f${String(i).padStart(4, "0")}.png`));
}
await evalJs("preview()");
await shot("preview.png");
ws.close(); chrome.kill();

execFileSync("ffmpeg", ["-v", "error", "-y", "-framerate", String(FPS), "-i", join(work, "f%04d.png"), "-vf",
  "split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle",
  "-loop", "0", "docs/demo.gif"], { stdio: "inherit" });
rmSync(work, { recursive: true, force: true });
console.log(`docs/demo.gif: ${n} frames, ${(n / FPS).toFixed(1)} s; preview.png`);
