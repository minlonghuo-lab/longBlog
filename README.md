<div align="center">

# longBlog

一个以 **Astro** 为核心的个人博客项目：
前台是偏极简、纸张感的静态站点，内容源来自 **Trilium** 与 **Memos**，并通过 **Webhook + Runner + Git Push + Build** 组成自动化发布链路。

[在线站点](https://huowenlong.com) · [自动化流](#自动化发布流) · [环境变量](#环境变量) · [本地开发](#本地开发) · [服务器部署结构](#服务器部署结构)

![Astro](https://img.shields.io/badge/Astro-6.x-black?style=flat-square&logo=astro)
![Trilium](https://img.shields.io/badge/Content-Trilium-4b5563?style=flat-square)
![Memos](https://img.shields.io/badge/Shuoshuo-Memos-2563eb?style=flat-square)
![DeepSeek](https://img.shields.io/badge/AI-DeepSeek-7c3aed?style=flat-square)
![Deploy](https://img.shields.io/badge/Deploy-Server%20%2B%20Nginx-16a34a?style=flat-square)

</div>

---

## 项目简介

`longBlog` 是一个围绕“**笔记驱动博客**”思路搭建的个人博客：

- **站点前台** 使用 Astro 构建静态页面，追求清爽、轻量、可长期维护。
- **文章主内容** 来自 Trilium，通过 ETAPI 拉取并生成静态数据文件。
- **说说 / 动态** 来自 Memos 公共 API，在前端按分页方式加载。
- **知识地图** 通过 Trilium 树代理接口懒加载，用图谱方式展示整个知识系统。
- **自动化发布** 在服务器上运行：Trilium 标签变化 → webhook → runner → 同步脚本 → Git push → Astro build。

从代码和实际生产运行情况看，这个项目不是传统“后台 CMS + 前台渲染”的模式，而是更接近：

> **Trilium 负责内容编辑与状态管理，longBlog 负责内容投影、静态生成与公开展示。**

---

## 项目定位

这个项目可以概括为 3 层：

1. **展示层**：Astro 博客前台
2. **内容层**：Trilium / Memos
3. **自动化层**：Webhook、同步脚本、AI 元数据补全、Git Push、构建发布

它的核心目标不是做一个通用博客系统，而是服务于一个个人知识工作流：

- 在 Trilium 里写文章、维护标签、管理发布状态
- 通过 webhook 触发自动同步
- 自动生成博客所需的结构化数据
- 在前台以静态站方式稳定输出

---

## 核心功能

### 1. 文章系统（Trilium 驱动）
- 从 Trilium 博客根节点递归扫描文章
- 依据 `publish=true` 控制文章是否进入博客
- 自动生成稳定 slug
- 自动抽取 / 回写摘要、标签、发布时间、更新时间、同步状态
- 将 Trilium 附件本地化到 `public/trilium-assets/`
- 生成前端消费的 `src/data/*.generated.ts`

### 2. 自动化发布流
- Trilium 内部脚本监听标签变更
- Webhook 发送到服务器
- 服务器验签后写入事件上下文
- Runner 执行同步脚本
- 有 Git 变更时自动提交并 push
- 有内容变更时自动执行 `npm run build`

### 3. AI 元数据补全
- 使用 DeepSeek 为文章补摘要与标签
- 已有合理标签时采用“增量补全”，而不是粗暴覆盖
- 支持 `aiRefresh=true` 触发单篇文章元数据刷新

### 4. 前台阅读体验
- 首页文章列表
- 文章列表页标签筛选
- 文章详情页目录、阅读进度、图片灯箱、返回顶部
- 深浅色主题切换
- 页面切换动效与路由进度条
- 页脚实时运行时长计数

### 5. 说说 / 友链 / 关于页
- **说说**：从 Memos API 拉取碎碎念与附件
- **友链**：本地数据维护，展示站点名片
- **关于**：通过 `vis-network` 以知识图谱方式展示 Trilium 知识树

### 6. 可观测与排障
- webhook 日志
- 同步日志
- 构建日志
- 最近一次同步报告 `last_report.json`
- 并发锁与补跑标记，避免 webhook 高频触发时互相踩踏

---

## 页面说明

| 页面 | 路径 | 数据来源 | 说明 |
|---|---|---|---|
| 首页 | `/` | Trilium 生成数据 | 作者介绍、社交入口、搜索、最新文章 |
| 文章列表 | `/blog` | Trilium 生成数据 | 标签筛选、文章归档入口 |
| 文章详情 | `/blog/[slug]` | Trilium 生成数据 | A4 纸张风格正文、目录、进度、灯箱 |
| 说说 | `/shuoshuo` | Memos API | 分页加载 memo、图片预览、附件展示 |
| 友链 | `/friends` | 本地 `src/data/friends.ts` | 静态友链卡片 |
| 关于 | `/about` | Trilium Tree API | 知识地图图谱、可拖动缩放与懒加载 |

---

## 技术栈

### 前端

| 技术 | 用途 |
|---|---|
| Astro 6 | 静态站生成与页面组织 |
| TypeScript | 类型标注与数据结构定义 |
| 原生脚本 + Astro 组件 | 搜索、目录、主题切换、动画、交互 |
| vis-network / vis-data | 关于页知识图谱 |
| CSS Variables | 深浅色主题与全站样式系统 |

### 内容与数据

| 技术 | 用途 |
|---|---|
| Trilium ETAPI | 拉取文章、属性、附件，回写发布状态 |
| Memos API | 说说页面内容来源 |
| 生成式 TS 数据文件 | 静态站构建时直接消费 |
| DeepSeek API | 摘要与标签补全 |

### 自动化与部署

| 技术 | 用途 |
|---|---|
| Trilium 内部脚本 | 监听标签变化并发出 webhook |
| Python | 同步脚本、AI 元数据脚本、Webhook 服务 |
| Shell Runner | 加锁、调度同步与构建 |
| Git | 自动提交生成文件并 push |
| Nginx | webhook 反向代理 |
| Linux 服务器 | 自动化运行宿主机 |

---

## 与 flare-stack-blog 的关系

这个项目在**界面风格与 README 组织方式**上参考了 [flare-stack-blog](https://github.com/du2333/flare-stack-blog)，但底层架构并不相同。

二者主要区别：

| 项目 | 架构特点 |
|---|---|
| flare-stack-blog | Cloudflare 生态全栈博客 / CMS |
| longBlog | Astro 静态博客 + Trilium/Memos 内容源 + 服务器自动化脚本 |

换句话说：

- `flare-stack-blog` 更像完整博客平台
- `longBlog` 更像“围绕个人知识库构建的自动化发布前台”

---

## 仓库结构

```text
longBlog/
├── .env.example                     # 前端公开变量模板
├── astro.config.mjs                # Astro 配置
├── package.json                    # 前端依赖与脚本
├── docs/
│   ├── about-page-env.md           # About 页面环境变量说明
│   ├── automation-layout-server.md # 自动化服务目录说明
│   ├── configuration.md            # 配置说明
│   ├── longblog-automation-stable.md
│   ├── migration-to-new-server-babysitter-guide.md
│   └── runtime-cutover-note.md
├── public/
│   ├── favicon.ico
│   ├── favicon.svg
│   └── trilium-assets/             # 运行时生成 / 同步后的本地附件
├── scripts/
│   ├── Trigger Webhook.js          # Trilium 内部脚本参考版本
│   ├── ai_generate_meta.py         # DeepSeek 元数据生成
│   ├── fetch_real_favicons.py      # 友链 favicon 辅助脚本
│   ├── run_sync_and_build.sh       # Runner
│   └── sync_trilium_posts.py       # 核心同步脚本
└── src/
    ├── components/
    ├── data/
    ├── layouts/
    ├── pages/
    ├── styles/
    └── consts.ts
```

---

## 前端架构说明

### 1. 配置入口：`src/consts.ts`
全站公开配置统一从环境变量读取，包括：

- 站点标题、描述、作者信息
- GitHub / Email
- Memos、Trilium、Trilium Tree API 地址
- ICP 文案
- Umami 统计脚本
- 站点启动时间
- 顶部导航项

### 2. 数据聚合：`src/data/posts.ts`
该文件负责把：

- `trilium-posts.content.generated.ts`
- `trilium-posts.meta.generated.ts`

聚合成最终的 `posts` 数组，并提供：

- `getSortedPosts()`
- `getPinnedPosts()`
- `getAllTags()`

当前排序规则：

1. 置顶文章优先
2. 非置顶文章按发布时间倒序
3. 同时间下按 ID 稳定排序

### 3. 页面布局：`src/layouts/BaseLayout.astro`
提供全站公共能力：

- Header / Footer
- 深浅色主题初始化与切换动画
- 路由切换进度条
- 预加载 Memos 数据
- Umami 统计注入
- 页面恢复逻辑（处理浏览器前进 / 后退）

### 4. 首页：`src/pages/index.astro`
首页提供：

- 作者介绍
- GitHub / 邮箱入口
- 主题切换
- 文章搜索
- 最新文章列表

搜索为前端本地搜索，匹配：

- 标题
- 摘要
- slug
- tags

### 5. 文章详情：`src/pages/blog/[slug].astro`
文章详情页是当前前台交互最完整的页面，包含：

- 静态路由预生成
- 自动 TOC
- 阅读进度条
- 当前阅读进度百分比
- 桌面端侧边导航折叠
- 移动端目录抽屉
- 图片点击灯箱预览
- 返回顶部

### 6. 关于页：`src/pages/about/index.astro`
关于页不是简单静态介绍，而是一个知识图谱页：

- 使用 `vis-network` 渲染节点图
- 支持拖拽、缩放、点击节点展开子层
- 通过 `PUBLIC_TRILIUM_TREE_API_URL` 接入代理接口
- 对“子节点很多”的节点采用分段增量加载，避免一次性渲染过重

### 7. 说说页：`src/pages/shuoshuo/index.astro`
说说页通过 Memos 公共 API 拉取内容，支持：

- 分页加载
- 前端缓存
- 图片预览
- Markdown 图片抽取
- 附件展示
- 空状态 / 错误状态 / 结束状态

---

## 内容模型与 Trilium 标签约定

`longBlog` 的发布逻辑高度依赖 Trilium note 的标签状态。

### 文章级核心标签

| 标签 | 含义 |
|---|---|
| `publish=true/false` | 是否发布到博客 |
| `sync=true/false` | 请求同步内容 |
| `aiRefresh=true/false` | 请求 AI 重新补全摘要 / 标签 |
| `pinned=true/false` | 是否置顶 |
| `syncStatus` | 当前同步状态，如 queued / publishing / published / error / removed |
| `summary` | 文章摘要 |
| `tags` | 标签列表 |
| `slug` | 文章路径 slug |
| `publishedAt` | 首次发布时间 |
| `updatedAt` | 最近更新时间 |
| `syncHash` | 当前内容哈希，用于判定增量变化 |

### 模板 note 约束

根据实际生产文档，模板 note 必须遵守“**定义和值分离**”：

- 模板里可以保留 `label:publish`、`label:sync` 等字段定义
- 模板里**不能**保留 `publish=false` 这类真实业务值

否则模板会污染实际文章状态，导致 webhook 与同步判断错乱。

---

## 自动化发布流

当前稳定方案可以概括为：

```text
Trilium 标签变化
  ↓
Trigger Webhook.js
  ↓
https://blog.ssaw.top/trilium-sync-webhook
  ↓
Nginx → 127.0.0.1:8787
  ↓
server/service/trilium_sync_webhook.py
  ↓
server/runtime/state/last_webhook.json
  ↓
server/service/run_sync_and_build.sh
  ↓
server/workspace/current
  ↓
生成 src/data/*.generated.ts + public/trilium-assets/*
  ↓
Git commit / push
  ↓
npm run build（仅验证）
```

### 1. Trilium 内部触发脚本
参考文件：`scripts/Trigger Webhook.js`

它的职责是：

- 监听 `publish / sync / pinned / aiRefresh`
- 过滤模板 note
- 对请求体做 HMAC-SHA256 签名
- 把事件推送给服务器 webhook 入口

### 2. Webhook 服务
生产环境入口职责：

- 校验 `X-Trilium-Signature`
- 校验事件 payload
- 写入 webhook 上下文文件
- 启动 runner

支持的事件：

| 事件 | 触发来源 | 语义 |
|---|---|---|
| `publish_changed` | `publish` 变化 | 发布 / 下架文章 |
| `sync_requested` | `sync=true` | 强制同步文章内容 |
| `pinned_changed` | `pinned` 变化 | 更新置顶状态 |
| `ai_refresh_requested` | `aiRefresh=true` | 强制刷新摘要 / 标签 |

### 3. Runner：`scripts/run_sync_and_build.sh`
这是生产自动化的调度入口。

它会做这些事：

- 从运行态读取环境变量与上下文
- 创建并发锁 `run.lock`
- 若已在运行则写入 `pending_rerun` 补跑标记
- 准备独立工作区
- 执行 `sync_trilium_posts.py`
- 把结果写到 `sync.log` 与 `last_report.json`
- 若 Git 有变化则决定是否 `npm install` / `npm run build`
- 支持 Bark 通知

### 4. 核心同步脚本：`scripts/sync_trilium_posts.py`
这是整个项目最关键的业务脚本，职责包括：

- 扫描 Trilium 博客根节点
- 跳过模板 note / 非文章 note / 特定关键字 note
- 读取 note HTML 内容
- 下载并本地化附件
- 生成稳定 slug
- 根据条件触发 AI 元数据补全
- 计算 `syncHash`
- 回写文章状态标签
- 生成前端数据文件
- 判断 Git 是否变更
- 自动 commit / push

### 5. AI 元数据脚本：`scripts/ai_generate_meta.py`
通过 DeepSeek API 完成：

- 摘要补全
- 标签补全
- 已有标签的增量合并

当前策略比较保守：

- 有合理 tags 时，尽量只补具体标签
- 不删除已有合理标签
- 摘要缺失或明显不足时才重写

---

## 生成文件说明

同步脚本当前会生成并维护以下前端数据：

| 文件 | 作用 |
|---|---|
| `src/data/trilium-posts.content.generated.ts` | 文章标题、摘要、HTML 正文 |
| `src/data/trilium-posts.meta.generated.ts` | slug、时间、标签、置顶、同步状态 |
| `public/trilium-assets/<noteId>/` | Trilium 附件本地化目录 |

这些文件属于**自动生成产物**，不建议手工维护。

---

## 服务器部署结构

当前推荐的服务器端目录设计如下：

| 路径 | 作用 |
|---|---|
| `/root/longblog-automation/service` | 自动化服务脚本目录 |
| `/root/longblog-automation/runtime` | 运行态目录（env / logs / reports / state） |
| `/root/longblog-automation/workspace/current` | 独立项目工作区 |

推荐结构：

```text
/root/longblog-automation/
├── service/
│   ├── trilium_sync_webhook.py
│   ├── run_sync_and_build.sh
│   └── sync_trilium_posts.py
├── runtime/
│   ├── env.sh
│   ├── logs/
│   ├── reports/
│   └── state/
└── workspace/
    └── current/
```

这种结构的意义是：

- **服务目录**只放必要自动化脚本
- **工作区**单独存在，便于验证、排障和后续清理
- 服务器上的构建结果只作为验证，不作为正式部署源
- 正式部署由 GitHub 仓库变更后触发外部平台自动发布

---

## 环境变量

项目采用“**公开变量进 `.env`，敏感变量进服务器环境 / runtime**”的双层配置策略。

### 1. 前端公开变量（`.env` / `.env.example`）

| 变量名 | 用途 |
|---|---|
| `PUBLIC_SITE_TITLE` | 站点标题 |
| `PUBLIC_SITE_DESCRIPTION` | 站点描述 |
| `PUBLIC_SITE_AUTHOR` | 作者名 |
| `PUBLIC_SITE_AUTHOR_INTRO` | 作者介绍 |
| `PUBLIC_SITE_GITHUB` | GitHub 地址 |
| `PUBLIC_SITE_EMAIL` | 邮箱 |
| `PUBLIC_SITE_URL` | 站点地址 |
| `PUBLIC_ICP_URL` | ICP 链接 |
| `PUBLIC_ICP_TEXT` | ICP 文案 |
| `PUBLIC_FOOTER_POWERED_TRILIUM_URL` | 页脚 Trilium 链接 |
| `PUBLIC_FOOTER_POWERED_ASTRO_URL` | 页脚 Astro 链接 |
| `PUBLIC_UMAMI_SCRIPT_URL` | Umami 脚本地址 |
| `PUBLIC_UMAMI_WEBSITE_ID` | Umami 站点 ID |
| `PUBLIC_SITE_LAUNCH_DATE` | 建站起始时间 |
| `PUBLIC_MEMOS_URL` | Memos 地址（建议部署环境注入） |
| `PUBLIC_TRILIUM_BASE_URL` | Trilium 公共地址（建议部署环境注入） |
| `PUBLIC_TRILIUM_TREE_API_URL` | Trilium Tree API（建议部署环境注入） |

### 2. 服务器敏感变量（`runtime/env.sh` 等）

| 变量名 | 用途 |
|---|---|
| `TRILIUM_BASE_URL` | Trilium 服务地址 |
| `TRILIUM_ETAPI_TOKEN` | ETAPI Token |
| `TRILIUM_BLOG_ROOT_NOTE_ID` | 博客根节点 ID |
| `TRILIUM_PUBLISH_WEBHOOK_SECRET` | webhook 验签 secret |
| `DEEPSEEK_API_BASE` | DeepSeek API Base |
| `DEEPSEEK_API_KEY` | DeepSeek API Key |
| `LONGBLOG_DEEPSEEK_MODEL` | DeepSeek 模型名 |
| `LONGBLOG_AUTO_PUSH` | 是否自动 push |
| `LONGBLOG_GIT_REMOTE` | Git 远端名 |
| `LONGBLOG_GIT_BRANCH` | Git 分支名 |
| `LONGBLOG_BARK_BASE_URL` | Bark 通知地址（可选） |
| `LONGBLOG_RUNTIME_DIR` | 当前 runtime 路径 |
| `LONGBLOG_REPO_DIR` | 当前工作区路径 |
| `LONGBLOG_WEBHOOK_LOG` | webhook 日志路径 |

### 配置原则

- `.env` 中的变量默认会进入前端构建结果，因此只能放公开信息
- Token、Secret、API Key、Webhook Secret 等敏感信息必须只留在服务器环境中

---

## 本地开发

### 前置要求
- Node.js / npm
- 可访问的 Trilium / Memos 公共地址（若需要完整联调）

### 安装依赖

```bash
npm install
```

### 启动开发环境

```bash
npm run dev
```

### 本地构建

```bash
npm run build
npm run preview
```

> 实际维护中，构建验证通常优先放在服务器工作区完成，而不是默认在本地环境构建。

---

## 手动执行自动化脚本

### 1. 手动运行同步脚本

```bash
cd /root/longblog-automation/workspace/current
. /root/longblog-automation/runtime/env.sh
export LONGBLOG_RUNTIME_DIR=/root/longblog-automation/runtime
export LONGBLOG_REPO_DIR=/root/longblog-automation/workspace/current
python3 /root/longblog-automation/service/sync_trilium_posts.py
```

### 2. 手动运行 Runner

```bash
. /root/longblog-automation/runtime/env.sh
export LONGBLOG_RUNTIME_DIR=/root/longblog-automation/runtime
export LONGBLOG_REPO_DIR=/root/longblog-automation/workspace/current
/bin/sh /root/longblog-automation/service/run_sync_and_build.sh
```

### 3. 观察日志

```bash
cat /root/longblog-automation/runtime/logs/trilium_sync_webhook.log
cat /root/longblog-automation/runtime/logs/sync.log
cat /root/longblog-automation/runtime/logs/build.log
cat /root/longblog-automation/runtime/reports/last_report.json
```

---

## 排障建议

如果自动化流异常，建议按下面顺序排查：

1. **Trilium note 实际标签值是否正确**
   - 特别是 `publish / sync / pinned / aiRefresh`
2. **Trilium 内部脚本是否仍为新版本**
   - 重点看是否过滤模板 note
3. **webhook 日志**
   - `/root/longblog-automation/runtime/logs/trilium_sync_webhook.log`
4. **最近一次同步报告**
   - `/root/longblog-automation/runtime/reports/last_report.json`
5. **同步日志**
   - `/root/longblog-automation/runtime/logs/sync.log`
6. **构建日志**
   - `/root/longblog-automation/runtime/logs/build.log`
7. **生成文件内容是否符合预期**
   - `src/data/trilium-posts.meta.generated.ts`

### 常见问题

| 现象 | 优先检查 |
|---|---|
| webhook 收不到 | Nginx 反代、签名 secret、监听端口 |
| 文章没发布出来 | `publish=true` 是否真实写入文章 note |
| 标签 / 摘要不更新 | `aiRefresh=true`、DeepSeek Key、AI 脚本日志 |
| 置顶不同步 | `pinned_changed` 事件是否到达 runner |
| 构建没触发 | `gitChanged` 是否为 true |
| webhook 高频触发互相冲突 | `run.lock` 与 `pending_rerun` 是否正常工作 |

---

## 适合继续演进的方向

从当前结构看，后续最值得继续做的事情包括：

- 把 webhook 服务纳入 systemd 统一托管
- 为同步脚本补更系统的错误分类和告警策略
- 进一步拆分 `sync_trilium_posts.py`，降低单文件复杂度
- 为服务目录 / 工作区 / 运行态补更明确的运维脚本
- 为友链、说说、关于页补更明确的配置文档与示例

---

## 一句话总结

`longBlog` 不是单纯的静态博客模板，而是一套围绕 **Trilium 知识库** 搭建出来的“**个人知识发布系统**”：

- 用 Astro 负责公开展示
- 用 Trilium 管内容与状态
- 用 webhook + runner + git + build 完成自动发布
- 用 DeepSeek 做温和的元数据补全
- 在服务器上维持一条长期稳定运行的自动化链路

如果你想要的不是传统后台，而是“**我在知识库里写，博客自动长出来**”的工作流，那这个项目的思路会很有参考价值。

---

## 致谢

- 界面与 README 组织方式参考：[flare-stack-blog](https://github.com/du2333/flare-stack-blog)
- 内容系统：[Trilium](https://github.com/TriliumNext/Trilium)
- 静态站框架：[Astro](https://github.com/withastro/astro)
- 知识图谱可视化：[vis-network](https://visjs.github.io/vis-network/)
