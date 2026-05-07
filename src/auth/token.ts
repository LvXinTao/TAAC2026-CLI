import { readFile } from "node:fs/promises";
import path from "node:path";
import type { CookieEntry, DirectClient } from "../types.js";

export function extractCookieHeader(fileContent: string): string {
  const text = fileContent.trim();
  const headerLine = text.match(/^cookie:\s*(.+)$/im);
  if (headerLine) return headerLine[1].trim();

  const curlHeader = text.match(/(?:-H|--header)\s+(['"])cookie:\s*([\s\S]*?)\1/i);
  if (curlHeader) return curlHeader[2].trim();

  return text.replace(/^cookie:\s*/i, "").trim();
}

export function parseCookieEntries(fileContent: string): CookieEntry[] {
  const cookieHeader = extractCookieHeader(fileContent);
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const separatorIndex = part.indexOf("=");
      if (separatorIndex === -1) return null;
      const name = part.slice(0, separatorIndex).trim();
      const value = part.slice(separatorIndex + 1).trim();
      if (!name) return null;
      return {
        name,
        value,
        domain: ".taiji.algo.qq.com",
        path: "/",
        secure: true,
        httpOnly: false,
        sameSite: "Lax",
      };
    })
    .filter((entry): entry is CookieEntry => entry !== null);
}

export async function readCookieFile(cookieFile: string): Promise<string> {
  const cookiePath = path.resolve(cookieFile);
  return (await readFile(cookiePath, "utf8")).trim();
}

export async function createDirectClient(cookieFile: string): Promise<DirectClient> {
  const cookieHeader = extractCookieHeader(await readCookieFile(cookieFile));
  if (!cookieHeader) throw new Error(`No cookie header parsed from ${cookieFile}`);
  console.log(`Loaded cookie header from ${cookieFile}`);
  return { directCookieHeader: cookieHeader };
}

export function isDirectClient(client: unknown): client is DirectClient {
  return Boolean((client as DirectClient)?.directCookieHeader);
}

export async function ensureAuthenticated(cookieFile?: string): Promise<DirectClient> {
  if (!cookieFile) throw new Error("--cookie-file is required for this command");
  return createDirectClient(cookieFile);
}
