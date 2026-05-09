# Train Publish Command Design

**Date**: 2026-05-09

## Overview

Add `taac2026 train publish` command to publish the latest checkpoint from a completed training task. The command auto-discovers the latest instance, finds the most recent checkpoint, and releases it via the Taiji API.

## User Flow

```
taac2026 train publish --task-id <id> [--name <name>] [--desc <desc>] [--output <dir>]
```

1. Resolve task ID (full string or numeric internal ID)
2. Fetch latest instance via `fetchJobInstances(client, taskId, 1)` — select the first instance (most recent, desc order)
3. Fetch checkpoint list via `fetchInstanceOutput(client, instanceId)` — returns `{ checkpoints: [...] }`
4. Select the first checkpoint in the array (most recent)
5. Call `releaseCheckpoint` API
6. Verify by re-fetching checkpoints via `fetchInstanceOutput`

## Parameters

| Flag | Required | Description |
|------|----------|-------------|
| `--task-id <id>` | Yes | Full taskID or numeric internal ID |
| `--name <name>` | No | Override auto-generated publish name |
| `--desc <desc>` | No | Override auto-generated publish description |
| `--output <dir>` | No | Output directory for result JSON |

## Auto-generated Fields

- **name**: `{task_name}-step{N}` — extract step from checkpoint filename by matching `/global_step(\d+)/`; if no match, use the full filename (truncated to 64 chars). Use task name from jobs.json if available, fallback to task_id.
- **desc**: `"Published from training task {task_id}"`

## Files Changed

### New: `src/cli/commands/train/publish.ts`

Implements the CLI command. Logic:

1. `ensureCliAuth()` → get cookie header
2. `fetchJobInstances(client, taskId, 1)` → get latest instance
3. `fetchInstanceOutput(client, instanceId)` → get checkpoints
4. Select first checkpoint (most recent)
5. Build request: use `--name`/`--desc` overrides or auto-generate
6. Call `releaseCheckpoint` API
7. Verify: re-fetch checkpoints via `fetchInstanceOutput` and check the released checkpoint appears
8. Write result to `<output>/publish-<fullTaskId>.json` (full task ID, e.g., `angel_training_xxx`)
9. Print success message

### Modified: `src/api/training.ts`

Add one function:

```typescript
export async function releaseCheckpoint(
  client: unknown,
  instanceId: string,
  request: ReleaseCkptRequest,
  authWaitMs?: number
): Promise<unknown>
```

### Modified: `src/types.ts`

Add two types:

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

### Modified: `src/cli/commands/train/index.ts`

Add `registerTrainPublishCommand(trainCmd)` import and registration call.

## API Details

**POST** `https://taiji.algo.qq.com/taskmanagement/api/v1/instances/external/{instanceId}/release_ckpt`

```json
{ "name": "my-model-step38050", "desc": "...", "ckpt": "global_step38050.layer=2..." }
```

Uses the existing cookie-based auth pattern (same as other train commands).

## Error Handling

- No instances found → exit with error message
- No checkpoints available → exit with error message
- release_ckpt fails → print API error and exit non-zero
- Verification fails → warn but exit 0 (release may be async)
