# TAAC2026-CLI 使用文档

TAAC2026 / Taiji 实验平台的命令行工具，用于管理训练任务（train）和评估任务（eval）。

## 安装

```bash
npm install
npm link
```

安装完成后即可使用 `taac2026` 命令。

## 认证

所有命令均需要 Cookie 认证。使用前请先手动保存：

将 Taiji 平台的 Cookie 保存为 `.taac2026/secrets/taiji-cookie.txt` 文件，后续命令会自动读取该文件进行认证。

---

## 训练任务（train）

标准工作流程：

```
prepare → submit → run → publish
```

即：先打包源码，再上传到 COS 并创建训练任务，然后启动训练，训练完成后发布 checkpoint 获取 `mould_id` 用于评估任务。

### `train prepare` — 准备提交包

从源码目录扫描模型文件，准备一个可提交的 bundle。

**用法：**

```bash
taac2026 train prepare \
  --name <任务名称> \
  --source <源码目录> \
  [--template-id <模板任务ID>] \
  [--description <描述>] \
  [--include <包含模式>] \
  [--exclude <排除模式>] \
  [--output <输出目录>]
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `--name` | 是 | 新任务名称 |
| `--source` | 是 | 源码目录路径 |
| `--template-id` | 否 | 模板任务 ID，完整的 taskID 字符串，如 `angel_training_ams_...`。可省略，在 submit 时指定 |
| `--description` | 否 | 任务描述 |
| `--include` | 否 | 逗号分隔的包含模式，如 `"*.py,*.sh"` |
| `--exclude` | 否 | 逗号分隔的排除模式，默认排除 `__pycache__`、`*.pyc`、`*.egg-info`、`.git`、`.DS_Store`、`inference/` |
| `--output` | 否 | 输出目录，默认 `submit-bundle` |

**扫描规则：**

- 递归扫描源码目录中的 `.py`、`.sh`、`.json`、`.yaml`、`.yml`、`.toml`、`.txt`、`.cfg`、`.ini` 文件
- 包含 `inference/` 子目录
- 排除 `__pycache__`、`*.pyc`、`inference/` 等模式

**产出文件（位于输出目录）：**

| 文件 | 说明 |
|------|------|
| `manifest.json` | 清单文件，包含模板 ID、任务名称、文件列表、Git 信息 |
| `NEXT_STEPS.md` | 下一步操作指南 |
| `files/` | 源码文件副本（保持相对路径结构） |

**调用的 API：** 无（纯本地操作）

---

### `train submit` — 上传并创建训练任务

将 prepare 产生的 bundle 上传到 COS，然后通过 Create Job API 创建训练任务。

**用法：**

```bash
taac2026 train submit \
  --bundle <bundle目录> \
  [--template-id <模板任务ID>] \
  [--gpu-num <GPU卡数>] \
  [--yes] \
  [--dry-run] \
  [--output <输出目录>]
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `--bundle` | 是 | `prepare` 生成的 bundle 目录路径 |
| `--template-id` | 条件 | 模板任务 ID。如果 bundle 的 manifest.json 中未包含，则必填 |
| `--yes` | 否 | 跳过确认提示 |
| `--gpu-num` | 否 | GPU 卡数（默认使用模板配置） |
| `--dry-run` | 否 | 仅生成计划，不执行上传和创建 |
| `--output` | 否 | 输出目录，默认 `taiji-output/submit-live/<时间戳>` |

**调用的 API：**

1. `GET /aide/api/evaluation_tasks/get_federation_token/` — 获取 COS 联邦令牌
2. `GET /taskmanagement/api/v1/webtasks/external/task/{internalId}` — 获取模板任务元信息
3. `PUT COS` — 将每个文件上传到腾讯云对象存储（Bucket: `hunyuan-external-1258344706`, Region: `ap-guangzhou`）
4. `POST /taskmanagement/api/v1/webtasks/external/task` — 创建新训练任务

**产出文件（位于输出目录）：**

| 文件 | 说明 |
|------|------|
| `plan.json` | 执行计划（含上传文件列表、COS 路径、创建参数） |
| `result.json` | 执行结果（含 taskId、上传详情、创建响应） |

---

### `train run` — 启动训练任务

启动已创建但未运行的训练任务。

**用法：**

```bash
taac2026 train run \
  --task-id <任务ID> \
  [--output <输出目录>]
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `--task-id` | 是 | 完整的 taskID 字符串（`angel_training_...`）或数字内部 ID |
| `--output` | 否 | 输出目录，默认 `taiji-output/train-jobs` |

**调用的 API：**

- `POST /taskmanagement/api/v1/webtasks/{taskId}/start` — 启动训练任务

**产出文件：**

| 文件 | 说明 |
|------|------|
| `taiji-output/train-jobs/run-{taskId}.json` | 启动结果，含 taskId 和响应数据 |

---

### `train list` — 列出训练任务

获取训练任务列表，支持增量模式只拉取变更的任务。

**用法：**

```bash
taac2026 train list \
  [--incremental] \
  [--page-size <n>] \
  [--output <输出目录>]
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `--incremental` | 否 | 增量模式，跳过未变更的已结束任务 |
| `--page-size` | 否 | 每页条数，默认 100 |
| `--output` | 否 | 输出目录，默认 `taiji-output` |

**调用的 API：**

- `GET /taskmanagement/api/v1/webtasks/external/task` — 分页获取训练任务列表（需通过 Cookie 认证）

**产出文件：**

| 文件 | 说明 |
|------|------|
| `taiji-output/jobs.json` | 任务详情（含 jobId、jobInternalId 的映射） |
| `taiji-output/jobs-summary.csv` | 任务摘要（CSV 格式） |

---

### `train describe` — 查看任务详情

获取训练任务的完整信息，包括实例详情、日志、指标和检查点。

**用法：**

```bash
taac2026 train describe \
  --job-id <任务ID> \
  [--output <输出目录>]

# 或查看所有任务
taac2026 train describe --all [--output <输出目录>]
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `--job-id` | 条件必填 | 完整的 taskID 字符串。与 `--all` 互斥 |
| `--all` | 条件必填 | 从 jobs.json 读取所有任务。与 `--job-id` 互斥 |
| `--output` | 否 | 输出目录，默认 `taiji-output/train-jobs` |

**调用的 API：**

1. `GET /taskmanagement/api/v1/webtasks/external/task/{internalId}` — 获取任务详情
2. `POST /taskmanagement/api/v1/instances/list` — 获取任务下的所有实例
3. `GET /taskmanagement/api/v1/instances/external/{instanceId}/get_ckpt` — 获取检查点信息
4. `GET /taskmanagement/api/v1/instances/external/{instanceId}/tf_events` — 获取训练指标（TensorFlow events）
5. `GET /taskmanagement/api/v1/instances/{instanceId}/pod_log` — 获取 Pod 日志

**产出文件：**

| 文件 | 说明 |
|------|------|
| `taiji-output/train-jobs/job-{taskId}.json` | 任务详情（含所有实例信息） |
| `taiji-output/train-jobs/job-{taskId}-metrics.csv` | 训练指标（loss、AUC 等） |
| `taiji-output/train-jobs/job-{taskId}-checkpoints.csv` | 检查点列表 |
| `taiji-output/train-jobs/logs/{taskId}/{instanceId}.json` | 原始日志（JSON） |
| `taiji-output/train-jobs/logs/{taskId}/{instanceId}.txt` | 格式化日志（文本） |

---

### `train logs` — 查看训练日志

获取训练任务所有实例的 Pod 日志。

**用法：**

```bash
taac2026 train logs \
  --job-id <任务ID> \
  [--output <输出目录>]
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `--job-id` | 是 | 完整的 taskID 字符串（`angel_training_...`） |
| `--output` | 否 | 输出目录，默认 `taiji-output/train-jobs` |

**调用的 API：**

1. `POST /taskmanagement/api/v1/instances/list` — 获取任务实例列表
2. `GET /taskmanagement/api/v1/instances/{instanceId}/pod_log` — 获取每个实例的 Pod 日志

**产出文件：**

| 文件 | 说明 |
|------|------|
| `taiji-output/train-jobs/logs/{taskId}/{instanceId}.json` | 原始日志（JSON） |
| `taiji-output/train-jobs/logs/{taskId}/{instanceId}.txt` | 格式化日志（文本） |

---

### `train metrics` — 查看训练指标

获取训练任务的指标数据（loss、AUC 等）。

**用法：**

```bash
taac2026 train metrics \
  --job-id <任务ID> \
  [--json] \
  [--output <输出目录>]
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `--job-id` | 是 | 完整的 taskID 字符串（`angel_training_...`） |
| `--json` | 否 | 输出 JSON 到标准输出，而非写入 CSV 文件 |
| `--output` | 否 | 输出目录，默认 `taiji-output/train-jobs/metrics` |

**调用的 API：**

1. `POST /taskmanagement/api/v1/instances/list` — 获取任务实例列表
2. `GET /taskmanagement/api/v1/instances/external/{instanceId}/tf_events` — 获取训练指标
3. `GET /taskmanagement/api/v1/instances/external/{instanceId}/get_ckpt` — 获取检查点信息（内部调用 fetchInstanceOutput）

**产出文件：**

| 文件 | 说明 |
|------|------|
| `taiji-output/train-jobs/metrics/metrics-job-{taskId}.csv` | 训练指标 CSV（仅非 `--json` 模式） |

---

### `train stop` — 停止训练任务

通过杀死运行中的实例来停止训练任务。

**用法：**

```bash
taac2026 train stop \
  --task-id <任务ID> \
  [--output <输出目录>]
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `--task-id` | 是 | 完整的 taskID 字符串（`angel_training_...`）。实例 ID 自动从 API 解析 |
| `--output` | 否 | 输出目录，默认 `taiji-output/train-jobs` |

**调用的 API：**

1. `POST /taskmanagement/api/v1/instances/list` — 获取任务实例列表（取第一个实例）
2. `POST /taskmanagement/api/v1/instances/{instanceId}/kill` — 杀死实例

**产出文件：**

| 文件 | 说明 |
|------|------|
| `taiji-output/train-jobs/stop-{taskId}.json` | 停止结果（含 taskId、instanceId、响应数据） |

---

### `train delete` — 删除训练任务

永久删除训练任务。需要数字内部 ID。

**用法：**

```bash
taac2026 train delete \
  --job-internal-id <数字内部ID> \
  [--yes]
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `--job-internal-id` | 是 | 数字内部 ID（如 `74958`），不是 taskID 字符串。可在 `jobs.json` 或 submit 的 `result.json` 中查看 |
| `--yes` | 否 | 跳过确认提示 |

**调用的 API：**

- `DELETE /taskmanagement/api/v1/webtasks/external/task/{internalId}` — 删除训练任务

**产出文件：** 无（仅在控制台打印结果）

---

### `train publish` — 发布 checkpoint 并获取 mould_id

训练完成后，发布最新 checkpoint 为模型（mould），并自动查询返回 `mould_id`，供下游评估任务创建时使用。

**用法：**

```bash
taac2026 train publish \
  --task-id <任务ID> \
  [--name <发布名称>] \
  [--desc <发布描述>] \
  [--output <输出目录>]
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `--task-id` | 是 | 完整的 taskID 字符串（`angel_training_...`）或数字内部 ID |
| `--name` | 否 | 发布名称，默认为 `<任务名>-step<N>`，N 从 checkpoint 文件名中提取 |
| `--desc` | 否 | 发布描述，默认为 `Published from training task <task_id>` |
| `--output` | 否 | 输出目录，默认 `taiji-output/train-jobs/ckpt` |

**调用的 API：**

1. `POST /taskmanagement/api/v1/instances/list` — 获取任务实例列表（取最新一个）
2. `GET /taskmanagement/api/v1/instances/external/{instanceId}/get_ckpt` — 获取 checkpoint 列表
3. `POST /taskmanagement/api/v1/instances/external/{instanceId}/release_ckpt` — 发布 checkpoint
4. `GET /aide/api/external/mould/` — 查询模型列表，通过 task_id + instance_id 匹配得到 `mould_id`

**产出文件：**

| 文件 | 说明 |
|------|------|
| `taiji-output/train-jobs/ckpt/publish-{taskId}.json` | 发布结果，含 `mouldId`、`mouldName`、checkpoint 文件名、响应数据 |

---

## 评估任务（eval）

### `eval list` — 列出评估任务

获取评估任务列表，并自动抓取每个任务的日志。

**用法：**

```bash
taac2026 eval list \
  [--page-size <n>] \
  [--output <输出目录>]
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `--page-size` | 否 | 每页条数，默认 100 |
| `--output` | 否 | 输出目录，默认 `taiji-output` |

**调用的 API：**

1. `GET /aide/api/evaluation_tasks/` — 分页获取评估任务列表
2. `GET /aide/api/evaluation_tasks/event_log/` — 获取每个任务的日志

**产出文件：**

| 文件 | 说明 |
|------|------|
| `taiji-output/eval-tasks.json` | 评估任务详情（含所有任务日志） |
| `taiji-output/eval-tasks-summary.csv` | 评估任务摘要（CSV 格式） |
| `taiji-output/eval-jobs/logs/{taskId}.json` | 单个任务原始日志（JSON） |
| `taiji-output/eval-jobs/logs/{taskId}.txt` | 单个任务格式化日志（文本） |

---

### `eval logs` — 查看评估日志

获取单个评估任务的日志。

**用法：**

```bash
taac2026 eval logs \
  --task-id <任务ID> \
  [--output <输出目录>]
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `--task-id` | 是 | 评估任务 ID（从 `eval list` 输出中获取） |
| `--output` | 否 | 输出目录，默认 `taiji-output/eval-jobs/logs` |

**调用的 API：**

- `GET /aide/api/evaluation_tasks/event_log/` — 获取指定任务的日志

**产出文件：**

| 文件 | 说明 |
|------|------|
| `{outputDir}/{taskId}.json` | 原始日志（JSON） |
| `{outputDir}/{taskId}.txt` | 格式化日志（文本） |

---

### `eval metrics` — 查看评估指标

获取评估任务的指标数据（score、AUC 等）。

**用法：**

```bash
taac2026 eval metrics \
  --task-id <任务ID> \
  [--json] \
  [--output <输出目录>]
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `--task-id` | 是 | 评估任务 ID（从 `eval list` 输出中获取） |
| `--json` | 否 | 输出 JSON 到标准输出，而非写入文件 |
| `--output` | 否 | 输出目录，默认 `taiji-output/eval-jobs/metrics` |

**调用的 API：**

- `GET /aide/api/evaluation_tasks/` — 获取评估任务列表（从中查找指定任务）

**产出文件：**

| 文件 | 说明 |
|------|------|
| `{outputDir}/{taskId}.json` | 指标数据（仅非 `--json` 模式） |

---

## 输出目录结构

所有命令的输出文件默认存放在 `taiji-output/` 目录下：

```
taiji-output/
├── jobs.json                          # 训练任务列表映射
├── jobs-summary.csv                   # 训练任务摘要
├── submit-live/                       # 提交结果（按时间戳分目录）
│   └── YYYY-MM-DDTHH-MM-SS/
│       ├── plan.json
│       └── result.json
├── train-jobs/
│   ├── job-{taskId}.json              # 任务详情
│   ├── job-{taskId}-metrics.csv       # 训练指标
│   ├── job-{taskId}-checkpoints.csv   # 检查点
│   ├── run-{taskId}.json              # 启动结果
│   ├── stop-{taskId}.json             # 停止结果
│   ├── ckpt/
│   │   └── publish-{taskId}.json      # 发布结果（含 mould_id）
│   ├── logs/
│   │   └── {taskId}/
│   │       ├── {instanceId}.json      # 原始日志
│   │       └── {instanceId}.txt       # 格式化日志
│   └── metrics/
│       └── metrics-job-{taskId}.csv   # 指标 CSV
├── eval-tasks.json                    # 评估任务详情
├── eval-tasks-summary.csv             # 评估任务摘要
└── eval-jobs/
    ├── logs/
    │   └── {taskId}.json              # 评估日志
    │   └── {taskId}.txt
    └── metrics/
        └── {taskId}.json              # 评估指标
```

---

## 关于 ID 类型

平台中存在两种任务 ID：

| ID 类型 | 示例 | 说明 |
|---------|------|------|
| **taskID（字符串）** | `angel_training_ams_2026_...` | 完整的任务标识符，用于 `run`、`stop`、`logs`、`metrics`、`describe` 等命令 |
| **jobInternalId（数字）** | `74958` | 数字内部 ID，仅用于 `delete` 命令和 API 路径中 |

在 `jobs.json` 中，`jobId` 对应 taskID，`jobInternalId` 对应数字内部 ID。
