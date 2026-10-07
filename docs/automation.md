# 自动化链路在哪

**这个仓库只有内容和站点。发布自动化不在本仓库。**

## 唯一来源

自动发布（TriliumNext → GitHub）由独立仓库维护：

**<https://github.com/minlonghuo-lab/longblog-automation>**

它包含 Docker 部署包：轮询 Trilium ETAPI、转换文章数据、构建验证、提交推送。完整文档（目录结构、安装步骤、Bash 通知、**支持的文章标签**、日志与备份、常见问题）都在那个仓库的 README 里。

## 各自负责什么

| 仓库 | 职责 |
|---|---|
| `longBlog`（本仓库） | 文章数据、Astro 站点、样式与前端脚本 |
| `longblog-automation` | 运行在 NAS 容器里的同步与发布服务 |

自动化会 clone 本仓库到容器内的 `workspace/`，改写 `src/data/trilium-posts.*.generated.ts` 与 `public/trilium-assets/`，然后提交推送。**本仓库的 `src/data/*.generated.ts` 由它生成，不要手改。**

## 改同步脚本后怎么生效

同步脚本是**构建进镜像**的，所以推送到 GitHub 不会自动生效：

```sh
cd <NAS 上的部署目录>
git pull
docker compose build
docker compose up -d
```

想先验证效果可以免重建（服务每次同步都新起 python3 进程，不用重启）：

```sh
docker cp service/sync_trilium_posts.py longblog-automation:/app/service/
```

## 为什么本仓库不再保留脚本副本

本仓库曾经有一份 `scripts/sync_trilium_posts.py` 和一套 systemd 部署文件，那是早期的服务器架构。迁移到容器后这些副本留了下来，并且**与生产脚本分叉了一百多行**。

代价是真实的：渲染修复被两次提交到那份不执行的副本上，直到追查「为什么宿主注入标签反复出现」才发现生产脚本在另一个仓库。所以那些文件连同描述旧架构的文档一并删除了。

**在别处看到 `service/sync_trilium_posts.py` 的路径，它指的都是 longblog-automation。**
