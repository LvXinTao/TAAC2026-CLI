# TAAC Metrics Scraper Skill

默认中文说明，English follows.

## 中文

这是一个用于腾讯 TAAC / Taiji 训练平台的 Codex Skill。它面向 `https://taiji.algo.qq.com/training` 和训练输出页面，提供抓取、导出、日志归档、代码文件下载、配置差异比较，以及本地 agent 训练提交/启动工作流。

### 能力

- 批量抓取 Job ID、Job Name、Job Description。
- 按 Job 抓取所有实例 `instanceId`，用于区分同一个 Job 下的多次 Run。
- 抓取 Checkpoints、Metrics / `tf_events`、Pod logs。
- 尽力下载训练代码文件，包括但不限于 `config.yaml`。
- 比较两个 YAML 配置文件的语义差异。
- 准备并可显式执行本地 agent 的 Taiji 提交流程：代码 zip、config、模板 Job URL、Job Name、Description、是否 Run。

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

先从已经登录成功的正常浏览器复制 TAAC 请求 Cookie，推荐保存为 `taiji-output/secrets/taiji-cookie.txt`。不要提交这个文件。

```powershell
node scripts/scrape-taiji.mjs --all --cookie-file taiji-output/secrets/taiji-cookie.txt --headless
```

服务器环境中如果 Chromium 页面请求失败，可以用后端直连模式：

```powershell
node scripts/scrape-taiji.mjs --all --cookie-file taiji-output/secrets/taiji-cookie.txt --direct
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
- `browser-profile/`: Playwright 登录态目录。
- `config-diffs/`: `compare-config-yaml.mjs --out <file>` 使用相对路径时的输出目录。
- `submit-bundle/`: 默认提交准备包。
- `submit-live/<timestamp>/`: dry-run 计划和 live submit/run 结果。
- `secrets/`: 推荐放 Cookie/HAR header 等本地敏感输入。

### 比较 config.yaml

```powershell
node scripts/compare-config-yaml.mjs old-config.yaml new-config.yaml
node scripts/compare-config-yaml.mjs old-config.yaml new-config.yaml --json --out diff.json
```

这个工具会解析 YAML，并按配置路径报告 `added`、`removed`、`changed`，例如 `model.lr`、`train.batch_size`、`layers[1]`。`--out` 给相对路径时会写入 `taiji-output/`；只给文件名时会写入 `taiji-output/config-diffs/`。

### 准备提交和训练

这个 skill 已经加入“本地 agent 一键提交代码并启动训练”的工作流。`prepare-taiji-submit.mjs` 只准备提交包；`submit-taiji.mjs` 默认 dry-run，只有显式 `--execute --yes` 才会上传并创建 Job，额外加 `--run` 才会启动训练。

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

- `taiji-output/submit-bundle/manifest.json`: 模板 Job、文件、Job Name、Description、Git HEAD、dirty 状态。
- `taiji-output/submit-bundle/files/`: 准备上传的 zip 和 config。
- `taiji-output/submit-bundle/NEXT_STEPS.md`: 后续复制 Job、替换文件、提交、Run 的操作说明。

dry-run:

```powershell
node scripts/submit-taiji.mjs --bundle taiji-output/submit-bundle --cookie-file taiji-output/secrets/taiji-cookie.txt --template-job-internal-id 58620
```

live 上传、创建并启动：

```powershell
node scripts/submit-taiji.mjs --bundle taiji-output/submit-bundle --cookie-file taiji-output/secrets/taiji-cookie.txt --template-job-internal-id 58620 --execute --yes --run
```

### 安全注意

- Cookie 是登录凭据，不要提交、截图或发给别人；推荐放在 `taiji-output/secrets/`。
- 如果服务器上 Cookie 返回 `401`，通常是登录态与出口 IP、设备指纹或浏览器环境绑定。先在服务器上测试完整 `Copy as cURL` 是否能返回 `200`。
- 公开仓库中不应包含 Cookie、抓取输出、训练代码、配置或平台私有数据。
- 提交训练脚本默认 dry-run，live 写操作必须显式使用 `--execute --yes`，启动训练必须额外使用 `--run`。

## English

This is a Codex Skill for Tencent TAAC / Taiji training platform workflows. It targets `https://taiji.algo.qq.com/training` and output pages, and supports scraping, exporting, log archiving, training-code downloads, YAML config diffs, and local-agent experiment submission/start workflows.

### Features

- Scrape Job ID, Job Name, and Job Description in bulk.
- Scrape all instances under each Job ID, so multiple runs are distinguishable.
- Scrape checkpoints, metrics / `tf_events`, and pod logs.
- Best-effort download of training code files, including but not limited to `config.yaml`.
- Semantic diff for two YAML config files.
- Prepare and explicitly execute a local-agent Taiji submission flow: code zip, config, template Job URL, Job Name, Description, and run-after-submit intent.

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

Copy a valid TAAC request Cookie from a normal logged-in browser and preferably save it as `taiji-output/secrets/taiji-cookie.txt`. Never commit this file.

```bash
node scripts/scrape-taiji.mjs --all --cookie-file taiji-output/secrets/taiji-cookie.txt --headless
```

On servers where Chromium page fetch fails, use backend direct mode:

```bash
node scripts/scrape-taiji.mjs --all --cookie-file taiji-output/secrets/taiji-cookie.txt --direct
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
- `browser-profile/`: Playwright persistent auth profile.
- `config-diffs/`: output for `compare-config-yaml.mjs --out <file>` when a relative path is used.
- `submit-bundle/`: default prepared submit bundle.
- `submit-live/<timestamp>/`: dry-run plans and live submit/run results.
- `secrets/`: recommended local location for Cookie/HAR headers.

### Compare YAML Configs

```bash
node scripts/compare-config-yaml.mjs old-config.yaml new-config.yaml
node scripts/compare-config-yaml.mjs old-config.yaml new-config.yaml --json --out diff.json
```

The diff tool parses YAML and reports semantic `added`, `removed`, and `changed` entries by config path. Relative `--out` values are written under `taiji-output/`; a bare filename is written under `taiji-output/config-diffs/`.

### Prepare Submit And Run

This skill includes a local-agent "submit code and start training" workflow. `prepare-taiji-submit.mjs` only prepares a bundle; `submit-taiji.mjs` is dry-run by default. Live upload/create requires `--execute --yes`; starting training also requires `--run`.

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

- `taiji-output/submit-bundle/manifest.json`: template Job, files, Job Name, Description, Git HEAD, and dirty status.
- `taiji-output/submit-bundle/files/`: the zip and config prepared for upload.
- `taiji-output/submit-bundle/NEXT_STEPS.md`: follow-up instructions for copying the Job, replacing files, submitting, and running.

Dry-run:

```bash
node scripts/submit-taiji.mjs --bundle taiji-output/submit-bundle --cookie-file taiji-output/secrets/taiji-cookie.txt --template-job-internal-id 58620
```

Live upload, create, and start:

```bash
node scripts/submit-taiji.mjs --bundle taiji-output/submit-bundle --cookie-file taiji-output/secrets/taiji-cookie.txt --template-job-internal-id 58620 --execute --yes --run
```

### Security

- Cookies are login credentials. Do not commit, screenshot, or share them; prefer `taiji-output/secrets/`.
- If the server returns `401` with a copied Cookie, the login state may be bound to IP, fingerprint, or browser context. First test a full `Copy as cURL` on the target server.
- The public repository must not contain cookies, scraped outputs, training code, configs, or private platform data.
- Submit tooling is dry-run by default. Live mutation requires `--execute --yes`; training start additionally requires `--run`.
