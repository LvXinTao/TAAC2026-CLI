# Eval Prepare & Submit Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `eval prepare` and `eval submit` commands mirroring the existing `train prepare` / `train submit` workflow.

**Architecture:** Two new command files in `src/cli/commands/eval/`. Eval prepare scans a source directory, copies files, and creates a bundle manifest. Eval submit reads the bundle, uploads files to COS, and creates an evaluation task via the Taiji API.

**Tech Stack:** TypeScript, commander.js, Node.js fs/promises, native fetch, cos-nodejs-sdk-v5

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `src/cli/commands/eval/prepare.ts` | Scan source dir, copy files, create manifest + NEXT_STEPS.md |
| Create | `src/cli/commands/eval/submit.ts` | Read bundle, upload to COS, POST create evaluation task |
| Modify | `src/cli/commands/eval/index.ts` | Register the two new commands |
| Modify | `src/api/evaluation.ts` | Add `fetchEvaluationTemplate()` function |

## Design Decisions

- **File scan patterns**: Same as train prepare (`.py`, `.sh`, `.json`, `.yaml`, etc.) but **no `inference/` subdirectory scan** (eval is inference-focused, all files are at top level)
- **Primary files for eval**: `run.sh`, `infer.py`, `model.py`, `dataset.py`
- **API client strategy**: Eval submit uses **inline `fetchJson`** (like train submit), not the higher-level `fetchJson` from `src/api/client.ts`, because COS uploads require raw fetch access
- **Output directories**: `eval-bundle` for prepare, `eval-submit-live/<timestamp>/` for submit (both under `taiji-output/`)

---

## Chunk 1: eval prepare

### Task 1: Create `src/cli/commands/eval/prepare.ts`

- [ ] **Step 1: Write `eval prepare.ts`**

Create `src/cli/commands/eval/prepare.ts` with this content:

```typescript
import { Command } from "commander";
import { access, copyFile, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { resolveTaijiOutputDir } from "../../../utils/output.js";

const execFileAsync = promisify(execFile);

// File patterns to include when scanning a source directory
const EVAL_FILE_PATTERNS = [
  /\.py$/,       // Python files
  /\.sh$/,       // Shell scripts
  /\.json$/,     // Config JSON
  /\.yaml$/,     // YAML configs
  /\.yml$/,
  /\.toml$/,
  /\.txt$/,
  /\.cfg$/,
  /\.ini$/,
];

// Files that should always be treated as primary
const PRIMARY_FILES = new Set(["run.sh", "infer.py", "model.py", "dataset.py"]);

async function exists(p: string) {
  try { await access(p); return true; } catch { return false; }
}

async function runGit(args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", args, { timeout: 10000 });
    return stdout.trim();
  } catch { return null; }
}

async function getGitInfo() {
  const root = await runGit(["rev-parse", "--show-toplevel"]);
  if (!root) return { available: false };
  const [head, branch, statusShort] = await Promise.all([
    runGit(["rev-parse", "HEAD"]),
    runGit(["branch", "--show-current"]),
    runGit(["status", "--short"]),
  ]);
  return {
    available: true, root, branch, head,
    dirty: Boolean(statusShort), statusShort: statusShort || "",
  };
}

async function scanDir(srcDir: string): Promise<string[]> {
  const entries = await readdir(srcDir);
  const files: string[] = [];
  for (const entry of entries) {
    const fp = path.join(srcDir, entry);
    const s = await stat(fp);
    if (s.isDirectory()) {
      // Include all subdirectories (eval code may be organized in subdirs)
      const subFiles = await scanDir(fp);
      files.push(...subFiles);
    } else if (EVAL_FILE_PATTERNS.some((pat) => pat.test(entry))) {
      files.push(fp);
    }
  }
  return files;
}

async function fileInfo(fp: string) {
  const s = await stat(fp);
  return { path: fp, basename: path.basename(fp), bytes: s.size, mtime: s.mtime.toISOString() };
}

function makeNextSteps(manifest: Record<string, unknown>) {
  const files = manifest.files as Array<Record<string, unknown>>;
  const lines = [
    "# Taiji Eval Submit Next Steps", "",
    "This directory was prepared by `taac2026 eval prepare`.", "",
    "## Intended live workflow", "",
    "1. Run `taac2026 eval submit --bundle <dir> --mould-id <id> --yes` to upload and create the eval task.", "",
    "## Prepared values", "",
    `- Job Name: ${(manifest.job as Record<string, string>).name}`,
    `- Job Description: ${(manifest.job as Record<string, string>).description || ""}`,
    `- Files: ${files.map((f) => f.name).join(", ")}`, "",
    "## Automation note", "",
    "The submit command uploads files to COS and creates a new evaluation task via API.", "",
  ];
  return `${lines.join("\n")}\n`;
}

export function registerEvalPrepareCommand(evalCmd: Command) {
  evalCmd
    .command("prepare")
    .description("Prepare a submission bundle from a source directory")
    .requiredOption("--name <name>", "Job name")
    .requiredOption("--source <dir>", "Source directory containing eval code")
    .option("--include <patterns>", "Comma-separated glob patterns to include (e.g. '*.py,*.sh')")
    .option("--exclude <patterns>", "Comma-separated patterns to exclude (e.g. '__pycache__',*.pyc)")
    .option("--description <text>", "Job description")
    .option("--output <dir>", "Output directory (default: eval-bundle)")
    .action(async (opts) => {
      const srcDir = path.resolve(opts.source);
      if (!(await exists(srcDir))) throw new Error(`Source directory not found: ${srcDir}`);

      const outDir = resolveTaijiOutputDir(opts.output ?? "eval-bundle");
      const filesDir = path.join(outDir, "files");

      // Parse exclude patterns
      const excludePatterns = opts.exclude
        ? opts.exclude.split(",").map((p: string) => p.trim())
        : ["__pycache__", "*.pyc", "*.egg-info", ".git", ".DS_Store"];

      const scanFiles = await scanDir(srcDir);

      // Filter out excluded patterns
      const filteredFiles = scanFiles.filter((fp) => {
        const rel = path.relative(srcDir, fp);
        return !excludePatterns.some((pat: string) => rel.includes(pat) || rel.endsWith(pat));
      });

      if (filteredFiles.length === 0) {
        throw new Error("No source files found. Check the source directory or --exclude patterns.");
      }

      const git = await getGitInfo();
      await mkdir(filesDir, { recursive: true });

      // Copy files preserving relative paths
      const fileEntries: Array<Record<string, unknown>> = [];
      for (const srcFile of filteredFiles) {
        const relPath = path.relative(srcDir, srcFile);
        const destPath = path.join(filesDir, relPath);
        await mkdir(path.dirname(destPath), { recursive: true });
        await copyFile(srcFile, destPath);
        fileEntries.push({
          name: relPath,
          preparedPath: path.relative(outDir, destPath).replaceAll(path.sep, "/"),
          isPrimary: PRIMARY_FILES.has(relPath) ? "true" : "false",
          ...(await fileInfo(srcFile)),
        });
      }

      const manifest = {
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        sourceDir: opts.source,
        job: { name: opts.name, description: opts.description || "" },
        files: fileEntries,
        git,
      };

      await writeFile(path.join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      await writeFile(path.join(outDir, "NEXT_STEPS.md"), makeNextSteps(manifest), "utf8");

      console.log(`Prepared Taiji eval submission bundle: ${outDir}`);
      console.log(`  ${fileEntries.length} files copied to files/`);
      console.log(`  Manifest: ${path.join(outDir, "manifest.json")}`);
      console.log(`  Next steps: ${path.join(outDir, "NEXT_STEPS.md")}`);
    });
}
```

- [ ] **Step 2: Register command in `src/cli/commands/eval/index.ts`**

Modify `src/cli/commands/eval/index.ts`:

```typescript
import { Command } from "commander";
import { registerEvalCreateCommand } from "./create.js";
import { registerEvalListCommand } from "./list.js";
import { registerEvalLogsCommand } from "./logs.js";
import { registerEvalMetricsCommand } from "./metrics.js";
import { registerEvalPrepareCommand } from "./prepare.js";
import { registerEvalSubmitCommand } from "./submit.js";

export function registerEvalCommand(program: Command) {
  const evalCmd = program.command("eval").description("Manage evaluation tasks. Typical workflow: prepare -> submit");
  registerEvalPrepareCommand(evalCmd);
  registerEvalSubmitCommand(evalCmd);
  registerEvalCreateCommand(evalCmd);
  registerEvalListCommand(evalCmd);
  registerEvalLogsCommand(evalCmd);
  registerEvalMetricsCommand(evalCmd);
}
```

- [ ] **Step 3: Build and verify**

Run: `npm run build`
Expected: No errors. `eval prepare` should now appear in `taac2026 eval --help`.

Verify: `npm run dev -- eval --help` should show `prepare` as a subcommand.
Verify: `npm run dev -- eval prepare --help` should show the expected options.

- [ ] **Step 4: Test eval prepare manually**

Create a test directory with a few `.py` files and run:
```bash
npm run dev -- eval prepare --name "test-eval" --source /path/to/test-dir
```

Expected: Creates `taiji-output/eval-bundle/` with `manifest.json`, `files/`, and `NEXT_STEPS.md`.

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/eval/prepare.ts src/cli/commands/eval/index.ts
git commit -m "feat: add eval prepare command"
```

---

## Chunk 2: eval submit

### Task 1: Add `fetchEvaluationTemplate` to `src/api/evaluation.ts`

- [ ] **Step 1: Add API function**

Append to `src/api/evaluation.ts`:

```typescript
export async function fetchEvaluationTemplate(
  client: unknown,
  authWaitMs?: number,
): Promise<Record<string, unknown>> {
  return fetchJson(client, "/aide/api/evaluation_tasks/get_template/", {
    authWaitMs,
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/api/evaluation.ts
git commit -m "feat: add fetchEvaluationTemplate API function"
```

### Task 2: Create `src/cli/commands/eval/submit.ts`

- [ ] **Step 1: Write `eval submit.ts`**

Create `src/cli/commands/eval/submit.ts` with this content:

```typescript
import { Command } from "commander";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { ensureCliAuth } from "../../../cli/middleware.js";
import { resolveTaijiOutputDir } from "../../../utils/output.js";

const require = createRequire(import.meta.url);
const COS = require("cos-nodejs-sdk-v5");

const BUCKET = "hunyuan-external-1258344706";
const REGION = "ap-guangzhou";
const TAIJI_ORIGIN = "https://taiji.algo.qq.com";

function taijiHeaders(cookieHeader: string, referer = "/evaluation/create") {
  return {
    accept: "application/json, text/plain, */*",
    "content-type": "application/json",
    cookie: cookieHeader,
    referer: `${TAIJI_ORIGIN}${referer}`,
    "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147 Safari/537.36",
  };
}

async function fetchJson(cookieHeader: string, endpoint: string, options?: { method?: string; body?: unknown }) {
  const url = new URL(endpoint, TAIJI_ORIGIN);
  const init: Record<string, unknown> = { method: options?.method || "GET", headers: taijiHeaders(cookieHeader) };
  if (options?.body !== undefined) init.body = JSON.stringify(options.body);
  const response = await fetch(url.href, init as RequestInit);
  const text = await response.text();
  let body: unknown;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!response.ok) throw new Error(`HTTP ${response.status} ${url.pathname}: ${String(text).slice(0, 300)}`);
  return body as Record<string, unknown>;
}

async function loadBundle(bundleDir: string) {
  const manifest = JSON.parse(await readFile(path.join(bundleDir, "manifest.json"), "utf8")) as Record<string, unknown>;
  const files = manifest.files as Array<Record<string, string>> | undefined;
  if (!files || !Array.isArray(files)) {
    throw new Error("Invalid manifest: expected 'files' to be an array. Re-run `prepare` with the updated version.");
  }
  const entries = files.map((f) => ({
    name: f.name,
    localPath: path.resolve(bundleDir, f.preparedPath),
    isPrimary: f.isPrimary === "true",
  }));
  return { manifest, files: entries };
}

function formatTaijiTime(date = new Date()): string {
  const utc = date.getTime() + date.getTimezoneOffset() * 60_000;
  const bj = new Date(utc + 8 * 60 * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${bj.getFullYear()}-${pad(bj.getMonth() + 1)}-${pad(bj.getDate())} ${pad(bj.getHours())}:${pad(bj.getMinutes())}:${pad(bj.getSeconds())}`;
}

function newCosKey(prefix: string, filename: string): string {
  return `${prefix}/eval/local--${randomUUID().replaceAll("-", "")}/${filename}`;
}

async function getFederationToken(cookieHeader: string) {
  const token = await fetchJson(cookieHeader, "/aide/api/evaluation_tasks/get_federation_token/");
  for (const key of ["id", "key", "Token"]) {
    if (!token?.[key]) throw new Error(`Federation token missing: ${key}`);
  }
  return token as Record<string, string>;
}

function putObject(cos: InstanceType<typeof COS>, params: Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    cos.putObject(params, (error: Error | null, data: Record<string, unknown>) => {
      if (error) reject(error);
      else resolve(data);
    });
  });
}

async function uploadToCos(cookieHeader: string, localPath: string, key: string) {
  const token = await getFederationToken(cookieHeader);
  const s = await stat(localPath);
  const cos = new COS({
    SecretId: token.id, SecretKey: token.key, SecurityToken: token.Token,
  });
  await putObject(cos, {
    Bucket: BUCKET, Region: REGION, Key: key,
    Body: createReadStream(localPath), ContentLength: s.size,
  });
  return { key, bytes: s.size };
}

function safeResult(result: unknown): unknown {
  return JSON.parse(JSON.stringify(result, (key, value) => {
    if (/cookie|token|secret|credential|authorization|signature/i.test(key)) return "<redacted>";
    return value;
  }));
}

export function registerEvalSubmitCommand(evalCmd: Command) {
  evalCmd
    .command("submit")
    .description("Upload bundle to COS and create a new evaluation task")
    .requiredOption("--bundle <dir>", "Prepared bundle directory")
    .requiredOption("--mould-id <id>", "Mould/Model ID for evaluation")
    .option("--yes", "Skip confirmation prompt", false)
    .option("--dry-run", "Preview without uploading", false)
    .option("--output <dir>", "Output directory for plan/result")
    .action(async (opts) => {
      const bundleDir = path.resolve(opts.bundle);
      const defaultOut = path.join("taiji-output", "eval-submit-live", new Date().toISOString().replace(/[:.]/g, "-"));
      const outDir = resolveTaijiOutputDir(opts.output ?? defaultOut);
      const { manifest, files: bundleFiles } = await loadBundle(bundleDir);

      // Job name/description from manifest
      const jobRecord = (manifest.job as Record<string, string> | undefined) ?? {};
      if (!jobRecord.name) throw new Error("Missing job.name in bundle manifest. Run `prepare` again with a valid `--name`.");
      const job = { name: jobRecord.name, description: jobRecord.description ?? "" };

      // Auth
      const cookieHeader = await ensureCliAuth();

      // Fetch template defaults (creator, image_name)
      const template = await fetchJson(cookieHeader, "/aide/api/evaluation_tasks/get_template/");
      // Response may be { data: {...} } or direct object
      const templateData = (template.data as Record<string, unknown> | undefined) ?? template;
      const creator = (templateData.creator as string | undefined) ?? "";
      const imageName = (templateData.image_name as string | undefined) ?? "";

      // Build files entries for COS upload
      const cosPrefix = `${new Date().getFullYear()}_AMS_ALGO_Competition/common/eval`;
      const uploadFiles = bundleFiles.map((f) => ({
        name: f.name,
        cosKey: newCosKey(cosPrefix, f.name),
        localPath: f.localPath,
      }));

      // Get file sizes
      for (const f of uploadFiles) {
        const s = await stat(f.localPath);
        (f as any).size = s.size;
      }

      const mode = opts.dryRun ? "dry-run" : "execute";

      // Safety check
      if (!opts.dryRun && !opts.yes) {
        throw new Error("--dry-run is not set; add --yes to confirm live execution");
      }

      const createPayload = {
        mould_id: parseInt(opts.mouldId, 10),
        name: job.name,
        image_name: imageName,
        creator,
        files: uploadFiles.map((f) => ({
          name: f.name,
          path: f.cosKey,
          mtime: formatTaijiTime(),
          size: f.size,
        })),
      };

      const plan = {
        mode,
        job,
        mouldId: opts.mouldId,
        uploadFiles: uploadFiles.map((f) => ({ name: f.name, cosKey: f.cosKey, size: f.size })),
        createPayload: safeResult(createPayload) as Record<string, unknown>,
      };

      await mkdir(outDir, { recursive: true });
      await writeFile(path.join(outDir, "plan.json"), `${JSON.stringify(plan, null, 2)}\n`, "utf8");

      if (opts.dryRun) {
        console.log(`Wrote dry-run plan: ${path.join(outDir, "plan.json")}`);
        console.log("No upload/create happened. Remove --dry-run and add --yes to run live.");
        return;
      }

      // Execute: upload files to COS, then create evaluation task
      const uploadResults: Array<{ key: string; bytes: number }> = [];
      for (const f of uploadFiles) {
        const result = await uploadToCos(cookieHeader, f.localPath, f.cosKey);
        uploadResults.push(result);
        console.log(`  Uploaded ${f.name} -> ${result.key}`);
      }

      const created = await fetchJson(cookieHeader, "/aide/api/evaluation_tasks/", {
        method: "POST",
        body: createPayload,
      });
      const data = (created as Record<string, unknown>).data as Record<string, unknown> | undefined;
      const taskId = data?.id;
      if (!taskId) throw new Error("Created evaluation task response has no data.id");

      const result = { ...plan, uploadResults, created: safeResult(created), taskId };
      await writeFile(path.join(outDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
      console.log(`Created Taiji eval task: ${taskId}`);
      console.log(`Wrote live result: ${path.join(outDir, "result.json")}`);
    });
}
```

- [ ] **Step 2: Build and verify**

Run: `npm run build`
Expected: No errors.

Verify: `npm run dev -- eval --help` should show `submit` as a subcommand.
Verify: `npm run dev -- eval submit --help` should show `--bundle`, `--mould-id`, `--yes`, `--dry-run`, `--output`.

- [ ] **Step 3: Test eval submit dry-run**

Create a bundle first with `eval prepare`, then run:
```bash
npm run dev -- eval submit --bundle taiji-output/eval-bundle --mould-id 37662 --dry-run
```

Expected: Creates `taiji-output/eval-submit-live/<timestamp>/plan.json` with the expected payload structure. No upload or API calls happen.

- [ ] **Step 4: Commit**

```bash
git add src/cli/commands/eval/submit.ts src/api/evaluation.ts
git commit -m "feat: add eval submit command"
```

---

## Chunk 3: README update

### Task 1: Update README to document eval commands

- [ ] **Step 1: Update eval section header**

In `README.md`, after line 376 (the `## 评估任务（eval）` header), add the workflow description:

```markdown
标准工作流程：

```
prepare → submit
```

即：先打包源码，再上传到 COS 并创建评估任务。

---

```

- [ ] **Step 2: Add eval prepare and eval submit documentation**

Insert before the `### \`eval list\`` section (currently line 377):

Documentation for `eval prepare` and `eval submit` following the same format as train documentation. Include:
- Usage block with all options
- Parameter table
- Scanned file patterns note (same as train, but no `inference/` subdir)
- Output files table
- API calls list (for submit only)

- [ ] **Step 3: Update output directory structure**

In the `## 输出目录结构` section, add eval-bundle and eval-submit-live entries to the tree.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document eval prepare and eval submit commands"
```
