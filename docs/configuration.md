# longBlog 配置说明

当前 longBlog 采用“双层配置”方式：

- `.env`：用于**公开前端配置**，可直接提交仓库并参与生产构建。
- Pages 环境变量 / 服务器环境变量：用于**敏感配置**，绝不写入 `.env`。

---

## 一、`.env` 的用途

仓库根目录的 `.env` 现在就是 longBlog 的**正式公开配置文件**。

适合写入：
- 作者名
- 作者介绍
- GitHub 链接
- 邮箱
- ICP 链接与文案
- Memos / Trilium 的公开地址
- Umami 的公开 website-id
- 页脚 Powered by 链接

这些变量会进入前端构建结果，因此默认都使用 `PUBLIC_*` 前缀。

### 当前建议直接修改的文件
- `.env`

---

## 二、敏感配置不要写进 `.env`

以下内容必须继续放在 Pages 环境变量或服务器环境变量中：

- `TRILIUM_BASE_URL`
- `TRILIUM_ETAPI_TOKEN`
- `TRILIUM_BLOG_ROOT_NOTE_ID`
- `TRILIUM_PUBLISH_WEBHOOK_SECRET`
- `DEEPSEEK_API_BASE`
- `DEEPSEEK_API_KEY`
- `LONGBLOG_DEEPSEEK_MODEL`
- `LONGBLOG_AUTO_PUSH`
- `LONGBLOG_GIT_REMOTE`
- `LONGBLOG_GIT_BRANCH`
- `LONGBLOG_BARK_BASE_URL`

这些变量如果进入仓库，将造成凭证泄露风险。

---

## 三、公开配置变量列表（写入 `.env`）

- `PUBLIC_SITE_TITLE`
- `PUBLIC_SITE_DESCRIPTION`
- `PUBLIC_SITE_AUTHOR`
- `PUBLIC_SITE_AUTHOR_INTRO`
- `PUBLIC_SITE_GITHUB`
- `PUBLIC_SITE_EMAIL`
- `PUBLIC_SITE_URL`
- `PUBLIC_ICP_URL`
- `PUBLIC_ICP_TEXT`
- `PUBLIC_FOOTER_POWERED_TRILIUM_URL`
- `PUBLIC_FOOTER_POWERED_ASTRO_URL`
- `PUBLIC_UMAMI_SCRIPT_URL`
- `PUBLIC_UMAMI_WEBSITE_ID`

### 以下 3 个公开 URL 不再写入仓库 `.env`
它们仍然是前端需要读取的 `PUBLIC_*` 变量，但建议只在 Pages 环境变量中提供：

- `PUBLIC_MEMOS_URL`
- `PUBLIC_TRILIUM_BASE_URL`
- `PUBLIC_TRILIUM_TREE_API_URL`

---

## 四、`AUTHOR` 已抽离

原先首页/页脚展示用的 `AUTHOR` 已统一改为读取：
- `PUBLIC_SITE_AUTHOR`

如果你想修改页面显示的作者名，现在只需要改 `.env` 中的该变量即可。

---

## 五、推荐使用方式

### 你自己日常改站点展示内容
直接改：
- `.env`

### 你自己日常改自动化/同步/AI 密钥
直接改：
- Pages 环境变量
- 雨云 `/root/longBlog/runtime/env.sh`

---

## 六、`.env.example`

`.env.example` 仅保留为模板说明文件，用于参考字段结构。

真正生产前端构建读取的是：
- `.env`
