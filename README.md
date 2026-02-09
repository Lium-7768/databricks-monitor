# Databricks Apps 监控

通过 GitHub Actions 定时监控 ARGO 隧道状态和 Databricks Apps，自动重启停止的 Apps，并通过 Telegram 发送通知。

## 功能

- **智能检查**：优先检查 ARGO 域名状态，仅在 ARGO 离线时才调用 Databricks API（减少 API 调用）
- **自动重启**：检测到 ARGO 离线后，自动检查并重启停止的 Databricks Apps
- **状态变化通知**：ARGO 离线/恢复、App 启动成功/失败时发送 Telegram 通知
- **持久化状态**：通过 GitHub Actions Cache 保存 ARGO 状态，实现跨次运行的状态变化检测
- **手动操作**：支持通过 GitHub Actions 手动触发各种操作

## 快速开始

### 1. Fork 或创建仓库

将 `databricks-monitor` 目录的内容推送到一个新的 GitHub 仓库。

### 2. 配置 GitHub Secrets

在仓库的 **Settings → Secrets and variables → Actions** 中添加以下 Secrets：

| Secret 名称 | 必填 | 说明 |
|---|---|---|
| `DATABRICKS_HOST` | ✅ | Databricks 工作区地址，如 `https://abc-123.cloud.databricks.com` |
| `DATABRICKS_TOKEN` | ✅ | Databricks Personal Access Token |
| `ARGO_DOMAIN` | ✅ | ARGO 隧道域名，如 `databricks.argo.domain.com` |
| `CHAT_ID` | ❌ | Telegram 聊天 ID（配置后启用通知） |
| `BOT_TOKEN` | ❌ | Telegram 机器人 Token（配置后启用通知） |

> 也可以直接在 `monitor.js` 的 `DEFAULT_CONFIG` 中填写默认值。

### 3. 启用 GitHub Actions

推送代码后，Actions 会自动按 cron 计划执行。也可以手动触发。

## 操作说明

### 自动定时执行

默认每 **10 分钟** 执行一次智能检查（`check`）。

可在 `.github/workflows/monitor.yml` 中修改 cron 表达式：

```yaml
schedule:
  - cron: '*/10 * * * *'  # 每 10 分钟
```

### 手动触发

在 GitHub 仓库页面 → **Actions** → **Databricks Apps 监控** → **Run workflow**，选择操作类型：

| 操作 | 说明 |
|---|---|
| `check` | 智能检查（ARGO 优先，离线时检查 Databricks） |
| `status` | 仅获取并打印 Apps 状态 |
| `start` | 启动所有停止的 Apps |
| `test-notify` | 发送测试通知到 Telegram |

### 本地运行

```bash
# 安装依赖（无外部依赖）
npm install

# 设置环境变量后运行
export DATABRICKS_HOST="https://your-workspace.cloud.databricks.com"
export DATABRICKS_TOKEN="dapi..."
export ARGO_DOMAIN="your.argo.domain.com"

# 执行不同操作
npm run check        # 智能检查
npm run status       # 查看状态
npm run start        # 启动停止的 Apps
npm run test-notify  # 测试 Telegram 通知
```

## 监控逻辑

```
定时触发 (每10分钟)
    │
    ▼
检查 ARGO 域名状态
    │
    ├── 在线 (404/502) → 记录状态，结束
    │       │
    │       └── 若从离线恢复 → 发送恢复通知
    │
    └── 离线 (其他状态码/连接失败)
            │
            ├── 状态变化 → 发送离线通知
            │
            └── 调用 Databricks API 检查 Apps
                    │
                    ├── ACTIVE → 跳过
                    └── STOPPED → 自动重启 + 发送通知
```

## 项目结构

```
databricks-monitor/
├── .github/
│   └── workflows/
│       └── monitor.yml      # GitHub Actions 工作流配置
├── monitor.js               # 监控脚本主逻辑
├── package.json
├── .gitignore
└── README.md
```

## 注意事项

- GitHub Actions 免费额度：公开仓库无限，私有仓库每月 2000 分钟
- 每 10 分钟触发一次，每月约 4320 次（每次约 10-30 秒）
- ARGO 正常时不调用 Databricks API，节省配额
- GitHub Actions 的 cron 可能有 1-5 分钟的延迟，这是正常现象
