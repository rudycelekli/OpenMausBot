import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findCliCandidates } from "./env-path.ts";
import { isAppStandaloneCopy, standaloneEngineDir, standaloneRunEnv } from "./engine-standalone.ts";
import { OPENCODE_STANDALONE } from "./drivers/acp/opencode-release.ts";

let base: string;
beforeEach(() => { base = mkdtempSync(join(tmpdir(), "omb-cli-candidates-")); });
afterEach(() => rmSync(base, { recursive: true, force: true }));

function executable(folder: string, name: string) {
  mkdirSync(folder, { recursive: true });
  const path = join(folder, name);
  writeFileSync(path, "#!/bin/sh\nprintf actual-executable", { mode: 0o755 });
  return path;
}

describe("CLI candidates follow executable PATH lookup", () => {
  it("never advertises a directory as an installed CLI", () => {
    const name = process.platform === "win32" ? "probe.exe" : "probe";
    const shadow = join(base, "shadow");
    const runnable = join(base, "runnable");
    mkdirSync(join(shadow, name), { recursive: true });
    const real = executable(runnable, name);
    expect(findCliCandidates("probe", [shadow, runnable].join(delimiter))).toEqual([real]);
  });

  it.skipIf(process.platform === "win32")("skips non-executable files just as a native spawn does", () => {
    const shadow = join(base, "shadow");
    mkdirSync(shadow);
    const placeholder = join(shadow, "probe");
    writeFileSync(placeholder, "not an executable");
    chmodSync(placeholder, 0o644);
    const real = executable(join(base, "runnable"), "probe");
    const path = [shadow, join(base, "runnable")].join(delimiter);
    expect(execFileSync("probe", [], { env: { PATH: path }, encoding: "utf8" })).toBe("actual-executable");
    expect(findCliCandidates("probe", path)).toEqual([real]);
  });

  it.skipIf(process.platform === "win32")("keeps the app-owned OpenCode runtime settings when an earlier PATH file cannot run", () => {
    const shadow = join(base, "shadow");
    mkdirSync(shadow);
    writeFileSync(join(shadow, "opencode"), "placeholder", { mode: 0o644 });
    const appBin = join(standaloneEngineDir("opencode", base), "bin");
    executable(appBin, "opencode");
    const path = [shadow, appBin].join(delimiter);
    expect(execFileSync("opencode", [], { env: { PATH: path }, encoding: "utf8" })).toBe("actual-executable");
    expect(isAppStandaloneCopy("opencode", base, path)).toBe(true);
    expect(standaloneRunEnv(OPENCODE_STANDALONE, "opencode", base, path)).toEqual({ OPENCODE_DISABLE_AUTOUPDATE: "1" });
  });

  it.skipIf(process.platform === "win32")("retains executable symlinks and skips broken symlinks", () => {
    const folder = join(base, "bin");
    mkdirSync(folder);
    const real = executable(join(base, "real"), "probe");
    symlinkSync(real, join(folder, "probe"));
    expect(findCliCandidates("probe", folder)).toEqual([join(folder, "probe")]);
    rmSync(real);
    expect(findCliCandidates("probe", folder)).toEqual([]);
  });
});
