# Train Publish Command Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `taac2026 train publish` command to auto-discover and release the latest checkpoint from a completed training task.

**Architecture:** Follow the existing `stop.ts`/`metrics.ts` patterns: use `ensureCliAuth()` to get cookie header, create a DirectClient, call shared API functions from `training.ts`, and write results to the output directory.

**Tech Stack:** TypeScript, Commander.js, native fetch, existing project patterns

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/types.ts` | Modify | Add `CheckpointInfo` and `ReleaseCkptRequest` types |
| `src/api/training.ts` | Modify | Add `releaseCheckpoint()` API function |
| `src/cli/commands/train/publish.ts` | Create | CLI command: auth → find instance → find ckpt → release → verify |
| `src/cli/commands/train/index.ts` | Modify | Import and register `registerTrainPublishCommand` |

---

## Chunk 1: Types + API + Command

### Task 1: Add Types

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add new types to the end of `src/types.ts`**

Append these two interfaces after the last existing type:

```typescript
export interface CheckpointInfo {
  name?: string;
  ckpt?: string;
  createTime?: string;
  [key: string]: unknown;
}

export interface ReleaseCkptRequest {
  name: string;
  desc: string;
  ckpt: string;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: PASS (no new errors)

### Task 2: Add releaseCheckpoint API Function

**Files:**
- Modify: `src/api/training.ts`

- [ ] **Step 1: Import the new type**

At the top of `src/api/training.ts`, add `ReleaseCkptRequest` to the import:

```typescript
import type { TrainingJob, JobInstance, JobDetail, ReleaseCkptRequest } from "../types.js";
```

- [ ] **Step 2: Add releaseCheckpoint function**

Append to the end of `src/api/training.ts`:

```typescript
export async function releaseCheckpoint(
  client: unknown,
  instanceId: string,
  request: ReleaseCkptRequest,
  authWaitMs?: number
): Promise<unknown> {
  return fetchJson(client, `/taskmanagement/api/v1/instances/external/${instanceId}/release_ckpt`, {
    method: "POST",
    body: request,
    authWaitMs,
  });
}
```

Note: `fetchJson` already handles POST requests with body — see `client.ts` line 88-94, where POST body is serialized to JSON and sent.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: PASS

### Task 3: Implement publish.ts Command

**Files:**
- Create: `src/cli/commands/train/publish.ts`

This is the main command file. Follow `stop.ts` and `metrics.ts` patterns:

- Auth via `ensureCliAuth()` → create DirectClient
- `fetchJobInstances` to get latest instance
- `fetchInstanceOutput` to get checkpoints
- Build name/desc (auto or override)
- Call `releaseCheckpoint`
- Verify by re-fetching
- Write result JSON, print success

- [ ] **Step 1: Create `src/cli/commands/train/publish.ts` with full implementation**

```typescript
import { Command } from "commander";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { ensureCliAuth } from "../../../cli/middleware.js";
import { resolveTaijiOutputDir } from "../../../utils/output.js";
import { fetchJobInstances, fetchInstanceOutput, releaseCheckpoint } from "../../../api/training.js";

function findTaijiOutputDir(fromDir: string): string | null {
  let current = fromDir;
  while (true) {
    if (existsSync(path.join(current, "jobs.json"))) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

async function resolveTaskName(taskId: string, outDir: string): Promise<string | null> {
  const taijiOutputDir = findTaijiOutputDir(outDir);
  if (taijiOutputDir) {
    try {
      const jobsData = JSON.parse(await readFile(path.join(taijiOutputDir, "jobs.json"), "utf8"));
      for (const [, entry] of Object.entries(jobsData.jobsById ?? {}) as Array<[string, any]>) {
        if (entry.jobId === taskId && entry.name) return entry.name as string;
      }
    } catch { /* not available */ }
  }
  return null;
}

function extractStepFromCkpt(ckptName: string): string | null {
  const match = ckptName.match(/global_step(\d+)/);
  return match ? match[1] : null;
}

function generatePublishName(taskName: string | null, ckptFilename: string): string {
  const base = taskName || "unnamed";
  const step = extractStepFromCkpt(ckptFilename);
  return step ? `${base}-step${step}` : `${base}-${ckptFilename.slice(0, 64)}`;
}

function generatePublishDesc(taskId: string): string {
  return `Published from training task ${taskId}`;
}

export function registerTrainPublishCommand(trainCmd: Command) {
  trainCmd
    .command("publish")
    .description("Publish the latest checkpoint from a completed training task")
    .requiredOption("--task-id <id>", "Task ID — full taskID string (angel_training_...) or numeric internal ID")
    .option("--name <name>", "Override auto-generated publish name")
    .option("--desc <desc>", "Override auto-generated publish description")
    .option("--output <dir>", "Output directory for result JSON (default: taiji-output/train-jobs)")
    .action(async (opts) => {
      const outDir = resolveTaijiOutputDir(opts.output ?? "taiji-output/train-jobs");
      const cookieHeader = await ensureCliAuth();
      const client = { directCookieHeader: cookieHeader };

      // Step 1: Find latest instance
      const instances = await fetchJobInstances(client, opts.taskId, 1);
      if (instances.length === 0) {
        console.error(`Error: No instances found for task ${opts.taskId}`);
        process.exit(1);
      }
      const instance = instances[0];
      const instanceId = instance.id;
      if (!instanceId) {
        console.error(`Error: Latest instance for task ${opts.taskId} has no ID`);
        process.exit(1);
      }

      // Step 2: Get checkpoints
      const output = await fetchInstanceOutput(client, instanceId);
      const checkpoints = (output as Record<string, any>).checkpoints as any[];
      if (!checkpoints || checkpoints.length === 0) {
        console.error(`Error: No checkpoints found for instance ${instanceId}`);
        process.exit(1);
      }

      // Step 3: Select latest checkpoint (first in list)
      const latestCkpt = checkpoints[0];
      const ckptFilename = latestCkpt.ckpt ?? latestCkpt.name ?? "";
      if (!ckptFilename) {
        console.error(`Error: Latest checkpoint for instance ${instanceId} has no filename`);
        process.exit(1);
      }

      // Step 4: Build name/desc
      const taskName = await resolveTaskName(opts.taskId, outDir);
      const publishName = opts.name ?? generatePublishName(taskName, ckptFilename);
      const publishDesc = opts.desc ?? generatePublishDesc(opts.taskId);

      console.log(`Publishing checkpoint: ${ckptFilename}`);
      console.log(`  Name: ${publishName}`);
      console.log(`  Desc: ${publishDesc}`);

      // Step 5: Release checkpoint
      const response = await releaseCheckpoint(client, instanceId, {
        name: publishName,
        desc: publishDesc,
        ckpt: ckptFilename,
      });

      // Extract mould_id from response for downstream evaluation tasks
      const responseData = response as Record<string, any>;
      const mouldId = responseData?.data?.mould_id ?? responseData?.data?.model_id ?? responseData?.data?.id ?? responseData?.mould_id ?? responseData?.model_id ?? null;

      // Step 6: Verify
      const verifyOutput = await fetchInstanceOutput(client, instanceId);
      const verifyCheckpoints = (verifyOutput as Record<string, any>).checkpoints as any[];
      const verified = verifyCheckpoints?.some((c: any) => c.ckpt === ckptFilename || c.name === ckptFilename);

      const result = {
        taskId: opts.taskId,
        instanceId,
        checkpoint: ckptFilename,
        publishName,
        publishDesc,
        mouldId,
        publishedAt: new Date().toISOString(),
        response,
        verified: verified ?? null,
      };

      await mkdir(outDir, { recursive: true });
      await writeFile(path.join(outDir, `publish-${opts.taskId}.json`), JSON.stringify(result, null, 2), "utf8");

      if (mouldId) {
        console.log(`Checkpoint published: ${publishName} (mould_id: ${mouldId})`);
      } else if (verified) {
        console.log(`Checkpoint published and verified: ${publishName}`);
      } else {
        console.log(`Checkpoint published: ${publishName} (verification inconclusive, may be async)`);
      }
    });
}
```

- [ ] **Step 2: Register the command in `src/cli/commands/train/index.ts`**

Add import:
```typescript
import { registerTrainPublishCommand } from "./publish.js";
```

Add registration call after existing ones:
```typescript
registerTrainPublishCommand(trainCmd);
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Verify command is registered**

Run: `npx tsx src/cli/index.ts train --help`
Expected: `publish` appears in the list of train subcommands

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/api/training.ts src/cli/commands/train/publish.ts src/cli/commands/train/index.ts
git commit -m "feat: add train publish command for checkpoint release"
```

---

## Review

- [ ] Dispatch plan-document-reviewer for the full plan chunk
- [ ] Fix any issues found
- [ ] Re-dispatch until approved
