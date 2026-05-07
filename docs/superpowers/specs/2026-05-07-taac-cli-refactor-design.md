# TAAC2026 CLI 重构设计

**日期**: 2026-05-07
**状态**: 待实现

## 目标

将当前扁平脚本集合式的 CLI 重构为基于子命令的结构化 CLI，参考 mt-mlx-cli 的模式，使用 TypeScript + Commander 实现。

## 痛点

- 入口通过 spawn 子进程分发，无 CLI 框架，缺少自动帮助和参数校验
- 每个命令对应独立 `.mjs` 脚本，无模块化分层
- 命令层级扁平，不符合 train/eval 的生命周期心智模型

## 命令树

```
taac2026
├── login                              # 浏览器 SSO 登录，保存 cookie
├── train
│   ├── prepare                        # 准备提交包（原 prepare-submit）
│   ├── submit                         # 上传到 COS（原 submit）
│   ├── create                         # 创建 Job
│   ├── run                            # 启动训练 instance
│   ├── list                           # 抓取训练任务列表（原 scrape train）
│   ├── logs                           # 获取实验日志
│   ├── metrics                        # 获取实验指标
│   ├── stop                           # 停止 Job
│   ├── delete                         # 删除 Job
│   ├── doctor                         # 提交前检查
│   ├── verify                         # 提交后回读校验
│   ├── compare                        # 跨实验对比（原 compare jobs）
│   ├── compare-runs                   # 对比 base vs exp
│   ├── ckpt-select                    # checkpoint 候选
│   ├── config-diff                    # config 语义对比（原 diff-config）
│   ├── ledger                         # 同步实验账本（ledger sync）
│   └── diagnose                       # 诊断失败 Job
└── eval
    ├── create                         # 创建评测任务
    ├── list                           # 抓取评测任务列表（原 scrape eval）
    ├── logs                           # 查看评测日志
    └── metrics                        # 查看评测指标
```

## 项目结构

```
src/
├── api/
│   ├── client.ts        # HTTP 客户端（cookie 注入、重试、circuit breaker）
│   ├── training.ts      # Train API（create、run、list、status、stop、delete、metrics、logs）
│   ├── evaluation.ts    # Eval API（create、list、logs、metrics）
│   └── upload.ts        # COS 上传
├── auth/
│   ├── browser.ts       # Playwright SSO 登录
│   └── token.ts         # Cookie 管理、凭证存储、ensureAuthenticated
├── cli/
│   ├── index.ts         # CLI 入口（program.parse）
│   └── commands/
│       ├── train/       # 16 个子命令，每个文件一个
│       ├── eval/        # 4 个子命令
│       └── login.ts     # 顶层 login
├── config/
│   ├── defaults.ts      # 内置默认值（API URL、bucket、region 等）
│   └── resolver.ts      # 参数优先级解析
├── utils/
│   ├── credentials.ts   # 凭证文件读写
│   ├── format.ts        # 表格/JSON 格式化输出
│   └── output.ts        # 输出路径管理
├── scrape/
│   └── scraper.ts       # 抓取逻辑（从 scrape-taiji.mjs 迁移）
└── types.ts             # 共享 TypeScript 类型
```

## 数据流

1. **参数优先级**: CLI flags > `~/.taac2026/config.json` > built-in defaults
2. **认证流**: 写操作命令执行前调用 `ensureAuthenticated()`，读操作也需要 cookie
3. **输出路径**: 统一走 `src/utils/output.ts`，默认 `taiji-output/`，`--out` 可覆盖
4. **命令职责**: CLI 文件只做参数解析 + auth 检查 + 调用 API 层 + 格式化输出

## 模块职责

### API Client (`src/api/client.ts`)
- 基于 Node.js 原生 fetch
- Cookie 注入、指数退避重试（3 次，5xx）、circuit breaker（10 次 5xx 后冷却 5 分钟）
- 401 最多重试 2 次，超过则提示重新登录

### Auth (`src/auth/token.ts`)
- 支持纯 Cookie header 和 Copy-as-cURL 两种格式
- 存储路径：`taiji-output/secrets/taiji-cookie.txt`

### Scraper (`src/scrape/scraper.ts`)
- 从 scrape-taiji.mjs 迁移，拆分为独立函数
- 支持 `--direct`（后端 HTTP）和 `--headless`（Playwright）
- 支持增量模式（终态 Job 跳过深拉）

### Config Resolver (`src/config/resolver.ts`)
- 统一参数优先级链
- Train 和 Eval 共享基础参数，各自维护业务参数默认值

## 依赖

- commander（新增，CLI 框架）
- js-yaml（已有）
- playwright（已有）
- cos-nodejs-sdk-v5（已有）
- typescript（新增）

## 迁移策略

1. 新建 `src/` 目录，搭建 TypeScript + Commander 骨架
2. 新增 `tsconfig.json`，配置 ESM 输出到 `dist/`
3. 每个子命令先用 commander 定义 options 骨架
4. 将对应 `.mjs` 中的逻辑迁移到 TypeScript 模块
5. 现有 `.mjs` 脚本保留作为迁移参考，全部迁移完成后删除
