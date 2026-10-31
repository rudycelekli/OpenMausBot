import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("./preload.cjs", import.meta.url), "utf8");
const LOCAL = "http://127.0.0.1:48993";
const REMOTE = "https://bots.example.test";

function fixture({ origin = REMOTE, home = false } = {}) {
  let bridge;
  const channels = new Map();
  const invoked = [];
  vm.runInNewContext(source, {
    process: { platform: "darwin", argv: [`--omb-local-origin=${LOCAL}`] },
    location: { origin }, navigator: {}, TextEncoder, queueMicrotask,
    localStorage: { getItem: () => null },
    require: () => ({
      webUtils: {},
      contextBridge: { exposeInMainWorld: (_name, value) => { bridge = value; } },
      ipcRenderer: {
        on(channel, callback) { channels.set(channel, [...(channels.get(channel) ?? []), callback]); },
        removeListener() {}, send() {},
        sendSync: channel => channel === "home:page" && home,
        invoke: (...args) => { invoked.push(args); return Promise.resolve(); },
      },
    }),
  });
  return { bridge, invoked, emit(section) { for (const callback of channels.get("app:open-settings") ?? []) callback({}, section); } };
}

test("a remote server receives generic menu Preferences without any privileged desktop bridge", () => {
  const remote = fixture();
  assert.equal(typeof remote.bridge.onOpenAppSettings, "function");
  const calls = [];
  const unsubscribe = remote.bridge.onOpenAppSettings((...args) => calls.push(args));
  remote.emit(); remote.emit();
  assert.deepEqual(calls, [[], []]);
  unsubscribe(); remote.emit();
  assert.equal(calls.length, 2);
  assert.deepEqual(remote.invoked, []);
  for (const key of ["organization", "cloudAccount", "credential", "setCredential", "saveFile", "pickFolder", "copyText", "exportDiagnostics", "openLogsFolder", "home", "onChatLink", "onPackageInstall"]) {
    assert.equal(remote.bridge[key], undefined, key);
  }
});

test("ordinary remote Preferences never forwards fixed organization or Cloud actions, including a queued action", async () => {
  const remote = fixture();
  remote.emit("organization");
  assert.equal(typeof remote.bridge.onOpenAppSettings, "function");
  const calls = [];
  const unsubscribe = remote.bridge.onOpenAppSettings(section => calls.push(section));
  await Promise.resolve();
  for (const action of ["organization", "cloud", "cloud-settings", "cloud-add", "cloud-add-howto"]) remote.emit(action);
  assert.deepEqual(calls, []);
  remote.emit();
  assert.deepEqual(calls, [undefined]);
  unsubscribe();
});

test("local and verified home pages retain their fixed settings actions", async () => {
  for (const options of [{ origin: LOCAL }, { home: true }]) {
    const page = fixture(options);
    page.emit("organization");
    const calls = [];
    const unsubscribe = page.bridge.onOpenAppSettings(section => calls.push(section));
    await Promise.resolve();
    page.emit("cloud-settings");
    assert.deepEqual(calls, ["organization", "cloud-settings"]);
    unsubscribe();
  }
});
