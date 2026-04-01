# 雨云 longBlog 自动化运行态迁移收尾说明

本文档说明当前 longBlog 自动化链路在雨云服务器上的**最终运行结构**，以及旧运行态目录的退役策略。

---

## 一、当前已生效的结构

### 1. 主 Git 仓库
- 路径：`/root/longBlog`
- 作用：博客源码、同步脚本、构建产物、文档

### 2. Webhook 正式入口
- 路径：`/root/longBlog/ops/trilium_sync_webhook.py`
- 当前已生效
- 当前监听：`127.0.0.1:8787`

### 3. Webhook 启动级引导配置
- 路径：`/root/longBlog/ops/runtime-bootstrap.env`
- 作用：告诉 webhook / runner 当前真正使用的 runtime 目录与 webhook 日志路径

当前内容核心为：
```bash
export LONGBLOG_RUNTIME_DIR=/root/longBlog/runtime
export LONGBLOG_WEBHOOK_LOG=/root/longBlog/runtime/logs/trilium_sync_webhook.log
```

### 4. 新运行态目录（当前主运行态）
- 路径：`/root/longBlog/runtime`

当前已生效的分层结构：
```text
/root/longBlog/runtime/
├── env.sh
├── logs/
│   ├── trilium_sync_webhook.log
│   ├── sync.log
│   └── build.log
├── reports/
│   └── last_report.json
└── state/
    ├── last_webhook.json
    ├── package-lock.sha256
    ├── run.lock
    └── pending_rerun
```

---

## 二、当前已验证成功的链路

已经通过真实 webhook 事件验证：

1. Trilium 内部脚本发送 webhook
2. Nginx 转发到 `127.0.0.1:8787`
3. `/root/longBlog/ops/trilium_sync_webhook.py` 接收并验签
4. runner 真正使用新 runtime 路径：
   - `runtime/reports/last_report.json`
   - `runtime/logs/sync.log`
   - `runtime/logs/build.log`
   - `runtime/state/last_webhook.json`
5. 自动 Git push 成功
6. Astro build 成功

结论：
> 新 runtime 目录已经接管自动化运行态。

---

## 三、旧目录 `/root/longblog-sync` 现在是什么角色？

旧目录：
- `/root/longblog-sync`

当前状态：
- **不再作为主运行态目录使用**
- 当前保留的作用主要是：
  1. 历史日志和历史报告
  2. 迁移观察期的兼容保留
  3. 旧环境残留留档

所以你现在应当把它理解为：

> **旧运行态目录（观察退役期）**

而不是当前主运行目录。

---

## 四、当前推荐的维护原则

### 1. 以后主要看这几个位置
#### 主入口
- `/root/longBlog/ops/trilium_sync_webhook.py`

#### 主运行态
- `/root/longBlog/runtime/logs/trilium_sync_webhook.log`
- `/root/longBlog/runtime/logs/sync.log`
- `/root/longBlog/runtime/logs/build.log`
- `/root/longBlog/runtime/reports/last_report.json`

#### 主业务脚本
- `/root/longBlog/scripts/run_sync_and_build.sh`
- `/root/longBlog/scripts/sync_trilium_posts.py`

### 2. 不要再把新逻辑改回 `/root/longblog-sync`
如果以后要继续调自动化，优先使用：
- `/root/longBlog/runtime`

### 3. 旧目录先保留，不急着删
建议先观察一段时间，确认连续多次 webhook 都正常写入新 runtime，再决定是否彻底清理旧目录。

---

## 五、当前迁移完成状态总结

### 已完成
- webhook 入口迁移到 `ops/`
- webhook 日志迁移到新 runtime
- runner 运行态迁移到新 runtime 分层目录
- 真实业务流验证通过

### 未完成（可选后续）
- 是否彻底删除 `/root/longblog-sync`
- 是否把旧日志/旧报告进一步归档
- 是否引入 systemd 托管

---

## 六、一句话总结

当前 longBlog 自动化链路在雨云上已经进入新的稳定结构：

> **入口在 `/root/longBlog/ops/`，运行态在 `/root/longBlog/runtime/`，旧 `/root/longblog-sync` 仅作为观察退役期保留。**
