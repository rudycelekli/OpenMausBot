import { writeFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { parseVoiceList, synthesizeSystem, type Runner } from "./system-voices.ts";

describe("synthesizeSystem", () => {
  it("passes the text after `--`, so text that looks like an option is spoken, never parsed", async () => {
    for (const text of ["--input-file=/etc/hosts", "--output-file=/tmp/victim", "- item", "-v Alex", "hello"]) {
      const calls: string[][] = [];
      const run: Runner = async (_file, args) => {
        calls.push(args);
        await writeFile(args[args.indexOf("-o") + 1], "RIFF");
        return { stdout: "" };
      };
      await synthesizeSystem(`  ${text}  `, "Samantha", run);
      expect(calls).toHaveLength(1);
      expect(calls[0].slice(-2), text).toEqual(["--", text]);
      expect(calls[0].filter((arg) => arg.startsWith("--input-file") || arg.startsWith("--output-file")).length, text)
        .toBe(text.startsWith("--") ? 1 : 0);
    }
  });
});

describe("parseVoiceList", () => {
  it("reads names longer than say's 20-column field, and lists a repeated voice once", () => {
    const stdout = [
      "Albert              en_US    # Hello! My name is Albert.",
      "Bad News            en_US    # Hello! My name is Bad News.",
      "Eddy (German (Germany)) de_DE    # Hallo! Ich heiße Eddy.",
      "Eddy (English (UK)) en_GB    # Hello! My name is Eddy.",
      "Alice (Italian (Italy)) it_IT    # Ciao! Mi chiamo Alice.",
      "Alice (Italian (Italy)) it_IT    # Ciao! Mi chiamo Alice.",
      "",
    ].join("\n");
    expect(parseVoiceList(stdout)).toEqual([
      { id: "Albert", label: "Albert", description: "en_US — Hello! My name is Albert." },
      { id: "Bad News", label: "Bad News", description: "en_US — Hello! My name is Bad News." },
      { id: "Eddy (German (Germany))", label: "Eddy (German (Germany))", description: "de_DE — Hallo! Ich heiße Eddy." },
      { id: "Eddy (English (UK))", label: "Eddy (English (UK))", description: "en_GB — Hello! My name is Eddy." },
      { id: "Alice (Italian (Italy))", label: "Alice (Italian (Italy))", description: "it_IT — Ciao! Mi chiamo Alice." },
    ]);
  });
});
