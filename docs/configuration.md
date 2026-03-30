# longBlog 配置说明

本文档将 longBlog 所有相关环境变量按“公开配置”和“敏感配置”拆分，便于 GitHub Pages / Cloudflare Pages / 雨云服务器分别管理。

---

## 一、公开配置变量（适合放 GitHub Variables / Pages Variables）

这些变量会进入前端构建结果，可被浏览器看到，因此**不能放 token / secret**。

### 站点展示信息
- `PUBLIC_SITE_TITLE`
- `PUBLIC_SITE_DESCRIPTION`
- `PUBLIC_SITE_AUTHOR`
- `PUBLIC_SITE_AUTHOR_INTRO`
- `PUBLIC_SITE_GITHUB`
- `PUBLIC_SITE_EMAIL`
- `PUBLIC_SITE_URL`

### 前端公开 URL
- `PUBLIC_MEMOS_URL`
- `PUBLIC_TRILIUM_BASE_URL`
- `PUBLIC_TRILIUM_TREE_API_URL`
- `PUBLIC_SITE_HISTORY_IMAGE_URL`

### 页脚与公共链接
- `PUBLIC_ICP_URL`
- `PUBLIC_ICP_TEXT`
- `PUBLIC_FOOTER_POWERED_TRILIUM_URL`
- `PUBLIC_FOOTER_POWERED_ASTRO_URL`

### 公开统计脚本配置
- `PUBLIC_UMAMI_SCRIPT_URL`
- `PUBLIC_UMAMI_WEBSITE_ID`

---

## 二、敏感/服务端变量（适合放 Secrets / 雨云 env.sh）

这些变量**不能暴露给前端**。

### Trilium 同步
- `TRILIUM_BASE_URL`
- `TRILIUM_ETAPI_TOKEN`
- `TRILIUM_BLOG_ROOT_NOTE_ID`
- `TRILIUM_PUBLISH_WEBHOOK_SECRET`

### AI 元数据
- `DEEPSEEK_API_BASE`
- `DEEPSEEK_API_KEY`
- `LONGBLOG_DEEPSEEK_MODEL`

### 自动化控制
- `LONGBLOG_AUTO_PUSH`
- `LONGBLOG_GIT_REMOTE`
- `LONGBLOG_GIT_BRANCH`
- `LONGBLOG_BARK_BASE_URL`

---

## 三、AUTHOR 已抽离

原本主页/页脚中的 `AUTHOR` 已统一抽离为：
- `PUBLIC_SITE_AUTHOR`

后续如果你想修改站点显示作者名，只需要改公开配置变量即可，无需再改源码。

---

## 四、代码侧统一入口

### 前端公开配置统一入口
文件：`src/consts.ts`

负责读取：
- 站点标题 / 描述 / 作者
- GitHub / Email
- Memos / Trilium 公共地址
- ICP / 页脚链接
- Umami 脚本

### 服务端脚本读取服务端环境变量
文件：
- `scripts/sync_trilium_posts.py`
- `scripts/ai_generate_meta.py`

这些脚本只读取服务端环境变量，不依赖前端公开配置。

---

## 五、推荐维护原则

1. **所有会展示在页面上的文本/链接，优先放 `PUBLIC_*`。**
2. **所有 token / secret / 内部控制项，只放服务端环境变量。**
3. **不要在仓库里硬编码 URL、邮箱、作者名、统计 ID。**
4. **不要把 token、secret 放入 GitHub 公开变量。**

---

## 六、参考示例

见仓库根目录：
- `.env.example`
