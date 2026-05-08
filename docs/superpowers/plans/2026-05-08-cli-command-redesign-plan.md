# CLI Command Options Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign all CLI command options for consistency — global auth, unified naming, minimal surface.

**Architecture:** Introduce a shared `ensureCliAuth()` middleware that reads cookies from `.taac2026/secrets/taiji-cookie.txt`. Rewrite all command option definitions and remove dead code paths. Split `train list` into `list` + `describe` + `logs` + `metrics`.

**Tech Stack:** TypeScript, Commander.js, Node.js ESM

**Spec:** `docs/superpowers/specs/2026-05-08-cli-command-redesign-design.md`

---

## Chunk 1: Shared Auth Middleware + `login` refactor

### File Map

| Action | File | Purpose |
|--------|------|---------|
| Create | `src/cli/middleware.ts` | Shared auth middleware: `ensureCliAuth()` |
| Modify | `src/auth/token.ts:57-60` | Replace `ensureAuthenticated()` → calls middleware |
| Modify | `src/cli/commands/login.ts` | Simplify: remove --cookie-file, --headless, --out |

### Task 1: Create auth middleware

**Files:**
- Create: `src/cli/middleware.ts`

- [ ] **Step 1: Write the middleware**

```typescript
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
```

- [ ] **Step 2: Update `src/auth/token.ts` — replace `ensureAuthenticated`**

Replace lines 57-60 with:

```typescript
import { ensureCliAuth } from "../cli/middleware.js";

export async function ensureAuthenticated(_unused?: string): Promise<DirectClient> {
  const cookieHeader = await ensureCliAuth();
  return { directCookieHeader: cookieHeader };
}
```

This keeps backward compatibility for callers that pass `opts.cookieFile` (now ignored) while using global auth.

- [ ] **Step 3: Update `src/types.ts` — remove `SharedCliOptions`**

Remove the `SharedCliOptions` interface (lines 163-169). It's no longer needed since `cookieFile` and `direct` are removed from all commands.

- [ ] **Step 4: Commit**

```bash
git add src/cli/middleware.ts src/auth/token.ts src/types.ts
git commit -m "feat: add global auth middleware, replace ensureAuthenticated"
```

---

### Task 2: Refactor `login` command

**Files:**
- Modify: `src/cli/commands/login.ts`

- [ ] **Step 1: Refactor login.ts**

Remove `--cookie-file`, `--headless`, `--out` options. Remove `loginWithCookieFile` function. Hard-code output to `.taac2026/secrets/taiji-cookie.txt`.

The final command:

```typescript
import { Command } from "commander";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { parseCookieEntries } from "../../auth/token.js";

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

async function loginWithBrowser(headless: boolean, timeout: number) {
  const userDataDir = path.join(tmpdir(), `taac2026-login-${Date.now()}`);
  try {
    const browser = await chromium.launchPersistentContext(userDataDir, {
      headless,
      args: ["--disable-features=CookieDeprecationMessages"],
    });

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
    .description("Browser SSO login, save cookie to .taac2026/secrets/")
    .option("--timeout <ms>", "Login timeout in ms", (v) => parseInt(v, 10), 120000)
    .action(async (opts) => {
      await loginWithBrowser(false, opts.timeout);
    });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/cli/commands/login.ts
git commit -m "refactor(login): simplify to browser-only auth, save to .taac2026/secrets/"
```

---

### Task 3: Update tests for login and auth

**Files:**
- Modify: `tests/auth.test.mjs` (update cookie file path references)

- [ ] **Step 1: Read existing test, update if it references old paths**

Check if the test references `--cookie-file` or old paths. If so, update to use `.taac2026/secrets/taiji-cookie.txt`.

- [ ] **Step 2: Commit**

```bash
git add tests/auth.test.mjs
git commit -m "test: update auth tests for new cookie path"
```

---

## Chunk 2: `train prepare` refactor

### File Map

| Action | File | Purpose |
|--------|------|---------|
| Modify | `src/cli/commands/train/prepare.ts` | Rewrite options, remove --file/--file-dir/--message/--run/--allow-dirty |

### Task 4: Refactor `train prepare` command options

**Files:**
- Modify: `src/cli/commands/train/prepare.ts`

- [ ] **Step 1: Replace option definitions**

Current options (lines 126-138):
```typescript
.requiredOption("--template-job-url <url>", "Template job URL")
.requiredOption("--name <name>", "Job name")
.option("--zip <path>", "Code zip path")
.option("--config <path>", "Config YAML path")
.option("--run-sh <path>", "run.sh path")
.option("--file <path[=name]>", "Generic trainFile, repeatable", (v, prev) => [...prev, v], [])
.option("--file-dir <dir>", "Directory of trainFiles, repeatable", (v, prev) => [...prev, v], [])
.option("--description <text>", "Job description")
.option("--message <text>", "Local note")
.option("--run", "Mark run-after-submit", false)
.option("--out <dir>", "Output directory")
.option("--allow-dirty", "Skip git dirty warning", false)
```

Replace with:
```typescript
.requiredOption("--template-id <id>", "Template job URL or internal ID")
.requiredOption("--name <name>", "Job name")
.option("--zip <path>", "Path to code.zip")
.option("--config <path>", "Path to config.yaml")
.option("--run-sh <path>", "Path to run.sh")
.option("--description <text>", "Job description")
.option("--output <dir>", "Output directory (default: submit-bundle)")
```

- [ ] **Step 2: Remove `--file` and `--file-dir` processing**

Remove these functions and their usage:
- `parseGenericFileSpec` (lines 47-55) — delete entirely
- `collectFileDirSpecs` (lines 57-75) — delete entirely
- In the action handler (line 139+): remove `fileDirSpecs`, `genericFiles` logic
- Remove `genericFilesDir`, `copiedGenericFiles` from action
- Update the error check on line 154 to only require one of zip/config/run-sh:

```typescript
if (!codeZip && !config && !runSh) {
  throw new Error("No trainFiles prepared. Provide at least one of --zip, --config, or --run-sh.");
}
```

- Remove generic files from manifest (line 187).
- Remove generic files from `NEXT_STEPS.md` generation (line 102, 114).

- [ ] **Step 3: Remove `--message`, `--run`, `--allow-dirty` from action**

- Remove `opts.message` references from manifest (line 182)
- Remove `opts.run` → remove `runAfterSubmit` from manifest (line 181)
- Remove `opts.allowDirty` check (lines 157-159) and the `getGitInfo` dirty flag (keep git info for head/branch but remove dirty status)

- [ ] **Step 4: Update `--out` → `--output` in action**

Line 144: `opts.out` → `opts.output`

- [ ] **Step 5: Update `--template-job-url` → `--template-id`**

Line 180: `opts.templateJobUrl` → `opts.templateId`

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/train/prepare.ts
git commit -m "refactor(train prepare): slim options, remove generic files, rename --template-id"
```

---

## Chunk 3: `train submit` refactor

### File Map

| Action | File | Purpose |
|--------|------|---------|
| Modify | `src/cli/commands/train/submit.ts` | Rewrite options, remove generic file handling, change dry-run default |

### Task 5: Refactor `train submit` command options

**Files:**
- Modify: `src/cli/commands/train/submit.ts`

- [ ] **Step 1: Replace option definitions**

Replace lines 177-187:

```typescript
.requiredOption("--bundle <dir>", "Prepared bundle directory")
.option("--run", "Start job after creation", false)
.option("--yes", "Skip confirmation prompt", false)
.option("--dry-run", "Preview without uploading", false)
.option("--output <dir>", "Output directory for plan/result")
```

- [ ] **Step 2: Invert dry-run logic in action handler**

Current logic (lines 209, 222-228, 260-263):
- `mode: opts.execute ? "execute" : "dry-run"`
- `if (opts.execute && !opts.yes) throw new Error("--execute requires --yes")`
- `if (!opts.cookieFile)` → writes dry-run plan

Replace with:
- `mode: opts.dryRun ? "dry-run" : "execute"`
- `if (!opts.dryRun && !opts.yes) throw new Error("--dry-run is not set; add --yes to confirm live execution")`
- Remove the `!opts.cookieFile` early return — auth is now global
- Always write plan.json (both dry-run and execute)

- [ ] **Step 3: Remove `--cookie-file` usage**

Remove line 223-228 (`if (!opts.cookieFile)` block). Replace line 230-231:
```typescript
// OLD:
const client = await createDirectClient(opts.cookieFile);
const cookieHeader = extractCookieHeader(await readFile(opts.cookieFile, "utf8"));

// NEW:
const cookieHeader = await ensureCliAuth();
const client = { directCookieHeader: cookieHeader };
```

Add import at top:
```typescript
import { ensureCliAuth } from "../../../cli/middleware.js";
```

Remove `createDirectClient` import if no longer needed.

- [ ] **Step 4: Remove template-job-internal-id and template-job-url from action**

Remove line 179-180 options. The internal ID is now inferred from the bundle manifest only.
- Remove `opts.templateJobUrl` references (line 193)
- Keep using `inferInternalId(templateJobUrl)` from manifest only
- Remove `opts.templateJobInternalId` override (line 194)

- [ ] **Step 5: Remove name/description overrides**

Remove lines 181-182 options. Always read from manifest:
- Remove `opts.name` and `opts.description` references (lines 196-198)

- [ ] **Step 6: Remove `--allow-add-file`**

Remove option and `{ allowAddFile: opts.allowAddFile }` from `buildTaskPayload` call (line 254). Remove the `allowAddFile` field from the plan object (line 212).

- [ ] **Step 7: Update `--out` → `--output`**

Line 187, 191: `opts.out` → `opts.output`

- [ ] **Step 8: Commit**

```bash
git add src/cli/commands/train/submit.ts
git commit -m "refactor(train submit): default execute, remove auth/file options, use global auth"
```

---

## Chunk 4: `train list` refactor + `train describe` + `train logs` + `train metrics`

### File Map

| Action | File | Purpose |
|--------|------|---------|
| Modify | `src/cli/commands/train/list.ts` | Lightweight list only — remove detail/logs/metrics fetching |
| Create | `src/cli/commands/train/describe.ts` | New: single job detail + instances |
| Modify | `src/cli/commands/train/logs.ts` | Simplify: only logs, no auth options |
| Modify | `src/cli/commands/train/metrics.ts` | Simplify: only metrics, no auth options |
| Modify | `src/cli/commands/train/index.ts` | Register describe command |

### Task 6: Refactor `train list` to lightweight only

**Files:**
- Modify: `src/cli/commands/train/list.ts`

- [ ] **Step 1: Replace option definitions**

Replace lines 53-61:
```typescript
.option("--headless", "Headless browser mode (for CI/CD)")
.option("--incremental", "Skip unchanged terminal jobs")
.option("--page-size <n>", "Page size", (v) => parseInt(v, 10))
.option("--output <dir>", "Output directory (default: taiji-output)")
.option("--timeout <ms>", "Browser timeout in ms", (v) => parseInt(v, 10))
```

- [ ] **Step 2: Remove detail/logs/metrics fetching from action**

The current `runScrape` function (lines 89-240) fetches job detail, instances, logs, and metrics for each job. Simplify it to:
- Fetch only the job list (line 99: `fetchTrainingJobs`)
- Write `jobs.json` with only the listed job data (no deep fetch)
- Write `jobs-summary.csv` with list-level data
- Remove: `fetchJobDetail`, `fetchJobInstances`, `fetchInstanceOutput`, `fetchInstanceLog` calls
- Remove: `all-metrics-long.csv` and `all-checkpoints.csv` output
- Remove: `readJsonIfExists` incremental sync logic (lines 41-47, 96-97, 113-125)
  - Keep `--incremental` but for now make it skip duplicate jobs by taskID

- [ ] **Step 3: Remove auth-related options from action**

- Remove `opts.direct` branch (lines 70-75)
- Remove `createBrowserContext`, `addCookiesToBrowser` imports and usage
- Keep browser mode for list (it navigates to the page and scrapes)
- Remove `createDirectClient` import if unused

- [ ] **Step 4: Update `--out` → `--output`**

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/train/list.ts
git commit -m "refactor(train list): lightweight list only, remove detail/logs/metrics"
```

---

### Task 7: Create `train describe` command

**Files:**
- Create: `src/cli/commands/train/describe.ts`
- Modify: `src/cli/commands/train/index.ts`

- [ ] **Step 1: Create `src/cli/commands/train/describe.ts`**

Extract the per-job detail fetching logic from the current `list.ts` `runScrape` function (lines 109-195). The new command:

```typescript
import { Command } from "commander";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureCliAuth } from "../../../cli/middleware.js";
import { fetchJobDetail, fetchJobInstances, fetchInstanceOutput, fetchInstanceLog } from "../../../api/training.js";
import { resolveTaijiOutputDir } from "../../../utils/output.js";
import { normalizeLogLines, toCsv } from "../../../utils/format.js";

const AUTH_WAIT_MS = 180_000;

export function registerTrainDescribeCommand(trainCmd: Command) {
  trainCmd
    .command("describe")
    .description("Fetch full details of a single training job")
    .requiredOption("--job-id <id>", "Job internal ID")
    .option("--output <dir>", "Output directory (default: taiji-output)")
    .action(async (opts) => {
      const outDir = resolveTaijiOutputDir(opts.output ?? "taiji-output");
      const cookieHeader = await ensureCliAuth();
      const client = { directCookieHeader: cookieHeader };
      const jobId = opts.jobId;

      // Fetch job detail
      const jobDetail = await fetchJobDetail(client, jobId, AUTH_WAIT_MS);

      // Fetch instances
      const instances = await fetchJobInstances(client, jobId, 100, AUTH_WAIT_MS);
      console.log(`Job ${jobId}: ${instances.length} instances`);

      const instancesById: Record<string, unknown> = {};
      const metricRows: any[] = [];
      const checkpointRows: any[] = [];

      for (const instance of instances) {
        const instanceId = instance.id;
        if (!instanceId) continue;

        try {
          const [output, logResponse] = await Promise.all([
            fetchInstanceOutput(client, instanceId, AUTH_WAIT_MS),
            fetchInstanceLog(client, instanceId, AUTH_WAIT_MS),
          ]);
          const logDir = path.join(outDir, "logs", jobId);
          await mkdir(logDir, { recursive: true });
          const lines = normalizeLogLines(logResponse);
          await writeFile(path.join(logDir, `${instanceId}.json`), JSON.stringify(logResponse, null, 2), "utf8");
          await writeFile(path.join(logDir, `${instanceId}.txt`), lines.join("\n"), "utf8");

          instancesById[instanceId] = {
            instanceId,
            rawInstance: instance,
            ...output,
            log: { path: `logs/${jobId}/${instanceId}.txt`, lines: lines.length },
            error: null,
          };

          // Collect metrics and checkpoints
          for (const [metricName, metricPayload] of Object.entries((output as any).metrics ?? {})) {
            const rows = normalizeMetricRowsForExport(metricName, metricPayload);
            for (const row of rows) {
              metricRows.push({ jobId, instanceId, ...row });
            }
          }
          const ckpts = Array.isArray((output as any).checkpoints) ? (output as any).checkpoints : [];
          for (const ckpt of ckpts) {
            checkpointRows.push({
              jobId, instanceId,
              ckpt: ckpt.ckpt, ckptFileSize: ckpt.ckpt_file_size,
              createTime: ckpt.create_time, deleteTime: ckpt.deleteTime, status: ckpt.status,
            });
          }

          const metricCount = Object.keys((output as any).metrics ?? {}).length;
          console.log(`  Instance ${instanceId}: ${metricCount} metrics, ${lines.length} log lines`);
        } catch (error) {
          instancesById[instanceId] = {
            instanceId,
            rawInstance: instance,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }

      // Write output
      await mkdir(outDir, { recursive: true });
      await writeFile(path.join(outDir, `job-${jobId}.json`), JSON.stringify({
        jobId, jobDetail, instancesById,
        fetchedAt: new Date().toISOString(),
      }, null, 2), "utf8");

      if (metricRows.length) {
        await writeFile(path.join(outDir, `job-${jobId}-metrics.csv`), toCsv(metricRows), "utf8");
      }
      if (checkpointRows.length) {
        await writeFile(path.join(outDir, `job-${jobId}-checkpoints.csv`), toCsv(checkpointRows), "utf8");
      }

      console.log(`Saved job ${jobId} details to ${outDir}`);
    });
}

function normalizeMetricRowsForExport(metricName: string, payload: unknown): any[] {
  if (!payload) return [];
  const arr = Array.isArray(payload) ? payload : [payload];
  return arr.flatMap((p: any, i: number) => {
    const dates = Array.isArray(p?.date) ? p.date : [];
    const titles = Array.isArray(p?.title) ? p.title : [];
    const values = Array.isArray(p?.value) ? p.value : [];
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

- [ ] **Step 2: Register in `src/cli/commands/train/index.ts`**

Add:
```typescript
import { registerTrainDescribeCommand } from "./describe.js";
```
And in `registerTrainCommand`:
```typescript
registerTrainDescribeCommand(trainCmd);
```

- [ ] **Step 3: Commit**

```bash
git add src/cli/commands/train/describe.ts src/cli/commands/train/index.ts
git commit -m "feat: add train describe command for single job detail fetch"
```

---

### Task 8: Refactor `train logs` command

**Files:**
- Modify: `src/cli/commands/train/logs.ts`

- [ ] **Step 1: Replace option definitions**

Replace lines 13-19:
```typescript
.requiredOption("--job-id <id>", "Job internal ID")
.option("--output <dir>", "Output directory (default: taiji-output)")
```

- [ ] **Step 2: Update action handler**

- Replace `ensureAuthenticated(opts.cookieFile)` → `ensureCliAuth()`
- Remove `opts.direct` check
- Remove `--errors`, `--tail`, `--json` references
- Update `opts.out` → `opts.output`
- Rename `opts.job` → `opts.jobId`

Final action:
```typescript
.action(async (opts) => {
  const outDir = resolveTaijiOutputDir(opts.output ?? "taiji-output");
  const cookieHeader = await ensureCliAuth();
  const client = { directCookieHeader: cookieHeader };

  const logDir = path.join(outDir, "logs", opts.jobId);
  await mkdir(logDir, { recursive: true });

  const instances = await fetchJobInstances(client, opts.jobId, 100);
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
})
```

- [ ] **Step 3: Update imports**

```typescript
import { ensureCliAuth } from "../../../cli/middleware.js";
// Remove: ensureAuthenticated import
```

- [ ] **Step 4: Commit**

```bash
git add src/cli/commands/train/logs.ts
git commit -m "refactor(train logs): use global auth, remove dead options"
```

---

### Task 9: Refactor `train metrics` command

**Files:**
- Modify: `src/cli/commands/train/metrics.ts`

- [ ] **Step 1: Replace option definitions**

Replace lines 13-17:
```typescript
.requiredOption("--job-id <id>", "Job internal ID")
.option("--json", "Output JSON to stdout instead of CSV file")
.option("--output <dir>", "Output directory (default: taiji-output)")
```

- [ ] **Step 2: Update action handler**

- Replace `ensureAuthenticated(opts.cookieFile)` → `ensureCliAuth()`
- Remove `opts.direct` check
- Update `opts.job` → `opts.jobId`
- Update `opts.out` → `opts.output`

- [ ] **Step 3: Update imports**

```typescript
import { ensureCliAuth } from "../../../cli/middleware.js";
```

- [ ] **Step 4: Commit**

```bash
git add src/cli/commands/train/metrics.ts
git commit -m "refactor(train metrics): use global auth, rename --job-id"
```

---

### Task 10: Register describe in train index

**Files:**
- Modify: `src/cli/commands/train/index.ts` (already done in Task 7)

Already covered. Verify the final index.ts:

```typescript
import { Command } from "commander";
import { registerTrainListCommand } from "./list.js";
import { registerTrainDescribeCommand } from "./describe.js";
import { registerTrainLogsCommand } from "./logs.js";
import { registerTrainMetricsCommand } from "./metrics.js";
import { registerTrainStopCommand } from "./stop.js";
import { registerTrainDeleteCommand } from "./delete.js";
import { registerTrainPrepareCommand } from "./prepare.js";
import { registerTrainSubmitCommand } from "./submit.js";

export function registerTrainCommand(program: Command) {
  const trainCmd = program.command("train").description("Manage training tasks");
  registerTrainPrepareCommand(trainCmd);
  registerTrainSubmitCommand(trainCmd);
  registerTrainListCommand(trainCmd);
  registerTrainDescribeCommand(trainCmd);
  registerTrainLogsCommand(trainCmd);
  registerTrainMetricsCommand(trainCmd);
  registerTrainStopCommand(trainCmd);
  registerTrainDeleteCommand(trainCmd);
}
```

---

## Chunk 5: `train stop/delete` refactor

### Task 11: Refactor `train stop`

**Files:**
- Modify: `src/cli/commands/train/stop.ts`

- [ ] **Step 1: Remove `--cookie-file`, update auth**

```typescript
import { Command } from "commander";
import { ensureCliAuth } from "../../../cli/middleware.js";
import { fetchJson } from "../../../api/client.js";

export function registerTrainStopCommand(trainCmd: Command) {
  trainCmd
    .command("stop")
    .description("Stop a training job")
    .requiredOption("--job-id <id>", "Job internal ID to stop")
    .action(async (opts) => {
      const cookieHeader = await ensureCliAuth();
      const client = { directCookieHeader: cookieHeader };
      const jobId = opts.jobId;
      console.log(`Stopping job ${jobId}…`);
      try {
        const response = await fetchJson(client, `/taskmanagement/api/v1/webtasks/external/task/${jobId}/stop`, {
          method: "POST",
        });
        console.log(`Job ${jobId} stopped:`, JSON.stringify(response, null, 2));
      } catch (error) {
        console.error(`Failed to stop job ${jobId}:`, (error as Error).message);
        process.exitCode = 1;
      }
    });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/cli/commands/train/stop.ts
git commit -m "refactor(train stop): use global auth"
```

---

### Task 12: Refactor `train delete`

**Files:**
- Modify: `src/cli/commands/train/delete.ts`

- [ ] **Step 1: Remove `--cookie-file`, update auth**

```typescript
import { Command } from "commander";
import { ensureCliAuth } from "../../../cli/middleware.js";
import { fetchJson } from "../../../api/client.js";

export function registerTrainDeleteCommand(trainCmd: Command) {
  trainCmd
    .command("delete")
    .description("Delete a training job")
    .requiredOption("--job-id <id>", "Job internal ID to delete")
    .option("--yes", "Skip confirmation prompt", false)
    .action(async (opts) => {
      const cookieHeader = await ensureCliAuth();
      const client = { directCookieHeader: cookieHeader };
      const jobId = opts.jobId;

      if (!opts.yes) {
        process.stdout.write(`Are you sure you want to delete job ${jobId}? [y/N] `);
        const answer = await new Promise<string>((resolve) => {
          process.stdin.once("data", (data) => resolve(data.toString().trim().toLowerCase()));
          setTimeout(() => resolve("n"), 10000);
        });
        if (answer !== "y" && answer !== "yes") {
          console.log("Cancelled.");
          return;
        }
      }

      console.log(`Deleting job ${jobId}…`);
      try {
        const response = await fetchJson(client, `/taskmanagement/api/v1/webtasks/external/task/${jobId}`, {
          method: "DELETE",
        });
        console.log(`Job ${jobId} deleted:`, JSON.stringify(response, null, 2));
      } catch (error) {
        console.error(`Failed to delete job ${jobId}:`, (error as Error).message);
        process.exitCode = 1;
      }
    });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/cli/commands/train/delete.ts
git commit -m "refactor(train delete): use global auth"
```

---

## Chunk 6: `eval` commands refactor

### File Map

| Action | File | Purpose |
|--------|------|---------|
| Modify | `src/cli/commands/eval/create.ts` | Remove auth options (skeleton) |
| Modify | `src/cli/commands/eval/list.ts` | Remove auth options |
| Modify | `src/cli/commands/eval/logs.ts` | Remove auth options |
| Modify | `src/cli/commands/eval/metrics.ts` | Remove auth options |

### Task 13: Refactor all eval commands

**Files:**
- Modify: `src/cli/commands/eval/create.ts`
- Modify: `src/cli/commands/eval/list.ts`
- Modify: `src/cli/commands/eval/logs.ts`
- Modify: `src/cli/commands/eval/metrics.ts`

- [ ] **Step 1: `eval/create.ts`**

Remove `--cookie-file` and `--direct` options. Keep skeleton.

```typescript
import { Command } from "commander";

export function registerEvalCreateCommand(evalCmd: Command) {
  evalCmd
    .command("create")
    .description("Create an evaluation task (not yet implemented)")
    .action(async () => {
      console.log("Create evaluation task — not yet implemented");
    });
}
```

- [ ] **Step 2: `eval/list.ts`**

Remove `--cookie-file`, `--direct`. Update `--out` → `--output`.

```typescript
import { Command } from "commander";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureCliAuth } from "../../../cli/middleware.js";
import { fetchEvaluationTasks, fetchEvaluationLog } from "../../../api/evaluation.js";
import { resolveTaijiOutputDir } from "../../../utils/output.js";
import { toCsv } from "../../../utils/format.js";

export function registerEvalListCommand(evalCmd: Command) {
  evalCmd
    .command("list")
    .description("Scrape evaluation task list")
    .option("--page-size <n>", "Page size", (v) => parseInt(v, 10))
    .option("--output <dir>", "Output directory (default: taiji-output)")
    .action(async (opts) => {
      const outDir = resolveTaijiOutputDir(opts.output ?? "taiji-output");
      const cookieHeader = await ensureCliAuth();
      const client = { directCookieHeader: cookieHeader };
      // ... rest of the action unchanged, just remove direct check
    });
}
```

Remove the `if (!opts.direct) throw new Error("--direct is required for now");` check.

- [ ] **Step 3: `eval/logs.ts`**

Remove `--cookie-file`, `--direct`. Update `--out` → `--output`.

```typescript
import { Command } from "commander";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureCliAuth } from "../../../cli/middleware.js";
import { fetchEvaluationLog } from "../../../api/evaluation.js";
import { resolveTaijiOutputDir } from "../../../utils/output.js";

export function registerEvalLogsCommand(evalCmd: Command) {
  evalCmd
    .command("logs")
    .description("View evaluation task logs")
    .requiredOption("--task-id <id>", "Evaluation task ID")
    .option("--output <dir>", "Output directory (default: taiji-output)")
    .action(async (opts) => {
      const outDir = resolveTaijiOutputDir(opts.output ?? "taiji-output");
      const cookieHeader = await ensureCliAuth();
      const client = { directCookieHeader: cookieHeader };
      // ... rest unchanged
    });
}
```

- [ ] **Step 4: `eval/metrics.ts`**

Remove `--cookie-file`, `--direct`.

```typescript
import { Command } from "commander";
import { ensureCliAuth } from "../../../cli/middleware.js";
import { fetchEvaluationTasks } from "../../../api/evaluation.js";

export function registerEvalMetricsCommand(evalCmd: Command) {
  evalCmd
    .command("metrics")
    .description("View evaluation task metrics")
    .requiredOption("--task-id <id>", "Evaluation task ID")
    .option("--json", "Output JSON to stdout")
    .action(async (opts) => {
      const cookieHeader = await ensureCliAuth();
      const client = { directCookieHeader: cookieHeader };
      // ... rest unchanged, remove direct check
    });
}
```

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/eval/create.ts src/cli/commands/eval/list.ts src/cli/commands/eval/logs.ts src/cli/commands/eval/metrics.ts
git commit -m "refactor(eval commands): use global auth, remove dead options"
```

---

## Chunk 7: Tests + build verification

### Task 14: Update CLI tests

**Files:**
- Modify: `tests/cli.test.mjs` (at `scripts/tests/cli.test.mjs`)

- [ ] **Step 1: Update tests to match new options**

The current tests check for old option names. Update:

```javascript
test("taac2026 train prints subcommand list", async () => {
  const { stdout } = await execFileAsync(process.execPath, [cliPath, "train", "--help"], { cwd: toolDir });

  assert.match(stdout, /prepare/);
  assert.match(stdout, /submit/);
  assert.match(stdout, /list/);
  assert.match(stdout, /describe/);  // NEW
  assert.match(stdout, /logs/);
  assert.match(stdout, /metrics/);
  assert.match(stdout, /stop/);
  assert.match(stdout, /delete/);
});

test("taac2026 train prepare help includes expected options", async () => {
  const { stdout } = await execFileAsync(process.execPath, [cliPath, "train", "prepare", "--help"], { cwd: toolDir });

  assert.match(stdout, /--template-id/);
  assert.match(stdout, /--name/);
  assert.notMatch(stdout, /--file-dir/);   // REMOVED
  assert.notMatch(stdout, /--file </);     // REMOVED
});

test("taac2026 train submit help includes expected options", async () => {
  const { stdout } = await execFileAsync(process.execPath, [cliPath, "train", "submit", "--help"], { cwd: toolDir });

  assert.match(stdout, /--bundle/);
  assert.match(stdout, /--dry-run/);       // NEW
  assert.match(stdout, /--yes/);
  assert.notMatch(stdout, /--execute/);    // REMOVED
  assert.notMatch(stdout, /--cookie-file/); // REMOVED
});

test("taac2026 train describe help includes --job-id", async () => {
  const { stdout } = await execFileAsync(process.execPath, [cliPath, "train", "describe", "--help"], { cwd: toolDir });

  assert.match(stdout, /--job-id/);
});

test("taac2026 train stop help includes --job-id", async () => {
  const { stdout } = await execFileAsync(process.execPath, [cliPath, "train", "stop", "--help"], { cwd: toolDir });

  assert.match(stdout, /--job-id/);
  assert.notMatch(stdout, /--cookie-file/);
});

test("taac2026 login help has only --timeout", async () => {
  const { stdout } = await execFileAsync(process.execPath, [cliPath, "login", "--help"], { cwd: toolDir });

  assert.match(stdout, /--timeout/);
  assert.notMatch(stdout, /--cookie-file/);
  assert.notMatch(stdout, /--headless/);
  assert.notMatch(stdout, /--out/);
});
```

- [ ] **Step 2: Build and run tests**

```bash
npm run build
npm test
```

Expected: all tests pass

- [ ] **Step 3: Verify CLI help output**

```bash
npm run build
npm run cli -- --help
npm run cli -- train --help
npm run cli -- train prepare --help
npm run cli -- train submit --help
npm run cli -- train list --help
npm run cli -- train describe --help
npm run cli -- train logs --help
npm run cli -- train metrics --help
npm run cli -- eval --help
```

Verify each matches the spec.

- [ ] **Step 4: Final commit**

```bash
git add scripts/tests/cli.test.mjs
git commit -m "test: update CLI tests for new command structure"
```

---

## Chunk 8: Submit `--dry-run` default behavior correction

### Task 15: Correct the submit --dry-run default

The spec says default should be **execute** (not dry-run), but `--yes` is still required for safety. This means:

- Without any flags: errors out asking for `--yes` or `--dry-run`
- With `--dry-run`: shows plan, no upload
- With `--yes`: executes live

- [ ] **Step 1: Update submit action to handle the case where neither --yes nor --dry-run is set**

```typescript
if (!opts.dryRun && !opts.yes) {
  console.log("This will create a live job. Use --dry-run to preview, or --yes to confirm.");
  process.exit(1);
}
```

This is already covered in Task 5 step 2.

- [ ] **Step 2: Commit**

Already covered in Task 5 commit.

---

## Verification Checklist

After all chunks:

1. `npm run build` — compiles without errors
2. `npm test` — all tests pass
3. `taac2026 --help` — shows login, train, eval
4. `taac2026 train --help` — shows prepare, submit, list, describe, logs, metrics, stop, delete
5. `taac2026 eval --help` — shows list, logs, metrics, create
6. No remaining references to `--cookie-file`, `--direct`, `--execute`, `--file`, `--file-dir`, `--message`, `--run` (in prepare), `--allow-dirty`
7. All `--out` replaced with `--output`
8. No TypeScript compilation errors
9. No unused imports (verify with `npm run build` output)
