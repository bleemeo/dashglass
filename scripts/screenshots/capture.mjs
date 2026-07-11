// Headless-Chrome screenshotter for demo/doc images. Drives Chrome over
// CDP (there is no CLI flag for light vs dark, so we emulate
// prefers-color-scheme), captures each target full-page in both schemes,
// and writes PNGs to ./out/.
//
//   node capture.mjs                 # all targets, light + dark
//
// Env overrides: BASE (default http://localhost:3000),
// CHROME (default the macOS Google Chrome path), SCHEMES (e.g. "light").
//
// Assumes the SPA is served on BASE (the Vite dev server or the built
// binary) with the API reachable behind it. The SSE stream keeps the page
// "loading" forever, so we wait a fixed budget rather than for network idle.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const CHROME =
  process.env.CHROME ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SCHEMES = (process.env.SCHEMES ?? "light,dark").split(",");
const OUT = new URL("./out/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

// Each target: a route, a viewport, and how long to let it render.
const TARGETS = [
  { name: "demo-overview", route: "/d/demo", width: 1280, settle: 4500 },
];

const PORT = 9333;
const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    "--no-first-run",
    "--no-default-browser-check",
    `--user-data-dir=/tmp/dg-shot-${PORT}`,
    "--force-device-scale-factor=2",
    "--hide-scrollbars",
    "about:blank",
  ],
  { stdio: "ignore" },
);
process.on("exit", () => {
  try {
    chrome.kill();
  } catch {
    /* already gone */
  }
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const targets = await (
        await fetch(`http://127.0.0.1:${PORT}/json/list`)
      ).json();
      const page = targets.find((t) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error("Chrome DevTools endpoint never came up");
}

const wsUrl = await connect();
const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => {
  ws.addEventListener("open", res);
  ws.addEventListener("error", rej);
});

let nextId = 0;
const pending = new Map();
ws.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`timeout: ${method}`));
    }, 30000);
    pending.set(id, (m) => {
      clearTimeout(timeout);
      resolve(m);
    });
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  return r.result?.result?.value;
};

await send("Page.enable");

// Pre-dismiss the "authentication is disabled" banner (dev-only) so the
// doc images are clean. The app persists the dismissal in localStorage.
await send("Page.navigate", { url: BASE + "/" });
await sleep(1200);
await evaluate(
  "try{localStorage.setItem('dashglass-auth-banner-dismissed','true')}catch{}",
);

for (const target of TARGETS) {
  for (const scheme of SCHEMES) {
    await send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-color-scheme", value: scheme }],
    });
    await send("Emulation.setDeviceMetricsOverride", {
      width: target.width,
      height: 900,
      deviceScaleFactor: 2,
      mobile: false,
    });
    await send("Page.navigate", { url: BASE + target.route });
    await sleep(target.settle);
    // Grow the viewport to the full content height so the capture is not
    // clipped, then let layout settle.
    const height = await evaluate(
      "Math.min(4000, Math.ceil(document.documentElement.scrollHeight))",
    );
    await send("Emulation.setDeviceMetricsOverride", {
      width: target.width,
      height: height || 900,
      deviceScaleFactor: 2,
      mobile: false,
    });
    await sleep(700);
    const shot = await send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
    });
    const file = `${OUT}${target.name}-${scheme}.png`;
    writeFileSync(file, Buffer.from(shot.result.data, "base64"));
    console.log("wrote", file);
  }
}

ws.close();
chrome.kill();
process.exit(0);
