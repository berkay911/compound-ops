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
  const phaseDone = (id) => ev(`__ops.store.get("${id}").props.status === "Complete"`);
  const engagement = (label) => ev(`(__ops.store.list("Engagement").find((e) => e.props.label === "${label}") || { id: null }).id`);

  for (let i = 0; i < 8; i++) await shot();
  await ev(`__ops.act("startPhase", "phase-1")`);
  let picked = null;
  for (let f = 0; f < 170; f++) {
    await step(180);
    if (!picked) {
      const tech = await ev(
        `(__ops.store.list("Engagement").find((e) => e.props.rationale.includes("closing on")) || { id: null }).id`,
      );
      const first = tech ?? (await engagement("ENG-01"));
      if (first && first !== picked) {
        await ev(`__ops.select(${JSON.stringify(first)})`);
        if (tech) picked = tech;
      }
    }
    await shot();
    const hits = await ev(`__ops.store.list("Engagement").filter((e) => e.props.status === "Hit").length`);
    if (hits >= 5 && f > 130) break;
  }
  for (let i = 0; i < 12; i++) await shot();
  console.log("scene 1 frames", n);

  await ev(`__ops.select((__ops.store.list("Track").find((t) => t.props.affiliation === "Neutral") || { id: null }).id)`);
  for (let i = 0; i < 18; i++) {
    await step(180);
    await shot();
  }

  await ev(`__ops.select(null)`);
  for (let i = 0; i < 2000 && !(await phaseDone("phase-1")); i++) await step(200);
  await ev(`__ops.act("startPhase", "phase-2")`);
  for (let i = 0; i < 2000 && !(await phaseDone("phase-2")); i++) await step(200);
  await ev(`__ops.view(640, 345, 2.5)`);
  await ev(`__ops.select("bravo")`);
  for (let i = 0; i < 6; i++) await shot();
  await ev(`__ops.act("startPhase", "phase-3")`);
  for (let f = 0; f < 220; f++) {
    await step(300);
    await shot();
    if (await phaseDone("phase-3")) break;
  }
  for (let i = 0; i < 16; i++) await shot();
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
