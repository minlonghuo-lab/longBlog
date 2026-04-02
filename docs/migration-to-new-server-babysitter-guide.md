# longBlog 自动化流迁移到新服务器：保姆级教程

> 目标：把当前 longBlog 的 **Trilium → Webhook → 服务器自动化服务 → Runner → 同步脚本 → Git Push → Astro Build** 这条自动化流，完整迁移到另一台新服务器。  
> 这份教程默认你对 Linux、Git、Nginx、Python 只懂一点点，尽量写成“照抄也能做”的版本。  
> 为了避免踩坑，本文把“为什么这样做”也讲清楚。

---

## 一、先搞明白：你到底要迁移什么

当前这套自动化流不是一个单文件脚本，而是 3 个部分一起工作：

### 1. 自动化服务目录
路径（推荐）：
- `/root/longblog-automation/service`

作用：
- 存放 webhook 服务
- 存放 runner
- 存放同步脚本

### 2. 运行态目录
路径（推荐）：
- `/root/longblog-automation/runtime`

作用：
- 存环境变量
- 存 webhook 日志
- 存同步日志
- 存构建日志
- 存最近一次同步报告
- 存 webhook 上下文临时文件
- 存运行锁和哈希缓存

### 3. 项目工作区
路径（推荐）：
- `/root/longblog-automation/workspace/current`

作用：
- 存放独立的 longBlog 仓库工作区
- 用于生成数据、构建验证、Git push

所以你迁移时，不是只复制仓库，而是要把：

```text
服务目录 + 运行态目录 + 工作区准备逻辑 + Nginx 配置 + 环境变量
```
一起迁过去。

---

## 二、迁移前你要准备什么

### 1. 新服务器
- 一台 Linux 服务器（推荐 Debian / Ubuntu）
- 你有 root 权限
- 能联网

### 2. 域名
当前 webhook 入口示例：
- `https://blog.ssaw.top/trilium-sync-webhook`

你有两种选择：

#### 方案 A：继续沿用旧域名
- 让原有域名指向新服务器
- 然后 Trilium 不用改 webhook 地址

#### 方案 B：先用新域名测试
例如：
- `https://new-blog.ssaw.top/trilium-sync-webhook`

然后等确认新服务器没问题后，再切正式域名。

**如果你是第一次迁移，建议先走方案 B。**

### 3. 需要用到的敏感信息
这些不要写进 Git 仓库，而是放服务器环境变量文件：

- `TRILIUM_ETAPI_TOKEN`
- `TRILIUM_BLOG_ROOT_NOTE_ID`
- `TRILIUM_PUBLISH_WEBHOOK_SECRET`
- `DEEPSEEK_API_KEY`
- `LONGBLOG_AUTO_PUSH`
- `LONGBLOG_BARK_BASE_URL`（可选）

### 4. GitHub SSH 推送能力
新服务器要能直接：

```bash
git push origin main
```

所以你要准备：
- GitHub SSH key
- 或重新在新服务器生成 key 并加到 GitHub

---

## 三、迁移总路线图

整套迁移按下面顺序做最稳：

```text
1. 新服务器装环境
2. 创建自动化目录
3. 配置 runtime/env.sh
4. 部署 webhook 服务脚本
5. 部署 runner 与同步脚本
6. 配 Nginx 反代 /trilium-sync-webhook
7. 准备工作区
8. 手动跑一次 runner
9. 用 curl 模拟一次 webhook
10. 最后再让 Trilium 真发 webhook
```

**记住：一定先手动验证，再切正式流量。**

---

## 四、步骤 1：在新服务器装基础环境

以下命令假设你用的是 Debian / Ubuntu。

### 1）安装基础依赖
```bash
apt update
apt install -y git python3 python3-pip nodejs npm nginx curl
```

### 2）确认版本
```bash
git --version
python3 --version
npm --version
nginx -v
```

---

## 五、步骤 2：创建自动化目录

推荐结构：

```bash
mkdir -p /root/longblog-automation/service
mkdir -p /root/longblog-automation/runtime/logs
mkdir -p /root/longblog-automation/runtime/reports
mkdir -p /root/longblog-automation/runtime/state
mkdir -p /root/longblog-automation/workspace
chmod 700 /root/longblog-automation/runtime
```

---

## 六、步骤 3：写环境变量文件 env.sh

创建文件：
- `/root/longblog-automation/runtime/env.sh`

内容模板如下（把值换成你自己的）：

```bash
export TRILIUM_ETAPI_TOKEN='你的 Trilium ETAPI Token'
export TRILIUM_BLOG_ROOT_NOTE_ID='你的博客根 noteId'
export LONGBLOG_AUTO_PUSH='true'
export DEEPSEEK_API_KEY='你的 DeepSeek API Key'
export LONGBLOG_DEEPSEEK_MODEL='deepseek-chat'
export LONGBLOG_BARK_BASE_URL='你的 Bark 地址'
export TRILIUM_PUBLISH_WEBHOOK_SECRET='你的 webhook secret'
export LONGBLOG_RUNTIME_DIR='/root/longblog-automation/runtime'
export LONGBLOG_REPO_DIR='/root/longblog-automation/workspace/current'
```

写完以后设置权限：

```bash
chmod 600 /root/longblog-automation/runtime/env.sh
```

### 验证 env.sh 可加载
```bash
. /root/longblog-automation/runtime/env.sh
[ -n "$TRILIUM_ETAPI_TOKEN" ] && echo ok || echo fail
```

---

## 七、步骤 4：部署 webhook / runner / 同步脚本

建议把以下脚本部署到：

- `/root/longblog-automation/service/trilium_sync_webhook.py`
- `/root/longblog-automation/service/run_sync_and_build.sh`
- `/root/longblog-automation/service/sync_trilium_posts.py`

并赋予执行权限：

```bash
chmod +x /root/longblog-automation/service/run_sync_and_build.sh
chmod +x /root/longblog-automation/service/sync_trilium_posts.py
python3 -m py_compile /root/longblog-automation/service/trilium_sync_webhook.py
python3 -m py_compile /root/longblog-automation/service/sync_trilium_posts.py
```

---

## 八、步骤 5：配置 Nginx

典型反代规则：

```nginx
location /trilium-sync-webhook {
    proxy_pass http://127.0.0.1:8787/trilium-sync-webhook;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

修改后重载：

```bash
nginx -t && systemctl reload nginx
```

---

## 九、步骤 6：准备工作区

runner 第一次运行时可以自动 clone，但建议你先手动验证：

```bash
cd /root/longblog-automation/workspace
git clone git@github.com:minlonghuo-lab/longBlog.git current
cd current
git status
git branch -vv
```

如果需要指定 SSH key：

```bash
git config core.sshCommand "ssh -i /root/.ssh/id_ed25519_longblog -o IdentitiesOnly=yes"
```

---

## 十、步骤 7：先手动验证 runner

```bash
. /root/longblog-automation/runtime/env.sh
export LONGBLOG_RUNTIME_DIR=/root/longblog-automation/runtime
export LONGBLOG_REPO_DIR=/root/longblog-automation/workspace/current
/bin/sh /root/longblog-automation/service/run_sync_and_build.sh
```

你期待看到：
- `runtime/reports/last_report.json` 正常生成
- `runtime/logs/sync.log` 有输出
- `runtime/logs/build.log` 有输出

---

## 十一、步骤 8：观察日志与报告

```bash
cat /root/longblog-automation/runtime/reports/last_report.json
tail -n 50 /root/longblog-automation/runtime/logs/sync.log
tail -n 50 /root/longblog-automation/runtime/logs/build.log
tail -n 50 /root/longblog-automation/runtime/logs/trilium_sync_webhook.log
```

重点关注：
- `gitChanged`
- `gitPushed`
- `buildRan`
- `failed`

理想情况下，无请求同步时应能达到：

```json
{
  "gitChanged": false,
  "gitPushed": false,
  "buildRan": false
}
```

---

## 十二、步骤 9：启动 webhook 服务

可以直接前台验证：

```bash
. /root/longblog-automation/runtime/env.sh
export LONGBLOG_RUNTIME_DIR=/root/longblog-automation/runtime
export LONGBLOG_REPO_DIR=/root/longblog-automation/workspace/current
python3 /root/longblog-automation/service/trilium_sync_webhook.py
```

正式运行可用后台方式：

```bash
nohup /bin/sh -c '. /root/longblog-automation/runtime/env.sh && export LONGBLOG_RUNTIME_DIR=/root/longblog-automation/runtime && export LONGBLOG_REPO_DIR=/root/longblog-automation/workspace/current && python3 /root/longblog-automation/service/trilium_sync_webhook.py' >/dev/null 2>&1 &
```

---

## 十三、步骤 10：用 curl 模拟一次 webhook

本地模拟时要带签名；如果只是测 Nginx 转发和端口通路，可以先用无效请求确认服务有响应。

验证成功后，再让 Trilium 真正发一次：
- `publish=true`
- `sync=true`
- `pinned=true/false`
- `aiRefresh=true`

然后观察日志是否完整写入新目录。

---

## 常见坑

### 坑 1：把服务目录和工作区混在一起
后果：
- 目录职责不清
- 迁移后很难判断哪些文件属于“服务”，哪些属于“项目”

### 坑 2：没有给工作区单独设置路径
后果：
- runner 可能回退到脚本目录旁边找仓库
- 难以支持独立工作区和后续清理

### 坑 3：无请求同步时也重建全部生成文件
后果：
- 没有真实业务变化却 `gitChanged=true`
- 触发无意义 push
- 外部部署平台被无意义唤醒

### 坑 4：只 clone 仓库，不创建 runtime 子目录
后果：
- webhook 日志、同步日志、报告无法正常落盘

---

## 一句话总结

迁移 longBlog 自动化流时，最重要的不是“把仓库拷过去”，而是：

> **把自动化服务目录、运行态目录和项目工作区分开。**

这样结构清晰，回滚容易，排障也更省心。
