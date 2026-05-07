import { readFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import { parseCookieEntries } from "./token.js";

const TRAINING_URL = "https://taiji.algo.qq.com/training";

export async function addCookiesToBrowser(context: BrowserContext, cookieFile: string): Promise<void> {
  if (!cookieFile) return;
  const cookieHeader = (await readFile(cookieFile, "utf8")).trim();
  const cookies = parseCookieEntries(cookieHeader);
  if (!cookies.length) throw new Error(`No cookies parsed from ${cookieFile}`);
  await context.addCookies(cookies);
  console.log(`Loaded ${cookies.length} cookies from ${cookieFile}`);
}

export async function waitForLogin(
  page: Page,
  url: string,
  timeoutMs: number,
  expectedTexts: string[]
): Promise<void> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pages = page.context().pages();
    const activePage =
      pages.find((c) => c.url().includes("taiji.algo.qq.com")) ?? page;
    if (activePage !== page) (page as any) = activePage;

    const location = page.url();
    const bodyText = await page
      .locator("body")
      .textContent({ timeout: 1_000 })
      .catch(() => "");
    const hasAppContent = expectedTexts.some((text) => bodyText?.includes(text));
    if (location.includes("taiji.algo.qq.com") && hasAppContent) return;

    console.log("Waiting for TAAC page/login to finish...");
    await page.waitForTimeout(3_000);
  }

  throw new Error(
    "Timed out waiting for TAAC page. If login is required, finish login in the opened browser window."
  );
}

export async function createBrowserContext(
  userDataDir: string,
  headless: boolean
): Promise<BrowserContext> {
  return chromium.launchPersistentContext(userDataDir, {
    headless,
    viewport: { width: 1600, height: 1000 },
  });
}

export const DEFAULTS = {
  TRAINING_URL,
  AUTH_WAIT_MS: 180_000,
  TIMEOUT_MS: 120_000,
} as const;
