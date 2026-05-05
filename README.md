# TAAC Metrics Scraper Skill

默认中文说明，English follows.

## 中文

这是一个用于抓取腾讯 TAAC / Taiji 训练平台数据的 Codex Skill。它可以从 `https://taiji.algo.qq.com/training` 批量抓取：

- Job ID、Job Name、Job Description
- 每个 Job 下的实例 `instanceId`
- Checkpoints
- Metrics / `tf_events`
- Pod logs
- 训练代码文件，包括但不限于 `config.yaml`
- 两个 YAML 配置文件的语义差异

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

- `jobs.json`: 完整数据，结构为 `jobsById[jobId].instancesById[instanceId]`
- `jobs-summary.csv`: Job 摘要，重复抓取会按 Job ID 更新 Name / Description
- `all-metrics-long.csv`: 全部 Metrics 长表
- `all-checkpoints.csv`: 全部 checkpoint 表
- `logs/<jobId>/<instanceId>.txt`: 每个实例的 pod log
- `code/<jobId>/job-detail.json`: Job detail 原始响应
- `code/<jobId>/train-files.json`: 训练代码文件索引和下载状态
- `code/<jobId>/files/...`: 尽力下载的全部训练代码文件

### 比较 config.yaml

```powershell
node scripts/compare-config-yaml.mjs old-config.yaml new-config.yaml
node scripts/compare-config-yaml.mjs old-config.yaml new-config.yaml --json --out diff.json
```

这个工具会解析 YAML，并按配置路径报告 `added`、`removed`、`changed`，例如 `model.lr`、`train.batch_size`、`layers[1]`。

### 安全注意

- `taiji-cookie.txt` 是登录凭据，不要提交、截图或发给别人。
- 如果服务器上 Cookie 返回 `401`，通常是登录态与出口 IP、设备指纹或浏览器环境绑定。先在服务器上测试完整 `Copy as cURL` 是否能返回 `200`。
- 公开仓库不包含任何 Cookie、抓取输出或平台私有数据。

## English

This is a Codex Skill for scraping Tencent TAAC / Taiji training platform data from `https://taiji.algo.qq.com/training`.

It exports:

- Job ID, Job Name, Job Description
- Instances under each Job
- Checkpoints
- Metrics / `tf_events`
- Pod logs
- Training code files, including but not limited to `config.yaml`
- Semantic diffs between two YAML config files

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

- `jobs.json`: full data keyed by `jobsById[jobId].instancesById[instanceId]`
- `jobs-summary.csv`: Job summary; repeated runs update Name / Description by Job ID
- `all-metrics-long.csv`: all metrics in long-table format
- `all-checkpoints.csv`: all checkpoint rows
- `logs/<jobId>/<instanceId>.txt`: pod logs for each instance
- `code/<jobId>/job-detail.json`: raw Job detail response
- `code/<jobId>/train-files.json`: training code file index and download status
- `code/<jobId>/files/...`: best-effort downloaded training code files

### Compare YAML Configs

```bash
node scripts/compare-config-yaml.mjs old-config.yaml new-config.yaml
node scripts/compare-config-yaml.mjs old-config.yaml new-config.yaml --json --out diff.json
```

The diff tool parses YAML and reports semantic `added`, `removed`, and `changed` entries by config path.

### Security

- `taiji-cookie.txt` is a login credential. Do not commit, screenshot, or share it.
- If the server returns `401` with a copied Cookie, the login state may be bound to IP, fingerprint, or browser context. First test a full `Copy as cURL` on the target server.
- This public repository must not contain cookies, scraped outputs, or private platform data.
