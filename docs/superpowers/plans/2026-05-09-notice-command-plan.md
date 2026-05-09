# Notice Command Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `train notice` subcommand that monitors a training task and sends WeChat notifications via PushPlus when the task completes.

**Architecture:** `taac2026 train notice --task-id <id>` registers a subscription, forks a daemon process running `_notice-watch` that polls every 20 minutes and sends PushPlus notifications on terminal status.

**Tech Stack:** TypeScript, Commander.js, Node.js `child_process` + `crypto.randomUUID()`, PushPlus HTTP API

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/utils/job-status.ts` | **Create** | Shared `isTerminalJob()` utility |
| `src/api/notification.ts` | **Create** | PushPlus notification API wrapper |
| `src/cli/commands/train/notice.ts` | **Create** | `train notice` command (register + fork daemon) |
| `src/cli/commands/train/notice-watch.ts` | **Create** | `_notice-watch` internal command (poll + notify) |
| `src/cli/commands/train/index.ts` | **Modify** | Register notice commands |
| `src/cli/commands/train/list.ts` | **Modify** | Import `isTerminalJob` from shared utility |
| `src/types.ts` | **Modify** | Add `NoticeSubscription` type |

---

## Chunk 1: Shared Utilities & Types

### Task 1: Extract `isTerminalJob` to shared utility

**Files:**
- Create: `src/utils/job-status.ts`

- [ ] **Step 1: Create `src/utils/job-status.ts`**

```typescript
/**
 * Returns true if a training job is in a terminal (non-running) state.
 */
export function isTerminalJob(job: { status?: string; jzStatus?: string }): boolean {
  const status = String(job?.status ?? "").toUpperCase();
  const jzStatus = String(job?.jzStatus ?? "").toUpperCase();
  return jzStatus === "END" || ["SUCCEED", "FAILED", "KILLED", "CANCELED", "CANCELLED"].includes(status);
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/utils/job-status.ts
git commit -m "feat(notice): extract isTerminalJob to shared utility"
```

### Task 2: Update `train/list.ts` to import from shared utility

**Files:**
- Modify: `src/cli/commands/train/list.ts:122`

- [ ] **Step 1: Add import and remove local function**

In `src/cli/commands/train/list.ts`:
- Add at top: `import { isTerminalJob } from "../../../utils/job-status.js";`
- Remove lines 122-126 (the local `isTerminalJob` function)

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/cli/commands/train/list.ts
git commit -m "feat(notice): use shared isTerminalJob in list.ts"
```

### Task 3: Add `NoticeSubscription` type to `types.ts`

**Files:**
- Modify: `src/types.ts` (append at end)

- [ ] **Step 1: Append type definition**

At the end of `src/types.ts`, after line 175:

```typescript
export interface NoticeSubscription {
  id: string;
  taskId: string;
  internalId: string;
  registeredAt: string;
  status: "active" | "completed" | "failed";
  lastCheckedAt?: string;
  consecutiveFailures?: number;
}

export interface NoticeStore {
  notices: NoticeSubscription[];
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat(notice): add NoticeSubscription and NoticeStore types"
```

---

## Chunk 2: PushPlus Notification API

### Task 4: Create PushPlus API wrapper

**Files:**
- Create: `src/api/notification.ts`

- [ ] **Step 1: Create `src/api/notification.ts`**

```typescript
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { resolveSecretPath } from "../cli/middleware.js";

const PUSHPLUS_API_URL = "http://www.pushplus.plus/send";
const PUSHPLUS_TOKEN_FILE = "pushplus-token.txt";

function resolvePushPlusTokenPath(): string {
  const secretPath = resolveSecretPath();
  const taacDir = path.dirname(path.dirname(secretPath));
  return path.join(taacDir, PUSHPLUS_TOKEN_FILE);
}

async function getPushPlusToken(): Promise<string> {
  const tokenPath = resolvePushPlusTokenPath();
  try {
    const token = (await readFile(tokenPath, "utf8")).trim();
    if (!token) {
      throw new Error(`PushPlus token file is empty: ${tokenPath}`);
    }
    return token;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `PushPlus token not found at ${tokenPath}.\n` +
        `Please obtain a token from https://www.pushplus.plus/ and save it to this file.`
      );
    }
    throw err;
  }
}

export async function sendPushPlusNotification(
  title: string,
  content: string
): Promise<{ success: boolean; message: string }> {
  const token = await getPushPlusToken();

  const body = {
    token,
    title,
    content,
    template: "markdown",
  };

  const response = await fetch(PUSHPLUS_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const result = await response.json() as { code: number; msg: string };

  if (result.code === 200) {
    return { success: true, message: "Notification sent successfully" };
  }

  return {
    success: false,
    message: `PushPlus API error: ${result.msg} (code: ${result.code})`,
  };
}

export function formatNoticeContent(
  taskId: string,
  status: string,
  completionTime: string
): string {
  return [
    `## TAAC2026 训练任务完成通知`,
    ``,
    `- **任务ID**: ${taskId}`,
    `- **最终状态**: ${status}`,
    `- **完成时间**: ${completionTime}`,
  ].join("\n");
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/api/notification.ts
git commit -m "feat(notice): add PushPlus notification API wrapper"
```

---

## Chunk 3: Notice Registration Command

### Task 5: Create `train notice` command

**Files:**
- Create: `src/cli/commands/train/notice.ts`

- [ ] **Step 1: Create `src/cli/commands/train/notice.ts`**

```typescript
import { Command } from "commander";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { ensureCliAuth, resolveSecretPath } from "../../../cli/middleware.js";
import { fetchJobDetail } from "../../../api/training.js";
import { isTerminalJob } from "../../../utils/job-status.js";
import { sendPushPlusNotification, formatNoticeContent } from "../../../api/notification.js";
import type { NoticeStore, NoticeSubscription } from "../../../types.js";

const AUTH_WAIT_MS = 180_000;
const NOTICE_PID_FILE = "notice.pid";

function resolveNoticeStorePath(): string {
  const secretPath = resolveSecretPath();
  const taacDir = path.dirname(path.dirname(secretPath));
  return path.join(taacDir, "notice.json");
}

function resolveNoticePidPath(): string {
  const secretPath = resolveSecretPath();
  const taacDir = path.dirname(path.dirname(secretPath));
  return path.join(taacDir, NOTICE_PID_FILE);
}

async function loadNoticeStore(): Promise<NoticeStore> {
  const storePath = resolveNoticeStorePath();
  try {
    const content = await readFile(storePath, "utf8");
    const parsed = JSON.parse(content);
    if (parsed && Array.isArray(parsed.notices)) return parsed;
  } catch {
    // File doesn't exist or is corrupted
  }
  return { notices: [] };
}

async function saveNoticeStore(store: NoticeStore): Promise<void> {
  const storePath = resolveNoticeStorePath();
  await writeFile(storePath, JSON.stringify(store, null, 2), "utf8");
}

async function loadJobsMapping(): Promise<Record<string, { jobId: string; jobInternalId: number }>> {
  // Uses the same jobs.json as train describe
  const taijiOutputDir = path.resolve(process.cwd(), "taiji-output");
  const jobsFile = path.join(taijiOutputDir, "jobs.json");
  try {
    const data = JSON.parse(await readFile(jobsFile, "utf8"));
    return data.jobsById ?? {};
  } catch {
    throw new Error(
      `jobs.json not found. Run "train list" first to populate the job mapping.`
    );
  }
}

function forkNoticeWatch(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [process.argv[1], "train", "_notice-watch"],
      {
        detached: true,
        stdio: "ignore",
      }
    );

    child.unref();

    // Write PID file as confirmation
    const pidPath = resolveNoticePidPath();
    writeFile(pidPath, String(child.pid), "utf8").then(() => {
      resolve(true);
    }).catch(() => {
      resolve(false);
    });
  });
}

export function registerTrainNoticeCommand(trainCmd: Command) {
  trainCmd
    .command("notice")
    .description("Monitor a training task and send WeChat notification when it completes")
    .requiredOption("--task-id <id>", "Task ID (the full angel_training_... string)")
    .action(async (opts: { taskId: string }) => {
      const cookieHeader = await ensureCliAuth();
      const client = { directCookieHeader: cookieHeader };

      // 1. Resolve internalId from jobs.json
      const jobsById = await loadJobsMapping();
      const entry = jobsById[opts.taskId];
      if (!entry) {
        console.error(
          `Task "${opts.taskId}" not found in jobs.json. Run "train list" first.`
        );
        process.exit(1);
      }

      const internalId = String(entry.jobInternalId);

      // 2. Fetch current job status
      const jobDetail = await fetchJobDetail(client, internalId, AUTH_WAIT_MS);
      const status = jobDetail?.data?.status ?? "";
      const jzStatus = jobDetail?.data?.jzStatus ?? "";

      // 3. If already terminal, notify immediately
      if (isTerminalJob({ status, jzStatus })) {
        console.log(`Task "${opts.taskId}" is already in terminal state (${status}).`);
        const content = formatNoticeContent(
          opts.taskId,
          status,
          new Date().toISOString()
        );
        const result = await sendPushPlusNotification(
          "TAAC2026 训练任务完成通知",
          content
        );
        if (result.success) {
          console.log("Notification sent successfully.");
        } else {
          console.error(`Failed to send notification: ${result.message}`);
          process.exit(1);
        }
        return;
      }

      // 4. Register subscription
      const subscription: NoticeSubscription = {
        id: crypto.randomUUID(),
        taskId: opts.taskId,
        internalId,
        registeredAt: new Date().toISOString(),
        status: "active",
      };

      const store = await loadNoticeStore();
      store.notices.push(subscription);
      await saveNoticeStore(store);

      // 5. Fork daemon
      const started = await forkNoticeWatch();
      if (started) {
        console.log(
          `Notice registered for task "${opts.taskId}".\n` +
          `Daemon started — will notify you via WeChat when the task completes.`
        );
      } else {
        console.log(
          `Notice registered for task "${opts.taskId}".\n` +
          `Failed to start daemon automatically. Run "train _notice-watch" manually to begin monitoring.`
        );
      }
    });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/cli/commands/train/notice.ts
git commit -m "feat(notice): add train notice registration command"
```

---

## Chunk 4: Notice Watch Daemon

### Task 6: Create `_notice-watch` internal command

**Files:**
- Create: `src/cli/commands/train/notice-watch.ts`

- [ ] **Step 1: Create `src/cli/commands/train/notice-watch.ts`**

```typescript
import { Command } from "commander";
import { readFile, writeFile } from "node:fs/promises";
import { ensureCliAuth, resolveSecretPath } from "../../../cli/middleware.js";
import { fetchJobDetail } from "../../../api/training.js";
import { isTerminalJob } from "../../../utils/job-status.js";
import { sendPushPlusNotification, formatNoticeContent } from "../../../api/notification.js";
import type { NoticeStore, NoticeSubscription } from "../../../types.js";
import path from "node:path";

const AUTH_WAIT_MS = 180_000;
const POLL_INTERVAL_MS = 20 * 60 * 1000; // 20 minutes
const MAX_CONSECUTIVE_FAILURES = 3;
const PID_FILE = "notice.pid";

function resolveNoticeStorePath(): string {
  const secretPath = resolveSecretPath();
  const taacDir = path.dirname(path.dirname(secretPath));
  return path.join(taacDir, "notice.json");
}

function resolveNoticePidPath(): string {
  const secretPath = resolveSecretPath();
  const taacDir = path.dirname(path.dirname(secretPath));
  return path.join(taacDir, PID_FILE);
}

async function loadNoticeStore(): Promise<NoticeStore> {
  const storePath = resolveNoticeStorePath();
  try {
    const content = await readFile(storePath, "utf8");
    const parsed = JSON.parse(content);
    if (parsed && Array.isArray(parsed.notices)) return parsed;
  } catch {
    // File doesn't exist or is corrupted
  }
  return { notices: [] };
}

async function saveNoticeStore(store: NoticeStore): Promise<void> {
  const storePath = resolveNoticeStorePath();
  await writeFile(storePath, JSON.stringify(store, null, 2), "utf8");
}

async function pollActiveSubscriptions(
  client: { directCookieHeader: string }
): Promise<{ completed: boolean }> {
  const store = await loadNoticeStore();
  const activeSubscriptions = store.notices.filter(
    (n) => n.status === "active"
  );

  if (activeSubscriptions.length === 0) {
    return { completed: true };
  }

  let allCompleted = true;

  for (const sub of activeSubscriptions) {
    try {
      const jobDetail = await fetchJobDetail(
        client,
        sub.internalId,
        AUTH_WAIT_MS
      );
      const status = jobDetail?.data?.status ?? "";
      const jzStatus = jobDetail?.data?.jzStatus ?? "";

      if (isTerminalJob({ status, jzStatus })) {
        // Task completed — send notification
        console.log(
          `[notice] Task "${sub.taskId}" completed with status: ${status}`
        );
        const content = formatNoticeContent(
          sub.taskId,
          status,
          new Date().toISOString()
        );

        let notified = false;
        for (let attempt = 0; attempt < 2; attempt++) {
          const result = await sendPushPlusNotification(
            "TAAC2026 训练任务完成通知",
            content
          );
          if (result.success) {
            console.log(`[notice] Notification sent for task "${sub.taskId}"`);
            notified = true;
            break;
          }
          console.error(
            `[notice] PushPlus attempt ${attempt + 1} failed: ${result.message}`
          );
        }

        if (!notified) {
          console.error(
            `[notice] Failed to send notification for task "${sub.taskId}" after 2 attempts`
          );
        }

        sub.status = "completed";
        sub.lastCheckedAt = new Date().toISOString();
      } else {
        allCompleted = false;
        sub.lastCheckedAt = new Date().toISOString();
        sub.consecutiveFailures = 0;
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[notice] Failed to poll task "${sub.taskId}": ${msg}`);

      sub.consecutiveFailures = (sub.consecutiveFailures ?? 0) + 1;
      sub.lastCheckedAt = new Date().toISOString();

      if (sub.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        console.warn(
          `[notice] Marking task "${sub.taskId}" as failed after ${MAX_CONSECUTIVE_FAILURES} consecutive errors`
        );
        sub.status = "failed";
      } else {
        allCompleted = false;
      }
    }
  }

  // Clean completed/failed entries
  store.notices = store.notices.filter((n) => n.status === "active");
  await saveNoticeStore(store);

  return { completed: allCompleted };
}

export function registerTrainNoticeWatchCommand(trainCmd: Command) {
  trainCmd
    .command("_notice-watch")
    .description("[internal] Poll active notice subscriptions and send notifications")
    .action(async () => {
      console.log("[notice] Starting notice watcher...");

      const cookieHeader = await ensureCliAuth();
      const client = { directCookieHeader: cookieHeader };

      // Initial poll
      const { completed } = await pollActiveSubscriptions(client);
      if (completed) {
        console.log("[notice] No active subscriptions. Exiting.");
        process.exit(0);
      }

      // Schedule next poll
      const interval = setInterval(async () => {
        const { completed } = await pollActiveSubscriptions(client);
        if (completed) {
          console.log("[notice] All subscriptions completed. Exiting.");
          clearInterval(interval);
          process.exit(0);
        }
      }, POLL_INTERVAL_MS);

      // Allow the process to exit cleanly on SIGTERM/SIGINT
      process.on("SIGTERM", () => {
        clearInterval(interval);
        process.exit(0);
      });
      process.on("SIGINT", () => {
        clearInterval(interval);
        process.exit(0);
      });
    });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/cli/commands/train/notice-watch.ts
git commit -m "feat(notice): add _notice-watch daemon command"
```

---

## Chunk 5: Wire Commands into Train

### Task 7: Register notice commands in `train/index.ts`

**Files:**
- Modify: `src/cli/commands/train/index.ts`

- [ ] **Step 1: Add imports and registrations**

In `src/cli/commands/train/index.ts`:

Add imports after line 11:
```typescript
import { registerTrainNoticeCommand } from "./notice.js";
import { registerTrainNoticeWatchCommand } from "./notice-watch.js";
```

Add registrations at the end of `registerTrainCommand` (after line 24):
```typescript
  registerTrainNoticeCommand(trainCmd);
  registerTrainNoticeWatchCommand(trainCmd);
```

- [ ] **Step 2: Verify the command is accessible**

Run: `npx tsx src/cli/index.ts train --help`
Expected: `notice` appears in the list of subcommands

- [ ] **Step 3: Commit**

```bash
git add src/cli/commands/train/index.ts
git commit -m "feat(notice): wire notice commands into train"
```

### Task 8: Full build and smoke test

- [ ] **Step 1: Build the project**

Run: `npx tsc`
Expected: PASS, no errors

- [ ] **Step 2: Verify notice help**

Run: `node dist/cli/index.js train notice --help`
Expected: Shows `--task-id` option

- [ ] **Step 3: Verify _notice-watch is hidden but accessible**

Run: `node dist/cli/index.js train _notice-watch --help`
Expected: Shows help for the internal command

- [ ] **Step 4: Commit**

```bash
git add dist/
git commit -m "build: compile notice command"
```

---

## Review Checklist

Before marking complete, verify:

1. `train notice --task-id <id>` works when the task is already terminal (immediate notification)
2. `train notice --task-id <id>` works when the task is running (daemon fork + subscription saved)
3. `.taac2026/notice.json` is created with correct structure
4. `.taac2026/pushplus-token.txt` error message is helpful when missing
5. `_notice-watch` correctly polls and exits when all subscriptions complete
6. TypeScript compilation passes with no errors
7. `isTerminalJob` in `list.ts` still works after extraction
