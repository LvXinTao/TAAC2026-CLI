# Taiji Submit Workflow

This note captures the local-agent submission idea discussed in session
`019df75c-87e1-72f3-adf8-293a9a38d3f5`.

## Goal

Let a local agent take a code change from the workspace, prepare the Taiji
training assets, submit them to the platform, start training, and return the
new Job ID / instance ID, similar to a code commit workflow.

Target command shape:

```powershell
node scripts/prepare-taiji-submit.mjs `
  --template-job-url "https://taiji.algo.qq.com/training/..." `
  --zip ".\artifacts\exp_017.zip" `
  --config ".\configs\exp_017.yaml" `
  --name "exp_017_focal" `
  --description "try focal loss" `
  --run
```

Higher-level wrappers can combine this with Git:

```powershell
git add .
git commit -m "try focal loss"
node scripts/prepare-taiji-submit.mjs --template-job-url "<url>" --zip ".\artifacts\exp.zip" --config ".\config.yaml" --name "exp_017" --description "try focal loss" --run
```

## Preferred Platform Flow

Use "Copy existing Job" instead of "Create blank Job".

Reasoning:

- The template already has working environment, image, entrypoint, and platform
  fields.
- `run.sh` may be hard to delete or recreate safely, so keep it unchanged by
  default.
- Most experiments only need a new code zip, a new config file, Job Name, and
  Job Description.

Live flow:

1. Open a known-good template Job.
2. Click Copy.
3. Replace uploaded code zip and config file.
4. Keep `run.sh` unchanged unless the experiment explicitly requires changing it.
5. Fill Job Name.
6. Fill Job Description.
7. Submit the copied Job.
8. Click Run if requested.
9. Return Job URL, Job ID, and first instance ID.

## Known API Clues

Existing scraper work identified these useful endpoints:

- Job list: `GET /taskmanagement/api/v1/webtasks/external/task?pageNum=0&pageSize=10`
- Job detail: `GET /taskmanagement/api/v1/webtasks/external/task/{jobInternalId}`
- Instance list: `POST /taskmanagement/api/v1/instances/list`
- Likely create/update Job: `POST /taskmanagement/api/v1/webtasks/external/task`
- Likely start Job: `POST /taskmanagement/api/v1/webtasks/{taskID}/start`

The unresolved part is file upload: the platform may upload code/config to an
object store first, then place returned file metadata into `trainFiles`.

## Before Enabling Live Submit

Capture one successful manual flow in DevTools from the same browser context:

1. Filter Network to Fetch/XHR.
2. Copy the requests for Copy Job, upload code zip, upload config, submit Job,
   and Run.
3. Save sanitized request URLs, methods, payload shapes, and response shapes.
4. Do not commit cookies, tokens, or private code.
5. Only then add a live `submit-taiji.mjs` implementation that replays the
   stable API path or calibrated browser selectors.

## Safe Current Tool

`scripts/prepare-taiji-submit.mjs` intentionally does not upload or click. It:

- Validates the code zip and config file.
- Copies both files into a deterministic `taiji-submit/files/` directory.
- Records Job Name, Job Description, template URL, and `runAfterSubmit`.
- Records Git root, branch, HEAD, and dirty status when available.
- Writes `manifest.json` and `NEXT_STEPS.md`.

This gives a local agent a consistent handoff point without risking accidental
platform mutations.
