# Eval Prepare & Submit Commands Design

**Date**: 2026-05-09
**Author**: Claude
**Status**: Draft

## Problem

The TAAC2026 CLI currently has `eval list`, `eval logs`, `eval metrics` commands but lacks `eval prepare` and `eval submit` to create and submit evaluation tasks. This mirrors the existing `train prepare` / `train submit` workflow.

## Architecture

```
eval prepare                    eval submit
──────────                      ──────────
source/ → scan files            bundle/ → read manifest.json
         ↓ copy to files/                  ↓
         ↓ create manifest.json            → ensureCliAuth()
         │   + name, description, files     → GET /aide/api/evaluation_tasks/get_template/
         ↓ create NEXT_STEPS.md              (get creator, image_name)
bundle/                                      ↓
                                             → GET federation token → upload files to COS
                                             → POST /aide/api/evaluation_tasks/
                                                (with user-provided --mould-id)
                                             ↓
                                             result.json
```

## Command: eval prepare

### Options

```
--name <name>              (required)   Job name
--source <dir>             (required)   Source directory containing eval code
--include <patterns>       (optional)   Comma-separated glob patterns to include
--exclude <patterns>       (optional)   Comma-separated patterns to exclude
--description <text>       (optional)   Job description
--output <dir>             (optional)   Output directory (default: eval-bundle)
```

### Behavior

- Scans source directory for files matching patterns: `.py`, `.sh`, `.json`, `.yaml`, `.yml`, `.toml`, `.txt`, `.cfg`, `.ini`
- Copies files to `files/` subdirectory preserving relative paths
- Creates `manifest.json` with:
  - `schemaVersion: 1`, `createdAt`, `sourceDir`
  - `job` object with `name` and `description`
  - `files` array with each file entry (`name`, `preparedPath`, `isPrimary`, etc.)
  - `git` info (branch, head, dirty status)
- Creates `NEXT_STEPS.md` guide
- Primary files for eval: `run.sh`, `infer.py`, `model.py`, `dataset.py`
- Output directory default: `taiji-output/eval-bundle/` (mirrors train's `submit-bundle` naming)

## Command: eval submit

### Options

```
--bundle <dir>             (required)   Prepared bundle directory
--mould-id <id>            (required)   Mould/Model ID for evaluation
--yes                      (optional)   Skip confirmation prompt
--dry-run                  (optional)   Preview without uploading
--output <dir>             (optional)   Output directory for plan/result
```

### Behavior

1. **Load bundle**: Read `manifest.json` from bundle directory
2. **Auth**: Call `ensureCliAuth()` for authentication
3. **Get template defaults**: `GET /aide/api/evaluation_tasks/get_template/`
   - Returns `creator`, `image_name` — used in the create payload
4. **Upload to COS**: Same logic as train submit
   - Get federation token via `GET /aide/api/evaluation_tasks/get_federation_token/`
   - Upload files to COS bucket `hunyuan-external-1258344706`, region `ap-guangzhou`
   - Use UUID-based keys to ensure uniqueness
5. **Create evaluation task**: `POST /aide/api/evaluation_tasks/`
   - Payload: `{"mould_id": <user-provided>, "name": <from manifest>, "image_name": <from template>, "creator": <from template>, "files": [...]}`
6. **Safety**: Same `--yes` and `--dry-run` pattern as train submit
7. **Output**: Write `plan.json` (before) and `result.json` (after) to output directory

### COS Upload Details

- Bucket: `hunyuan-external-1258344706`
- Region: `ap-guangzhou`
- Keys: UUID-based like train (e.g., `PREFIX/eval/local--<uuid>/<filename>`)
- Federation token: shared API endpoint with training

## API Client Strategy

Eval submit follows the **same approach as train submit**: inline `fetchJson` using native `fetch()` with cookie headers from `ensureCliAuth()`, rather than the higher-level `fetchJson` from `src/api/client.ts`. This is necessary because COS uploads require raw access and the train submit pattern already established this approach.

### Create Payload Structure

```json
{
  "mould_id": <user-provided>,
  "name": <manifest job.name>,
  "image_name": <from get_template/, may be empty string>,
  "creator": <from get_template/>,
  "files": [
    {
      "name": "dataset.py",
      "path": "<COS_KEY_AFTER_UPLOAD>",
      "mtime": "2026-04-23 11:57:16",
      "size": 30729
    }
  ]
}
```

Note: `image_name` comes from `get_template/` response — use the returned value (which may be empty string).

### Referer Headers

- Train submit uses `referer: ${TAIJI_ORIGIN}/training/create`
- Eval submit uses `referer: ${TAIJI_ORIGIN}/evaluation/create`

## Files Changed

### New files
- `src/cli/commands/eval/prepare.ts`
- `src/cli/commands/eval/submit.ts`

### Modified files
- `src/cli/commands/eval/index.ts` — register new commands
- `src/api/evaluation.ts` — add `fetchEvaluationTemplate()` API function (for consistency, though eval submit uses inline fetch like train submit)

## Eval Prepare: Intentional Differences from Train

- **No `--template-id` option**: Eval submit requires `--mould-id` as a direct user input, so eval prepare doesn't need to store a template reference
- **No `inference/` subdirectory scan**: Eval code is inference-focused; the file scan does NOT include an `inference/` subdir like train does
- **Output directory**: `eval-bundle` (mirrors train's `submit-bundle` naming convention but with `eval` prefix for clarity)

## Shared Code

Eval prepare reuses the file scanning pattern from `train/prepare.ts`. Eval submit reuses:
- COS upload logic from `train/submit.ts` (federation token, COS client, putObject)
- Auth middleware from `middleware.ts`
- Output directory resolution from `utils/output.ts`

COS upload code is nearly identical between train and eval. Consider extracting shared utilities if duplication is significant.

## Testing

- `eval prepare`: scans source dir, copies files preserving paths, creates valid manifest.json
- `eval submit --dry-run`: generates correct plan.json with expected payload structure (no upload or API calls)
- `eval submit --yes`: full live mode — uploads to COS, creates eval task, writes result.json
- `eval submit` without `--yes`: fails with confirmation error
- Federation token retrieval and COS upload to correct bucket/region
- `--mould-id` required: fails if not provided
- `--mould-id` overrides default from API
