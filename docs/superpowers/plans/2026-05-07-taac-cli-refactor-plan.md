# TAAC2026 CLI 重构 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将扁平脚本集合式的 CLI 重构为 TypeScript + Commander 子命令架构，命令按 train/eval 生命周期分组。

**Architecture:** 新建 `src/` 目录，使用 Commander 构建嵌套子命令树。现有 `.mjs` 脚本中的逻辑逐步迁移到 TypeScript 模块。旧脚本保留到全部迁移完成后再删除。

**Tech Stack:** TypeScript, Commander, Node.js fetch, js-yaml, Playwright, cos-nodejs-sdk-v5

---

## Chunk 1: 项目骨架搭建

### Task 1: 初始化 TypeScript 配置和 package.json

**Files:**
- Create: `tsconfig.json`
- Modify: `package.json`

- [ ] **Step 1: 创建 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "taiji-output"]
}
```

- [ ] **Step 2: 更新 package.json**

在现有 package.json 中新增以下字段（保留所有已有内容）：

```json
{
  "type": "module",
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/cli/index.ts"
  },
  "devDependencies": {
    "@types/js-yaml": "^4.0.9",
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0"
  },
  "dependencies": {
    "commander": "^12.1.0"
  }
}
```

保留已有的 `bin`, `dependencies.js-yaml`, `dependencies.playwright`, `dependencies.cos-nodejs-sdk-v5`。

- [ ] **Step 3: 安装依赖**

```bash
npm install
```

- [ ] **Step 4: 验证 TypeScript 编译**

```bash
npx tsc --noEmit
```

此时应该没有源文件但编译配置正确，不应报错。

- [ ] **Step 5: Commit**

```bash
git add tsconfig.json package.json package-lock.json
git commit -m "build: add TypeScript config and Commander dependency"
```

---

### Task 2: 共享类型定义 (`src/types.ts`)

**Files:**
- Create: `src/types.ts`

- [ ] **Step 1: 创建类型文件**

```typescript
// Cookie & Auth
export interface CookieEntry {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: "Lax" | "Strict" | "None";
}

export interface DirectClient {
  directCookieHeader: string;
}

// Training Jobs
export interface TrainingJob {
  taskID: string;
  id: string;
  name: string;
  description: string;
  status: string;
  jzStatus: string;
  updateTime: string;
}

export interface JobInstance {
  id: string;
  name?: string;
  status?: string;
}

export interface TrainFile {
  name: string;
  path: string;
  url?: string;
  size?: number;
  mtime?: number;
}

export interface JobDetail {
  data?: {
    trainFiles?: TrainFile[];
    train_files?: TrainFile[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface JobRecord {
  jobId: string;
  jobInternalId: string;
  name: string;
  description: string;
  status: string;
  jzStatus: string;
  updateTime: string;
  rawJob: unknown;
  rawJobDetail?: unknown;
  trainFiles?: TrainFile[];
  code?: {
    path: string;
    files: number;
    saved: number;
    downloadVersion?: number;
    error?: string;
  };
  instancesById: Record<string, InstanceRecord>;
  sync?: {
    skippedDeepSync: boolean;
    skipReason?: string;
    lastSeenAt: string;
    lastDeepFetchedAt?: string;
  };
}

export interface InstanceRecord {
  instanceId: string;
  rawInstance?: unknown;
  metrics?: Record<string, unknown>;
  checkpoints?: unknown[];
  metricSummary?: Record<string, unknown>;
  log?: { path: string; lines: number };
  error?: string | null;
}

// Metric rows
export interface MetricRow {
  metric: string;
  chart: string;
  chartIndex: number;
  series: string;
  step: string | number;
  value: unknown;
}

export interface CheckpointRow {
  jobId: string;
  jobInternalId: string;
  jobName: string;
  instanceId: string;
  ckpt: string;
  ckptFileSize?: number;
  createTime?: string;
  deleteTime?: string;
  status?: string;
}

// Evaluation
export interface EvaluationTask {
  id: string;
  name: string;
  mould_id: string;
  status: string;
  modifier: string;
  create_time: string;
  update_time: string;
  score?: number;
  results?: { auc?: number };
  infer_time?: number;
  error_msg?: string;
  files?: unknown[];
}

// Submit bundle
export interface SubmitManifest {
  name: string;
  description: string;
  templateJobInternalId?: string;
  templateJobUrl?: string;
  gitHead?: string;
  gitDirty?: boolean;
  files: {
    codeZip?: string;
    config?: string;
    runSh?: string;
    generic?: Array<{ localPath: string; remoteName: string }>;
  };
  run?: boolean;
  message?: string;
}

// COS
export interface CosToken {
  id: string;
  key: string;
  Token: string;
}

// Download validation
export interface DownloadValidation {
  bytes: number;
  contentType: string;
}

// Config diff
export interface ConfigChange {
  type: "added" | "removed" | "changed";
  path: string;
  before: unknown;
  after: unknown;
}

export interface ConfigDiffResult {
  oldFile: string;
  newFile: string;
  summary: { total: number; added: number; removed: number; changed: number };
  changes: ConfigChange[];
}

// Shared CLI options
export interface SharedCliOptions {
  cookieFile?: string;
  direct?: boolean;
  headless?: boolean;
  outDir?: string;
  json?: boolean;
}
```

- [ ] **Step 2: 编译验证**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add shared TypeScript type definitions"
```

---

### Task 3: CLI 入口骨架 (`src/cli/index.ts`)

**Files:**
- Create: `src/cli/index.ts`
- Create: `src/cli/commands/login.ts` (空壳)
- Create: `src/cli/commands/train/index.ts` (空壳)
- Create: `src/cli/commands/eval/index.ts` (空壳)

- [ ] **Step 1: 创建 CLI 入口**

```typescript
#!/usr/bin/env node

import { Command } from "commander";
import { version } from "../../package.json";
import { registerLoginCommand } from "./commands/login";
import { registerTrainCommand } from "./commands/train";
import { registerEvalCommand } from "./commands/eval";

const program = new Command();

program
  .name("taac2026")
  .description("Agent-friendly TAAC2026 / Taiji experiment CLI")
  .version(version);

registerLoginCommand(program);
registerTrainCommand(program);
registerEvalCommand(program);

program.parse();
```

- [ ] **Step 2: 创建 train/index.ts 空壳**

```typescript
import { Command } from "commander";

export function registerTrainCommand(program: Command) {
  const trainCmd = program.command("train").description("Manage training任务");
  // 子命令将在后续任务中添加
}
```

- [ ] **Step 3: 创建 eval/index.ts 空壳**

```typescript
import { Command } from "commander";

export function registerEvalCommand(program: Command) {
  const evalCmd = program.command("eval").description("Manage 评测任务");
  // 子命令将在后续任务中添加
}
```

- [ ] **Step 4: 创建 login.ts 空壳**

```typescript
import { Command } from "commander";

export function registerLoginCommand(program: Command) {
  program
    .command("login")
    .description("Browser SSO login, save cookie")
    .option("--cookie-file <file>", "Output cookie file path")
    .option("--headless", "Launch Chromium in headless mode")
    .option("--timeout <ms>", "Login timeout in ms", (v) => parseInt(v, 10))
    .action(async (_opts) => {
      console.log("login command — to be implemented");
    });
}
```

- [ ] **Step 5: 编译并测试**

```bash
npx tsc --noEmit
node dist/cli/index.js --help
node dist/cli/index.js train --help
node dist/cli/index.js eval --help
```

- [ ] **Step 6: Commit**

```bash
git add src/cli/index.ts src/cli/commands/
git commit -m "feat: add CLI entry point with empty train/eval/login commands"
```

---

## Chunk 2: 认证、配置与工具模块

### Task 4: 输出路径管理 (`src/utils/output.ts`)

**Files:**
- Create: `src/utils/output.ts`

- [ ] **Step 1: 创建 output.ts**

从 `scrape-taiji.mjs` 的 `resolveTaijiOutputDir` 和 `assertSafeRelativeOutputPath` 迁移逻辑，加上 `compare-config-yaml.mjs` 的 `resolveTaijiOutputFile`：

```typescript
import path from "node:path";

const DEFAULT_OUT_ROOT = "taiji-output";
const DEFAULT_OUT_DIR = "taiji-output/config-diffs";

export function assertSafeRelativeOutputPath(outPath: string): void {
  if (!path.isAbsolute(outPath) && outPath.split(/[\\/]+/).includes("..")) {
    throw new Error(
      `Relative output paths must not contain '..'. Use an absolute path for custom locations outside ${DEFAULT_OUT_ROOT}.`
    );
  }
}

export function resolveTaijiOutputDir(outDir: string): string {
  assertSafeRelativeOutputPath(outDir);
  if (path.isAbsolute(outDir)) return outDir;
  if (outDir.split(/[\\/]/)[0] === DEFAULT_OUT_ROOT) return path.resolve(outDir);
  return path.resolve(DEFAULT_OUT_ROOT, outDir);
}

export function resolveTaijiOutputFile(outPath: string): string {
  assertSafeRelativeOutputPath(outPath);
  if (path.isAbsolute(outPath)) return outPath;
  if (outPath.split(/[\\/]/)[0] === "taiji-output") return path.resolve(outPath);
  if (path.dirname(outPath) === ".") return path.resolve(DEFAULT_OUT_DIR, outPath);
  return path.resolve("taiji-output", outPath);
}

export const DEFAULTS = {
  OUT_ROOT: DEFAULT_OUT_ROOT,
  OUT_DIR: DEFAULT_OUT_DIR,
} as const;
```

- [ ] **Step 2: 创建测试 `tests/output.test.mjs`**

```javascript
import { strict as assert } from "node:assert";
import { test } from "node:test";
import path from "node:path";
import { resolveTaijiOutputDir, resolveTaijiOutputFile, assertSafeRelativeOutputPath } from "../dist/utils/output.js";

test("resolveTaijiOutputDir resolves relative under taiji-output", () => {
  const result = resolveTaijiOutputDir("submit-bundle");
  assert.ok(result.endsWith("taiji-output/submit-bundle"));
});

test("resolveTaijiOutputDir passes through absolute", () => {
  const result = resolveTaijiOutputDir("/abs/path");
  assert.strictEqual(result, "/abs/path");
});

test("assertSafeRelativeOutputPath rejects ..", () => {
  assert.throws(() => assertSafeRelativeOutputPath("../escape"), /must not contain '\.\.'/);
});

test("resolveTaijiOutputFile resolves relative under config-diffs", () => {
  const result = resolveTaijiOutputFile("diff.json");
  assert.ok(result.endsWith("taiji-output/config-diffs/diff.json"));
});
```

- [ ] **Step 3: 编译并运行测试**

```bash
npm run build
node --test tests/output.test.mjs
```

- [ ] **Step 4: Commit**

```bash
git add src/utils/output.ts tests/output.test.mjs
git commit -m "feat: add output path utilities with tests"
```

---

### Task 5: 凭证管理 (`src/auth/token.ts`)

**Files:**
- Create: `src/auth/token.ts`
- Create: `src/auth/browser.ts`
- Test: `tests/auth.test.mjs`

- [ ] **Step 1: 创建 auth/token.ts**

从 `scrape-taiji.mjs` 的 `extractCookieHeader`, `parseCookieHeader`, `addCookiesFromFile`, `createDirectClient`, `isDirectClient` 迁移：

```typescript
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { CookieEntry, DirectClient } from "../types";

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
        sameSite: "Lax" as const,
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
```

- [ ] **Step 2: 创建 auth/browser.ts**

从 `scrape-taiji.mjs` 的 `addCookiesFromFile`, `waitForLogin` 迁移 Playwright 浏览器逻辑：

```typescript
import { readFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import { parseCookieEntries } from "./token";

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
```

- [ ] **Step 3: 创建 auth 测试 `tests/auth.test.mjs`**

```javascript
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { extractCookieHeader, parseCookieEntries } from "../dist/auth/token.js";

test("extractCookieHeader extracts plain cookie header", () => {
  const input = "cookie: name=value; other=thing";
  assert.strictEqual(extractCookieHeader(input), "name=value; other=thing");
});

test("extractCookieHeader extracts from curl format", () => {
  const input = `curl 'https://example.com' \\\n  -H 'cookie: foo=bar; baz=qux'`;
  assert.strictEqual(extractCookieHeader(input), "foo=bar; baz=qux");
});

test("parseCookieEntries parses cookie string to entries", () => {
  const entries = parseCookieEntries("a=1; b=2; c=3");
  assert.strictEqual(entries.length, 3);
  assert.strictEqual(entries[0].name, "a");
  assert.strictEqual(entries[0].value, "1");
});
```

- [ ] **Step 4: 编译并测试**

```bash
npm run build
node --test tests/auth.test.mjs
```

- [ ] **Step 5: Commit**

```bash
git add src/auth/ tests/auth.test.mjs
git commit -m "feat: add authentication module (cookie parsing, browser login) with tests"
```

---

### Task 6: API 客户端 (`src/api/client.ts`)

**Files:**
- Create: `src/api/client.ts`

- [ ] **Step 1: 创建 API 客户端**

从 `scrape-taiji.mjs` 的 `fetchJsonFromPage`, `fetchJsonDirect`, `fetchBinaryDirect`, `fetchBinaryResource`, `fetchTextResource`, `fetchTextDirect` 迁移 HTTP 客户端逻辑：

```typescript
import type { DirectClient } from "../types";
import { isDirectClient } from "../auth/token";

const TAIJI_ORIGIN = "https://taiji.algo.qq.com";
const TRAINING_URL = "https://taiji.algo.qq.com/training";

export interface FetchOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  params?: Record<string, unknown>;
  authWaitMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}

export interface FetchResponse<T = unknown> {
  ok: boolean;
  status: number;
  statusText: string;
  body: T;
  text?: string;
}

function buildUrl(endpoint: string, params?: Record<string, unknown>): string {
  const url = new URL(endpoint, TAIJI_ORIGIN);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.href;
}

function buildHeaders(cookieHeader?: string): Record<string, string> {
  return {
    accept: "application/json, text/plain, */*",
    ...(cookieHeader ? { cookie: cookieHeader } : {}),
    referer: TRAINING_URL,
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36 Edg/147.0.0.0",
  };
}

export async function fetchJson<T = unknown>(
  client: unknown,
  endpoint: string,
  options: FetchOptions = {}
): Promise<T> {
  const method = options.method ?? "GET";
  const maxRetries = options.maxRetries ?? 3;
  const retryDelayMs = options.retryDelayMs ?? 1000;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (isDirectClient(client)) {
        return await fetchDirect<T>(client, endpoint, { method, params: options.params });
      }
      // Browser mode handled by browser.ts later
      throw new Error("Browser mode requires a Playwright page object");
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, retryDelayMs * (attempt + 1)));
      }
    }
  }

  throw lastError ?? new Error("Unknown error");
}

async function fetchDirect<T = unknown>(
  client: DirectClient,
  endpoint: string,
  options: { method?: string; params?: Record<string, unknown> }
): Promise<T> {
  const url = buildUrl(endpoint, options.params);
  const method = options.method ?? "GET";
  const headers = buildHeaders(client.directCookieHeader);
  const requestInit: RequestInit = { method, headers };

  if (method !== "GET" && options.params) {
    headers["content-type"] = "application/json";
    requestInit.body = JSON.stringify(options.params);
  }

  const response = await fetch(url, requestInit);
  const text = await response.text();
  let body: T;
  try {
    body = JSON.parse(text);
  } catch {
    body = text as T;
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${text.slice(0, 500)}`);
  }

  return body;
}

export async function fetchBinary(
  client: unknown,
  resourceUrl: string
): Promise<{ ok: boolean; status: number; buffer: Buffer; contentType: string }> {
  if (isDirectClient(client)) {
    return fetchBinaryDirect(client, resourceUrl);
  }
  throw new Error("Browser mode not yet implemented");
}

async function fetchBinaryDirect(
  client: DirectClient,
  resourceUrl: string
): Promise<{ ok: boolean; status: number; buffer: Buffer; contentType: string }> {
  const response = await fetch(resourceUrl, {
    headers: {
      accept: "*/*",
      cookie: client.directCookieHeader,
      referer: TRAINING_URL,
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36 Edg/147.0.0.0",
    },
  });
  return {
    ok: response.ok,
    status: response.status,
    contentType: response.headers.get("content-type") ?? "",
    buffer: Buffer.from(await response.arrayBuffer()),
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/api/client.ts
git commit -m "feat: add HTTP API client with retry and direct/fetch modes"
```

---

### Task 7: 格式化与 COS 工具 (`src/utils/format.ts`, `src/api/upload.ts`)

**Files:**
- Create: `src/utils/format.ts`
- Create: `src/api/upload.ts`

- [ ] **Step 1: 创建 format.ts**

从 `scrape-taiji.mjs` 的 `csvEscape`, `toCsv`, `normalizeLogLines`, `safePathPart`, `safeRelativeFilePath`, `normalizeMetricRows`, `summarizeMetrics` 迁移：

```typescript
import type { MetricRow, CheckpointRow } from "../types";

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
  if (Array.isArray(data?.list)) return data.list.map((item) => (typeof item === "string" ? item : JSON.stringify(item)));
  if (Array.isArray(data?.logs)) return data.logs.map((item) => (typeof item === "string" ? item : JSON.stringify(item)));
  return [];
}

export function safePathPart(value: unknown): string {
  return String(value ?? "unknown").replace(/[<>:"/\\|?*\x00-\x1F]+/g, "_").slice(0, 180);
}

export function safeRelativeFilePath(file: Record<string, unknown>): string {
  const raw = String(file?.name ?? file?.path ?? file?.url ?? "file");
  const withoutProtocol = raw.replace(/^https?:\/\//i, "").replace(/^\/+/, "");
  const parts = withoutProtocol.split(/[\\/]+/).filter(Boolean).map(safePathPart);
  return parts.length ? require("path").join(...parts) : "file";
}
```

- [ ] **Step 2: 创建 api/upload.ts**

从 `scrape-taiji.mjs` 的 `fetchFederationToken`, `getCosObject`, `fetchCosResource`, `isCosKey`, `candidateFileSources`, `sourceLabel`, `looksLikeHtml`, `hasZipMagic`, `validateTrainFileDownload` 迁移：

```typescript
import path from "node:path";
import { createRequire } from "node:module";
import type { CosToken, TrainFile, DownloadValidation } from "../types";
import { fetchJson } from "./client";

const require = createRequire(import.meta.url);
const COS = require("cos-nodejs-sdk-v5");

const BUCKET = "hunyuan-external-1258344706";
const REGION = "ap-guangzhou";

export const DOWNLOAD_VALIDATION_VERSION = 2;

export async function fetchFederationToken(client: unknown, authWaitMs?: number): Promise<CosToken> {
  const token = await fetchJson(client, "/aide/api/evaluation_tasks/get_federation_token/", { authWaitMs });
  for (const key of ["id", "key", "Token"]) {
    if (!(token as any)?.[key]) throw new Error(`Federation token missing ${key}`);
  }
  return token as CosToken;
}

export async function fetchCosResource(cos: InstanceType<typeof COS>, key: string): Promise<{ ok: boolean; buffer: Buffer; contentType: string }> {
  return new Promise((resolve, reject) => {
    cos.getObject({ Bucket: BUCKET, Region: REGION, Key: key }, (error: Error, data: any) => {
      if (error) reject(error);
      else resolve({
        ok: true,
        contentType: data.headers?.["content-type"] ?? data.ContentType ?? "",
        buffer: Buffer.isBuffer(data.Body) ? data.Body : Buffer.from(data.Body ?? ""),
      });
    });
  });
}

export function createCosClient(token: CosToken): InstanceType<typeof COS> {
  return new COS({
    SecretId: token.id,
    SecretKey: token.key,
    SecurityToken: token.Token,
  });
}

function isCosKey(rawPath: string): boolean {
  return /(^|\/)train\/local--[^/]+\/[^/]+$/i.test(rawPath);
}

function looksLikeHtml(buffer: Buffer, contentType: string): boolean {
  const head = buffer.subarray(0, 512).toString("utf8").trimStart().toLowerCase();
  return String(contentType).toLowerCase().includes("text/html") || head.startsWith("<!doctype html") || head.startsWith("<html");
}

function hasZipMagic(buffer: Buffer): boolean {
  return (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    [0x03, 0x05, 0x07].includes(buffer[2]) &&
    [0x04, 0x06, 0x08].includes(buffer[3])
  );
}

export function validateTrainFileDownload(file: TrainFile | undefined, download: { buffer: Buffer; contentType?: string }): DownloadValidation {
  const name = String(file?.name ?? path.basename(file?.path ?? file?.url ?? "file"));
  const buffer = download?.buffer;
  if (!Buffer.isBuffer(buffer)) throw new Error(`${name}: downloaded body is not a Buffer`);
  if (!buffer.length) throw new Error(`${name}: downloaded file is empty`);
  if (looksLikeHtml(buffer, download?.contentType ?? "")) throw new Error(`${name}: downloaded an HTML page instead of a trainFile`);

  const expectedSize = Number(file?.size);
  if (Number.isFinite(expectedSize) && expectedSize > 0 && buffer.length !== expectedSize) {
    throw new Error(`${name}: size mismatch, expected ${expectedSize} bytes, got ${buffer.length}`);
  }

  const lowerName = name.toLowerCase();
  if (lowerName.endsWith(".zip") && !hasZipMagic(buffer)) throw new Error(`${name}: ZIP magic mismatch`);

  return { bytes: buffer.length, contentType: download?.contentType ?? "" };
}

export const COS_CONSTS = { BUCKET, REGION };
```

- [ ] **Step 3: Commit**

```bash
git add src/utils/format.ts src/api/upload.ts
git commit -m "feat: add formatting utilities and COS upload helpers"
```

---

## Chunk 3: Train 核心命令（读取类）

### Task 8: `train list` 命令

**Files:**
- Create: `src/api/training.ts`
- Create: `src/cli/commands/train/list.ts`
- Modify: `src/cli/commands/train/index.ts`

- [ ] **Step 1: 创建 api/training.ts**

从 `scrape-taiji.mjs` 的 `fetchTrainingJobs`, `fetchJobInstances`, `fetchJobDetail`, `fetchInstanceOutput`, `fetchInstanceLog`, `extractRows`, `extractTotal` 迁移：

```typescript
import type { TrainingJob, JobInstance, JobDetail } from "../../types";
import { fetchJson, type FetchOptions } from "./client";

function extractRows(response: unknown): unknown[] {
  const data = (response as any)?.data;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.list)) return data.list;
  if (Array.isArray((response as any)?.list)) return (response as any).list;
  return [];
}

function extractTotal(response: unknown): number | null {
  return (
    (response as any)?.data?.totalCount ??
    (response as any)?.data?.total ??
    (response as any)?.data?.count ??
    (response as any)?.totalCount ??
    (response as any)?.total ??
    null
  );
}

export async function fetchTrainingJobs(
  client: unknown,
  pageSize: number,
  authWaitMs?: number
): Promise<TrainingJob[]> {
  const jobs: TrainingJob[] = [];
  for (let pageNum = 0; ; pageNum++) {
    const response = await fetchJson(client, "/taskmanagement/api/v1/webtasks/external/task", {
      params: { pageNum, pageSize },
      authWaitMs,
    });
    const rows = extractRows(response);
    jobs.push(...(rows as TrainingJob[]));
    const total = extractTotal(response);
    if (!rows.length || rows.length < pageSize || (total != null && jobs.length >= total)) break;
  }
  return jobs;
}

export async function fetchJobInstances(
  client: unknown,
  taskID: string,
  pageSize: number,
  authWaitMs?: number
): Promise<JobInstance[]> {
  const instances: JobInstance[] = [];
  for (let pageNum = 0; ; pageNum++) {
    const response = await fetchJson(client, "/taskmanagement/api/v1/instances/list", {
      method: "POST",
      params: { desc: true, orderBy: "create", task_id: taskID, page: pageNum, size: pageSize },
      authWaitMs,
    });
    const rows = extractRows(response);
    instances.push(...(rows as JobInstance[]));
    const total = extractTotal(response);
    if (!rows.length || rows.length < pageSize || (total != null && instances.length >= total)) break;
  }
  return instances;
}

export async function fetchJobDetail(client: unknown, jobInternalId: string, authWaitMs?: number): Promise<JobDetail> {
  return fetchJson(client, `/taskmanagement/api/v1/webtasks/external/task/${jobInternalId}`, { authWaitMs });
}

export async function fetchInstanceOutput(client: unknown, instanceId: string, authWaitMs?: number): Promise<Record<string, unknown>> {
  const [checkpoints, tfEvents] = await Promise.all([
    fetchJson(client, `/taskmanagement/api/v1/instances/external/${instanceId}/get_ckpt`, { authWaitMs }),
    fetchJson(client, `/taskmanagement/api/v1/instances/external/${instanceId}/tf_events`, { authWaitMs }),
  ]);
  return {
    checkpoints: (checkpoints as any)?.data ?? checkpoints,
    metrics: (tfEvents as any)?.data?.data ?? {},
    metricSummary: summarizeMetrics((tfEvents as any)?.data?.data ?? {}),
  };
}

export async function fetchInstanceLog(client: unknown, instanceId: string, authWaitMs?: number): Promise<unknown> {
  return fetchJson(client, `/taskmanagement/api/v1/instances/${instanceId}/pod_log`, { authWaitMs });
}

function summarizeMetrics(metrics: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(metrics).map(([name, payload]) => {
      const rows = normalizeMetricRows(name, payload);
      const numericValues = rows.map((row) => Number(row.value)).filter(Number.isFinite);
      const last = rows.at(-1);
      return [
        name,
        {
          series: [...new Set(rows.map((row) => row.series))],
          charts: [...new Set(rows.map((row) => row.chart))],
          points: rows.length,
          firstStep: rows[0]?.step ?? null,
          lastStep: last?.step ?? null,
          lastValue: last?.value ?? null,
          min: numericValues.length ? Math.min(...numericValues) : null,
          max: numericValues.length ? Math.max(...numericValues) : null,
        },
      ];
    })
  );
}

function normalizeMetricRows(metricName: string, payload: unknown): any[] {
  if (!payload) return [];
  const arr = Array.isArray(payload) ? payload : [payload];
  return arr.flatMap((p, i) => {
    const dates = Array.isArray((p as any)?.date) ? (p as any).date : [];
    const titles = Array.isArray((p as any)?.title) ? (p as any).title : [];
    const values = Array.isArray((p as any)?.value) ? (p as any).value : [];
    const rows: any[] = [];
    for (let si = 0; si < Math.max(titles.length, values.length); si++) {
      const seriesName = titles[si] ?? `${metricName}_${si}`;
      const seriesValues = Array.isArray(values[si]) ? values[si] : [];
      for (let pi = 0; pi < seriesValues.length; pi++) {
        rows.push({ metric: metricName, series: seriesName, step: dates[pi] ?? pi, value: seriesValues[pi] });
      }
    }
    return rows;
  });
}
```

- [ ] **Step 2: 创建 train/list.ts**

从 `scrape-taiji.mjs` 的 `scrapeAllTrainingJobs` 核心逻辑迁移：

```typescript
import { Command } from "commander";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureAuthenticated, isDirectClient, createDirectClient, readCookieFile } from "../../../auth/token";
import { createBrowserContext, addCookiesToBrowser, DEFAULTS as BROWSER_DEFAULTS } from "../../../auth/browser";
import { fetchTrainingJobs, fetchJobDetail, fetchJobInstances, fetchInstanceOutput, fetchInstanceLog } from "../../../api/training";
import { resolveTaijiOutputDir } from "../../../utils/output";
import { toCsv, normalizeLogLines, safePathPart } from "../../../utils/format";

export function registerTrainListCommand(trainCmd: Command) {
  trainCmd
    .command("list")
    .description("Scrape training job list with details")
    .option("--all", "Scrape all training jobs")
    .option("--cookie-file <file>", "Cookie file path")
    .option("--direct", "Use backend HTTP instead of browser")
    .option("--headless", "Launch Chromium in headless mode")
    .option("--incremental", "Skip unchanged terminal jobs")
    .option("--job-internal-id <id>", "Target one internal job ID")
    .option("--job-id <id>", "Target one platform task ID")
    .option("--page-size <n>", "Page size", (v) => parseInt(v, 10))
    .option("--out <dir>", "Output directory")
    .option("--timeout <ms>", "Timeout in ms", (v) => parseInt(v, 10))
    .action(async (opts) => {
      const outDir = resolveTaijiOutputDir(opts.out ?? "taiji-output");
      await mkdir(outDir, { recursive: true });

      if (opts.direct) {
        const client = await ensureAuthenticated(opts.cookieFile);
        await runScrape(client, opts, outDir);
        return;
      }

      const userDataDir = path.resolve(outDir, "browser-profile");
      const context = await createBrowserContext(userDataDir, opts.headless ?? false);
      try {
        if (opts.cookieFile) await addCookiesToBrowser(context, opts.cookieFile);
        const page = context.pages()[0] ?? (await context.newPage());
        await runScrape(page, opts, outDir);
      } finally {
        await context.close();
      }
    });
}

async function runScrape(client: unknown, opts: any, outDir: string): Promise<void> {
  // Implementation: migrate from scrapeAllTrainingJobs in scrape-taiji.mjs
  // For now, placeholder — will be filled in incremental tasks
  console.log("train list — scraping...");
}
```

注意：这里先创建命令骨架，完整的 scrape 逻辑在 Task 14 中迁移。

- [ ] **Step 3: 修改 train/index.ts 挂载子命令**

```typescript
import { Command } from "commander";
import { registerTrainListCommand } from "./list";

export function registerTrainCommand(program: Command) {
  const trainCmd = program.command("train").description("Manage training tasks");
  registerTrainListCommand(trainCmd);
}
```

- [ ] **Step 4: 编译验证**

```bash
npm run build
node dist/cli/index.js train list --help
```

- [ ] **Step 5: Commit**

```bash
git add src/api/training.ts src/cli/commands/train/list.ts src/cli/commands/train/index.ts
git commit -m "feat: add train list command skeleton with training API module"
```

---

### Task 9: `train logs` 和 `train metrics` 命令

**Files:**
- Create: `src/cli/commands/train/logs.ts`
- Create: `src/cli/commands/train/metrics.ts`
- Modify: `src/cli/commands/train/index.ts`

- [ ] **Step 1: 创建 train/logs.ts**

```typescript
import { Command } from "commander";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureAuthenticated } from "../../../auth/token";
import { createBrowserContext, addCookiesToBrowser } from "../../../auth/browser";
import { fetchInstanceLog, fetchJobInstances, fetchJobDetail } from "../../../api/training";
import { resolveTaijiOutputDir } from "../../../utils/output";
import { normalizeLogLines } from "../../../utils/format";

export function registerTrainLogsCommand(trainCmd: Command) {
  trainCmd
    .command("logs")
    .description("Get training job logs")
    .requiredOption("--job <id>", "Job internal ID")
    .option("--cookie-file <file>", "Cookie file path")
    .option("--direct", "Use backend HTTP")
    .option("--errors", "Only show error lines")
    .option("--tail <n>", "Last N lines", (v) => parseInt(v, 10))
    .option("--json", "Output as JSON")
    .option("--out <dir>", "Output directory")
    .action(async (opts) => {
      const outDir = resolveTaijiOutputDir(opts.out ?? "taiji-output");
      const client = opts.direct ? await ensureAuthenticated(opts.cookieFile) : null;
      // Browser mode TBD
      if (!client) throw new Error("--direct is required for now");

      const logDir = path.join(outDir, "logs", opts.job);
      await mkdir(logDir, { recursive: true });

      // Fetch instances for the job, then logs for each instance
      const instances = await fetchJobInstances(client, opts.job, 100);
      for (const instance of instances) {
        const instanceId = instance.id;
        if (!instanceId) continue;
        try {
          const logResponse = await fetchInstanceLog(client, instanceId);
          const lines = normalizeLogLines(logResponse);
          await writeFile(path.join(logDir, `${instanceId}.json`), JSON.stringify(logResponse, null, 2), "utf8");
          await writeFile(path.join(logDir, `${instanceId}.txt`), lines.join("\n"), "utf8");
          console.log(`  Instance ${instanceId}: ${lines.length} log lines`);
        } catch (error) {
          console.log(`  Instance ${instanceId}: failed: ${error}`);
        }
      }
      console.log(`Logs saved to ${logDir}`);
    });
}
```

- [ ] **Step 2: 创建 train/metrics.ts**

```typescript
import { Command } from "commander";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureAuthenticated } from "../../../auth/token";
import { fetchInstanceOutput, fetchJobInstances } from "../../../api/training";
import { resolveTaijiOutputDir } from "../../../utils/output";
import { toCsv } from "../../../utils/format";

export function registerTrainMetricsCommand(trainCmd: Command) {
  trainCmd
    .command("metrics")
    .description("Get training job metrics")
    .requiredOption("--job <id>", "Job internal ID")
    .option("--cookie-file <file>", "Cookie file path")
    .option("--direct", "Use backend HTTP")
    .option("--json", "Output as JSON")
    .option("--out <dir>", "Output directory")
    .action(async (opts) => {
      const outDir = resolveTaijiOutputDir(opts.out ?? "taiji-output");
      const client = opts.direct ? await ensureAuthenticated(opts.cookieFile) : null;
      if (!client) throw new Error("--direct is required for now");

      const instances = await fetchJobInstances(client, opts.job, 100);
      const metricRows: any[] = [];

      for (const instance of instances) {
        const instanceId = instance.id;
        if (!instanceId) continue;
        const output = await fetchInstanceOutput(client, instanceId);
        console.log(`  Instance ${instanceId}: ${Object.keys(output.metrics ?? {}).length} metrics`);
      }

      console.log(`Metrics fetched for job ${opts.job}`);
    });
}
```

- [ ] **Step 3: 修改 train/index.ts 挂载**

在 `registerTrainCommand` 中添加：
```typescript
import { registerTrainLogsCommand } from "./logs";
import { registerTrainMetricsCommand } from "./metrics";

// inside function:
registerTrainLogsCommand(trainCmd);
registerTrainMetricsCommand(trainCmd);
```

- [ ] **Step 4: 编译验证**

```bash
npm run build
node dist/cli/index.js train --help
node dist/cli/index.js train logs --help
node dist/cli/index.js train metrics --help
```

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/train/logs.ts src/cli/commands/train/metrics.ts src/cli/commands/train/index.ts
git commit -m "feat: add train logs and train metrics commands"
```

---

## Chunk 4: Train 写操作命令

### Task 10: `train stop` 和 `train delete` 命令

**Files:**
- Create: `src/cli/commands/train/stop.ts`
- Create: `src/cli/commands/train/delete.ts`
- Modify: `src/cli/commands/train/index.ts`

- [ ] **Step 1: 创建 stop.ts**

```typescript
import { Command } from "commander";
import { ensureAuthenticated } from "../../../auth/token";
import { fetchJson } from "../../../api/client";

export function registerTrainStopCommand(trainCmd: Command) {
  trainCmd
    .command("stop")
    .description("Stop a training job")
    .requiredOption("--job-id <id>", "Job internal ID")
    .requiredOption("--cookie-file <file>", "Cookie file path")
    .option("--direct", "Use backend HTTP")
    .action(async (opts) => {
      const client = await ensureAuthenticated(opts.cookieFile);
      console.log(`Stopping job ${opts.jobId}...`);
      // TODO: Implement actual API call
      console.log("train stop — API endpoint to be added");
    });
}
```

- [ ] **Step 2: 创建 delete.ts**

```typescript
import { Command } from "commander";
import { ensureAuthenticated } from "../../../auth/token";

export function registerTrainDeleteCommand(trainCmd: Command) {
  trainCmd
    .command("delete")
    .description("Delete a training job")
    .requiredOption("--job-id <id>", "Job internal ID")
    .requiredOption("--cookie-file <file>", "Cookie file path")
    .action(async (opts) => {
      const client = await ensureAuthenticated(opts.cookieFile);
      console.log(`Deleting job ${opts.jobId}...`);
      console.log("train delete — API endpoint to be added");
    });
}
```

- [ ] **Step 3: 修改 train/index.ts 挂载**

- [ ] **Step 4: Commit**

```bash
git add src/cli/commands/train/stop.ts src/cli/commands/train/delete.ts
git commit -m "feat: add train stop and train delete commands (skeleton)"
```

---

### Task 11: `login` 命令实现

**Files:**
- Modify: `src/cli/commands/login.ts`

- [ ] **Step 1: 实现 login.ts**

从 `scrape-taiji.mjs` 的 Playwright SSO 登录逻辑迁移：

```typescript
import { Command } from "commander";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createBrowserContext, addCookiesToBrowser, waitForLogin, DEFAULTS } from "../../auth/browser";
import { resolveTaijiOutputDir } from "../../utils/output";

const TRAINING_URL = "https://taiji.algo.qq.com/training";

export function registerLoginCommand(program: Command) {
  program
    .command("login")
    .description("Browser SSO login, save cookie")
    .option("--cookie-file <file>", "Output cookie file path")
    .option("--headless", "Launch Chromium in headless mode")
    .option("--timeout <ms>", "Login timeout in ms", (v) => parseInt(v, 10), DEFAULTS.TIMEOUT_MS)
    .option("--url <url>", "TAAC URL to navigate to", TRAINING_URL)
    .action(async (opts) => {
      const outDir = resolveTaijiOutputDir(opts.cookieFile ? path.dirname(opts.cookieFile) : "taiji-output/secrets");
      const cookieFile = opts.cookieFile ?? path.join(outDir, "taiji-cookie.txt");
      await mkdir(outDir, { recursive: true });

      const userDataDir = path.resolve(outDir, "browser-profile");
      const context = await createBrowserContext(userDataDir, opts.headless ?? false);
      try {
        await waitForLogin(context.pages()[0], opts.url, opts.timeout, ["Model Training Job", "模型训练任务"]);
        // Extract cookies from the logged-in session
        const cookies = await context.cookies();
        const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
        await writeFile(cookieFile, cookieHeader, "utf8");
        console.log(`Cookie saved to ${cookieFile}`);
      } finally {
        await context.close();
      }
    });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/cli/commands/login.ts
git commit -m "feat: implement login command with browser SSO flow"
```

---

## Chunk 5: Train 提交相关命令

### Task 12: `train prepare` 和 `train submit` 命令

**Files:**
- Create: `src/cli/commands/train/prepare.ts`
- Create: `src/cli/commands/train/submit.ts`
- Modify: `src/cli/commands/train/index.ts`

- [ ] **Step 1: 创建 train/prepare.ts**

从 `prepare-taiji-submit.mjs` 迁移核心逻辑：

```typescript
import { Command } from "commander";
import { access, copyFile, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveTaijiOutputDir } from "../../../utils/output";

const execFileAsync = promisify(execFile);
const PRIMARY_TRAIN_FILE_NAMES = new Set(["code.zip", "config.yaml", "run.sh"]);

export function registerTrainPrepareCommand(trainCmd: Command) {
  trainCmd
    .command("prepare")
    .description("Prepare a submit bundle")
    .requiredOption("--template-job-url <url>", "Template job URL or ID")
    .option("--zip <file>", "code.zip path")
    .option("--config <file>", "config.yaml path")
    .option("--run-sh <file>", "run.sh path")
    .option("--file <path[=name]>", "Generic trainFile (repeatable)")
    .option("--file-dir <dir>", "Directory of trainFiles")
    .option("--name <name>", "Job name")
    .option("--description <text>", "Job description")
    .option("--run", "Mark as run-after-submit")
    .option("--out <dir>", "Output directory")
    .option("--message <text>", "Local note")
    .option("--allow-dirty", "Skip git dirty check")
    .action(async (opts) => {
      const outDir = resolveTaijiOutputDir(opts.out ?? "submit-bundle");
      await mkdir(path.join(outDir, "files"), { recursive: true });
      console.log(`Preparing bundle in ${outDir}`);
      // TODO: Migrate full prepare logic from prepare-taiji-submit.mjs
    });
}
```

- [ ] **Step 2: 创建 train/submit.ts**

从 `submit-taiji.mjs` 迁移核心逻辑：

```typescript
import { Command } from "commander";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureAuthenticated } from "../../../auth/token";
import { fetchJson } from "../../../api/client";
import { createCosClient, fetchFederationToken, fetchCosResource } from "../../../api/upload";
import { resolveTaijiOutputDir } from "../../../utils/output";
import { randomUUID } from "node:crypto";

export function registerTrainSubmitCommand(trainCmd: Command) {
  trainCmd
    .command("submit")
    .description("Upload bundle to COS and create job")
    .requiredOption("--bundle <dir>", "Submit bundle directory")
    .requiredOption("--cookie-file <file>", "Cookie file")
    .option("--template-job-internal-id <id>", "Template job internal ID")
    .option("--template-job-url <url>", "Template job URL")
    .option("--name <name>", "Override job name")
    .option("--description <text>", "Override job description")
    .option("--execute", "Actually upload and create")
    .option("--run", "Start job after creation")
    .option("--yes", "Required with --execute")
    .option("--allow-add-file", "Allow new trainFiles")
    .option("--out <dir>", "Output directory")
    .action(async (opts) => {
      if (opts.execute && !opts.yes) {
        throw new Error("--execute requires --yes");
      }
      const outDir = resolveTaijiOutputDir(opts.out ?? `submit-live/${new Date().toISOString().replace(/[:.]/g, "-")}`);
      await mkdir(outDir, { recursive: true });

      if (!opts.execute) {
        console.log("Dry-run mode — no files uploaded, no job created");
        // TODO: Print planned actions
        return;
      }

      const client = await ensureAuthenticated(opts.cookieFile);
      console.log("Uploading files and creating job...");
      // TODO: Migrate full submit logic from submit-taiji.mjs
    });
}
```

- [ ] **Step 3: Commit**

```bash
git add src/cli/commands/train/prepare.ts src/cli/commands/train/submit.ts
git commit -m "feat: add train prepare and train submit commands (skeleton)"
```

---

### Task 13: `train create` 和 `train run` 命令

**Files:**
- Create: `src/cli/commands/train/create.ts`
- Create: `src/cli/commands/train/run.ts`
- Modify: `src/cli/commands/train/index.ts`

- [ ] **Step 1: 创建 create.ts**

```typescript
import { Command } from "commander";
import { ensureAuthenticated } from "../../../auth/token";

export function registerTrainCreateCommand(trainCmd: Command) {
  trainCmd
    .command("create")
    .description("Create a training job from bundle")
    .requiredOption("--cookie-file <file>", "Cookie file")
    .option("--bundle <dir>", "Submit bundle directory")
    .option("--template-job-internal-id <id>", "Template job internal ID")
    .option("--name <name>", "Job name")
    .option("--description <text>", "Job description")
    .action(async (opts) => {
      const client = await ensureAuthenticated(opts.cookieFile);
      console.log("Creating training job...");
      // TODO: Implement create API call
    });
}
```

- [ ] **Step 2: 创建 run.ts**

```typescript
import { Command } from "commander";
import { ensureAuthenticated } from "../../../auth/token";

export function registerTrainRunCommand(trainCmd: Command) {
  trainCmd
    .command("run")
    .description("Start a training job instance")
    .requiredOption("--job-id <id>", "Job internal ID")
    .requiredOption("--cookie-file <file>", "Cookie file")
    .action(async (opts) => {
      const client = await ensureAuthenticated(opts.cookieFile);
      console.log(`Starting job ${opts.jobId}...`);
      // TODO: Implement run API call
    });
}
```

- [ ] **Step 3: 修改 train/index.ts 挂载**

- [ ] **Step 4: Commit**

```bash
git add src/cli/commands/train/create.ts src/cli/commands/train/run.ts
git commit -m "feat: add train create and train run commands (skeleton)"
```

---

## Chunk 6: Train 实验分析工具

### Task 14: `train doctor` 和 `train verify` 命令

**Files:**
- Create: `src/cli/commands/train/doctor.ts`
- Create: `src/cli/commands/train/verify.ts`
- Modify: `src/cli/commands/train/index.ts`

- [ ] **Step 1: 创建 doctor.ts**

从 `experiment-tools.mjs` 的 doctor 逻辑迁移：

```typescript
import { Command } from "commander";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export function registerTrainDoctorCommand(trainCmd: Command) {
  trainCmd
    .command("doctor")
    .description("Check submit bundle for issues")
    .requiredOption("--bundle <dir>", "Submit bundle directory")
    .option("--json", "Output as JSON")
    .option("--out <file>", "Output file path")
    .action(async (opts) => {
      const bundleDir = path.resolve(opts.bundle);
      const manifestPath = path.join(bundleDir, "manifest.json");
      const filesDir = path.join(bundleDir, "files");

      const issues: string[] = [];
      try {
        await readFile(manifestPath, "utf8");
      } catch {
        issues.push("manifest.json not found");
      }

      for (const name of ["code.zip", "config.yaml"]) {
        try {
          await readFile(path.join(filesDir, name));
        } catch {
          issues.push(`${name} not found in bundle`);
        }
      }

      const result = { bundle: bundleDir, issues, ok: issues.length === 0 };
      console.log(opts.json ? JSON.stringify(result, null, 2) : JSON.stringify(result, null, 2));
    });
}
```

- [ ] **Step 2: 创建 verify.ts**

从 `experiment-tools.mjs` 的 verify 逻辑迁移：

```typescript
import { Command } from "commander";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ensureAuthenticated } from "../../../auth/token";
import { fetchJobDetail } from "../../../api/training";
import yaml from "js-yaml";

export function registerTrainVerifyCommand(trainCmd: Command) {
  trainCmd
    .command("verify")
    .description("Verify uploaded files match platform state")
    .requiredOption("--bundle <dir>", "Submit bundle directory")
    .requiredOption("--job-internal-id <id>", "Job internal ID")
    .requiredOption("--cookie-file <file>", "Cookie file")
    .option("--direct", "Use backend HTTP")
    .action(async (opts) => {
      const client = await ensureAuthenticated(opts.cookieFile);
      const bundleDir = path.resolve(opts.bundle);

      const jobDetail = await fetchJobDetail(client, opts.jobInternalId);
      // Compare bundle files with platform trainFiles
      console.log("Verifying bundle against platform state...");
      // TODO: Implement full verify logic
    });
}
```

- [ ] **Step 3: Commit**

```bash
git add src/cli/commands/train/doctor.ts src/cli/commands/train/verify.ts
git commit -m "feat: add train doctor and train verify commands"
```

---

### Task 15: `train compare`, `train compare-runs`, `train ckpt-select` 命令

**Files:**
- Create: `src/cli/commands/train/compare.ts`
- Create: `src/cli/commands/train/compare-runs.ts`
- Create: `src/cli/commands/train/ckpt-select.ts`
- Modify: `src/cli/commands/train/index.ts`

- [ ] **Step 1: 创建 compare.ts**

从 `experiment-tools.mjs` 的 `compare jobs` 逻辑迁移：

```typescript
import { Command } from "commander";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveTaijiOutputDir } from "../../../utils/output";

export function registerTrainCompareCommand(trainCmd: Command) {
  trainCmd
    .command("compare")
    .description("Compare multiple jobs as evidence")
    .argument("<jobIds...>", "Job internal IDs")
    .option("--out <dir>", "Output directory")
    .option("--json", "Output as JSON")
    .action(async (jobIds, opts) => {
      const outDir = resolveTaijiOutputDir(opts.out ?? "taiji-output");
      const jobsFile = path.join(outDir, "jobs.json");
      const data = JSON.parse(await readFile(jobsFile, "utf8"));

      const results = jobIds.map((id: string) => {
        const job = data.jobsById?.[id];
        if (!job) return { jobId: id, error: "not found" };
        return {
          jobId: id,
          name: job.name,
          description: job.description,
          status: job.status,
          instances: Object.keys(job.instancesById ?? {}).length,
        };
      });

      console.log(opts.json ? JSON.stringify(results, null, 2) : JSON.stringify(results, null, 2));
    });
}
```

- [ ] **Step 2: 创建 compare-runs.ts**

```typescript
import { Command } from "commander";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveTaijiOutputDir } from "../../../utils/output";

export function registerTrainCompareRunsCommand(trainCmd: Command) {
  trainCmd
    .command("compare-runs")
    .description("Compare base vs experiment job")
    .requiredOption("--base <id>", "Base job internal ID")
    .requiredOption("--exp <id>", "Experiment job internal ID")
    .option("--config", "Include config diff")
    .option("--metrics", "Include metrics comparison")
    .option("--json", "Output as JSON")
    .option("--out <dir>", "Output directory")
    .action(async (opts) => {
      const outDir = resolveTaijiOutputDir(opts.out ?? "taiji-output");
      const jobsFile = path.join(outDir, "jobs.json");
      const data = JSON.parse(await readFile(jobsFile, "utf8"));

      const base = data.jobsById?.[opts.base];
      const exp = data.jobsById?.[opts.exp];

      const result = {
        base: base ? { jobId: opts.base, name: base.name } : { jobId: opts.base, error: "not found" },
        exp: exp ? { jobId: opts.exp, name: exp.name } : { jobId: opts.exp, error: "not found" },
      };

      console.log(JSON.stringify(result, null, 2));
    });
}
```

- [ ] **Step 3: 创建 ckpt-select.ts**

```typescript
import { Command } from "commander";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveTaijiOutputDir } from "../../../utils/output";

export function registerTrainCkptSelectCommand(trainCmd: Command) {
  trainCmd
    .command("ckpt-select")
    .description("Select checkpoint candidates by metric rules")
    .requiredOption("--job <id>", "Job internal ID")
    .option("--by <metric>", "Metric to sort by", "valid_auc")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      const outDir = resolveTaijiOutputDir("taiji-output");
      const jobsFile = path.join(outDir, "jobs.json");
      const data = JSON.parse(await readFile(jobsFile, "utf8"));
      const job = data.jobsById?.[opts.job];
      if (!job) { console.error("Job not found"); process.exit(1); }

      // Extract checkpoints from instances
      const ckpts: any[] = [];
      for (const instance of Object.values(job.instancesById ?? {} as any)) {
        for (const ckpt of (instance as any).checkpoints ?? []) {
          ckpts.push({ instanceId: instance.instanceId, ...ckpt });
        }
      }

      console.log(JSON.stringify(ckpts.slice(0, 5), null, 2));
    });
}
```

- [ ] **Step 4: 修改 train/index.ts 挂载**

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/train/compare.ts src/cli/commands/train/compare-runs.ts src/cli/commands/train/ckpt-select.ts
git commit -m "feat: add train compare, compare-runs, and ckpt-select commands"
```

---

### Task 16: `train config-diff`, `train ledger`, `train diagnose` 命令

**Files:**
- Create: `src/cli/commands/train/config-diff.ts`
- Create: `src/cli/commands/train/ledger.ts`
- Create: `src/cli/commands/train/diagnose.ts`
- Modify: `src/cli/commands/train/index.ts`

- [ ] **Step 1: 创建 config-diff.ts**

从 `compare-config-yaml.mjs` 迁移核心逻辑：

```typescript
import { Command } from "commander";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { resolveTaijiOutputFile } from "../../../utils/output";
import type { ConfigChange, ConfigDiffResult } from "../../../types";

function formatPath(parts: string[]): string {
  if (!parts.length) return "$";
  return parts.map((p) => (typeof p === "number" ? `[${p}]` : String(p).replace(/[.[\]\\]/g, "\\$&")))
    .reduce((acc, part) => (part.startsWith("[") ? `${acc}${part}` : acc ? `${acc}.${part}` : part), "");
}

function isObject(value: unknown): boolean {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function compareValues(before: unknown, after: unknown, parts: (string | number)[] = []): ConfigChange[] {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  const changes: ConfigChange[] = [];

  if (Array.isArray(before) && Array.isArray(after)) {
    for (let i = 0; i < Math.max(before.length, after.length); i++) {
      if (i >= before.length) changes.push({ type: "added", path: formatPath([...parts, i]), before: undefined, after: after[i] });
      else if (i >= after.length) changes.push({ type: "removed", path: formatPath([...parts, i]), before: before[i], after: undefined });
      else changes.push(...compareValues(before[i], after[i], [...parts, i]));
    }
  } else if (isObject(before) && isObject(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    for (const key of keys) {
      if (!(key in before)) changes.push({ type: "added", path: formatPath([...parts, key]), before: undefined, after: (after as any)[key] });
      else if (!(key in after)) changes.push({ type: "removed", path: formatPath([...parts, key]), before: (before as any)[key], after: undefined });
      else changes.push(...compareValues((before as any)[key], (after as any)[key], [...parts, key]));
    }
  } else {
    changes.push({ type: "changed", path: formatPath(parts), before, after });
  }
  return changes;
}

export function registerTrainConfigDiffCommand(trainCmd: Command) {
  trainCmd
    .command("config-diff")
    .description("Semantic diff of two YAML configs")
    .argument("<oldFile>", "Old config YAML")
    .argument("<newFile>", "New config YAML")
    .option("--json", "Output as JSON")
    .option("--out <file>", "Output file path")
    .action(async (oldFile, newFile, opts) => {
      const [before, after] = await Promise.all([
        yaml.load(await readFile(oldFile, "utf8")),
        yaml.load(await readFile(newFile, "utf8")),
      ]);
      const changes = compareValues(before, after);
      const result: ConfigDiffResult = {
        oldFile: path.resolve(oldFile),
        newFile: path.resolve(newFile),
        summary: {
          total: changes.length,
          added: changes.filter((c) => c.type === "added").length,
          removed: changes.filter((c) => c.type === "removed").length,
          changed: changes.filter((c) => c.type === "changed").length,
        },
        changes,
      };

      const output = opts.json ? JSON.stringify(result, null, 2) : JSON.stringify(result, null, 2);
      if (opts.out) {
        const outPath = resolveTaijiOutputFile(opts.out);
        await mkdir(path.dirname(outPath), { recursive: true });
        await writeFile(outPath, output + "\n", "utf8");
        console.error(`Wrote config diff: ${outPath}`);
      } else {
        process.stdout.write(output);
      }
    });
}
```

- [ ] **Step 2: 创建 ledger.ts**

```typescript
import { Command } from "commander";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveTaijiOutputDir } from "../../../utils/output";

export function registerTrainLedgeCommand(trainCmd: Command) {
  trainCmd
    .command("ledger")
    .description("Sync structured experiment ledger")
    .argument("action", "Action: sync")
    .option("--out <file>", "Output file")
    .option("--output-dir <dir>", "Output directory")
    .action(async (action, opts) => {
      if (action !== "sync") { console.error("Only 'sync' action supported"); process.exit(1); }
      const outDir = resolveTaijiOutputDir(opts.outputDir ?? "taiji-output");
      const jobsFile = path.join(outDir, "jobs.json");
      const data = JSON.parse(await readFile(jobsFile, "utf8"));

      const ledger = Object.values(data.jobsById ?? {}).map((job: any) => ({
        jobId: job.jobId,
        jobInternalId: job.jobInternalId,
        name: job.name,
        description: job.description,
        status: job.status,
        jzStatus: job.jzStatus,
        instances: Object.keys(job.instancesById ?? {}).length,
      }));

      const outPath = path.join(outDir, opts.out ?? "ledger.json");
      await writeFile(outPath, JSON.stringify(ledger, null, 2), "utf8");
      console.log(`Ledger synced: ${ledger.length} jobs to ${outPath}`);
    });
}
```

- [ ] **Step 3: 创建 diagnose.ts**

```typescript
import { Command } from "commander";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveTaijiOutputDir } from "../../../utils/output";

export function registerTrainDiagnoseCommand(trainCmd: Command) {
  trainCmd
    .command("diagnose")
    .description("Diagnose a failed job")
    .requiredOption("--job-internal-id <id>", "Job internal ID")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      const outDir = resolveTaijiOutputDir("taiji-output");
      const jobsFile = path.join(outDir, "jobs.json");
      const data = JSON.parse(await readFile(jobsFile, "utf8"));
      const job = data.jobsById?.[opts.jobInternalId];
      if (!job) { console.error("Job not found"); process.exit(1); }

      // Check job status, code errors, instance errors
      const diagnosis: any = {
        jobId: opts.jobInternalId,
        name: job.name,
        status: job.status,
        jzStatus: job.jzStatus,
        codeError: job.code?.error ?? null,
        instanceErrors: [],
      };

      for (const [id, instance] of Object.entries(job.instancesById ?? {})) {
        if ((instance as any).error) {
          diagnosis.instanceErrors.push({ instanceId: id, error: (instance as any).error });
        }
      }

      console.log(JSON.stringify(diagnosis, null, 2));
    });
}
```

- [ ] **Step 4: 修改 train/index.ts 挂载所有子命令**

最终 train/index.ts 应该注册所有 16 个子命令。

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/train/config-diff.ts src/cli/commands/train/ledger.ts src/cli/commands/train/diagnose.ts
git commit -m "feat: add train config-diff, ledger, and diagnose commands"
```

---

## Chunk 7: Eval 命令

### Task 17: `eval create`, `eval list`, `eval logs`, `eval metrics` 命令

**Files:**
- Create: `src/cli/commands/eval/create.ts`
- Create: `src/cli/commands/eval/list.ts`
- Create: `src/cli/commands/eval/logs.ts`
- Create: `src/cli/commands/eval/metrics.ts`
- Modify: `src/cli/commands/eval/index.ts`
- Create: `src/api/evaluation.ts`

- [ ] **Step 1: 创建 api/evaluation.ts**

从 `scrape-taiji.mjs` 的 `fetchEvaluationTasks`, `fetchEvaluationLog` 迁移：

```typescript
import type { EvaluationTask } from "../../types";
import { fetchJson } from "./client";

export async function fetchEvaluationTasks(
  client: unknown,
  pageSize: number,
  authWaitMs?: number
): Promise<EvaluationTask[]> {
  const tasks: EvaluationTask[] = [];
  for (let pageNum = 1; ; pageNum++) {
    const response = await fetchJson(client, "/aide/api/evaluation_tasks/", {
      params: { page: pageNum, page_size: pageSize },
      authWaitMs,
    });
    const rows = (response as any)?.results ?? [];
    tasks.push(...rows);
    if (!rows.length || rows.length < pageSize || (response as any)?.next == null) break;
  }
  return tasks;
}

export async function fetchEvaluationLog(
  client: unknown,
  taskId: string,
  authWaitMs?: number
): Promise<unknown> {
  return fetchJson(client, "/aide/api/evaluation_tasks/event_log/", {
    params: { task_id: taskId },
    authWaitMs,
  });
}
```

- [ ] **Step 2: 创建 eval/list.ts**

```typescript
import { Command } from "commander";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureAuthenticated } from "../../../auth/token";
import { fetchEvaluationTasks, fetchEvaluationLog } from "../../../api/evaluation";
import { resolveTaijiOutputDir } from "../../../utils/output";
import { toCsv } from "../../../utils/format";

export function registerEvalListCommand(evalCmd: Command) {
  evalCmd
    .command("list")
    .description("Scrape evaluation task list")
    .option("--cookie-file <file>", "Cookie file")
    .option("--direct", "Use backend HTTP")
    .option("--page-size <n>", "Page size", (v) => parseInt(v, 10))
    .option("--out <dir>", "Output directory")
    .action(async (opts) => {
      const outDir = resolveTaijiOutputDir(opts.out ?? "taiji-output");
      const client = await ensureAuthenticated(opts.cookieFile);
      const tasks = await fetchEvaluationTasks(client, opts.pageSize ?? 100);
      console.log(`Found ${tasks.length} evaluation tasks`);

      const evalLogDir = path.join(outDir, "eval-logs");
      await mkdir(evalLogDir, { recursive: true });

      const tasksById: Record<string, any> = {};
      for (const task of tasks) {
        const taskId = task.id;
        if (!taskId) continue;
        tasksById[taskId] = { ...task };
        try {
          const logResponse = await fetchEvaluationLog(client, taskId);
          const logList = (logResponse as any)?.data?.list ?? [];
          await writeFile(path.join(evalLogDir, `${taskId}.json`), JSON.stringify(logList, null, 2), "utf8");
          const textLines = logList.map((entry: any) => `[${entry.time}] ${entry.message}`).join("\n");
          await writeFile(path.join(evalLogDir, `${taskId}.txt`), textLines, "utf8");
          tasksById[taskId].log = { entries: logList.length, path: `eval-logs/${taskId}.txt` };
        } catch (error) {
          tasksById[taskId].log = { error: String(error) };
        }
      }

      await writeFile(path.join(outDir, "eval-tasks.json"), JSON.stringify({
        sourceUrl: "https://taiji.algo.qq.com/evaluation",
        fetchedAt: new Date().toISOString(),
        count: tasks.length,
        tasksById,
      }, null, 2), "utf8");

      await writeFile(path.join(outDir, "eval-tasks-summary.csv"), toCsv(tasks.map((t) => ({
        id: t.id, name: t.name, status: t.status, score: t.score ?? "",
        auc: (t as any).results?.auc ?? "", infer_time: t.infer_time ?? "",
      }))), "utf8");

      console.log(`Saved ${tasks.length} evaluation tasks to ${outDir}`);
    });
}
```

- [ ] **Step 3: 创建 eval/create.ts**

```typescript
import { Command } from "commander";
import { ensureAuthenticated } from "../../../auth/token";

export function registerEvalCreateCommand(evalCmd: Command) {
  evalCmd
    .command("create")
    .description("Create an evaluation task")
    .requiredOption("--algo-id <id>", "Algorithm ID", (v) => parseInt(v, 10))
    .requiredOption("--sample-from <date>", "Sample start date (YYYY-MM-DD)")
    .requiredOption("--sample-to <date>", "Sample end date (YYYY-MM-DD)")
    .option("--model-version-id <id>", "Model version ID")
    .option("--cookie-file <file>", "Cookie file")
    .option("--name <name>", "Task name")
    .action(async (opts) => {
      const client = await ensureAuthenticated(opts.cookieFile);
      console.log("Creating evaluation task...");
      // TODO: Implement eval create API call
    });
}
```

- [ ] **Step 4: 创建 eval/logs.ts 和 eval/metrics.ts**

```typescript
// eval/logs.ts
import { Command } from "commander";
import { ensureAuthenticated } from "../../../auth/token";
import { fetchEvaluationLog } from "../../../api/evaluation";

export function registerEvalLogsCommand(evalCmd: Command) {
  evalCmd
    .command("logs")
    .description("View evaluation task logs")
    .requiredOption("--task-id <id>", "Task ID")
    .requiredOption("--cookie-file <file>", "Cookie file")
    .action(async (opts) => {
      const client = await ensureAuthenticated(opts.cookieFile);
      const log = await fetchEvaluationLog(client, opts.taskId);
      console.log(JSON.stringify(log, null, 2));
    });
}

// eval/metrics.ts
import { Command } from "commander";
import { ensureAuthenticated } from "../../../auth/token";
import { fetchEvaluationLog } from "../../../api/evaluation";

export function registerEvalMetricsCommand(evalCmd: Command) {
  evalCmd
    .command("metrics")
    .description("View evaluation task metrics")
    .requiredOption("--task-id <id>", "Task ID")
    .requiredOption("--cookie-file <file>", "Cookie file")
    .action(async (opts) => {
      const client = await ensureAuthenticated(opts.cookieFile);
      const log = await fetchEvaluationLog(client, opts.taskId);
      // Extract score/metrics from event log
      const entries = (log as any)?.data?.list ?? [];
      for (const entry of entries) {
        if (entry.message?.includes("score") || entry.message?.includes("auc")) {
          console.log(entry.message);
        }
      }
    });
}
```

- [ ] **Step 5: 修改 eval/index.ts 挂载所有子命令**

```typescript
import { Command } from "commander";
import { registerEvalListCommand } from "./list";
import { registerEvalCreateCommand } from "./create";
import { registerEvalLogsCommand } from "./logs";
import { registerEvalMetricsCommand } from "./metrics";

export function registerEvalCommand(program: Command) {
  const evalCmd = program.command("eval").description("Manage evaluation tasks");
  registerEvalListCommand(evalCmd);
  registerEvalCreateCommand(evalCmd);
  registerEvalLogsCommand(evalCmd);
  registerEvalMetricsCommand(evalCmd);
}
```

- [ ] **Step 6: Commit**

```bash
git add src/api/evaluation.ts src/cli/commands/eval/
git commit -m "feat: add eval commands (create, list, logs, metrics)"
```

---

## Chunk 8: 最终收尾

### Task 18: 更新 bin 入口和 package.json

**Files:**
- Modify: `bin/taac2026.mjs`
- Modify: `package.json`

- [ ] **Step 1: 更新 bin 入口指向 TypeScript 编译产物**

修改 package.json 的 bin 字段：
```json
{
  "bin": {
    "taac2026": "./dist/cli/index.js"
  }
}
```

- [ ] **Step 2: 保留旧 bin 作为兼容层**

旧的 `bin/taac2026.mjs` 保留，但输出迁移提示，然后转发到新的 CLI：

```javascript
#!/usr/bin/env node
console.warn("Note: This entry point is deprecated. Use 'taac2026' directly (now powered by TypeScript).");
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const rootDir = fileURLToPath(new URL("..", import.meta.url));
spawn(process.execPath, [path.join(rootDir, "dist", "cli", "index.js"), ...process.argv.slice(2)], { stdio: "inherit" });
```

- [ ] **Step 3: 编译并验证**

```bash
npm run build
taac2026 --help
taac2026 train --help
taac2026 eval --help
```

- [ ] **Step 4: Commit**

```bash
git add bin/taac2026.mjs package.json
git commit -m "chore: update bin entry to TypeScript CLI, keep old entry as compat shim"
```

---

### Task 19: 更新 README

**Files:**
- Modify: `README.md`
- Modify: `README.en.md`

- [ ] **Step 1: 更新 README.md 中的命令示例**

将旧命令替换为新命令结构。例如：
- `taac2026 scrape --all` → `taac2026 train list --all`
- `taac2026 diff-config` → `taac2026 train config-diff`
- `taac2026 prepare-submit` → `taac2026 train prepare`
- `taac2026 submit` → `taac2026 train submit`
- `taac2026 compare jobs` → `taac2026 train compare`
- 等等

- [ ] **Step 2: Commit**

```bash
git add README.md README.en.md
git commit -m "docs: update README with new command structure"
```

---

### Task 20: 全量验证

- [ ] **Step 1: 编译**

```bash
npm run build
```

- [ ] **Step 2: 所有命令 --help**

```bash
taac2026 --help
taac2026 train --help
taac2026 eval --help
```

验证所有子命令都列出来了。

- [ ] **Step 3: 运行已有测试**

```bash
node --test tests/output.test.mjs tests/auth.test.mjs
```

- [ ] **Step 4: 提交**

```bash
git add .
git commit -m "chore: final verification and cleanup"
```

---

## 迁移注意事项

1. **保持旧脚本可用**：在迁移期间，旧的 `.mjs` 脚本不删除，`bin/taac2026.mjs` 继续分发到旧脚本。全部迁移完成后再切换 bin 入口。
2. **行为一致性**：迁移后的命令应保持与旧脚本相同的输入/输出行为，包括参数名、输出格式、退出码。
3. **渐进式迁移**：每个命令先创建骨架（定义 options + 简单的 action），后续逐步填充完整逻辑。
4. **测试优先**：工具类模块（output, auth, format）必须有单元测试。命令类模块通过 `--help` 验证即可。
