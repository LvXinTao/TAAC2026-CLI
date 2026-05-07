import { Command } from "commander";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { extractCookieHeader } from "../../auth/token.js";
import { resolveTaijiOutputDir } from "../../utils/output.js";
import { parseCookieEntries } from "../../auth/token.js";

const TAIJI_ORIGIN = "https://taiji.algo.qq.com";
const SECRET_DIR = "secrets";
const SECRET_FILE = "taiji-cookie.txt";

async function saveCookie(cookieHeader: string, outDir: string): Promise<string> {
  const secretDir = path.resolve(outDir, SECRET_DIR);
  await mkdir(secretDir, { recursive: true });
  const cookiePath = path.join(secretDir, SECRET_FILE);
  await writeFile(cookiePath, cookieHeader, "utf8");
  return cookiePath;
}

async function loginWithCookieFile(cookieFile: string, outDir: string) {
  const content = await import("node:fs/promises").then((fs) => fs.readFile(cookieFile, "utf8"));
  const cookieHeader = extractCookieHeader(content);
  const cookiePath = await saveCookie(cookieHeader, outDir);
  console.log(`Cookie saved to ${cookiePath}`);
}

async function loginWithBrowser(headless: boolean, timeout: number, outDir: string) {
  const userDataDir = path.join(tmpdir(), `taac2026-login-${Date.now()}`);
  try {
    const browser = await chromium.launchPersistentContext(userDataDir, {
      headless,
      args: ["--disable-features=CookieDeprecationMessages"],
    });

    const loginUrl = `${TAIJI_ORIGIN}/training/create`;
    console.log(`Navigating to ${loginUrl} — please log in...`);
    await browser.pages()[0].goto(loginUrl, { timeout });

    // Poll for login cookies
    const deadline = Date.now() + timeout;
    let loggedIn = false;
    while (Date.now() < deadline) {
      const cookies = await browser.cookies();
      const authCookies = cookies.filter(
        (c) =>
          c.domain.includes("taiji") ||
          c.domain.includes("qq.com") ||
          ["skey", "lskey", "p_skey", "p_lg_uin"].some((name) => c.name.includes(name)),
      );
      if (authCookies.length > 0) {
        loggedIn = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }

    if (!loggedIn) {
      throw new Error("Login timed out. Try increasing --timeout.");
    }

    const cookies = await browser.cookies();
    const cookieEntries = parseCookieEntries(
      cookies.map((c) => `${c.name}=${c.value}`).join("; "),
    );
    const cookieHeader = cookieEntries.map((e) => `${e.name}=${e.value}`).join("; ");

    const cookiePath = await saveCookie(cookieHeader, outDir);
    console.log(`Login successful. Cookie saved to ${cookiePath}`);

    await browser.close();
  } finally {
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  }
}

export function registerLoginCommand(program: Command) {
  program
    .command("login")
    .description("Browser SSO login, save cookie")
    .option("--cookie-file <file>", "Read cookie from file and save")
    .option("--headless", "Launch Chromium in headless mode")
    .option("--timeout <ms>", "Login timeout in ms", (v) => parseInt(v, 10), 120000)
    .option("--out <dir>", "Output directory")
    .action(async (opts) => {
      const outDir = resolveTaijiOutputDir(opts.out ?? "taiji-output");

      if (opts.cookieFile) {
        await loginWithCookieFile(opts.cookieFile, outDir);
        return;
      }

      await loginWithBrowser(opts.headless ?? false, opts.timeout, outDir);
    });
}
