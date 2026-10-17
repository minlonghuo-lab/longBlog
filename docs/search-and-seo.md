# 文章 SEO 与全文搜索

文章页生成 `BlogPosting`（Article 的子类型）JSON-LD，内容来自同一份文章数据：标题、摘要、作者、发布日期、更新日期、标签、文章永久地址和可用的第一张正文图片。没有图片时不虚构封面。所有页面的 canonical 地址使用 `astro.config.mjs` 中的 `site`，不包含标签和分页查询参数。

首页原有搜索入口使用 Pagefind，在浏览器中搜索文章标题、摘要、标签及正文。结果显示相关正文片段，首次显示 10 条，可继续加载；保留 Ctrl/Cmd+K 和 Esc 操作，增加焦点管理与请求失败提示。搜索索引按需加载，不向外部搜索服务发送查询。

`npm run build` 依次运行 Astro 构建和 `pagefind --site dist`。Pagefind Extended 支持中文分词；仅带 `data-pagefind-body` 的文章会进入索引，导航、友链和关于页不会成为结果。索引输出在 `dist/pagefind/`，与整个 `dist/` 一起发布。EdgeOne 已有的 `npm run build` 构建命令无需更改，也无需新增服务端或密钥。

完整搜索验证：

```sh
npm ci
npm test
npm run preview
```

访问预览站点，点击首页搜索图标，分别搜索中文文章标题、仅在正文中出现的词和不存在的词；检查结果及其 noteId 地址。返回首页后再次打开搜索，确认没有重复响应。

`astro dev` 不生成 Pagefind 索引；本地验证全文搜索请使用上述构建后的 preview。修改文章后重新 build，以更新索引。

结构化数据可在部署后用 Google Rich Results Test 检查。标记帮助搜索引擎理解文章，不保证收录、排名或富媒体展示。
