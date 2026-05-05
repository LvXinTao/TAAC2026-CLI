# TAAC Metrics Scraper Skill

默认中文说明，English follows.

## 中文

这是一个用于腾讯 TAAC / Taiji 训练平台的 Codex Skill。它面向 `https://taiji.algo.qq.com/training` 和训练输出页面，提供抓取、导出、日志归档、代码文件下载、配置差异比较，以及本地 agent 训练提交准备工作流。

### 能力

- 批量抓取 Job ID、Job Name、Job Description。
- 按 Job 抓取所有实例 `instanceId`，用于区分同一个 Job 下的多次 Run。
- 抓取 Checkpoints、Metrics / `tf_events`、Pod logs。
- 尽力下载训练代码文件，包括但不限于 `config.yaml`。
- 比较两个 YAML 配置文件的语义差异。
- 准备本地 agent 的 Taiji 提交包：代码 zip、config、模板 Job URL、Job Name、Description、是否 Run。

### 安装到 Codex

把整个 `taiji-metrics-scraper` 文件夹放到：

```text
~/.codex/skills/
```

Windows 示例：

```powershell
Copy-Item -Recurse .\taiji-metrics-scraper "$env:USERPROFILE\.codex\skills\"
```

### 依赖

在工作目录中安装运行依赖：

```powershell
npm install
npx playwright install chromium
```

### 抓取全部 Job

先从已经登录成功的正常浏览器复制 TAAC 请求 Cookie，保存为 `taiji-cookie.txt`。不要提交这个文件。

```powershell
node scripts/scrape-taiji.mjs --all --cookie-file taiji-cookie.txt --headless
```

服务器环境中如果 Chromium 页面请求失败，可以用后端直连模式：

```powershell
node scripts/scrape-taiji.mjs --all --cookie-file taiji-cookie.txt --direct
```

### 输出

默认写到 `taiji-output/`：

- `jobs.json`: 完整数据，结构为 `jobsById[jobId].instancesById[instanceId]`。
- `jobs-summary.csv`: Job 摘要；重复抓取会按 Job ID 更新 Name / Description。
- `all-metrics-long.csv`: 全部 Metrics 长表。
- `all-checkpoints.csv`: 全部 checkpoint 行。
- `logs/<jobId>/<instanceId>.txt`: 每个实例的 pod log。
- `code/<jobId>/job-detail.json`: Job detail 原始响应。
- `code/<jobId>/train-files.json`: 训练代码文件索引和下载状态。
- `code/<jobId>/files/...`: 尽力下载的训练代码文件。

### 比较 config.yaml

```powershell
node scripts/compare-config-yaml.mjs old-config.yaml new-config.yaml
node scripts/compare-config-yaml.mjs old-config.yaml new-config.yaml --json --out diff.json
```

这个工具会解析 YAML，并按配置路径报告 `added`、`removed`、`changed`，例如 `model.lr`、`train.batch_size`、`layers[1]`。

### 准备提交和训练

这个 skill 已经加入“本地 agent 一键提交代码并启动训练”的安全准备层。当前脚本会准备提交包，但不会直接上传、点击、提交或启动平台任务。

```powershell
node scripts/prepare-taiji-submit.mjs `
  --template-job-url "https://taiji.algo.qq.com/training/..." `
  --zip ".\artifacts\exp_017.zip" `
  --config ".\configs\exp_017.yaml" `
  --name "exp_017_focal" `
  --description "try focal loss" `
  --run
```

它会生成：

- `taiji-submit/manifest.json`: 模板 Job、文件、Job Name、Description、Git HEAD、dirty 状态。
- `taiji-submit/files/`: 准备上传的 zip 和 config。
- `taiji-submit/NEXT_STEPS.md`: 后续复制 Job、替换文件、提交、Run 的操作说明。

推荐的真实平台流程是：复制一个已成功训练的模板 Job，替换代码 zip 和 config，保持 `run.sh` 不变，填写 Job Name 和 Description，提交后按需 Run。要启用真正的自动上传/启动，需要先从 DevTools 捕获一次完整的手动流程，包括 Copy Job、上传 zip/config、Submit、Run 的请求。

### 安全注意

- `taiji-cookie.txt` 是登录凭据，不要提交、截图或发给别人。
- 如果服务器上 Cookie 返回 `401`，通常是登录态与出口 IP、设备指纹或浏览器环境绑定。先在服务器上测试完整 `Copy as cURL` 是否能返回 `200`。
- 公开仓库中不应包含 Cookie、抓取输出、训练代码、配置或平台私有数据。
- 提交训练脚本在未校准上传接口前只做准备，不做平台写操作，避免误提交或误启动任务。

## English

This is a Codex Skill for Tencent TAAC / Taiji training platform workflows. It targets `https://taiji.algo.qq.com/training` and output pages, and supports scraping, exporting, log archiving, training-code downloads, YAML config diffs, and local-agent experiment submission preparation.

### Features

- Scrape Job ID, Job Name, and Job Description in bulk.
- Scrape all instances under each Job ID, so multiple runs are distinguishable.
- Scrape checkpoints, metrics / `tf_events`, and pod logs.
- Best-effort download of training code files, including but not limited to `config.yaml`.
- Semantic diff for two YAML config files.
- Prepare a local-agent Taiji submission bundle: code zip, config, template Job URL, Job Name, Description, and run-after-submit intent.

### Install Into Codex

Place the entire `taiji-metrics-scraper` folder under:

```text
~/.codex/skills/
```

### Dependencies

Install runtime dependencies in your working directory:

```bash
npm install
npx playwright install chromium
```

### Scrape All Jobs

Copy a valid TAAC request Cookie from a normal logged-in browser and save it as `taiji-cookie.txt`. Never commit this file.

```bash
node scripts/scrape-taiji.mjs --all --cookie-file taiji-cookie.txt --headless
```

On servers where Chromium page fetch fails, use backend direct mode:

```bash
node scripts/scrape-taiji.mjs --all --cookie-file taiji-cookie.txt --direct
```

### Outputs

The default output directory is `taiji-output/`:

- `jobs.json`: full data keyed by `jobsById[jobId].instancesById[instanceId]`.
- `jobs-summary.csv`: Job summary; repeated runs update Name / Description by Job ID.
- `all-metrics-long.csv`: all metrics in long-table format.
- `all-checkpoints.csv`: all checkpoint rows.
- `logs/<jobId>/<instanceId>.txt`: pod logs for each instance.
- `code/<jobId>/job-detail.json`: raw Job detail response.
- `code/<jobId>/train-files.json`: training code file index and download status.
- `code/<jobId>/files/...`: best-effort downloaded training code files.

### Compare YAML Configs

```bash
node scripts/compare-config-yaml.mjs old-config.yaml new-config.yaml
node scripts/compare-config-yaml.mjs old-config.yaml new-config.yaml --json --out diff.json
```

The diff tool parses YAML and reports semantic `added`, `removed`, and `changed` entries by config path.

### Prepare Submit And Run

This skill includes a safe preparation layer for the local-agent "submit code and start training" workflow. The current script prepares a submission bundle, but does not upload, click, submit, or start a platform job.

```bash
node scripts/prepare-taiji-submit.mjs \
  --template-job-url "https://taiji.algo.qq.com/training/..." \
  --zip "./artifacts/exp_017.zip" \
  --config "./configs/exp_017.yaml" \
  --name "exp_017_focal" \
  --description "try focal loss" \
  --run
```

It writes:

- `taiji-submit/manifest.json`: template Job, files, Job Name, Description, Git HEAD, and dirty status.
- `taiji-submit/files/`: the zip and config prepared for upload.
- `taiji-submit/NEXT_STEPS.md`: follow-up instructions for copying the Job, replacing files, submitting, and running.

The recommended live platform flow is to copy a known-good template Job, replace the code zip and config, keep `run.sh` unchanged, fill Job Name and Description, submit, then optionally run. To enable real automatic upload/start, first capture one complete manual DevTools flow for Copy Job, upload zip/config, Submit, and Run.

### Security

- `taiji-cookie.txt` is a login credential. Do not commit, screenshot, or share it.
- If the server returns `401` with a copied Cookie, the login state may be bound to IP, fingerprint, or browser context. First test a full `Copy as cURL` on the target server.
- The public repository must not contain cookies, scraped outputs, training code, configs, or private platform data.
- Submission tooling only prepares local artifacts until the upload interface is calibrated, avoiding accidental platform mutations.
