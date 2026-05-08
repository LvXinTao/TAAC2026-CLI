---
name: taac2026-cli
description: >
  Reference guide for the taac2026 CLI — a Node.js command-line tool for managing training and evaluation tasks on the TAAC2026 / Taiji platform. Use whenever the user mentions taac2026, Taiji, training tasks, evaluation tasks, task submission, model training on Taiji, COS upload for training, job management on the Taiji platform, or asks about any taac2026 subcommand (login, train prepare/submit/run/list/describe/logs/metrics/stop/delete, eval list/logs/metrics). Also use when debugging CLI errors, authentication issues, API calls, or output file paths related to this project.
---

# TAAC2026 CLI Reference

## Overview

`taac2026` is a Node.js CLI (`commander`-based) for managing experiments on the TAAC2026 / Taiji platform. It handles authentication, training task lifecycle (prepare → submit → run), and evaluation task management.

**Binary**: `taac2026` (from `dist/cli/index.js` after `npm run build`)
**Dev**: `npm run dev` runs via `tsx` without building.

---

## Authentication

All commands require authentication via a manually saved cookie:

Save your Taiji cookie as `.taac2026/secrets/taiji-cookie.txt`. All subsequent commands read this file automatically.

---

## Training Tasks (train)

### Workflow

The standard training task lifecycle:

```
train prepare → train submit → train run
```

1. **prepare** — Scan source code, create a bundle with `manifest.json`
2. **submit** — Upload bundle to COS (Tencent Cloud Object Storage), create training task via API
3. **run** — Start the created (but not yet running) training task

### Command Reference

#### `train prepare` — Prepare submission bundle

Pure local operation, no API calls.

```bash
taac2026 train prepare \
  --name <task-name> \
  --source <source-dir> \
  [--template-id <template-task-id>] \
  [--description <desc>] \
  [--include "*.py,*.sh"] \
  [--exclude "*.pyc,__pycache__"] \
  [--output submit-bundle]
```

- **Scans** for `.py`, `.sh`, `.json`, `.yaml`, `.yml`, `.toml`, `.txt`, `.cfg`, `.ini`
- **Always includes** `inference/` subdirectory
- **Excludes** `__pycache__`, `*.pyc`, `*.egg-info`, `.git`, `.DS_Store`, `inference/` (top-level) by default
- **Outputs** in the bundle directory:
  - `manifest.json` — template ID, task name, file list, git info
  - `NEXT_STEPS.md` — next steps guide
  - `files/` — source file copies (relative paths preserved)

#### `train submit` — Upload to COS & create task

```bash
taac2026 train submit \
  --bundle <bundle-dir> \
  [--template-id <template-id>] \
  [--gpu-num <gpu-count>] \
  [--yes] \
  [--dry-run] \
  [--output taiji-output/submit-live/<timestamp>]
```

- **APIs called** (in order):
  1. `GET /aide/api/evaluation_tasks/get_federation_token/` — COS federation token
  2. `GET /taskmanagement/api/v1/webtasks/external/task/{internalId}` — template task metadata
  3. `PUT COS` — upload each file to `hunyuan-external-1258344706` bucket, `ap-guangzhou` region
  4. `POST /taskmanagement/api/v1/webtasks/external/task` — create training task
- **Outputs**:
  - `plan.json` — execution plan (upload list, COS paths, creation params)
  - `result.json` — execution result (taskId, upload details, creation response)
- `--template-id` is required only if not present in `manifest.json`

#### `train run` — Start training

```bash
taac2026 train run --task-id <taskId> [--output taiji-output/train-jobs]
```

- API: `POST /taskmanagement/api/v1/webtasks/{taskId}/start`
- Output: `run-{taskId}.json`

#### `train list` — List training tasks

```bash
taac2026 train list \
  [--incremental] \
  [--page-size 100] \
  [--output taiji-output]
```

- API: `GET /taskmanagement/api/v1/webtasks/external/task` (paginated, requires cookie auth)
- `--incremental` skips unchanged finished tasks
- Outputs: `jobs.json` (task mapping), `jobs-summary.csv`

#### `train describe` — Full task details

```bash
taac2026 train describe --job-id <taskId> [--output taiji-output/train-jobs]
taac2026 train describe --all [--output taiji-output/train-jobs]
```

- `--job-id` and `--all` are mutually exclusive
- **APIs called**:
  1. `GET /taskmanagement/api/v1/webtasks/external/task/{internalId}` — task details
  2. `POST /taskmanagement/api/v1/instances/list` — all instances
  3. `GET /taskmanagement/api/v1/instances/external/{instanceId}/get_ckpt` — checkpoints
  4. `GET /taskmanagement/api/v1/instances/external/{instanceId}/tf_events` — training metrics
  5. `GET /taskmanagement/api/v1/instances/{instanceId}/pod_log` — pod logs
- Outputs: `job-{taskId}.json`, `job-{taskId}-metrics.csv`, `job-{taskId}-checkpoints.csv`, `logs/{taskId}/{instanceId}.{json,txt}`

#### `train logs` — Pod logs only

```bash
taac2026 train logs --job-id <taskId> [--output taiji-output/train-jobs]
```

- APIs: instances list + pod log per instance
- Outputs: `logs/{taskId}/{instanceId}.{json,txt}`

#### `train metrics` — Training metrics (loss, AUC, etc.)

```bash
taac2026 train metrics --job-id <taskId> [--json] [--output taiji-output/train-jobs/metrics]
```

- APIs: instances list + tf_events + checkpoints
- `--json` prints to stdout instead of writing CSV
- Output: `metrics-job-{taskId}.csv` (CSV mode only)

#### `train stop` — Stop training

```bash
taac2026 train stop --task-id <taskId> [--output taiji-output/train-jobs]
```

- APIs: instances list (takes first instance) → `POST /taskmanagement/api/v1/instances/{instanceId}/kill`
- Output: `stop-{taskId}.json`

#### `train delete` — Delete training task (permanent)

```bash
taac2026 train delete --job-internal-id <numericId> [--yes]
```

- Requires **numeric internal ID** (not the `angel_training_...` string)
- API: `DELETE /taskmanagement/api/v1/webtasks/external/task/{internalId}`
- No output file (prints to console)

---

## Evaluation Tasks (eval)

#### `eval list` — List eval tasks with logs

```bash
taac2026 eval list [--page-size 100] [--output taiji-output]
```

- APIs: `GET /aide/api/evaluation_tasks/` (paginated) + `GET /aide/api/evaluation_tasks/event_log/` per task
- Outputs: `eval-tasks.json`, `eval-tasks-summary.csv`, `eval-jobs/logs/{taskId}.{json,txt}`

#### `eval logs` — Eval task logs

```bash
taac2026 eval logs --task-id <taskId> [--output taiji-output/eval-jobs/logs]
```

- API: `GET /aide/api/evaluation_tasks/event_log/`
- Outputs: `{taskId}.{json,txt}`

#### `eval metrics` — Eval metrics (score, AUC)

```bash
taac2026 eval metrics --task-id <taskId> [--json] [--output taiji-output/eval-jobs/metrics]
```

- API: `GET /aide/api/evaluation_tasks/` (finds the task in the list)
- `--json` prints to stdout
- Output: `{taskId}.json` (non-JSON mode only)

#### `eval create` — Create eval task

Not yet implemented (stub only).

---

## ID Types

Two different ID types exist on the platform. Using the wrong one is a common source of errors.

| ID Type | Example | Used By |
|---------|---------|---------|
| **taskID (string)** | `angel_training_ams_2026_...` | `run`, `stop`, `logs`, `metrics`, `describe` |
| **jobInternalId (numeric)** | `74958` | `delete` only, and internal API paths |

You can find both in `taiji-output/jobs.json` (`jobId` = taskID, `jobInternalId` = numeric) or in `submit`'s `result.json`.

---

## Output Directory Structure

```
taiji-output/
├── jobs.json                          # Training task list mapping
├── jobs-summary.csv                   # Training task summary
├── submit-live/YYYY-MM-DDTHH-MM-SS/   # Submit results (per timestamp)
│   ├── plan.json
│   └── result.json
├── train-jobs/
│   ├── job-{taskId}.json              # Full task details
│   ├── job-{taskId}-metrics.csv       # Training metrics
│   ├── job-{taskId}-checkpoints.csv   # Checkpoints
│   ├── run-{taskId}.json              # Run result
│   ├── stop-{taskId}.json             # Stop result
│   ├── logs/{taskId}/{instanceId}.{json,txt}  # Pod logs
│   └── metrics/metrics-job-{taskId}.csv       # Metrics CSV
├── eval-tasks.json                    # Eval task details (with logs)
├── eval-tasks-summary.csv             # Eval task summary
└── eval-jobs/
    ├── logs/{taskId}.{json,txt}       # Eval logs
    └── metrics/{taskId}.json          # Eval metrics
```

---

## Key APIs

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `GET /aide/api/evaluation_tasks/` | Cookie | List eval tasks |
| `GET /aide/api/evaluation_tasks/get_federation_token/` | Cookie | Get COS upload token |
| `GET /aide/api/evaluation_tasks/event_log/` | Cookie | Get eval task logs |
| `GET /taskmanagement/api/v1/webtasks/external/task` | Browser | List training tasks (paginated) |
| `GET /taskmanagement/api/v1/webtasks/external/task/{internalId}` | Cookie | Get training task details |
| `POST /taskmanagement/api/v1/webtasks/external/task` | Cookie | Create training task |
| `POST /taskmanagement/api/v1/webtasks/{taskId}/start` | Cookie | Start training task |
| `DELETE /taskmanagement/api/v1/webtasks/external/task/{internalId}` | Cookie | Delete training task |
| `POST /taskmanagement/api/v1/instances/list` | Cookie | List task instances |
| `GET /taskmanagement/api/v1/instances/{instanceId}/pod_log` | Cookie | Get pod logs |
| `POST /taskmanagement/api/v1/instances/{instanceId}/kill` | Cookie | Kill instance |
| `GET /taskmanagement/api/v1/instances/external/{instanceId}/tf_events` | Cookie | Get training metrics |
| `GET /taskmanagement/api/v1/instances/external/{instanceId}/get_ckpt` | Cookie | Get checkpoint info |

---

## Common Workflows

### Submit a new training task

```bash
# 1. Prepare bundle from source code
taac2026 train prepare --name my-model --source ./my-model-src

# 2. Upload and create task (use template-id if not in manifest)
taac2026 train submit --bundle submit-bundle --template-id angel_training_ams_xxx

# 3. Start training
taac2026 train run --task-id $(cat taiji-output/submit-live/*/result.json | jq -r '.taskId')
```

### Monitor a running training task

```bash
# Check task details, metrics, and logs
taac2026 train describe --job-id angel_training_ams_xxx

# Or just logs
taac2026 train logs --job-id angel_training_ams_xxx

# Or just metrics
taac2026 train metrics --job-id angel_training_ams_xxx
```

### Stop and clean up

```bash
# Stop the running instances
taac2026 train stop --task-id angel_training_ams_xxx

# Delete the task permanently (needs numeric internal ID)
taac2026 train delete --job-internal-id 74958
```
