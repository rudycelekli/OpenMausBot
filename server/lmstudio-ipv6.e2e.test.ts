import { writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, it } from "vitest";
import { launchVerificationServer } from "../scripts/control-omb.ts";

it("loads an explicitly added IPv6 LM Studio server's native chat catalog", async () => {
  const requests: string[] = [];
  const provider = createServer((req, res) => {
    requests.push(req.url ?? "");
    res.setHeader("content-type", "application/json");
    if (req.url === "/api/v1/models") {
      res.end(JSON.stringify({ models: [
        { type: "llm", key: "fixture/chat-model" },
        { type: "embedding", key: "fixture/embedding-model" },
      ] }));
    } else if (req.url === "/v1/models") {
      res.end(JSON.stringify({ data: [{ id: "fixture/chat-model@q4_k_m" }] }));
    } else {
      res.statusCode = 404;
      res.end("{}");
    }
  });
  await new Promise<void>((resolve, reject) => {
    provider.once("error", reject);
    provider.listen(0, "::1", resolve);
  });
  let fixture: Awaited<ReturnType<typeof launchVerificationServer>> | undefined;
  const evidence: unknown[] = [];
  try {
    fixture = await launchVerificationServer();
    evidence.push({ fixture: fixture.info });
    const url = `http://[::1]:${(provider.address() as AddressInfo).port}/v1`;
    const response = await fetch(`${fixture.info.url}/api/instances/openai-compat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "IPv6 LM Studio fixture", url, key: "fixture-local-key", catalog: "lmstudio" }),
    });
    expect(response.status).toBe(201);
    const created = await response.json() as { instanceId: string };
    const refresh = await fetch(`${fixture.info.url}/api/instances/${created.instanceId}/refresh-models`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(refresh.status).toBe(200);
    const body = await refresh.json() as { instances: { instanceId: string; models: { options: { id: string }[] } }[] };
    const instance = body.instances.find(row => row.instanceId === created.instanceId);
    evidence.push({ action: "add-and-refresh-lmstudio", url, result: body, requests });
    expect(instance?.models.options.map(row => row.id)).toEqual(["fixture/chat-model"]);
    expect(requests).toContain("/api/v1/models");
    expect(requests).not.toContain("/v1/models");
  } finally {
    if (fixture) {
      const evidencePath = `${fixture.info.logPath}.lmstudio-ipv6.json`;
      writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
      console.info(JSON.stringify({ evidencePath }));
      await fixture.close();
    }
    provider.closeAllConnections();
    await new Promise<void>((resolve, reject) => provider.close(error => error ? reject(error) : resolve()));
  }
}, 60_000);
