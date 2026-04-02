# longBlog 自动化运行态迁移收尾说明

本文档说明当前 longBlog 自动化链路的推荐目录结构，以及旧运行态目录的退役思路。

---

## 一、当前推荐结构

### 1. 自动化服务目录
- 路径：`/root/longblog-automation/service`
- 作用：存放 webhook 服务、runner 和同步脚本

### 2. 自动化运行态目录
- 路径：`/root/longblog-automation/runtime`
- 作用：存放环境变量、日志、报告、状态文件

推荐结构：
```text
/root/longblog-automation/runtime/
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

### 3. 项目工作区
- 路径：`/root/longblog-automation/workspace/current`
- 作用：存放独立的仓库工作区，用于同步、生成、验证与 Git push

---

## 二、已经验证成功的链路

已经通过实际运行验证：

1. Trilium 内部脚本发送 webhook
2. Nginx 转发到 `127.0.0.1:8787`
3. `service/trilium_sync_webhook.py` 接收并验签
4. runner 真正使用新的 runtime 和 workspace 路径
5. 自动 Git push 成功
6. Astro build 能在独立工作区完成验证
7. 无请求同步时可稳定达到：
   - `gitChanged=false`
   - `gitPushed=false`
   - `buildRan=false`

结论：
> 新的自动化目录结构已经能够稳定接管自动化运行态。

---

## 三、旧目录现在是什么角色？

如果你有旧目录，例如：
- `/root/longBlog`
- 旧的 runtime 兼容目录

建议将其理解为：

> **历史工作区 / 兼容残留 / 回滚参考目录**

而不是当前主运行目录。

也就是说，新的服务入口、运行态与工作区应当以 `/root/longblog-automation` 为中心，而不是继续把旧仓库目录同时当服务目录使用。

---

## 四、当前推荐的维护原则

### 1. 以后主要看这几个位置
#### 主入口
- `/root/longblog-automation/service/trilium_sync_webhook.py`

#### 主运行态
- `/root/longblog-automation/runtime/logs/trilium_sync_webhook.log`
- `/root/longblog-automation/runtime/logs/sync.log`
- `/root/longblog-automation/runtime/logs/build.log`
- `/root/longblog-automation/runtime/reports/last_report.json`

#### 主业务脚本
- `/root/longblog-automation/service/run_sync_and_build.sh`
- `/root/longblog-automation/service/sync_trilium_posts.py`

### 2. 不要把新逻辑再改回旧目录
如果以后继续调自动化，优先使用：
- `/root/longblog-automation/service`
- `/root/longblog-automation/runtime`
- `/root/longblog-automation/workspace/current`

### 3. 旧目录可以先保留，不急着删
建议先观察一段时间，确认连续多次 webhook 都正常写入新 runtime，再决定是否彻底清理旧目录。

---

## 五、当前迁移完成状态总结

### 已完成
- webhook 入口已切换到独立服务目录
- webhook 日志、同步日志、构建日志已写入统一 runtime
- runner 使用独立工作区
- 实际业务流验证通过
- 无意义重建与无意义 push 已被抑制

### 后续可选项
- 是否彻底删除旧目录
- 是否把旧日志与旧报告进一步归档
- 是否引入 systemd 托管 webhook 服务

---

## 六、一句话总结

当前 longBlog 自动化链路推荐使用如下结构：

> **入口在 `/root/longblog-automation/service/`，运行态在 `/root/longblog-automation/runtime/`，工作区在 `/root/longblog-automation/workspace/current/`。**

这样的结构可以把自动化服务与项目工作区分开，后续维护会更清晰、可控。
