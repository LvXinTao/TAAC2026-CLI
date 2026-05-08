import { Command } from "commander";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { parseCookieEntries, extractCookieHeader } from "../../auth/token.js";

const TAIJI_ORIGIN = "https://taiji.algo.qq.com";
const SECRET_DIR = ".taac2026/secrets";
const SECRET_FILE = "taiji-cookie.txt";

async function saveCookie(cookieHeader: string): Promise<string> {
  const secretDir = path.resolve(process.cwd(), SECRET_DIR);
  await mkdir(secretDir, { recursive: true });
  const cookiePath = path.join(secretDir, SECRET_FILE);
  await writeFile(cookiePath, cookieHeader, "utf8");
  return cookiePath;
}

async function loginWithCookieString(raw: string) {
  const cookieHeader = extractCookieHeader(raw);
  const cookiePath = await saveCookie(cookieHeader);
  console.log(`Cookie saved to ${cookiePath}`);
}

async function loginWithBrowser(timeout: number) {
  const userDataDir = path.join(tmpdir(), `taac2026-login-${Date.now()}`);
  const launchChrome = async (channel?: string) =>
    chromium.launchPersistentContext(userDataDir, {
      channel,
      headless: false,
      args: ["--disable-features=CookieDeprecationMessages"],
    });

  let browser: Awaited<ReturnType<typeof chromium.launchPersistentContext>>;
  try {
    browser = await launchChrome("chrome");
    console.log("Using installed Chrome for login…");
  } catch {
    browser = await launchChrome();
    console.log("Chrome not found, using bundled Chromium…");
  }

  try {
    const loginUrl = `${TAIJI_ORIGIN}/training/create`;
    console.log(`Navigating to ${loginUrl} — please log in...`);
    await browser.pages()[0].goto(loginUrl, { timeout });

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

    const cookiePath = await saveCookie(cookieHeader);
    console.log(`Login successful. Cookie saved to ${cookiePath}`);

    await browser.close();
  } finally {
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  }
}

export function registerLoginCommand(program: Command) {
  program
    .command("login")
    .description("Login and save cookie to .taac2026/secrets/")
    .option("--timeout <ms>", "Browser login timeout in ms", (v) => parseInt(v, 10), 120000)
    .option("--cookie-string <string>", "Paste cookie string directly")
    .option("--stdin", "Read cookie string from stdin")
    .action(async (opts) => {
      if (opts.cookieString) {
        await loginWithCookieString(opts.cookieString);
        return;
      }
      if (opts.stdin) {
        const chunks: string[] = [];
        for await (const chunk of process.stdin) chunks.push(chunk);
        await loginWithCookieString(chunks.join(""));
        return;
      }
      await loginWithBrowser(opts.timeout);
    });
}
