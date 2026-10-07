# Trilium → longBlog 渲染契约

这份文档回答一个问题：**在 Trilium 里写下的内容，博客上应该长成什么样。**

它把 Trilium 自己的渲染规则逐条查出来作为基准，再逐项对照博客现状，标出偏差。改样式前先看这里，不要凭感觉调。

**契约类偏差已全部实现**（PR #21）。保留每节的"梳理时的状态"是为了说明哪些是后来补的、以及**哪些结论被实测推翻过** —— 2.3 表格宽度那条就是初版判断错了，实测记录留在原处。

## 依据的源码版本

| 项 | 值 |
|---|---|
| 仓库 | [TriliumNext/Trilium](https://github.com/TriliumNext/Trilium) |
| commit | `84841ae26a8f000dc617ddd1fddb5d348c547302`（2026-10-07） |
| CKEditor | `ckeditor5@48.5.2` |

CLAUDE.md 提示：Trilium 的上游默认样式来自 npm 包里的 `ckeditor5/dist/ckeditor5-content.css`，不在仓库内，需要单独取：

```sh
curl -sL https://unpkg.com/ckeditor5@48.5.2/dist/ckeditor5-content.css -o ck-base.css
```

---

## 一、样式层叠链条

Trilium 的正文渲染由五层叠加而成，越靠后优先级越高：

| 层 | 位置 | 作用 |
|---|---|---|
| 1 | `ckeditor5/dist/ckeditor5-content.css`（npm 包） | 内核默认值。**注意它并不等于 Trilium 的显示效果**，多处被下面几层推翻 |
| 2 | `packages/ckeditor5/src/theme/ck-content.css` | `@import` 第 1 层，再加提示框（admonition）与列表段落边距 |
| 3 | `apps/client/src/stylesheets/style.css` | 客户端阅读/编辑视图，折叠块等大量样式在这里 |
| 4 | **`packages/share-theme/src/styles/content.css`** | **对外分享/静态渲染。与博客的诉求同构，是最重要的参照** |
| 5 | `apps/client/src/print.css` | 打印 |

**第 4 层是基准。** 它是一个"把笔记内容渲染给站外读者看"的样式表，和博客所处的场景完全一致。

一个贯穿全局的设定：Trilium 把内容的字体、字号、颜色、行高**全部设为继承宿主**——

```css
/* packages/share-theme/src/styles/content.css:1-6 */
:root {
    --ck-content-font-family: inherit !important;
    --ck-content-font-size: inherit !important;
    --ck-content-font-color: inherit !important;
    --ck-content-line-height: inherit !important;
}
```

所以**字体族、字号、行高、配色不属于契约**，由宿主（博客的版式设计）决定。契约管的是**结构与排布**：换行、对齐、尺寸语义、间距关系。

---

## 二、逐构造契约

### 2.1 代码块

**存储形态**（笔记内容里就是这个，ETAPI 原样返回）：

```html
<pre><code class="language-text-x-sh">…</code></pre>
```

`language-` 后面是 **MIME 形式**的语言标识（`text-x-sh`、`text-x-yaml`、`text-x-python`、`text-x-latex`、`text-x-trilium-auto`），不是 highlight.js 的常规语言名。

**第 1 层（CKEditor）默认：**

```css
.ck-content pre {
  color: #353535; text-align: left;
  tab-size: 4;
  white-space: pre-wrap;      /* ← 默认是折行的 */
  direction: ltr;
  background: #c7c7c74d; border: 1px solid #c4c4c4; border-radius: 2px;
  min-width: 200px;
  margin: .9em 0; padding: 1em;
  font-style: normal;
}
.ck-content pre code { background: unset; border-radius: 0; padding: 0; }
```

**第 4 层（Trilium 分享主题）覆盖：**

```css
/* packages/share-theme/src/styles/content.css:16-41 */
/* 只有代码块保留源码自身的换行。行内 code 过去从上面的规则继承了这一点，
 * 导致长代码片段挤在一行、在移动端把页面撑宽。 */
.ck-content pre { white-space: pre; }

.ck-content code:not(pre code) { padding: 2px 5px; overflow-wrap: break-word; }
.ck-content pre code { border: 0; }
.ck-content pre { overflow: auto; position: relative; min-width: unset !important; }
.ck-content pre .copy-button { position: absolute; top: .5em; right: .5em; }
```

**硬性条件**：代码块必须 `white-space: pre`（不是 `pre-wrap`），且能横向滚动。Trilium 自己踩过这个坑，注释里写明了原因。

**博客现状**：✅ 已对齐。`.content pre` 与 `.content pre code` 均为 `white-space: pre`，`overflow-x: auto`。

**遗留偏差**：
- 博客**没有设 `tab-size: 4`**。用 Tab 缩进的代码块在博客上会按浏览器默认（8）渲染，比 Trilium 宽一倍。当前内容用空格缩进，暂未暴露。
- 博客**没有 `min-width: 200px`**（Trilium 也把它 `unset` 了，所以这一条两边一致，无需处理）。

---

### 2.2 图片

**存储形态**：

```html
<figure class="image image_resized" style="width:67.69%">
  <img style="aspect-ratio:2000/1168" src="…" width="2000" height="1168">
</figure>
```

关键点：**缩放后宽度写在 `<figure>` 的内联 `style` 上，是百分比**；`<img>` 上只有 `aspect-ratio` 和 `width`/`height` 属性。

**第 1 层（CKEditor）契约：**

```css
.ck-content .image {
  clear: both; text-align: center; min-width: 50px;
  margin: .9em auto;
  display: table;                    /* figure 收缩到内容宽度 */
}
.ck-content .image img {
  min-width: 100%;                   /* ← 让图片撑满 figure，即使固有宽度更小 */
  max-width: 100%;
  height: auto; margin: 0 auto; display: block;
}
.ck-content .image.image_resized {
  box-sizing: border-box; max-width: 100%; display: block;
}
.ck-content .image.image_resized img { width: 100%; }

/* 对齐（浮动） */
.ck-content .image.image-style-align-left  { float: left;  margin-right: 1.5em; }
.ck-content .image.image-style-align-right { float: right; margin-left:  1.5em; }
.ck-content .image.image-style-side        { float: right; margin-left:  1.5em; max-width: 50%; }
.ck-content .image.image-style-block-align-left  { margin-left: 0;    margin-right: auto; }
.ck-content .image.image-style-block-align-right { margin-left: auto; margin-right: 0; }

.ck-content .image > figcaption {
  caption-side: bottom; display: table-caption;
  padding: .6em; font-size: .75em;
}
```

**第 4 层（Trilium 分享主题）**：`#content img { max-width: 100%; height: auto; }`

**硬性条件**：
1. 图片必须能在 figure 内**撑满** —— 靠 `min-width: 100%`（普通图）和 `width: 100%`（缩放图）。
2. 图片上限是**内容列宽的 100%**，没有额外的像素上限。
3. `image-style-align-*` 是浮动对齐，不是居中。
4. 缩放图靠 figure 上的内联百分比宽度定位。

**博客现状**：

```css
.content figure     { margin: 1.5rem auto; text-align: center; }
.content img        { display: block; max-width: min(100%, 760px); height: auto; margin: .9rem auto; … }
```

**偏差（三处，均为实测确认）**：

| # | 偏差 | 影响 |
|---|---|---|
| 1 | `max-width: min(100%, 760px)` 多了一个 **760px 上限** | 内容列宽 883px，94 张图里 **5 张**被压到 760px，比 Trilium 小 14% |
| 2 | 缺 `min-width: 100%` / `.image_resized img { width: 100% }` | 固有宽度小于容器的图片**不会撑满 figure**，在缩放图里尤其明显 |
| 3 | 完全没有 `image-style-align-*` 规则 | 左/右浮动对齐的图片在博客会退化成独占一行居中 |

---

### 2.3 表格

**存储形态**：

```html
<figure class="table" style="width:48.68%">
  <table class="ck-table-resized">
    <colgroup><col style="width:40.1%"><col style="width:59.9%"></colgroup>
    …
  </table>
</figure>
```

**第 1 层（CKEditor）**：`figure.table { display: table }`、`figure.table > table { width: 100% }`、`.table { margin: .9em auto }`、`th { background: #0000000d; font-weight: bold }`、`table { border-collapse: collapse; border: 1px double #b3b3b3 }`

**第 4 层（Trilium 分享主题）：**

```css
.ck-content table { border-collapse: collapse; width: 100%; }
.ck-content table td, .ck-content table th {
  min-width: 120px; border: 1px solid var(--background-highlight); padding: 8px;
}
.ck-content table th { background-color: var(--background-secondary); font-weight: bold; }
```

**硬性条件**：单元格有 **120px 最小宽**（防止窄列被压扁）；表头有背景色和粗体；单元格内首尾段落的上下边距被清零。

**表格宽度是个容易搞错的点，这里留一次实测记录**（本仓库构建产物，内容列宽 883px）：

| 方案 | 无内联宽度的表格实测宽度 |
|---|---|
| 博客原来的 `table { width: max-content }` | 494px |
| `table { width: 100% }`，figure 保持 block | 883px（撑满整列） |
| **Trilium 的真实规则**：`figure.table { display: table; margin: .9em auto }` + `figure.table > table { width: 100% }` | **494px** |

只有第三行是 Trilium 的实际行为，结果与 `max-content` **完全一致**：`width: 100%` 撑满的是「收缩到内容宽度之后的 figure」，而不是整个内容列。所以**表格宽度不构成偏差**，博客保持原样即可。

教训：只读规则文本会把这一条误判成差异（本文档初版就判错了），涉及尺寸的结论必须实测。

**已对齐**：单元格 `min-width: 120px`、表头背景色、单元格内首尾段落边距清零。

---

### 2.4 折叠块

**存储形态**：

```html
<details class="trilium-collapsible" open>
  <summary>标题</summary>
  …正文…
</details>
```

**关键设计**：折叠箭头**故意不进存储内容**。源码注释（`style.css:3230-3235`）：

> 在编辑器里它是真实的 `<span>`（由编辑态下转换插入），因为需要点击和键盘处理；**在其他场景那个 span 不存在——箭头被刻意排除在保存的 HTML 之外**——所以数据视图把箭头画在 summary 上，并让原生 `<details>` 负责切换。

因此静态渲染侧用 `::before` 画箭头：

```css
/* style.css:3236-3263 */
.ck-content:not(.ck-editor__editable) details.trilium-collapsible > summary::before {
  content: "\ea50";                 /* boxicons chevron-right */
  position: absolute; left: 0; top: -0.05em;
  width: 1lh; height: 1lh;
  display: flex; justify-content: center; align-items: center;
  font-family: boxicons;
  transform: scale(1.3);
}
.ck-content:not(.ck-editor__editable) details.trilium-collapsible[open] > summary::before {
  transform: scale(1.3) rotate(90deg);
}
```

容器与标题（`style.css:3144-3227`）：

```css
.ck-content details.trilium-collapsible {
  position: relative; overflow: hidden; isolation: isolate;
  margin: 1em 0; border-radius: 8px;
  background: var(--collapsible-block-background);
  padding: .75rem 1rem .75rem 2rem;   /* 左内边距留给箭头 */
}
.ck-content details.trilium-collapsible > summary {
  position: relative; left: -1rem; width: calc(100% + 2rem);
  padding-left: 2rem;
  cursor: pointer; font-weight: 500;
  list-style: none;                    /* 去掉原生三角标记 */
}
.ck-content details.trilium-collapsible > summary::-webkit-details-marker { display: none; }
.ck-content details.trilium-collapsible[open] > summary { margin-bottom: 1.5rem; }
```

另外：连续多个折叠块会合并圆角（首/中/末三段处理，`style.css:3164-3183`）。

**硬性条件**：不需要 JavaScript，**原生 `<details>`/`<summary>` 就能工作**；需要去掉原生三角标记并自绘箭头；展开态箭头旋转 90°。

**另一个重要约定**（`packages/ckeditor5/src/theme/collapsible_list_items.css` 头部注释）：折叠**列表项**的状态存在 `<li data-trilium-collapsed>` 上，但

> 折叠状态的隐藏被限定在 `.ck-editor__editable` 内，**因此只读和分享渲染保持完全展开**（它们没有办法切换状态）。

也就是说：**博客不应隐藏任何折叠的列表项内容。**

**博客现状**：✅ 已实现（含展开态的箭头旋转与分隔线）。纯 CSS + 原生 `<details>`，没有引入 JS。

---

### 2.5 内嵌笔记（include-note）

**存储形态**：

```html
<section class="include-note" data-note-id="2epdE8sgosX8" data-box-size="small">&nbsp;</section>
```

**内容是空的** —— Trilium 在浏览器里实时取回目标笔记再注入（`apps/client/src/services/content_renderer_text.ts:90` `renderContentEmbeds`）：

- `data-box-size="tiny"` → 替换成一条**引用链接**（`replaceEmbedWithReferenceLink`）
- 其他（含 `small`）→ 取回目标笔记，把渲染结果塞进容器，并保留容器内的 `<figcaption>` 作为说明

**分享主题的样式**（`content.css:177-188`）：

```css
.ck-content figure.include-note { margin: 1em 0; }
.ck-content .include-note > figcaption {
  margin-top: .5em; border-top: 1px solid var(--background-active);
  padding-top: .5em; font-size: .9em; text-align: center;
}
```

注意分享主题用的是 `figure.include-note`，而 ETAPI 返回的是 `section.include-note` —— 标签不一致，写选择器时建议只依赖 `.include-note` 类。

**博客现状**：✅ 已由同步脚本解析成引用卡片（`render_include_note_cards`），这是本项目的有意选择（避免站内重复内容）。目标未发布时原样保留。

---

### 2.6 提示框（admonition）

**存储形态**：`<aside class="admonition <type>">`，type ∈ `note` / `tip` / `important` / `caution` / `warning`。
依据：`packages/ckeditor5/src/plugins/admonition/admonition_editing.ts:55-58` 定义了 `{ name: "aside", classes: "admonition" }`，downcast 写成 `class="admonition <type>"`。

**样式**（`packages/ckeditor5/src/theme/ck-content.css:20-59`）：

```css
.admonition {
  --accent-color: var(--card-border-color);
  border: 1px solid var(--accent-color);
  background: var(--card-background-color);
  border-radius: .5em; padding: 1em; margin: 1.25em 0;
  position: relative; padding-inline-start: 2.5em; overflow: hidden;
}
.admonition.note      { --accent-color: #69c7ff; }
.admonition.tip       { --accent-color: #40c025; }
.admonition.important { --accent-color: #9839f7; }
.admonition.caution   { --accent-color: #ff2e2e; }
.admonition.warning   { --accent-color: #e2aa03; }
.admonition::before {           /* 图标，boxicons */
  color: var(--accent-color); font-family: boxicons !important;
  position: absolute; top: 1em; inset-inline-start: 1em;
}
.admonition.note::before      { content: "\eb21"; }
.admonition.tip::before       { content: "\ea0d"; }
.admonition.important::before { content: "\ea7c"; }
.admonition.caution::before   { content: "\eac7"; }
.admonition.warning::before   { content: "\eac5"; }
```

**博客现状**：✅ 已实现 5 种类型。图标取自 boxicons，但**只把笔记内容可能引用的 7 个字形子集化**（`public/fonts/boxicons-subset.woff`，1.3 KB，完整字体 115 KB），字形轮廓与 Trilium 一致。子集里有 `\ea50`(chevron-right)、`\eb21`(info-circle)、`\ea0d`(bulb)、`\ea7c`(comment-error)、`\eac7`(error-circle)、`\eac5`(error)、`\ea84`(copy)。**若以后在 Trilium 里用到别的图标，需要重新子集化并补进这个文件。**

---

### 2.7 基础排版

| 构造 | Trilium（第 1 层 CKEditor 为主） | 博客现状 | 判断 |
|---|---|---|---|
| 引用块 | `border-left: 5px solid #ccc; padding: 0 1.5em; font-style: italic; overflow: hidden` | ✅ 已对齐到 5px + 斜体（仅保留博客自己的边框配色） | — |
| 分隔线 | `hr { height: 4px; background: #dedede; border: 0; margin: 15px 0 }` | ✅ 已实现 | — |
| 段落 | 由宿主决定；CKEditor 默认 `overflow-wrap: break-word; word-break: normal` | ✅ 已去掉两端对齐 | — |
| 列表项内段落 | `.ck-content li p { margin: 0 !important }`（Trilium 覆盖） | ✅ 已补 | — |
| 行内 code | `code:not(pre code) { padding: 2px 5px; overflow-wrap: break-word }` | `padding: .1em .3em; overflow-wrap: anywhere; word-break: break-all` | 接近；博客断行更激进 |
| 标题 | CKEditor 用 em 相对字号，Trilium 分享主题给 h1–h6 加 `border-bottom` | 固定 rem 字号，无下边框 | 设计差异 |
| 字体/字号/行高/配色 | **`inherit`**（明确交给宿主） | 博客自有版式 | 不属于契约 |

---

## 三、渲染时后处理（不在笔记内容里）

这一节最容易被忽略：**Trilium 的显示效果有一部分不是 CSS，而是渲染时用 JS 加工的**。博客若只搬 HTML 和 CSS，这部分会整体缺失。

来自 `apps/client/src/services/syntax_highlight.ts`：

| 能力 | 实现 | 触发条件 |
|---|---|---|
| **语法高亮** | 渲染时用 highlight.js 处理 `pre code`，把结果写回 `innerHTML`，并给 `<pre>` 加 `hljs` 类 | 语言从 `language-` 类名取（MIME 形式）。**分享模式下不自动检测语言**，只有明确指定才高亮 |
| **代码块复制按钮** | 渲染时给 `<pre>` **追加** `<button class="… copy-button">`（`$codeBlock.parent().append(...)`，所以是 `<pre>` 的直接子元素） | 非打印环境 |
| **行内 code 点击复制** | 给 `code:not(pre code)` 加 `copyable-inline-code` 类与点击处理器 | 非打印环境 |

配套 CSS：`pre > button.copy-button { position: absolute; top: .35em; inset-inline-end: .35em }`，且 `pre:has(> button.copy-button) { padding-inline-end: calc(37px + .7em) }`（`style.css:721-743`）。

**含义**：博客要完全一致，需要自己实现**语法高亮**和**复制按钮**。这是功能缺口，不是 CSS 缺口——调样式解决不了。

**已实现**，两处都与 Trilium 的做法有意不同或相同，理由如下：

- **语法高亮**改成**构建时**预渲染（`src/data/syntax-highlight.ts`，接在 `src/data/posts.ts` 的内容管线上）。Trilium 在浏览器里跑，静态站预渲染更划算：没有运行时成本、禁用 JS 也能看到。语言映射沿用 Trilium 的规则：class 里是 MIME 形式，`text-x-trilium-auto` 表示自动检测，而 Trilium 的分享渲染**不做**自动检测（`applySingleBlockSyntaxHighlight` 的自动分支带 `!isShare`），所以这类块在博客上同样保持无高亮。
- **复制按钮**沿用 Trilium 的做法，在页面加载后追加到 `<pre>` 上（`src/scripts/code-blocks.js`），并用 `:has()` 为它预留空间；行内 code 也支持点击复制。

另外两项渲染时展开：

- **include-note** → 已在同步脚本中实现（见 2.5）。
- **折叠列表项** → Trilium 在只读/分享下**故意不折叠**，博客同样不应折叠（见 2.4）。

---

## 四、总表

下表是**契约刚梳理出来时**的差距快照。除标注外，其余均已在 `feat/trilium-rendering-parity`（PR #21）中实现。

| # | 构造 | 梳理时的状态 | 性质 | 现在 |
|---|---|---|---|---|
| 1 | 代码块空白 | ✅ 已对齐 | — | ✅ |
| 2 | 代码块 `tab-size: 4` | ❌ 缺失 | 契约 | ✅ |
| 3 | 图片 760px 上限 | ❌ 偏差 | 设计取舍 | ✅ 已去掉 |
| 4 | 图片撑满 figure（`min-width: 100%`） | ❌ 缺失 | 契约 | ✅ |
| 5 | 图片浮动对齐（`image-style-align-*`） | ❌ 缺失 | 契约 | ✅ |
| 6 | 表格宽度 `100%` | ❌ 偏差 | ~~设计取舍~~ | **判错了，无需改动**（见 2.3 实测） |
| 7 | `td/th` 最小宽 120px | ❌ 缺失 | 契约 | ✅ |
| 8 | `th` 表头背景 | ❌ 缺失 | 设计取舍 | ✅ |
| 9 | 单元格内段落边距清零 | ❌ 缺失 | 契约（影响 31 个单元格） | ✅ |
| 10 | 折叠块 `trilium-collapsible` | ❌ **完全缺失** | 契约 | ✅ 纯 CSS + 原生 `<details>` |
| 11 | 内嵌笔记 | ✅ 已用引用卡片实现 | 本项目决定 | ✅ |
| 12 | 提示框 admonition | ❌ 缺失（含图标字体） | 契约 | ✅ 含 7 字形子集字体 |
| 13 | 分隔线 `hr` | ❌ 缺失 | 契约 | ✅ |
| 14 | 段落两端对齐 | ❌ 博客独有 | 设计取舍 | ✅ 已去掉 |
| 15 | 语法高亮 | ❌ 缺失 | **功能** | ✅ 改为构建时预渲染 |
| 16 | 代码块复制按钮 | ❌ 缺失 | **功能** | ✅ 含行内 code 点击复制 |

---

## 五、怎么用这份文档

- **改样式前**先查对应构造的"硬性条件"，那是 Trilium 侧的权威行为。
- **"契约"**类是 Trilium 的结构性行为，不改就会走样；改版式时（字体、配色、间距）可以按博客自己的审美来 —— Trilium 把这几项显式设为 `inherit` 交给宿主。
- **涉及尺寸的结论必须实测**，不能只读规则文本（见 2.3）。
- 复查方式：`node audit-render.mjs http://127.0.0.1:<port>` 扫全部文章的折叠/溢出/注入/图片加载；`node measure-images.mjs` 量化图片布局；`node probe.mjs <url> <expr>` 在真实渲染里做 A/B。

### 验证状态说明

- 2.1–2.4 的 CSS 规则与 2.5 的渲染流程：**已在源码中逐条核对**，附文件与行号。
- 图片、表格、单元格的影响数量，以及表格宽度的方案对比：**已在本仓库构建产物上实测**。
- 2.6 提示框、2.7 中的 `hr` 与列表项段落：源码已核对，实现后**用合成夹具截图验证过**（内容里还没有实例，属构造可用性验证而非真实文章验证）。
