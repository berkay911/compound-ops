import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const OUT = process.argv[2] ?? "frames";
const PORT = 9333;
const APP = process.env.APP_URL ?? "http://localhost:5317/?capture";
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PROFILE = path.join(os.tmpdir(), "compound-ops-capture-profile");
fs.mkdirSync(OUT, { recursive: true });

async function launch() {
  const proc = spawn(
    CHROME,
    [
      "--headless=new",
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${PROFILE}`,
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-component-update",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  for (let i = 0; i < 50; i++) {
    try {
      return { proc, version: await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json() };
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error("chrome did not start");
}

async function run(version) {
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  let nextId = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  };
  ws.onclose = () => {
    for (const { reject } of pending.values()) reject(new Error("chrome connection closed"));
    pending.clear();
  };
  await new Promise((r) => (ws.onopen = r));
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      if (ws.readyState !== 1) return reject(new Error("chrome connection closed"));
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, sessionId }));
    });

  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const s = (m, p) => send(m, p, sessionId);
  await s("Page.enable");
  await s("Runtime.enable");
  await s("Emulation.setDeviceMetricsOverride", { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  await s("Page.navigate", { url: APP });

  const ev = async (expression) => {
    const r = await s("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  for (let i = 0; i < 100 && !(await ev("!!window.__ops").catch(() => false)); i++) await new Promise((r) => setTimeout(r, 100));
  await new Promise((r) => setTimeout(r, 800));

  let n = 0;
  const settle = () => ev("new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(1))))");
  const shot = async () => {
    const file = `${OUT}/f${String(n++).padStart(4, "0")}.png`;
    if (fs.existsSync(file)) return;
    await settle();
    const { data } = await s("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(file, Buffer.from(data, "base64"));
  };
  const step = (ms) => ev(`__ops.step(${ms})`);

  await ev(`window.__auto = (confirmDelayMs) => {
    const o = __ops, st = o.store;
    for (const p of st.list("Phase").sort((a, b) => a.props.order - b.props.order)) {
      if (p.props.status === "Pending" && o.act("startPhase", p.id) === null) break;
    }
    for (const x of st.list("Structure")) {
      if (x.props.status !== "Clear reported") continue;
      x.__reportedAt ??= st.clockMs;
      if (st.clockMs - x.__reportedAt >= confirmDelayMs) o.act("markCleared", x.id);
    }
    for (const u of st.list("Unit")) {
      if (u.props.role !== "Assault" || st.linkedOne(u.id, "unitObjective")) continue;
      const next = st.list("Structure").find((x) => x.props.status === "Uncleared" && st.linked(x.id, "unitObjective", "reverse").length === 0);
      if (next) o.act("assignObjective", u.id, { structure: next.id });
    }
  }`);

  for (let i = 0; i < 6; i++) await shot();
  await ev(`__ops.act("startPhase", "phase-1")`);
  let alertFrame = -1;
  let trackId = null;
  for (let f = 0; f < 500; f++) {
    await step(150);
    await shot();
    if (alertFrame < 0) {
      trackId = await ev(`(__ops.store.events.find((e) => e.kind === "warning" && e.text.includes("from HLZ RAVEN")) || { refs: [null] }).refs[0]`);
      if (trackId) alertFrame = f;
      continue;
    }
    const k = f - alertFrame;
    if (k === 5) await ev(`__ops.select(${JSON.stringify(trackId)})`);
    if (k === 15) await ev(`__ops.act("classifyHostile", ${JSON.stringify(trackId)})`);
    if (k === 24) await ev(`__ops.select("hlz-raven")`);
    if (k === 32) await ev(`__ops.act("markLzRisky", "hlz-raven")`);
    if (k === 95) break;
  }
  console.log("scene 1 frames", n, "alert at frame", alertFrame);

  await ev(`__ops.select(null)`);
  for (let i = 0; i < 2000; i++) {
    await step(200);
    await ev("__auto(1500)");
    if (await ev(`__ops.store.get("phase-3").props.status === "Active"`)) break;
  }
  await ev(`__ops.view(640, 330, 2.3)`);
  await ev(`__ops.select("alpha")`);
  for (let f = 0; f < 120; f++) {
    await step(200);
    await ev("__auto(1500)");
    if (f === 60) {
      await ev(`__ops.select((__ops.store.list("Track").find((t) => t.props.status === "Confirmed" && __ops.store.linkedOne(t.id, "trackStructure")) || { id: null }).id)`);
    }
    await shot();
  }
  console.log("total frames", n, "sim clock", await ev("__ops.store.clockMs"));

  ws.close();
  return n;
}

for (let attempt = 1; attempt <= 15; attempt++) {
  const { proc, version } = await launch();
  try {
    const total = await run(version);
    console.log("done, frames:", total);
    proc.kill();
    process.exit(0);
  } catch (e) {
    console.log(`attempt ${attempt} stopped: ${e.message}; frames on disk: ${fs.readdirSync(OUT).length}`);
    proc.kill();
    await new Promise((r) => setTimeout(r, 1000));
  }
}
process.exit(1);
