import path from "node:path";
export function csvEscape(value: unknown): string {
  if (value == null) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const columns = Object.keys(rows[0]);
  const lines = [columns.map(csvEscape).join(",")];
  for (const row of rows) lines.push(columns.map((column) => csvEscape(row[column])).join(","));
  return `${lines.join("\n")}\n`;
}

export function normalizeLogLines(logResponse: unknown): string[] {
  const data = (logResponse as any)?.data ?? logResponse;
  if (Array.isArray(data)) return data.map((item) => (typeof item === "string" ? item : JSON.stringify(item)));
  if (typeof data === "string") return data.split(/\r?\n/);
  if (Array.isArray(data?.list)) return data.list.map((item: unknown) => (typeof item === "string" ? item : JSON.stringify(item)));
  if (Array.isArray(data?.logs)) return data.logs.map((item: unknown) => (typeof item === "string" ? item : JSON.stringify(item)));
  return [];
}

export function safePathPart(value: unknown): string {
  return String(value ?? "unknown").replace(/[<>:"/\\|?*\x00-\x1F]+/g, "_").slice(0, 180);
}

export function safeRelativeFilePath(file: Record<string, unknown>): string {
  const raw = String(file?.name ?? file?.path ?? file?.url ?? "file");
  const withoutProtocol = raw.replace(/^https?:\/\//i, "").replace(/^\/+/, "");
  const parts = withoutProtocol.split(/[\\/]+/).filter(Boolean).map(safePathPart);
  return parts.length ? path.join(...parts) : "file";
}
