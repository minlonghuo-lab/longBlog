# 服务器自动化目录说明

本文档说明当前 longBlog 自动化发布链路在服务器上的目录分布、文件职责、运行入口与维护建议，方便后续排障与维护。

## 一、目录设计

推荐将自动化服务、运行态和项目工作区拆分为三个独立区域：

### 1. 自动化服务目录
- 路径：`/root/longblog-automation/service`
- 作用：存放 webhook 服务、runner 和同步脚本

建议包含：
- `trilium_sync_webhook.py`
- `run_sync_and_build.sh`
- `sync_trilium_posts.py`

### 2. 自动化运行态目录
- 路径：`/root/longblog-automation/runtime`
- 作用：存放环境变量、日志、报告与状态文件

推荐结构：
- `env.sh`：运行环境变量（Trilium、DeepSeek、Webhook Secret、Bark 等）
- `logs/trilium_sync_webhook.log`：webhook 接收日志
- `logs/sync.log`：同步日志
- `logs/build.log`：构建日志
- `reports/last_report.json`：最近一次同步结果
- `state/last_webhook.json`：webhook 上下文临时文件
- `state/package-lock.sha256`：依赖锁文件哈希缓存
- `state/run.lock` / `state/pending_rerun`：运行锁与补跑标记

### 3. 项目工作区
- 路径：`/root/longblog-automation/workspace/current`
- 作用：独立的 longBlog 仓库工作区，用于：
  - 拉取仓库
  - 生成 `src/data/*.generated.ts`
  - 本地化 Trilium 附件
  - 执行 `npm run build` 验证
  - Git commit / push

### 4. 服务托管方式
当前推荐使用 `systemd` 托管 webhook 服务：

- 服务名：`longblog-webhook.service`
- 查看状态：`systemctl status longblog-webhook.service`
- 重启服务：`systemctl restart longblog-webhook.service`
- 查看日志：`journalctl -u longblog-webhook.service -n 50 --no-pager`

### 5. 巡检脚本
推荐在服务器上保留一键巡检脚本：

- 路径：`/root/longblog-automation/check.sh`
- 作用：汇总输出服务状态、监听端口、运行报告、工作区状态和关键日志尾部

> 注意：工作区和服务目录分离后，服务器上的构建结果只承担“验证”职责，不作为正式部署源。

---

## 二、当前核心脚本职责

### 1. `service/trilium_sync_webhook.py`
职责：
- 校验 `X-Trilium-Signature`
- 校验请求体事件格式
- 写入 `runtime/state/last_webhook.json`
- 启动 `service/run_sync_and_build.sh`

这是自动化链路的 webhook 入口。

---

### 2. `service/run_sync_and_build.sh`
职责：
- 加并发锁
- 消费 webhook 上下文
- 加载 `runtime/env.sh`
- 准备或刷新 `workspace/current`
- 调用 `service/sync_trilium_posts.py`
- 写入 `last_report.json`
- 根据 Git 改动决定是否 build
- 记录 `sync.log` / `build.log`

这是自动化链路的调度入口。

---

### 3. `service/sync_trilium_posts.py`
职责：
- 从 Trilium ETAPI 扫描与读取文章
- 跳过模板 note / 非文章 note
- 本地化附件到 `public/trilium-assets/`
- 生成 `src/data/trilium-posts.content.generated.ts`
- 生成 `src/data/trilium-posts.meta.generated.ts`
- 回写 Trilium 标签（slug / summary / tags / syncStatus 等）
- 与 Git 同步并 push

当前已包含的重要策略：
- push 前先同步远端（fetch/rebase）
- 同一篇文章优先复用自己的旧 slug
- `pinned_changed` 支持快路径
- 未请求同步的文章优先复用已有生成结果，避免无意义重建与无意义 push

---

## 三、生产链路时序图

```text
Trilium note 标签变化
  ↓
Trigger Webhook（Trilium 内部脚本）
  ↓
https://blog.ssaw.top/trilium-sync-webhook
  ↓
Nginx 转发到 127.0.0.1:8787
  ↓
/root/longblog-automation/service/trilium_sync_webhook.py
  ↓
/root/longblog-automation/runtime/state/last_webhook.json
  ↓
/root/longblog-automation/service/run_sync_and_build.sh
  ↓
/root/longblog-automation/workspace/current
  ↓
生成 src/data/*.generated.ts + public/trilium-assets/*
  ↓
Git commit / push
  ↓
npm run build（仅验证）
```

---

## 四、维护建议

### 1. 优先维护这些文件
- `/root/longblog-automation/service/trilium_sync_webhook.py`
- `/root/longblog-automation/service/run_sync_and_build.sh`
- `/root/longblog-automation/service/sync_trilium_posts.py`
- `/root/longblog-automation/runtime/env.sh`

### 2. 排障优先顺序
1. `/root/longblog-automation/runtime/logs/trilium_sync_webhook.log`
2. `/root/longblog-automation/runtime/reports/last_report.json`
3. `/root/longblog-automation/runtime/logs/sync.log`
4. `/root/longblog-automation/runtime/logs/build.log`
5. `src/data/trilium-posts.meta.generated.ts`

### 3. 推荐保留的目录职责边界
- `service/`：只放必要脚本
- `runtime/`：只放运行态文件
- `workspace/current/`：只放仓库工作区

### 4. 后续可继续优化
- 将 webhook 服务改为 systemd 管理
- 增加更细粒度的错误分类和通知
- 为工作区清理、回滚和恢复增加专用脚本

---

## 五、一句话结论

当前推荐的 longBlog 自动化链路结构是：

- **服务在 `/root/longblog-automation/service`**
- **运行态在 `/root/longblog-automation/runtime`**
- **工作区在 `/root/longblog-automation/workspace/current`**

这样服务职责、运行态和项目工作区彼此解耦，后续维护会清晰很多。
