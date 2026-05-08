import { readFile } from "node:fs/promises";
import path from "node:path";

const SECRET_DIR = ".taac2026/secrets";
const SECRET_FILE = "taiji-cookie.txt";

export function resolveSecretPath(): string {
  return path.resolve(process.cwd(), SECRET_DIR, SECRET_FILE);
}

export async function ensureCliAuth(): Promise<string> {
  const secretPath = resolveSecretPath();
  try {
    const content = (await readFile(secretPath, "utf8")).trim();
    if (!content) throw new Error(`Cookie file is empty: ${secretPath}`);
    return content;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `No authentication cookie found at ${secretPath}.\n` +
        `Run "taac2026 login" first to authenticate.`
      );
    }
    throw err;
  }
}
