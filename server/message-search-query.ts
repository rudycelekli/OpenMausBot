import type { DatabaseSync } from "node:sqlite";

export interface SearchHit {
  threadId: string;
  messageId: string;
  at: number;
  role: string;
  kind: string;
  snippet: string;
  matchStart: number;
  matchLength: number;
  from?: string;
}

function caseInsensitiveMatch(text: string, needle: string): { start: number; length: number } | null {
  const folded = text.toLowerCase();
  const at = folded.indexOf(needle);
  if (at < 0) return null;
  if (folded.length === text.length) return { start: at, length: needle.length };
  const end = at + needle.length;
  let sourceAt = 0;
  let foldedAt = 0;
  let start = 0;
  for (const character of text) {
    const foldedEnd = foldedAt + character.toLowerCase().length;
    const sourceEnd = sourceAt + character.length;
    if (foldedAt <= at && at < foldedEnd) start = sourceAt;
    if (foldedAt < end && end <= foldedEnd) return { start, length: sourceEnd - start };
    sourceAt = sourceEnd;
    foldedAt = foldedEnd;
  }
  return null;
}

export function searchMessagesInDatabase(database: DatabaseSync, query: string, limit = 40, threadId?: string): SearchHit[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  database.function("omb_search_lower", { deterministic: true }, (value) => typeof value === "string" ? value.toLowerCase() : null);
  const pattern = `%${needle.replace(/([\\%_])/g, "\\$1")}%`;
  const scope = threadId ? "thread_id = ? AND " : "";
  const statement = database.prepare(
    "SELECT thread_id, id, at, role, kind, text, json_extract(json, '$.tool.name') AS tool_name, json_extract(json, '$.from.name') AS from_name FROM messages " +
      `WHERE ${scope}((kind = 'text' AND text IS NOT NULL AND omb_search_lower(text) LIKE ? ESCAPE '\\') ` +
      "   OR (kind = 'activity' AND tool_name IS NOT NULL AND omb_search_lower(tool_name) LIKE ? ESCAPE '\\')) " +
      "ORDER BY at DESC LIMIT ?",
  );
  const rows = (threadId
    ? statement.all(threadId, pattern, pattern, limit)
    : statement.all(pattern, pattern, limit)) as Array<{
    thread_id: string;
    id: string;
    at: number;
    role: string;
    kind: string;
    text: string | null;
    tool_name: string | null;
    from_name: string | null;
  }>;
  return rows.map((row) => {
    const haystack = row.kind === "activity" ? (row.tool_name ?? "") : (row.text ?? "");
    const match = caseInsensitiveMatch(haystack, needle);
    const hitAt = match?.start ?? 0;
    const start = Math.max(0, hitAt - 60);
    const end = Math.min(haystack.length, hitAt + (match?.length ?? needle.length) + 90);
    const head = start > 0 ? "…" : "";
    const body = haystack.slice(start, end).replace(/\s+/g, " ").trim();
    const snippet = head + body + (end < haystack.length ? "…" : "");
    const folded = needle.replace(/\s+/g, " ");
    const highlight = caseInsensitiveMatch(snippet, folded);
    return {
      threadId: row.thread_id,
      messageId: row.id,
      at: row.at,
      role: row.role,
      kind: row.kind,
      snippet,
      matchStart: highlight?.start ?? head.length,
      matchLength: highlight?.length ?? 0,
      ...(row.from_name ? { from: row.from_name } : {}),
    };
  });
}
