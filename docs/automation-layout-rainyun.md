# 雨云 longBlog 自动化链路目录说明

本文档用于说明当前雨云服务器上 longBlog 自动化发布链路的目录分布、文件职责、运行入口与维护建议，方便后续排障与维护。

## 一、当前主目录分布

### 1. 仓库主目录
- 路径：`/root/longBlog`
- 作用：Git 仓库主工作区，负责存放博客前端源码、同步脚本、构建产物与文档。

关键子目录：
- `scripts/`：主业务自动化脚本
- `src/`：Astro 前端源码
- `public/`：静态资源与 Trilium 本地化附件
- `dist/`：构建后的静态站点
- `docs/`：项目文档
- `ops/`：运维相关脚本与归档

---

### 2. 自动化运行态目录
- 路径：`/root/longblog-sync`
- 作用：存放自动化链路运行时状态、环境变量、日志与报告

关键文件：
- `env.sh`：运行环境变量（Trilium、DeepSeek、Webhook Secret、Bark 等）
- `last_report.json`：最近一次同步结果
- `sync.log`：同步日志
- `build.log`：构建日志
- `last_webhook.json`：webhook 上下文临时文件（被 runner 消费后会删除）

> 注意：这是运行态目录，不属于 Git 仓库主代码区。

---

### 3. Webhook 服务入口目录
- 当前正式入口路径：`/root/longBlog/ops/trilium_sync_webhook.py`
- 作用：接收 Trilium webhook、验签、落盘上下文、触发 runner

当前监听：
- `127.0.0.1:8787`

当前由 Nginx 转发：
- `https://blog.ssaw.top/trilium-sync-webhook`
  → `127.0.0.1:8787/trilium-sync-webhook`

---

## 二、当前核心脚本职责

### 1. `/root/longBlog/ops/trilium_sync_webhook.py`
职责：
- 校验 `X-Trilium-Signature`
- 校验请求体事件格式
- 写入 `/root/longblog-sync/last_webhook.json`
- 启动 `/root/longBlog/scripts/run_sync_and_build.sh`

这是当前**生产 webhook 入口**。

---

### 2. `/root/longBlog/scripts/run_sync_and_build.sh`
职责：
- 加并发锁
- 消费 webhook 上下文
- 加载 `/root/longblog-sync/env.sh`
- 执行 `sync_trilium_posts.py`
- 写入 `last_report.json`
- 根据 Git 改动决定是否 build
- 执行 `npm install` / `npm run build`
- 记录 `sync.log` / `build.log`

这是当前**自动化 runner**。

---

### 3. `/root/longBlog/scripts/sync_trilium_posts.py`
职责：
- 从 Trilium ETAPI 扫描与读取文章
- 跳过模板 note / 非文章 note
- 本地化附件到 `public/trilium-assets/`
- 生成 `src/data/trilium-posts.content.generated.ts`
- 生成 `src/data/trilium-posts.meta.generated.ts`
- 回写 Trilium 标签（slug / summary / tags / syncStatus 等）
- 与 Git 同步并 push

当前已包含的重要修复：
- push 前先同步远端（fetch/rebase）
- 在生成文件前先同步远端
- 同一篇文章优先复用自己的旧 slug
- `pinned_changed` 快路径支持重试回读
- `pinned_changed` 若状态迟滞则自动回退全量主流程

---

### 4. `/root/longBlog/scripts/ai_generate_meta.py`
职责：
- 调用 DeepSeek 生成 / 补全摘要与标签
- 支持 `tags_only` 与 `summary_tags` 两种模式

---

## 三、当前归档目录

为避免 `/root` 根目录过于混乱，已将历史/辅助/打包文件归档至：

- `/root/longBlog/ops/archive/2026-04-01-root-cleanup/`

归档内容包括：
- 历史部署脚本
- 修复脚本
- 上传中转脚本
- `.bak_*` 旧备份
- `.tar.gz` 打包归档

这些文件**不参与当前生产链路执行**，仅作为历史留档。

---

## 四、当前仍保留在 `/root` 的少量文件

### 当前保留原因：
#### 1. 运行日志 / 运行态
- `/root/trilium_sync_webhook.log`
- `/root/longblog-sync/*`

#### 2. 敏感/凭证文件
- `/root/trilium_webhook_secret.env`
- `/root/.ssh/id_ed25519_longblog`
- `/root/.ssh/id_ed25519_longblog.pub`

#### 3. 旧 webhook 文件（暂未删除）
- `/root/longBlog/ops/trilium_sync_webhook.py`

说明：
- 当前生产进程已切换到 `/root/longBlog/ops/trilium_sync_webhook.py`
- 确认稳定运行一段时间后可再决定是否删除

---

## 五、当前生产链路时序图

```text
Trilium note 标签变化
  ↓
Trigger Webhook（Trilium 内部脚本）
  ↓
https://blog.ssaw.top/trilium-sync-webhook
  ↓
Nginx 转发到 127.0.0.1:8787
  ↓
/root/longBlog/ops/trilium_sync_webhook.py
  ↓
/root/longblog-sync/last_webhook.json
  ↓
/root/longBlog/scripts/run_sync_and_build.sh
  ↓
/root/longBlog/scripts/sync_trilium_posts.py
  ↓
生成 src/data/*.generated.ts + public/trilium-assets/*
  ↓
Git commit / push
  ↓
npm run build
  ↓
/root/longBlog/dist
```

---

## 六、维护建议

### 1. 当前优先维护这些文件
- `/root/longBlog/ops/trilium_sync_webhook.py`
- `/root/longBlog/scripts/run_sync_and_build.sh`
- `/root/longBlog/scripts/sync_trilium_posts.py`
- `/root/longblog-sync/env.sh`

### 2. 排障优先顺序
1. `/root/trilium_sync_webhook.log`
2. `/root/longblog-sync/last_report.json`
3. `/root/longblog-sync/sync.log`
4. `/root/longblog-sync/build.log`
5. `src/data/trilium-posts.meta.generated.ts`

### 3. 不建议直接删除
- `/root/trilium_webhook_secret.env`
- `/root/.ssh/id_ed25519_longblog*`
- `/root/longblog-sync/*`

### 4. 后续可进一步优化
- 将 webhook 服务改为 systemd 管理
- 将 `trilium_sync_webhook.log` 也迁入更规范的日志目录

---

## 七、一句话结论

当前雨云 longBlog 自动化链路已经整理为：
- **主代码在 `/root/longBlog`**
- **运行态在 `/root/longblog-sync`**
- **生产 webhook 入口在 `/root/longBlog/ops/trilium_sync_webhook.py`**
- **历史杂项已归档到 `/root/longBlog/ops/archive/2026-04-01-root-cleanup/`**

这样后续维护会比之前清晰很多。
