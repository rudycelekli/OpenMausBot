import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { searchMessagesInDatabase } from "./message-search-query.ts";

let database: DatabaseSync;
beforeEach(() => {
  database = new DatabaseSync(":memory:");
  database.exec("CREATE TABLE messages(thread_id TEXT,id TEXT,at REAL,role TEXT,kind TEXT,text TEXT,json TEXT)");
});
afterEach(() => database.close());

function message(id: string, text: string, kind = "text") {
  const json = kind === "activity" ? { tool: { name: text } } : {};
  database.prepare("INSERT INTO messages VALUES(?,?,?,?,?,?,?)").run("thread", id, 1, "user", kind, text, JSON.stringify(json));
}

describe("literal message search across writing systems", () => {
  it.each([
    ["ÉCOLE : réunion demain", "école"],
    ["ÜBER die Planung", "über"],
    ["ПРИВЕТ участникам", "привет"],
    ["ΑΘΉΝΑ meeting", "αθήνα"],
  ])("finds %s regardless of letter case", (text, query) => {
    message("m", text);
    expect(text.toLowerCase().includes(query.toLowerCase())).toBe(true);
    expect(searchMessagesInDatabase(database, query)).toMatchObject([{ messageId: "m" }]);
  });

  it("searches Unicode tool names with the same literal rules", () => {
    message("tool", "ÉCRIRE 10%_\\ rapport", "activity");
    expect(searchMessagesInDatabase(database, "écrire 10%_\\")).toMatchObject([{ messageId: "tool", kind: "activity" }]);
    expect(searchMessagesInDatabase(database, "écrire 11%_\\")).toEqual([]);
  });

  it.each([
    ["İstanbul planning", "planning", "planning"],
    ["İ".repeat(70) + " planning", "planning", "planning"],
    ["İstanbul meeting", "i\u0307stanbul", "İstanbul"],
  ])("keeps the highlight in original text coordinates for %s", (text, query, highlighted) => {
    message("m", text);
    const [hit] = searchMessagesInDatabase(database, query);
    expect(hit).toBeDefined();
    expect(hit.snippet.slice(hit.matchStart, hit.matchStart + hit.matchLength)).toBe(highlighted);
  });
});
