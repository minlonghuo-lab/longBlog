# longBlog 自动化发布流（稳定方案）

## 概览
当前 longBlog 采用 **Trilium → Webhook → 雨云 Runner → 同步脚本 → Git Push → Astro Build** 的自动化流。

核心目标：
- 每篇文章独立控制发布状态，不受模板 note 污染。
- `publish=true` 触发发布/更新。
- `sync=true` 触发内容同步。
- `aiRefresh=true` 触发 AI 元数据增量补全。
- `pinned=true` 触发置顶同步。

---

## 一、组件与职责

### 1. Trilium 文章 note
每篇真实文章独立持有业务状态标签：
- `publish=true|false`
- `sync=true|false`
- `aiRefresh=true|false`
- `pinned=true|false`
- `syncStatus`
- `summary`
- `tags`
- `slug`
- `publishedAt`
- `updatedAt`
- `syncHash`

### 2. longTemplate 模板 note
模板 **只保留字段定义，不保留字段值**。

可保留：
- `label:publish`
- `label:sync`
- `label:aiRefresh`
- `label:pinned`
- `runOnAttributeChange`

必须删除：
- `publish`
- `sync`
- `aiRefresh`
- `pinned`

否则模板会污染文章业务状态。

### 3. Trilium 内部属性变更脚本
脚本 note：`HZjySYFoNUAN`
标题：`Trigger Webhook`

职责：
- 监听文章 `publish/sync/pinned/aiRefresh` 的 label 变更。
- 过滤模板 note，不对模板发送 webhook。
- 按事件类型向 `https://blog.ssaw.top/trilium-sync-webhook` 发送签名 webhook。

### 4. 雨云 Webhook 服务
文件：`/root/trilium_sync_webhook.py`

职责：
- 校验 `X-Trilium-Signature`
- 接收事件：
  - `publish_changed`
  - `sync_requested`
  - `pinned_changed`
  - `ai_refresh_requested`
- 将上下文写入 `/root/longblog-sync/last_webhook.json`
- 拉起 runner：`/root/longBlog/scripts/run_sync_and_build.sh`

### 5. Runner
文件：`scripts/run_sync_and_build.sh`

职责：
- 防并发锁
- 消费 webhook 上下文
- 调用 `scripts/sync_trilium_posts.py`
- 有 Git 变化时执行 `npm run build`
- 写入 `/root/longblog-sync/last_report.json`

### 6. 同步脚本
文件：`scripts/sync_trilium_posts.py`

职责：
- 遍历 Trilium 博客根节点
- 跳过模板 note / 非文章 note
- 拉取文章 HTML
- 本地化附件到 `public/trilium-assets/`
- 生成 `src/data/trilium-posts.generated.ts`
- 回写文章状态标签
- 自动 git push

---

## 二、事件设计

### 1. `publish_changed`
由文章 `publish` 标签变化触发。

语义：
- `publish=true`：文章纳入已发布候选
- `publish=false`：文章从站点移除

### 2. `sync_requested`
由文章 `sync=true` 触发。

语义：
- 仅用于内容更新同步
- 成功后自动回写 `sync=false`

### 3. `pinned_changed`
由文章 `pinned=true|false` 触发。

语义：
- 仅更新置顶状态
- 成功后 `trilium-posts.generated.ts` 中对应文章写入 `pinned: true|false`

### 4. `ai_refresh_requested`
由文章 `aiRefresh=true` 触发。

语义：
- 强制目标文章进入 AI 元数据生成分支
- 不依赖当前 note 上是否已成功保存 `aiRefresh=true`
- 成功后自动回写 `aiRefresh=false`

---

## 三、AI 元数据策略（已稳定）

文件：`scripts/ai_generate_meta.py`

规则：
- 优先保留已有合理 tags。
- AI 只做 **增量补充**，不粗暴覆盖。
- 若已有 tags，则走 `tags_only` 模式，只补更具体标签。
- 若摘要缺失，则补 summary。

验证结果：
- 测试文章 `yAEdBzTrtiHe` 成功从原有标签：
  - `自动化`
  - `博客发布`
  - `longBlog`
- 增量补充为：
  - `自动化`
  - `博客发布`
  - `longBlog`
  - `兜底策略`
  - `流程优化`

---

## 四、模板隔离保护（关键）

### 已落实的保护
1. Trilium 内部脚本忽略模板 note。
2. 同步脚本跳过模板 note。
3. 模板 note 不再保留 `publish/pinned/sync/aiRefresh` 真实值。

### 判定模板 note 的方式
- noteId 为模板固定 ID：`MC7PtiChdF5S`
- 标题包含 `template/模板`
- 存在空值 `template` 标记时视为模板实体

---

## 五、为什么之前会出问题

历史问题根因：
1. 模板 note 带有真实 `publish=false` 等业务状态值。
2. Trilium 内部实际运行脚本仍是旧版，只监听 `publish/sync`，且未隔离模板。
3. 文章上曾同时存在重复标签，如：
   - `publish=true`
   - `publish=false`
4. 导致：
   - UI 上看似已发布
   - ETAPI 实际返回值混乱
   - runner 收到 webhook 后同步判断失真

---

## 六、当前稳定验证结果

以测试文章 `yAEdBzTrtiHe` 为例，当前已验证：
- ETAPI 实际状态：
  - `publish=true`
  - `pinned=true`
  - `syncStatus=published`
- webhook 日志：
  - `publish_changed`
  - `pinned_changed`
- `last_report.json`：
  - `publishedCandidates=1`
  - `updated[0].pinned=true`
- `src/data/trilium-posts.generated.ts`：
  - `"pinned": true`

结论：
> 发布、置顶、AI 刷新三条主链路均已打通。

---

## 七、后续维护原则

### 1. 不要再给模板 note 设置业务状态值
包括：
- `publish`
- `pinned`
- `sync`
- `aiRefresh`

### 2. 新增字段时遵守“定义和值分离”
- 模板：只放 `label:xxx`
- 文章：只放 `xxx=value`

### 3. 排查优先顺序
如果以后再出问题，按这个顺序查：
1. ETAPI 实际返回值
2. Trilium 内部脚本 note `HZjySYFoNUAN`
3. `/root/trilium_sync_webhook.log`
4. `/root/longblog-sync/last_report.json`
5. `src/data/trilium-posts.generated.ts`

### 4. 避免再次使用临时修复脚本直接改大范围状态
批量修复前应先备份 ETAPI 当前状态。

---

## 八、关键文件清单

本地仓库：
- `scripts/sync_trilium_posts.py`
- `scripts/ai_generate_meta.py`
- `scripts/Trigger Webhook.js`（作为 Trilium 内部脚本参考版本）
- `docs/longblog-automation-stable.md`

雨云：
- `/root/longBlog/scripts/sync_trilium_posts.py`
- `/root/longBlog/scripts/run_sync_and_build.sh`
- `/root/trilium_sync_webhook.py`
- `/root/longblog-sync/env.sh`

Trilium：
- 根节点：`zB8WioyKlvOw`
- 模板 note：`MC7PtiChdF5S`
- 属性变更脚本 note：`HZjySYFoNUAN`
