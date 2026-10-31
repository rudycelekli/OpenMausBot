import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("..", import.meta.url));
const flag = "--omb-remote-settings-fixture";
const option = name => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined;

if (process.versions.electron && process.argv.includes(flag)) {
  const { app, BrowserWindow, ipcMain, session } = await import("electron");
  const { buildApplicationMenu } = await import("../electron/menu.mjs");
  const [url, localOrigin, profile, output, preload] = process.argv.slice(process.argv.indexOf(flag) + 1);
  app.setPath("userData", profile);
  app.setPath("sessionData", profile);
  app.commandLine.appendSwitch("disable-background-networking");
  for (const [channel, value] of [["home:page", false], ["update:offered", false], ["desktop-analytics:read", false], ["desktop-language:read", "en"]]) {
    ipcMain.on(channel, event => { event.returnValue = value; });
  }
  const summaries = require("../electron/environments.cjs");
  const handlers = {
    "desktop:capabilities": () => require("../electron/capabilities.cjs").desktopCapabilities({ platform: process.platform, remote: true }),
    "perm:status": () => ({}),
    "window:state": () => ({ maximized: false, fullscreen: false }),
    "workspaces:state": () => summaries.workspaceSummary({ activeId: "fixture", environments: [{ id: "fixture", name: "Fixture server", origin: new URL(url).origin }] }),
    "workspaces:line": () => null,
    "workspaces:places": () => [],
    "workspaces:look": () => ({ name: "Fixture server", color: null, swatch: null, change: "local" }),
    "rail:state": () => ({ available: false, hidden: true }),
    "cloud-plan:state": () => ({ status: "signed-out" }),
    "cloud-add:state": () => ({ status: "idle" }),
    "desktop-notices:state": () => [],
    "desktop:skin": () => undefined,
    "rail:offer": () => undefined,
  };
  for (const [channel, handler] of Object.entries(handlers)) ipcMain.handle(channel, handler);
  let win;
  const deadline = setTimeout(() => { console.error("remote Settings fixture timed out"); app.exit(1); }, 60_000);
  app.whenReady().then(async () => {
    const allowed = new Set([new URL(url).origin, localOrigin]);
    session.defaultSession.webRequest.onBeforeRequest((request, callback) => {
      const target = new URL(request.url);
      callback({ cancel: !["devtools:", "data:", "blob:"].includes(target.protocol) && !allowed.has(target.origin) });
    });
    win = new BrowserWindow({ show: false, width: 1180, height: 850, webPreferences: {
      preload, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
      additionalArguments: [`--omb-local-origin=${localOrigin}`, "--omb-app-version=fixture"],
    } });
    win.webContents.on("console-message", event => console.log(event.message));
    const evaluate = code => win.webContents.executeJavaScript(code);
    const until = async (check, label) => {
      const untilAt = Date.now() + 15_000;
      do {
        if (await check()) return;
        await evaluate("new Promise(done => requestAnimationFrame(() => done()))");
      } while (Date.now() < untilAt);
      throw new Error(`Timed out: ${label}`);
    };
    await win.loadURL(url);
    await until(() => evaluate("Boolean(document.querySelector('textarea')) && !document.querySelector('[data-welcome], [data-tour-card]')"), "actual App mounted");
    await evaluate("new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))");
    const before = await evaluate("({ settings: Boolean(document.getElementById('app-settings-title')), bridge: typeof window.ogb.onOpenAppSettings, ownPage: window.ogb.app.ownPage })");
    assert.equal(before.settings, false);
    assert.equal(before.ownPage, false);
    writeFileSync(join(output, "before.png"), (await win.webContents.capturePage()).toPNG());
    for (const key of ["organization", "cloudAccount", "credential", "setCredential", "saveFile", "pickFolder", "exportDiagnostics", "openLogsFolder"]) {
      assert.equal(await evaluate(`typeof window.ogb[${JSON.stringify(key)}]`), "undefined", key);
    }
    const menu = buildApplicationMenu({ environments: [], activeId: "local", onSwitch() {}, onAddFromClipboard() {}, onConnect() {}, onForget() {},
      onOpenSettings: () => { if (win && !win.isDestroyed()) win.webContents.send("app:open-settings"); },
    });
    const preferences = menu.items.flatMap(item => item.submenu?.items ?? []).find(item => item.label === "Preferences…");
    assert.ok(preferences, "run this macOS menu regression on macOS");
    for (const action of ["organization", "cloud", "cloud-settings", "cloud-add", "cloud-add-howto"]) win.webContents.send("app:open-settings", action);
    await evaluate("new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))");
    assert.equal(await evaluate("Boolean(document.getElementById('app-settings-title'))"), false, "fixed home and organization actions stay out of the remote page");
    preferences.click();
    try {
      await until(() => evaluate("(() => { const title = document.getElementById('app-settings-title'); const dialog = title?.closest('[role=dialog]'); if (!dialog) return false; const close = dialog.querySelector('[aria-label=\"Close settings\"]'); if (!close || Number(getComputedStyle(dialog).opacity) < 0.99) return false; const box = close.getBoundingClientRect(); return box.width > 0 && box.height > 0 && close.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)); })()"), "native menu opens visible actual Settings");
    } catch (error) {
      writeFileSync(join(output, "failure.png"), (await win.webContents.capturePage()).toPNG());
      throw error;
    }
    await evaluate("new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))");
    writeFileSync(join(output, "after.png"), (await win.webContents.capturePage()).toPNG());
    const receipt = { passed: true, renderer: "actual src/main.tsx, App and SettingsModal", preload, before,
      action: "production buildApplicationMenu Preferences callback sends app:open-settings", result: "Settings dialog visible, opaque and hittable; fixed organization and Cloud actions refused",
      isolation: "two different loopback origins, disposable fake-engine API and Electron profile, sandbox/contextIsolation on, external network blocked",
      limitation: "No real Cloudflare, public TLS, logged-in account or installed app navigation; remote origin distinction reproduced on loopback." };
    writeFileSync(join(output, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
    console.log(JSON.stringify(receipt));
    clearTimeout(deadline); win.destroy(); app.exit(0);
  }).catch(async error => {
    console.error(error);
    writeFileSync(join(output, "failed.json"), JSON.stringify({ passed: false, error: error.message }, null, 2) + "\n");
    clearTimeout(deadline); win?.destroy(); app.exit(1);
  });
} else {
  assert.equal(process.platform, "darwin", "this fixture exercises the macOS Preferences menu");
  const { launchVerificationServer } = await import("./control-omb.ts");
  const { mountPreview } = await import("./testing/preview-fixture.ts");
  const output = resolve(option("--evidence") ?? mkdtempSync(join(tmpdir(), "omb-remote-settings-evidence-")));
  mkdirSync(output, { recursive: true });
  const owned = mkdtempSync(join(tmpdir(), "omb-remote-settings-profile-"));
  const profile = join(owned, "user-data");
  const home = join(owned, "home");
  mkdirSync(profile); mkdirSync(home);
  const preload = resolve(option("--preload") ?? join(root, "electron/preload.cjs"));
  let fixture, preview;
  try {
    fixture = await launchVerificationServer();
    const { WELCOME_VERSION } = await import("../electron/onboarding-record.mjs");
    const { TOUR_STEPS } = await import("../src/lib/guided-tour.ts");
    const { SPOTLIGHTS } = await import("../src/lib/first-conversation.ts");
    const setup = await fetch(`${fixture.info.url}/api/config`, {
      method: "PATCH", headers: { "content-type": "application/json", origin: fixture.info.url },
      body: JSON.stringify({ language: "en", onboarding: { completedAt: new Date().toISOString(), version: WELCOME_VERSION, hintsSeen: [...TOUR_STEPS.map(step => step.id), ...SPOTLIGHTS] } }),
    });
    assert.equal(setup.ok, true, "mark only this disposable workspace as onboarded");
    preview = await mountPreview(fixture, { entry: "/src/main.tsx", route: "/__remote_settings.html", title: "Isolated remote Settings", logLevel: "error" });
    const child = spawn(require("electron"), [fileURLToPath(import.meta.url), flag, preview.previewUrl, fixture.info.url, profile, output, preload], {
      env: { PATH: process.env.PATH, HOME: home, XDG_CONFIG_HOME: home, TMPDIR: owned, TEMP: owned, TMP: owned },
      stdio: ["ignore", "pipe", "pipe"],
    });
    for (const stream of [child.stdout, child.stderr]) stream.on("data", data => { appendFileSync(join(output, "electron.log"), data); process.stdout.write(data); });
    const stop = () => child.kill("SIGTERM");
    const timer = setTimeout(stop, 90_000);
    process.once("SIGINT", stop); process.once("SIGTERM", stop);
    const code = await new Promise((done, fail) => { child.once("error", fail); child.once("close", done); })
      .finally(() => { clearTimeout(timer); process.off("SIGINT", stop); process.off("SIGTERM", stop); });
    assert.equal(code, 0, `Remote Settings UI failed; inspect ${output}`);
    assert.equal(JSON.parse(readFileSync(join(output, "receipt.json"), "utf8")).passed, true);
  } finally {
    await preview?.close(); await fixture?.close();
    rmSync(owned, { recursive: true, force: true });
  }
}
