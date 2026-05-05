---
name: taiji-metrics-scraper
description: Scrape Tencent TAAC / Taiji training pages for Job IDs, Job Names, Job Descriptions, all training code files, instances, checkpoints, logs, and all Metrics; compare YAML configs such as config.yaml across versions; prepare TAAC experiment submissions; and optionally upload/start Taiji jobs through the captured API flow. Use when the user asks to crawl taiji.algo.qq.com/training, TAAC training jobs, Tencent Angel Machine Learning Platform outputs, ckpt pages, pod logs, config.yaml or arbitrary job code files, compare two config.yaml files, tf_events metrics, or wants a reusable backend/script workflow for TAAC metrics, logs, code files, config diffs, or code/config submission to Taiji.
---

# TAAC Metrics Scraper

## Workflow

1. Confirm the target is `https://taiji.algo.qq.com/training` or a `/training/ckpt/.../<instanceId>` page.
2. Run bundled scripts from the user's workspace root so `taiji-output/` is written there. Replace `<SKILL_DIR>` below with this skill directory, for example `.codex/skills/taiji-metrics-scraper` in a vendored repo install.
3. If creating a standalone scraper workspace instead, copy the relevant scripts and create a minimal `package.json` using `references/package-json.md`.
4. Install dependencies with `npm install` and, if needed, `npx playwright install chromium`.
5. Add `taiji-output/` to `.gitignore`. Scripts default all local outputs, browser profile, submit bundles, and live submit records under this directory.
6. Capture a browser Cookie from the user if Playwright login triggers verification or rate limiting.
7. Run the scraper and verify output row counts.

## Commands

For all training jobs:

```powershell
node <SKILL_DIR>/scripts/scrape-taiji.mjs --all --cookie-file taiji-output/secrets/taiji-cookie.txt --headless
```

Incremental sync still scans the full Job list, but skips deep fetching for cached terminal Jobs whose `updateTime`, `status`, and `jzStatus` are unchanged:

```powershell
node <SKILL_DIR>/scripts/scrape-taiji.mjs --all --incremental --cookie-file taiji-output/secrets/taiji-cookie.txt --direct
```

For servers where Chromium page fetch fails, use backend direct HTTP mode:

```powershell
node <SKILL_DIR>/scripts/scrape-taiji.mjs --all --cookie-file taiji-output/secrets/taiji-cookie.txt --direct
```

For a single ckpt page:

```powershell
node <SKILL_DIR>/scripts/scrape-taiji.mjs --url "<TAAC_CKPT_URL>" --cookie-file taiji-output/secrets/taiji-cookie.txt --headless
```

Compare two YAML config files:

```powershell
node <SKILL_DIR>/scripts/compare-config-yaml.mjs old-config.yaml new-config.yaml
node <SKILL_DIR>/scripts/compare-config-yaml.mjs old-config.yaml new-config.yaml --json --out diff.json
```

Prepare a local-agent experiment submission package:

```powershell
node <SKILL_DIR>/scripts/prepare-taiji-submit.mjs --template-job-url "<TEMPLATE_JOB_URL>" --zip ".\artifacts\exp.zip" --config ".\configs\exp.yaml" --name "exp_017" --description "try focal loss"
```

Submit file priority:

1. Prefer primary files: `--zip <code.zip>`, `--config <config.yaml>`, and optional `--run-sh <run.sh>`.
2. Use `--file-dir <dir>` for a directory of direct trainFiles. It auto-detects `code.zip`, `config.yaml`, and `run.sh`; every other direct file becomes generic. Subdirectories are ignored.
3. Use repeatable `--file <path[=name]>` only for single-file generic replacements or local-to-template name mapping.

The names `code.zip`, `config.yaml`, and `run.sh` are reserved primary names and cannot be supplied through `--file`.
`prepare --run` only records run intent in the manifest; it does not start training by itself.

Dry-run live submit plan:

```powershell
node <SKILL_DIR>/scripts/submit-taiji.mjs --bundle taiji-output/submit-bundle --cookie-file taiji-output/secrets/taiji-cookie.txt --template-job-internal-id <TEMPLATE_JOB_INTERNAL_ID>
```

Live upload/create only. Do not add `--run` unless the user explicitly asks to start training:

```powershell
node <SKILL_DIR>/scripts/submit-taiji.mjs --bundle taiji-output/submit-bundle --cookie-file taiji-output/secrets/taiji-cookie.txt --template-job-internal-id <TEMPLATE_JOB_INTERNAL_ID> --execute --yes
```

Live upload/create/run, only after explicit user confirmation:

```powershell
node <SKILL_DIR>/scripts/submit-taiji.mjs --bundle taiji-output/submit-bundle --cookie-file taiji-output/secrets/taiji-cookie.txt --template-job-internal-id <TEMPLATE_JOB_INTERNAL_ID> --execute --yes --run
```

If the template Job does not already contain `code.zip`, `config.yaml`, requested `run.sh`, or requested generic `--file` / `--file-dir` names, `submit-taiji.mjs` fails by default. Use `--allow-add-file` only when intentionally adding new `trainFiles`.

Use longer auth waiting only when interactive login is required:

```powershell
node <SKILL_DIR>/scripts/scrape-taiji.mjs --all --auth-timeout 600000
```

## Cookie Handling

Treat cookies as secrets. Do not print them back, commit them, or include them in final answers.

If the user sees "operation too frequent" or a verification loop, do not keep retrying interactive login. Ask them to copy the Cookie header or `Copy as cURL` from the successful normal browser request. Follow `references/workflow.md` for the exact DevTools flow.

If both Playwright mode and `--direct` return `401`, treat the cookie as invalid for that machine or request context. Ask for a fresh complete `Copy as cURL` from the browser that can access the page, then test that cURL on the target machine before changing scraper logic.

## Output Contract

The scraper writes to `taiji-output/` by default:

- `jobs.json`: complete raw and normalized data, keyed by `jobsById[jobId].instancesById[instanceId]`, with log file metadata.
- `jobs-summary.csv`: one row per Job ID; reruns update Job Name and Job Description.
- `all-checkpoints.csv`: checkpoint rows with `jobId` and `instanceId`.
- `all-metrics-long.csv`: long-form metric rows with `jobId`, `instanceId`, `metric`, `chart`, `series`, `step`, `value`.
- `logs/<jobId>/<instanceId>.json` and `.txt`: pod logs for every instance.
- `code/<jobId>/job-detail.json`: full Job detail response, including `trainFiles` when available.
- `code/<jobId>/train-files.json`: train file metadata plus download status.
- `code/<jobId>/files/...`: best-effort downloaded training code files, preserving path structure when possible.
- `browser-profile/`: Playwright persistent browser state for interactive auth fallback.
- `config-diffs/`: config diff files when `compare-config-yaml.mjs --out <file>` is used with a relative path.
- `submit-bundle/`: default prepared local submission bundle.
- `submit-live/<timestamp>/`: dry-run plans and live submit/run results.
- `secrets/`: recommended local location for `taiji-cookie.txt` or captured headers. Never commit this directory.

## Config Diff Tool

Use `scripts/compare-config-yaml.mjs` to compare two YAML files semantically instead of line-by-line. It parses YAML, flattens nested maps/lists into stable paths, and reports `added`, `removed`, and `changed` entries.

When `--out` is a relative path, the diff is written under `taiji-output/`; a bare filename such as `diff.json` becomes `taiji-output/config-diffs/diff.json`.

Use path identity like `model.lr`, `train.batch_size`, and `layers[1]` when explaining changes. Prefer `--json` when downstream scripts need machine-readable output.

Use `jobId + instanceId` to distinguish multiple runs under one Job ID. Use `jobId + instanceId + metric + series + step` for metric row identity.

## Submit Training Workflow

Use `scripts/prepare-taiji-submit.mjs` when a local agent needs to package the intended Taiji submission. It validates prepared trainFiles, records the Git commit/status when available, writes a manifest, and captures whether the agent should run after submission.

Use `scripts/submit-taiji.mjs` for the captured Taiji API path. It is dry-run by default. Live execution requires `--execute --yes`, and starting training additionally requires `--run`.

For a minimal `code.zip + run.sh + config.yaml` package shape, load `examples/minimal-taiji-submit/README.md`. The submit script replaces `code.zip` and `config.yaml` by default; pass `--run-sh` to prepare an explicit `run.sh` overwrite. For legacy templates with loose files such as `main.py` and `dataset.py`, prefer `--file-dir` for a whole directory, or pass repeatable `--file` entries so the manifest records those replacements explicitly.

The intended live workflow is:

1. Commit or record the local code state.
2. Reuse a known-good template Job instead of creating a blank Job.
3. Copy the template Job.
4. Replace the code zip and config file; replace `run.sh` only when `--run-sh` or `--file-dir` prepared it; replace generic files only when `--file-dir` or `--file` prepared them. The template must already contain matching trainFiles unless `--allow-add-file` is used.
5. Fill Job Name and Job Description.
6. Submit the new Job.
7. Optionally click Run and return the new Job ID, Job URL, and instance result.

Live submit uses the captured "Copy Job -> upload trainFiles to COS -> submit -> run" flow. Load `references/submit-workflow.md` before debugging live submission.

## Implementation Notes

- Job list endpoint is GET.
- Instance list endpoint is POST with JSON body, not query params.
- Metrics endpoint may return each metric as an array of chart objects; flatten all charts.
- Job list rows do not include training code files. Fetch Job detail via `/taskmanagement/api/v1/webtasks/external/task/{jobInternalId}` and read all of `data.trainFiles`, not only `config.yaml`.
- Training code file download depends on whether `trainFiles[].path` is a directly fetchable URL/path. Always save `job-detail.json` and `train-files.json` even when some file content downloads fail.
- Some failed or interrupted instances legitimately have zero metrics.
- `--direct` bypasses Chromium and uses Node `fetch` with the Cookie header. It helps on headless servers, but it cannot fix an expired, IP-bound, or fingerprint-bound login token.
- The output CSV can be large. Prefer streaming or long-form CSV for downstream analysis instead of loading the whole file into memory for ad hoc transformations.

Load `references/workflow.md` when debugging endpoint behavior, auth, empty instances, or metric flattening.
