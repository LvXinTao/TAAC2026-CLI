# Taiji Metrics Scraper Skill

[English](README.en.md)

把 Taiji / TAAC 训练平台变成 agent 能读取、能比较、能归档、能提交训练的实验工作台。

这个 skill 面向 `https://taiji.algo.qq.com/training`：它可以抓取训练任务、指标、日志、checkpoint、代码文件，比较两个 `config.yaml` 的语义差异，并通过已捕获的 Taiji API 流程准备、上传、创建和启动训练任务。所有本地产物默认收进 `taiji-output/`，不会把根目录弄得一团乱。

## 给 Agent 一键安装

直接把这段话发给 Codex / 兼容 Codex skill 的 agent：

```text
请安装并使用这个 Codex skill：
https://github.com/ZhongKuang/taiji-metrics-scraper-skill.git

安装后请运行 npm install，并在需要浏览器模式时安装 Chromium：
npx playwright install chromium
```

手动安装：

```bash
mkdir -p ~/.codex/skills
git clone https://github.com/ZhongKuang/taiji-metrics-scraper-skill.git ~/.codex/skills/taiji-metrics-scraper
cd ~/.codex/skills/taiji-metrics-scraper
npm install
npx playwright install chromium
```

如果当前仓库已经内置了本 skill，可以直接进入 `.codex/skills/taiji-metrics-scraper/` 后运行 `npm install`。

## 痛点：训练平台不该占用你的工作记忆

每天早上醒来，第一反应不该是打开官网、点进一个个实例、手动检查训练曲线。但现实常常是这样：metric 一多，就要拖着鼠标在页面里上下滑，逐个找 AUC、logloss、valid/test-like 指标；刚记住一个实例的数值，切到下一个实例准备对比，前一个又忘了，只好再回去重复打开。

训练报错也一样折磨人。你要点进实例、打开 logs、复制粘贴，再解释这次跑的是哪份代码、哪个 commit、哪个 config。agent 如果拿不到日志、代码和配置的稳定快照，就只能靠你转述，很难真正定位问题。

更糟的是提交训练本身也容易出错。好不容易写了一版不错的代码，上传时却可能传错 zip、忘了换 config、只改了标题没改超参数，白白跑几个 epoch 才发现。于是每次提交都变成一场小心翼翼的人工仪式。

最关键的是，训练产出的 metric 明明应该交给 agent 跨实例分析，却常常只能靠人脑短时记忆做比较。这个 skill 的目的就是把这些“页面劳动”变成可归档、可比较、可自动化的实验数据流。

## 我们能解决什么

| 痛点 | 这个 skill 怎么解决 |
| --- | --- |
| 每天手动点开多个实例看曲线 | 批量抓取 Job、实例、checkpoint 和 metrics，输出 `jobs.json`、`all-metrics-long.csv`、`all-checkpoints.csv`。 |
| metric 多了以后只能靠鼠标滑动和人脑记忆对比 | 把指标转成长表，保留 `jobId + instanceId + metric + step`，让 agent 可以一次性跨 Job / Run 做排序、对比和总结。 |
| 同一个 Job 多次 Run 容易混在一起 | 用 `jobId + instanceId` 区分每次运行，避免“这个 AUC 到底是哪次跑出来的”。 |
| 报错后需要手动复制日志，再口头解释代码版本 | 自动归档 Pod log、Job detail、训练代码文件和 `config.yaml`，让 agent 拿着完整现场排查。 |
| 对比两个实验配置时只能肉眼扫 YAML | `compare-config-yaml.mjs` 做语义 diff，按配置路径报告新增、删除和变化项。 |
| 上传训练容易传错 zip / config / run.sh / 标题和说明 | `prepare-taiji-submit.mjs` 先生成提交包和 manifest，记录 Job Name、Description、Git HEAD、dirty 状态和待上传文件。 |
| 想自动提交但又怕误启动训练 | `submit-taiji.mjs` 默认 dry-run；真实创建必须显式 `--execute --yes`，启动必须额外 `--run`。 |
| 工具产物散落根目录，越用越乱 | 所有本地产物默认写入 `taiji-output/`，包括浏览器 profile、抓取结果、提交包、dry-run/live 结果和 config diff。 |

## 它让 Codex 可以做什么

- 一键抓取最近所有训练，把实验指标整理成可分析表格。
- 帮你回答“这一版到底比上一版强在哪里，弱在哪里”。
- 结合 Job 描述、config diff、日志和曲线，定位训练报错或指标异常。
- 在提交前检查本次 zip/config/run.sh/name/description 是否和 manifest 一致。
- 复用一个稳定模板 Job，自动替换 `code.zip`、`config.yaml`，并可显式覆写 `run.sh` 后按需启动训练。
- 把平台页面里的短暂信息沉淀成长期可复盘的实验资产。

## 核心能力

| 能力 | 输出 |
| --- | --- |
| 批量抓 Job | `jobs.json`、`jobs-summary.csv` |
| 抓 Metrics / tf_events | `all-metrics-long.csv` |
| 抓 Checkpoints | `all-checkpoints.csv` |
| 抓 Pod logs | `logs/<jobId>/<instanceId>.txt` |
| 下载训练代码 | `code/<jobId>/files/...` |
| 保存任务详情 | `code/<jobId>/job-detail.json`、`train-files.json` |
| 比较 config | `taiji-output/config-diffs/*.json` 或 Markdown |
| 准备提交包 | `taiji-output/submit-bundle/` |
| dry-run / live submit | `taiji-output/submit-live/<timestamp>/` |

## 快速开始

把浏览器里已经登录成功的 Cookie 保存到：

```text
taiji-output/secrets/taiji-cookie.txt
```

抓取全部训练任务：

```bash
node scripts/scrape-taiji.mjs --all --cookie-file taiji-output/secrets/taiji-cookie.txt --headless
```

增量同步会完整扫描 Job list，但对本地已有、终态、且 `updateTime/status/jzStatus` 没变的 Job 跳过 detail、代码、实例、metric 和 log 的深拉：

```bash
node scripts/scrape-taiji.mjs --all --incremental --cookie-file taiji-output/secrets/taiji-cookie.txt --direct
```

服务器上 Chromium 不稳定时，用后端直连模式：

```bash
node scripts/scrape-taiji.mjs --all --cookie-file taiji-output/secrets/taiji-cookie.txt --direct
```

比较两个配置：

```bash
node scripts/compare-config-yaml.mjs old-config.yaml new-config.yaml
node scripts/compare-config-yaml.mjs old-config.yaml new-config.yaml --json --out diff.json
```

`--out diff.json` 会写到 `taiji-output/config-diffs/diff.json`，不会掉到根目录。

## 自动提交训练

提交链路分两层：先准备，再执行。默认只 dry-run，不会误上传、误创建、误启动。

### 推荐提交包形态

公开版推荐使用最简单、最稳定的 Taiji trainFiles 形态：

```text
code.zip
run.sh
config.yaml
```

- `code.zip` 放项目代码，由你的仓库脚本或 agent 打包生成。
- `run.sh` 是平台入口，负责解压/定位代码并读取 `config.yaml` 启动训练。
- `config.yaml` 放本次实验参数。

本仓库提供了一个不含真实代码的最小示例：

```text
examples/minimal-taiji-submit/
  code/
  run.sh
  config.yaml
```

你的 agent 可以参考这个形态打包：把项目代码放进 `code.zip`，把实验参数写入 `config.yaml`，用 `run.sh` 作为统一入口。自动提交脚本默认替换 `code.zip` 和 `config.yaml`；如果传入 `--run-sh ./run.sh`，也会显式覆写模板里的同名 `run.sh`。模板 Job 里必须已有这些同名 trainFiles；只有明确加 `--allow-add-file` 时才允许新增。

如果别人的模板不是 zip 形态，而是散文件，例如 `main.py + dataset.py + run.sh`，也可以用通用文件适配：

```bash
node scripts/prepare-taiji-submit.mjs \
  --template-job-url "https://taiji.algo.qq.com/training/..." \
  --file-dir "./taiji-files" \
  --name "loose_files_exp"
```

`--file-dir` 只扫描目录第一层文件；自动识别 `code.zip`、`config.yaml`、`run.sh`，其他第一层文件都会进入 generic trainFiles。比如目录里有：

```text
taiji-files/
  dataset.py
  model.py
  ns_groups.json
  run.sh
  train.py
  trainer.py
  utils.py
```

就会准备覆写同名 `run.sh`，以及 `dataset.py/model.py/ns_groups.json/train.py/trainer.py/utils.py` 这些散文件。子目录会被忽略，避免不小心把项目目录整体传上去。

也可以单独列文件：

```bash
node scripts/prepare-taiji-submit.mjs \
  --template-job-url "https://taiji.algo.qq.com/training/..." \
  --zip "./submits/0505/V1.4.0/code.zip" \
  --config "./submits/0505/V1.4.0/config.yaml" \
  --run-sh "./submits/0505/V1.4.0/run.sh" \
  --file "./main.py" \
  --file "./local_dataset.py=dataset.py" \
  --name "v1.4.0_mixed_files"
```

`--file ./main.py` 会按 basename 替换模板里的 `main.py`；`--file ./local_dataset.py=dataset.py` 会把本地文件上传后替换模板里的 `dataset.py`。`code.zip`、`config.yaml`、`run.sh` 是一等文件名，不能通过 `--file` 传，必须使用 `--zip`、`--config`、`--run-sh`，或让 `--file-dir` 自动识别。

准备一个提交包：

```bash
node scripts/prepare-taiji-submit.mjs \
  --template-job-url "https://taiji.algo.qq.com/training/..." \
  --zip "./submits/0505/V1.4.0/code.zip" \
  --config "./submits/0505/V1.4.0/config.yaml" \
  --run-sh "./submits/0505/V1.4.0/run.sh" \
  --name "v1.4.0_item_reinit" \
  --description "item id reinit + dense transform" \
  --run
```

不传 `--run-sh` 时会沿用模板 Job 里的旧 `run.sh`。

它会写入：

```text
taiji-output/submit-bundle/
  manifest.json
  NEXT_STEPS.md
  files/code.zip
  files/config.yaml
  files/run.sh        # 仅在传入 --run-sh 时存在
  files/generic/...   # 仅在传入 --file 或 --file-dir 发现散文件时存在
```

生成 dry-run 提交计划：

```bash
node scripts/submit-taiji.mjs \
  --bundle taiji-output/submit-bundle \
  --cookie-file taiji-output/secrets/taiji-cookie.txt \
  --template-job-internal-id <TEMPLATE_JOB_INTERNAL_ID>
```

真实上传并创建 Job：

```bash
node scripts/submit-taiji.mjs \
  --bundle taiji-output/submit-bundle \
  --cookie-file taiji-output/secrets/taiji-cookie.txt \
  --template-job-internal-id <TEMPLATE_JOB_INTERNAL_ID> \
  --execute --yes
```

上传、创建并启动训练：

```bash
node scripts/submit-taiji.mjs \
  --bundle taiji-output/submit-bundle \
  --cookie-file taiji-output/secrets/taiji-cookie.txt \
  --template-job-internal-id <TEMPLATE_JOB_INTERNAL_ID> \
  --execute --yes --run
```

只有用户明确要启动训练时才加 `--run`；普通上传验证先用上一段 create-only 命令。

如果模板 Job 里没有同名 `code.zip`、`config.yaml`，或在传入 `--run-sh` / `--file` / `--file-dir` 时没有对应同名 trainFile，脚本会默认报错，避免旧文件和新文件同时存在。只有明确要新增 trainFiles 时才加：

```bash
node scripts/submit-taiji.mjs ... --execute --yes --allow-add-file
```

## 安全默认值

- Cookie、HAR、headers 建议放在 `taiji-output/secrets/` 或 `taiji-output/har/`，不要提交。
- 所有脚本默认把本地产物写到 `taiji-output/`。
- 相对输出路径不能包含 `..`；如果确实要写到外部位置，请使用绝对路径。
- `submit-taiji.mjs` 默认 dry-run。
- 真实平台写操作必须显式加 `--execute --yes`。
- 启动训练必须额外显式加 `--run`。
- 脚本会保留模板 Job 的环境、镜像和入口；默认严格替换模板中已有的 `code.zip` 和 `config.yaml`，传入 `--run-sh` 时才严格替换同名 `run.sh`，传入 `--file` 或 `--file-dir` 时才严格替换对应通用文件。

## 输出目录

```text
taiji-output/
  jobs.json
  jobs-summary.csv
  all-checkpoints.csv
  all-metrics-long.csv
  browser-profile/
  code/<jobId>/
  config-diffs/
  logs/<jobId>/
  secrets/
  submit-bundle/
  submit-live/<timestamp>/
```

推荐在业务仓库里加入：

```gitignore
taiji-output/
```

## 什么时候使用

适合这些场景：

- 想让 agent 总结一批 Taiji Job 的训练指标。
- 想比较两个实验版本的 `config.yaml`。
- 想把每个 Job 的代码、日志、checkpoint 和指标归档起来。
- 想用一个已成功的模板 Job 自动提交下一组代码和配置。
- 想让 agent 根据历史实验记录辅助判断下一次训练是否值得跑。

不适合这些场景：

- Cookie 已经过期或被出口 IP / 浏览器指纹绑定。
- 平台接口发生变化且没有新的 DevTools 请求样本。
- 需要完全无人工确认地消耗线上训练资源。

## 脚本清单

| 脚本 | 用途 |
| --- | --- |
| `scripts/scrape-taiji.mjs` | 抓取 Job、实例、指标、日志、checkpoint、代码文件 |
| `scripts/compare-config-yaml.mjs` | 语义比较两个 YAML 配置 |
| `scripts/prepare-taiji-submit.mjs` | 准备本地提交包，记录 Git 状态和上传文件 |
| `scripts/submit-taiji.mjs` | dry-run 或显式执行 Taiji 上传、创建、Run 流程 |

## 故障判断

- `401` / `403`：Cookie 过期、缺失，或登录态绑定了出口环境。
- Playwright 失败但 `--direct` 成功：优先用 `--direct`。
- 两种模式都 `401`：先在同一机器上测试完整 `Copy as cURL`。
- Job 有实例但指标为空：可能是任务失败、实例未产出 metrics，或平台响应结构变化。
- 代码文件下载失败：先看 `code/<jobId>/job-detail.json` 和 `train-files.json`，确认平台给的是普通 URL 还是 COS 路径。

## 开发验证

```bash
npm run check
npm run test
```

`check` 会对所有 bundled scripts 执行 `node --check`；`test` 会跑提交安全和输出路径的小型行为测试。
