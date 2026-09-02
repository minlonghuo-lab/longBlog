# longBlog

longBlog 是一个以 **Trilium 为内容后台、Astro 为静态站生成器、GitHub 为发布源** 的个人博客。

本文档同时描述项目开发方式和当前生产自动化。生产基准为：

> **Webhook 实时触发 + ETAPI 每分钟轮询兜底 + 单 Runner 串行同步 + 有变化才提交、构建。**

## 1. 发布架构

```text
Trilium 文章
├─ Trigger Webhook.js（实时入口）
│  └─ HTTPS → Nginx → 127.0.0.1:8787
│                    └─ trilium_sync_webhook.py
└─ systemd timer（每分钟兜底）
   └─ poll_trilium_changes.py（ETAPI 标签与正文哈希快照）
                         ↓
              run_sync_and_build.sh
                         ↓
              sync_trilium_posts.py
              ├─ 拉取正文并本地化附件
              ├─ 生成 Astro 数据
              ├─ 回写 Trilium 标签
              ├─ git commit / push
              └─ 有变化时 npm run build
                         ↓
                    GitHub main
                         ↓
                 外部平台自动部署
```

服务器上的 Astro build 只用于验证，`dist/` 不是正式部署源。

## 2. 核心状态标签

每篇文章独立维护：

| 标签 | 作用 |
|---|---|
| `publish=true/false` | 发布或下架 |
| `sync=true` | 请求同步正文；成功后复位为 `false` |
| `aiRefresh=true` | 请求刷新 AI 元数据；成功后复位为 `false` |
| `pinned=true/false` | 更新置顶状态 |
| `syncStatus` | 最近同步状态 |
| `summary` / `tags` | 摘要与标签，标签总数最多 5 个 |
| `slug` | 稳定文章路径，冲突时使用 Note ID 去重 |
| `publishedAt` / `updatedAt` | 发布时间和更新时间 |
| `syncHash` | 已同步内容哈希 |

模板 Note 只定义字段，不应保存 `publish`、`sync`、`aiRefresh`、`pinned` 的业务值。生产脚本同时按固定模板 ID、标题关键字和模板标签进行隔离。

## 3. 仓库中的自动化文件

```text
scripts/
├── Trigger Webhook.js          # 部署到 Trilium 的属性变更脚本
├── trilium_sync_webhook.py     # 签名校验、接收事件、启动 Runner
├── poll_trilium_changes.py     # ETAPI 每分钟轮询兜底
├── run_sync_and_build.sh       # 锁、工作区准备、同步、构建和报告
├── sync_trilium_posts.py       # 核心同步、附件、回写、Git push
├── ai_generate_meta.py         # AI 摘要及标签增量补充
└── fetch_real_favicons.py      # 项目辅助脚本，不属于发布主链路

ops/systemd/
├── longblog-webhook.service
├── longblog-poller.service
└── longblog-poller.timer

docs/
├── longblog-automation-stable.md
└── automation-layout-server.md
```

生产版本必须以这些受 Git 管理的文件为源。修改后先验证，再将对应文件部署到服务器 `service/`，不要只在线修改生产副本。

## 4. 生产目录

```text
/root/longblog-automation/
├── service/                 # 从仓库 scripts/ 部署的生产脚本
├── runtime/                 # 不入 Git：密钥、日志、报告、快照和锁
│   ├── env.sh
│   ├── logs/
│   ├── reports/last_report.json
│   └── state/
└── workspace/current/       # 本仓库的生产工作区
```

旧目录 `/root/longBlog` 和 `/root/longblog-sync` 已退役，不应作为生产入口。

## 5. 配置

生产密钥只放在：

```text
/root/longblog-automation/runtime/env.sh
```

建议权限：

```bash
chmod 600 /root/longblog-automation/runtime/env.sh
```

至少需要：

| 环境变量 | 说明 |
|---|---|
| `TRILIUM_BASE_URL` | Trilium 地址 |
| `TRILIUM_ETAPI_TOKEN` | ETAPI Token，必填且禁止提交 |
| `TRILIUM_BLOG_ROOT_NOTE_ID` | 博客根 Note ID |
| `TRILIUM_PUBLISH_WEBHOOK_SECRET` | Webhook HMAC Secret，禁止提交 |
| `LONGBLOG_AUTO_PUSH` | 生产环境设为 `true` |
| `LONGBLOG_GIT_REMOTE` | 默认 `origin` |
| `LONGBLOG_GIT_BRANCH` | 默认 `main` |
| `LONGBLOG_REPO_URL` | GitHub SSH 仓库地址 |
| `LONGBLOG_GIT_SSH_COMMAND` | 指定部署密钥的 SSH 命令 |
| `LONGBLOG_GIT_USER_NAME` / `LONGBLOG_GIT_USER_EMAIL` | 自动提交身份 |
| `DEEPSEEK_API_KEY` | AI 元数据功能使用，禁止提交 |
| `LONGBLOG_BARK_BASE_URL` | 可选，Bark 通知入口 |
| `LONGBLOG_BARK_ICON_URL` | 可选，通知图标 |

任何 Token、Secret、私钥、`runtime/` 内容都不得提交到仓库。

## 6. systemd 部署

将仓库脚本同步为生产副本：

```bash
install -d /root/longblog-automation/service
install -m 755 scripts/run_sync_and_build.sh /root/longblog-automation/service/
install -m 644 scripts/sync_trilium_posts.py /root/longblog-automation/service/
install -m 644 scripts/trilium_sync_webhook.py /root/longblog-automation/service/
install -m 644 scripts/poll_trilium_changes.py /root/longblog-automation/service/
```

安装服务单元：

```bash
install -m 644 ops/systemd/*.service ops/systemd/*.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now longblog-webhook.service
systemctl enable --now longblog-poller.timer
```

说明：`longblog-poller.service` 是 `Type=oneshot`，平时显示 `inactive` 属于正常状态；它由 timer 每分钟唤起。

Trilium 内部脚本需将 `scripts/Trigger Webhook.js` 的内容部署到脚本 Note，并配置 `runOnAttributeChange`。仓库副本不会自动覆盖 Trilium 内脚本。

## 7. 本地开发与构建

要求 Node.js/npm：

```bash
npm install
npm run dev
npm run build
npm run preview
```

构建成功标准：Astro 无错误完成，目标页面写入 `dist/`。

## 8. 手动执行生产同步

```bash
. /root/longblog-automation/runtime/env.sh
export LONGBLOG_RUNTIME_DIR=/root/longblog-automation/runtime
export LONGBLOG_REPO_DIR=/root/longblog-automation/workspace/current
/bin/sh /root/longblog-automation/service/run_sync_and_build.sh
```

不要直接并发运行多个同步脚本；统一经过 Runner。

## 9. 健康检查与日志

```bash
systemctl status longblog-webhook.service --no-pager
systemctl status longblog-poller.timer --no-pager
systemctl list-timers --all | grep longblog
ss -lntp | grep 8787

cat /root/longblog-automation/runtime/reports/last_report.json
tail -n 80 /root/longblog-automation/runtime/logs/trilium_sync_webhook.log
tail -n 80 /root/longblog-automation/runtime/logs/poller.log
tail -n 80 /root/longblog-automation/runtime/logs/sync.log
tail -n 80 /root/longblog-automation/runtime/logs/build.log
```

健康标准：

- Webhook service 为 `active (running)`；
- Poller timer 为 `active (waiting)`，持续产生轮询日志；
- 8787 仅监听 `127.0.0.1`；
- 最近报告 `failed=[]`；
- 工作区 `git status --short` 为空；
- 无业务变化时不 commit、不 push、不 build。

## 10. 运行态文件

| 文件 | 用途 |
|---|---|
| `state/trilium_poll_snapshot.json` | Poller 上一次状态快照 |
| `state/published_at_registry.json` | 发布时间保护记录 |
| `state/last_webhook.json` | 待消费事件上下文 |
| `state/run.lock` | Runner 防并发锁 |
| `state/pending_rerun` | 锁冲突后的补跑标记 |
| `state/poller.lock` | 防止 Poller 重入 |
| `state/package-lock.sha256` | 判断是否需要重新安装依赖 |
| `reports/last_report.json` | 最近一次真实同步报告 |

这些文件均为运行态，不应进入 Git。

## 11. 故障排查顺序

1. 检查文章标签实际值及是否存在重复标签；
2. 检查 Trilium `Trigger Webhook` 脚本；
3. 检查 Webhook service、Nginx 和 8787 监听；
4. 检查 `poller.log`，确认兜底扫描仍在运行；
5. 查看 `last_report.json` 的 `failed`、`gitPushed`、`buildRan`；
6. 查看 `sync.log` 和 `build.log`；
7. 检查工作区 Git 是否冲突或落后；
8. 检查生成文件和 `public/trilium-assets/`。

## 12. 维护原则

- Webhook 和 Poller 必须复用同一个 Runner；
- 生产 `service/` 必须来自 GitHub 对应版本，禁止长期保留未提交热修复；
- `runtime/env.sh` 和所有敏感信息永不入库；
- 模板只定义标签，文章保存标签值；
- 无实际变化不触发提交与构建；
- 修改生产脚本前先备份，修改后执行语法检查、构建和健康检查；
- 正式站点部署以 GitHub 为源，服务器构建只用于验证。
