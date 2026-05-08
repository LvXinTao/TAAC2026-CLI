---
name: CLI Command Options Redesign
description: Redesign all CLI command options for consistency, simplicity, and usability
type: spec
---

# CLI Command Options Redesign — Design Spec

**Date**: 2026-05-08
**Status**: Draft
**Author**: Brainstorming session with user

## Problem

The current CLI has messy, inconsistent options across subcommands:
- Authentication (`--cookie-file`, `--direct`) repeated on nearly every command
- Job ID naming inconsistent: `--job`, `--job-id`, `--job-internal-id`, `--task-id`
- Output directory named `--out` everywhere instead of `--output`
- Many unused or non-functional options (`--tail`, `--json` in train logs)
- `train list` does too much (list + detail + logs + metrics + checkpoints)
- `train prepare` has options that aren't useful for the user's workflow

## Design Principles

1. **Global authentication** — `login` saves cookie; subsequent commands auto-read
2. **Each command does one thing** — split `train list` into list + describe + logs + metrics
3. **Consistent naming** — `--job-id`, `--task-id`, `--output` everywhere
4. **Remove dead options** — options with no implementation are removed
5. **Minimal surface** — only options the user actually needs are kept

## Global Changes

### Authentication
- Remove `--cookie-file` from all commands except `login`
- Remove `--direct` from all commands
- Commands auto-read cookie from `.taac2026/secrets/taiji-cookie.txt`
- Browser mode (`--headless`) only exists on `login` and `train list` (scraping)

### Option naming
- `--out` → `--output` across all commands
- `--job` / `--job-internal-id` / `--task-id` → `--job-id` (training) / `--task-id` (eval)

## Command Specifications

### `login`

Interactively logs in via browser SSO, saves cookie.

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `--timeout <ms>` | number | No | Browser login timeout (default: 120000) |

**Removed**: `--cookie-file` (manual import), `--headless` (impractical for interactive login), `--out` (fixed to `.taac2026/secrets/`)

**Output**: Cookie saved to `.taac2026/secrets/taiji-cookie.txt` in working directory.

### `train prepare`

Prepares a submission bundle directory without uploading.

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `--template-id <id>` | string | Yes | Template job URL or internal ID |
| `--name <name>` | string | Yes | Job name |
| `--zip <path>` | string | No | Path to code.zip |
| `--config <path>` | string | No | Path to config.yaml |
| `--run-sh <path>` | string | No | Path to run.sh |
| `--description <text>` | string | No | Job description |
| `--output <dir>` | string | No | Output directory (default: submit-bundle) |

**Removed**: `--file`, `--file-dir` (user doesn't need generic trainFiles), `--message` (unnecessary local note), `--run` (submit's responsibility), `--allow-dirty` (unnecessary git warning bypass)

**Note**: At least one of `--zip`, `--config`, or `--run-sh` must be provided.

### `train submit`

Uploads bundle to COS and creates a Taiji job.

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `--bundle <dir>` | string | Yes | Prepared bundle directory |
| `--run` | flag | No | Start job after creation |
| `--yes` | flag | No | Skip confirmation prompt |
| `--dry-run` | flag | No | Preview without uploading (default: execute) |
| `--output <dir>` | string | No | Output directory for plan/result |

**Removed**: `--cookie-file`, `--direct` (global auth), `--template-job-internal-id` (auto-inferred from bundle), `--template-job-url` (from bundle manifest), `--name` (decided at prepare), `--description` (decided at prepare), `--execute` (inverted to `--dry-run`), `--allow-add-file` (generic files removed)

**Behavior change**: Default is now **execute** (live). Previously default was dry-run. This matches user expectation — you type `submit` to submit.

### `train list`

Lists training jobs. Lightweight — no detail/logs/metrics fetching.

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `--headless` | flag | No | Headless browser mode (for CI/CD) |
| `--incremental` | flag | No | Skip unchanged terminal jobs |
| `--page-size <n>` | number | No | Page size (default: 100) |
| `--output <dir>` | string | No | Output directory (default: taiji-output) |
| `--timeout <ms>` | number | No | Browser timeout (default: 180000) |

**Removed**: `--all` (no effect), `--cookie-file`, `--direct` (global auth), `--job-internal-id`, `--job-id` (use `train describe`)

**Behavior change**: No longer fetches job detail, logs, or metrics. Those are handled by `train describe`, `train logs`, `train metrics`.

### `train describe` (new)

Fetches full details of a single training job.

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `--job-id <id>` | string | Yes | Job internal ID |

**Implementation note**: Extract the per-job detail + logs + metrics fetching logic from current `train list` into this new command.

### `train logs`

Fetches and saves training job logs.

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `--job-id <id>` | string | Yes | Job internal ID |
| `--output <dir>` | string | No | Output directory (default: taiji-output) |

**Removed**: `--cookie-file`, `--direct` (global auth), `--errors` (unused), `--tail` (defined but never read), `--json` (defined but never read)

### `train metrics`

Fetches and exports training job metrics.

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `--job-id <id>` | string | Yes | Job internal ID |
| `--json` | flag | No | Output JSON to stdout instead of CSV file |
| `--output <dir>` | string | No | Output directory (default: taiji-output) |

**Removed**: `--cookie-file`, `--direct` (global auth)

### `train stop`

Stops a running training job.

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `--job-id <id>` | string | Yes | Job internal ID |

**Removed**: `--cookie-file` (global auth)

### `train delete`

Deletes a training job.

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `--job-id <id>` | string | Yes | Job internal ID |
| `--yes` | flag | No | Skip confirmation prompt |

**Removed**: `--cookie-file` (global auth)

### `eval create`

Create an evaluation task. (Skeleton — not yet implemented)

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| (none yet) | | | |

**Removed**: `--cookie-file`, `--direct` (global auth)

### `eval list`

Lists evaluation tasks.

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `--page-size <n>` | number | No | Page size (default: 100) |
| `--output <dir>` | string | No | Output directory (default: taiji-output) |

**Removed**: `--cookie-file`, `--direct` (global auth)

### `eval logs`

Fetches evaluation task logs.

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `--task-id <id>` | string | Yes | Evaluation task ID |
| `--output <dir>` | string | No | Output directory (default: taiji-output) |

**Removed**: `--cookie-file`, `--direct` (global auth)

### `eval metrics`

Views evaluation task metrics.

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `--task-id <id>` | string | Yes | Evaluation task ID |
| `--json` | flag | No | Output JSON to stdout |

**Removed**: `--cookie-file`, `--direct` (global auth)

## Final Command Tree

```
taac2026
├── login [--timeout]
├── train
│   ├── prepare     --template-id --name [--zip] [--config] [--run-sh] [--description] [--output]
│   ├── submit      --bundle [--run] [--yes] [--dry-run] [--output]
│   ├── list        [--headless] [--incremental] [--page-size] [--output] [--timeout]
│   ├── describe    --job-id
│   ├── logs        --job-id [--output]
│   ├── metrics     --job-id [--json] [--output]
│   ├── stop        --job-id
│   └── delete      --job-id [--yes]
└── eval
    ├── list        [--page-size] [--output]
    ├── logs        --task-id [--output]
    ├── metrics     --task-id [--json]
    └── create      (skeleton)
```

## Authentication Middleware

A shared authentication middleware will be introduced in `src/cli/middleware.ts`:

```typescript
export async function ensureCliAuth(): Promise<{ cookieHeader: string }>
```

- Reads cookie from `.taac2026/secrets/taiji-cookie.txt`
- Throws clear error if not found, pointing user to `taac2026 login`
- Returns the cookie header string for API calls

All commands that need authentication will call this instead of parsing `--cookie-file`.

## Impact on Existing Code

- **No business logic changes** — only command option definitions and registration are modified
- Existing API functions (`fetchTrainingJobs`, `fetchJobDetail`, etc.) are unchanged
- Existing utils (`resolveTaijiOutputDir`, `toCsv`, etc.) are unchanged
- The `train list` implementation will be split: detail/logs/metrics extraction moves to `train describe`
- `prepare.ts` and `submit.ts` lose file-dir/generic-file handling code paths

## Risks

1. **Breaking change** — all existing scripts/cron jobs using old option names will break. Mitigation: document migration in PR.
2. **Default execute vs dry-run** — submit now executes by default. Mitigation: `--yes` still required for safety.
3. **train describe extraction** — splitting list implementation may introduce bugs. Mitigation: test against existing data.
