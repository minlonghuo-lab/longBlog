# About 页面环境变量说明

当前 `/about` 页面主要用于展示 **TriliumNext 知识地图（动态树形交互）**。

## 推荐环境变量

### 1) Trilium 基础地址
```env
PUBLIC_TRILIUM_BASE_URL=https://blog.ssaw.top
```

用于：
- About 页右上角“打开 Trilium”按钮
- 树节点跳转链接的默认前缀

### 2) Trilium 树数据接口地址（推荐使用服务端代理）
```env
PUBLIC_TRILIUM_TREE_API_URL=https://your-domain.com/api/trilium-tree
```

前端 About 页面会请求这个接口，并期待返回 JSON。

> **安全提醒**：
> 不要把 ETAPI Token 直接暴露给浏览器端。推荐在 EdgeOne Pages / Serverless Function 中读取：
>
> - `TRILIUM_BASE_URL`
> - `TRILIUM_ETAPI_TOKEN`（或你的 ETAPI 环境变量）
>
> 然后由服务端代理请求 Trilium ETAPI，再把整理后的树结构返回给前端。

## 推荐的树接口返回格式

支持以下任意一种：

### 格式 A
```json
{
  "root": {
    "title": "知识库",
    "noteId": "rootNoteId",
    "path": "/知识库",
    "children": [
      {
        "title": "分类 A",
        "noteId": "noteA",
        "path": "/知识库/分类 A",
        "children": []
      }
    ]
  }
}
```

### 格式 B
```json
{
  "nodes": [
    {
      "title": "知识库",
      "noteId": "rootNoteId",
      "path": "/知识库",
      "children": []
    }
  ]
}
```

### 格式 C
```json
[
  {
    "title": "知识库",
    "noteId": "rootNoteId",
    "path": "/知识库",
    "children": []
  }
]
```

字段兼容：
- `title` / `name` / `noteTitle`
- `noteId` / `id` / `note_id`
- `children` / `items`
- `path`
- `href`（如果你想自定义跳转链接）

## 关于 ETAPI

你提到的两个部署环境建议这样分工：

### 服务端私密变量
```env
TRILIUM_BASE_URL=https://blog.ssaw.top
TRILIUM_ETAPI_TOKEN=xxxx
```

### 前端公开变量
```env
PUBLIC_TRILIUM_BASE_URL=https://blog.ssaw.top
PUBLIC_TRILIUM_TREE_API_URL=https://your-domain.com/api/trilium-tree
PUBLIC_SITE_HISTORY_IMAGE_URL=https://picture.ssaw.top/20260321183505675.png
```

如果后续需要，我可以继续补：
- EdgeOne Pages 的 `/api/trilium-tree` 代理函数
- Trilium ETAPI → 树形 JSON 的转换逻辑
- 更像“笔记地图”的可视化版本（不是列表树，而是关系图 / 脑图风格）
