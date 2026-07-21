# longBlog

longBlog 是一个由 TriliumNext 笔记驱动的个人博客项目。内容在 TriliumNext 中维护，通过服务器上的自动化链路同步生成博客数据，并推送到 GitHub 仓库后由外部部署平台发布。

## 自动发布链路

```text
TriliumNext 笔记标签变化
  ↓
后端脚本触发 webhook
  ↓
服务器 longBlog 自动化服务
  ↓
同步 Trilium 内容并生成前端数据
  ↓
Astro build 校验
  ↓
Git commit / push
  ↓
外部部署平台发布
```

## TriliumNext v0.104.0 注意事项

从 TriliumNext `v0.104.0` 开始，后端脚本执行可能默认处于禁用状态。如果自动发布流表现为：

- TriliumNext 中点击同步或修改发布标签后，博客没有更新；
- webhook 服务本身仍在运行；
- 自动化日志没有收到新的 webhook 请求；

需要检查 TriliumNext 日志中是否出现：

```text
Backend script execution is DISABLED.
```

如果出现该提示，说明 TriliumNext 的后端脚本没有启用。由于本项目依赖 TriliumNext 后端脚本触发 webhook，必须在 TriliumNext 的 `config.ini` 中启用：

```ini
[Security]
backendScriptingEnabled=true
```

或者通过环境变量启用：

```bash
TRILIUM_SECURITY_BACKEND_SCRIPTING_ENABLED=true
```

修改后重启 TriliumNext，并确认日志出现类似提示：

```text
Backend script execution is ENABLED.
```

> 注意：后端脚本拥有服务器文件系统、网络和系统命令访问能力，只应在可信自用环境中启用。

## 常见排障顺序

1. 确认 TriliumNext 后端脚本已启用。
2. 确认 webhook 服务正在监听，例如 `127.0.0.1:8787`。
3. 查看 webhook 日志是否收到请求。
4. 查看同步报告，确认 `gitPushed`、`buildRan`、`failed` 等字段。
5. 如果 GitHub 已更新但线上未变化，继续检查外部部署平台或域名/Nginx 指向。
