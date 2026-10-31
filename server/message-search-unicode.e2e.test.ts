import { writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";

it("finds multilingual messages through the isolated server's read-only search worker", async () => {
  const fixture = await launchVerificationServer();
  const evidence: unknown[] = [{ fixture: fixture.info }];
  const control = async (args: string[]) => {
    const result = await runControlOmb([...args, "--url", fixture.info.url]);
    evidence.push({ command: args, result });
    return result;
  };
  try {
    const result = await control(["new-bot", "--name", "Unicode search probe"]) as { bot: { id: string; activeTaskId: string } };
    const text = "ÉCOLE : réunion demain. ÜBER die Planung. ПРИВЕТ участникам. İstanbul planning.";
    await control(["send", "--bot", result.bot.id, "--text", text]);
    await control(["wait", "--bot", result.bot.id, "--timeout", "30"]);
    for (const [query, highlight] of [["école", "ÉCOLE"], ["über", "ÜBER"], ["привет", "ПРИВЕТ"], ["planning", "planning"]]) {
      const url = new URL("/api/search", fixture.info.url);
      url.searchParams.set("q", query);
      url.searchParams.set("threadId", result.bot.activeTaskId);
      const response = await fetch(url);
      expect(response.status).toBe(200);
      const body = await response.json() as { hits: { threadId: string; snippet: string; matchStart: number; matchLength: number }[] };
      expect(body.hits).toHaveLength(1);
      const [hit] = body.hits;
      expect(hit.threadId).toBe(result.bot.activeTaskId);
      expect(hit.snippet.slice(hit.matchStart, hit.matchStart + hit.matchLength)).toBe(highlight);
      evidence.push({ query, result: body });
    }
  } finally {
    const evidencePath = `${fixture.info.logPath}.unicode-search.json`;
    writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
    console.info(JSON.stringify({ evidencePath }));
    await fixture.close();
  }
}, 60_000);
