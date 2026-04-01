# longBlog 自动化流迁移到新服务器：保姆级教程

> 目标：把当前 longBlog 的 **Trilium → Webhook → 服务器 Runner → 同步脚本 → Git Push → Astro Build** 这条自动化流，完整迁移到另一台新服务器。  
> 这份教程默认你对 Linux、Git、Nginx、Python 只懂一点点，尽量写成“照抄也能做”的版本。  
> 为了避免踩坑，本文把“为什么这样做”也讲清楚。

---

## 一、先搞明白：你到底要迁移什么

当前这套自动化流不是一个单文件脚本，而是 3 个部分一起工作：

### 1. Git 仓库主目录
路径：
- `/root/longBlog`

作用：
- 存放 Astro 博客源码
- 存放主同步脚本
- 存放构建产物 `dist/`
- 存放 docs 文档

### 2. 运行态目录
路径：
- `/root/longblog-sync`

作用：
- 存环境变量
- 存同步日志
- 存构建日志
- 存最近一次同步报告
- 存 webhook 上下文临时文件

### 3. Webhook 入口脚本
当前路径：
- `/root/longBlog/ops/trilium_sync_webhook.py`

作用：
- 接收 Trilium 发来的 webhook
- 验签
- 写入上下文
- 启动 runner

所以你迁移时，不是只复制仓库，而是要把：

```text
仓库目录 + 运行态目录 + webhook 入口 + Nginx 配置 + 环境变量
```
一起迁过去。

---

## 二、迁移前你要准备什么

你需要准备这些信息：

### 1. 新服务器
- 一台 Linux 服务器（推荐 Debian / Ubuntu）
- 你有 root 权限
- 能联网

### 2. 域名
你现在的 webhook 入口是：
- `https://blog.ssaw.top/trilium-sync-webhook`

你有两种选择：

#### 方案 A：继续沿用旧域名
- 让 `blog.ssaw.top` 指向新服务器
- 然后 Trilium 不用改 webhook 地址

#### 方案 B：先用新域名测试
例如：
- `https://new-blog.ssaw.top/trilium-sync-webhook`

然后等确认新服务器没问题后，再切正式域名。

**如果你是第一次迁移，建议先走方案 B。**

---

### 3. 需要用到的敏感信息
这些不要写进 Git 仓库，而是放服务器环境变量文件：

- `TRILIUM_ETAPI_TOKEN`
- `TRILIUM_BLOG_ROOT_NOTE_ID`
- `TRILIUM_PUBLISH_WEBHOOK_SECRET`
- `DEEPSEEK_API_KEY`
- `LONGBLOG_AUTO_PUSH`
- `LONGBLOG_BARK_BASE_URL`（可选）

如果你没有这些值，迁移做不起来。

---

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
2. clone 仓库
3. 建运行态目录
4. 写 env.sh
5. 部署 webhook 入口脚本
6. 配 Nginx 反代 /trilium-sync-webhook
7. 手动跑一次同步脚本
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

只要这些命令都能跑，就说明基础环境没问题。

---

## 五、步骤 2：把仓库拉到新服务器

建议路径仍然保持和旧服务器一致：

```bash
cd /root
git clone git@github.com:minlonghuo-lab/longBlog.git
cd /root/longBlog
```

确认成功：

```bash
git status
git branch -vv
```

看到 `main` 就行。

---

## 六、步骤 3：创建运行态目录

在新服务器上创建：

```bash
mkdir -p /root/longblog-sync
chmod 700 /root/longblog-sync
```

这个目录是自动化运行时要用的，不在 Git 仓库里。

---

## 七、步骤 4：写环境变量文件 env.sh

创建文件：

- `/root/longblog-sync/env.sh`

内容模板如下（把值换成你自己的）：

```bash
export TRILIUM_ETAPI_TOKEN='你的 Trilium ETAPI Token'
export TRILIUM_BLOG_ROOT_NOTE_ID='你的博客根 noteId'
export LONGBLOG_AUTO_PUSH='true'
export DEEPSEEK_API_KEY='你的 DeepSeek API Key'
export LONGBLOG_DEEPSEEK_MODEL='deepseek-chat'
export LONGBLOG_BARK_BASE_URL='你的 Bark 地址'
export TRILIUM_PUBLISH_WEBHOOK_SECRET='你的 webhook secret'
```

写完以后设置权限：

```bash
chmod 600 /root/longblog-sync/env.sh
```

### 验证 env.sh 可加载
```bash
. /root/longblog-sync/env.sh
[ -n "$TRILIUM_ETAPI_TOKEN" ] && echo ok || echo fail
```

如果输出 `ok`，说明成功。

---

## 八、步骤 5：确认 webhook 入口脚本存在

现在仓库里正式入口脚本路径是：

- `/root/longBlog/ops/trilium_sync_webhook.py`

检查它是否存在：

```bash
ls -l /root/longBlog/ops/trilium_sync_webhook.py
python3 -m py_compile /root/longBlog/ops/trilium_sync_webhook.py
```

只要不报错就行。

---

## 九、步骤 6：确认 runner 和主同步脚本存在

检查：

```bash
ls -l /root/longBlog/scripts/run_sync_and_build.sh
ls -l /root/longBlog/scripts/sync_trilium_posts.py
ls -l /root/longBlog/scripts/ai_generate_meta.py
```

并给执行权限：

```bash
chmod +x /root/longBlog/scripts/run_sync_and_build.sh
chmod +x /root/longBlog/scripts/sync_trilium_posts.py
```

---

## 十、步骤 7：先手动验证 Trilium 读取能力

### 1）加载环境变量
```bash
cd /root/longBlog
. /root/longblog-sync/env.sh
```

### 2）先直接跑同步脚本
```bash
python3 scripts/sync_trilium_posts.py
```

### 你期待看到什么
你应该看到一段 JSON 输出，里面可能包含：
- `scanned`
- `publishedCandidates`
- `updated`
- `unchanged`
- `failed`
- `gitChanged`

如果这里就报错，先不要继续。

---

## 十一、步骤 8：检查 Git 推送是否正常

迁移时最容易卡住的就是“服务器能 pull 不能 push”。

### 1）先看远端
```bash
cd /root/longBlog
git remote -v
```

应该看到：
- `git@github.com:minlonghuo-lab/longBlog.git`

### 2）测试 SSH 到 GitHub
```bash
ssh -T git@github.com
```

能连上就行。

### 3）必要时配置 key
如果推送不通，就把旧服务器的：
- `/root/.ssh/id_ed25519_longblog`
- `/root/.ssh/id_ed25519_longblog.pub`

安全迁到新服务器，并设置：

```bash
chmod 700 /root/.ssh
chmod 600 /root/.ssh/id_ed25519_longblog
chmod 644 /root/.ssh/id_ed25519_longblog.pub
```

然后在 `/root/longBlog` 内设置：

```bash
git config core.sshCommand "ssh -i /root/.ssh/id_ed25519_longblog -o IdentitiesOnly=yes"
```

### 4）再测试 push
做一个空测试：

```bash
git fetch origin main
```

如果 fetch 正常，说明 SSH 基本没问题。

---

## 十二、步骤 9：手动跑一次 runner

现在测试 runner：

```bash
cd /root/longBlog
/bin/sh scripts/run_sync_and_build.sh
```

### 你要检查这些文件
```bash
cat /root/longblog-sync/last_report.json
tail -n 50 /root/longblog-sync/sync.log
tail -n 50 /root/longblog-sync/build.log
```

### 正常表现
- 有 `last_report.json`
- 没有明显 Python traceback
- 如有 Git 变化，可能会自动 build

---

## 十三、步骤 10：部署 Nginx webhook 路由

你需要在新服务器的 Nginx 里加一段：

```nginx
location /trilium-sync-webhook {
    proxy_pass http://127.0.0.1:8787/trilium-sync-webhook;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```

### 如果你已有站点配置
把这段加进目标 `server {}` 里。

### 检查配置
```bash
nginx -t
```

### 重载
```bash
nginx -s reload
```

---

## 十四、步骤 11：启动 webhook 服务

### 临时启动方式（先验证）
```bash
nohup /bin/sh -c '. /root/longblog-sync/env.sh && python3 /root/longBlog/ops/trilium_sync_webhook.py' >/dev/null 2>&1 &
```

### 验证进程
```bash
ps -ef | grep trilium_sync_webhook.py | grep -v grep
```

### 验证监听
```bash
ss -lntp | grep 8787
```

只要看到：
- `127.0.0.1:8787`
就说明启动成功。

---

## 十五、步骤 12：用 curl 手动模拟一次 webhook

先不要马上让 Trilium 发真实流量，先自己模拟。

### 1）准备 payload
保存为 `/tmp/test-webhook.json`

```json
{
  "event": "sync_requested",
  "requestId": "manual-test-1",
  "noteId": "你的某篇文章noteId",
  "noteTitle": "测试文章",
  "sync": "true",
  "triggeredAt": "2026-04-01T00:00:00Z"
}
```

### 2）生成签名
可以用 Python：

```bash
python3 - <<'PY'
import hmac, hashlib, os, json
secret = '你的 webhook secret'
raw = open('/tmp/test-webhook.json','rb').read()
print('sha256=' + hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest())
PY
```

复制输出的签名。

### 3）发送请求
```bash
curl -i https://你的域名/trilium-sync-webhook \
  -H 'Content-Type: application/json' \
  -H 'X-Trilium-Signature: 上一步输出的签名' \
  --data @/tmp/test-webhook.json
```

### 4）你期待看到
- HTTP `200`
- JSON 里有：
  - `ok: true`
  - `message: sync triggered`

### 5）然后马上看日志
```bash
tail -n 50 /root/trilium_sync_webhook.log
cat /root/longblog-sync/last_report.json
```

如果这一步不通，不要切正式流量。

---

## 十六、步骤 13：再让 Trilium 真正发 webhook

当你已经确认：
- 脚本可跑
- Nginx 可转发
- 签名正确
- 手动 curl 成功
- runner 可执行

这时再去 Trilium 里：
- 改一篇文章 `publish=true/false`
- 或者手动打 `sync=true`
- 或者 `aiRefresh=true`
- 或者 `pinned=true/false`

然后看：

```bash
tail -n 100 /root/trilium_sync_webhook.log
cat /root/longblog-sync/last_report.json
tail -n 100 /root/longblog-sync/sync.log
```

---

## 十七、迁移后你最容易踩的坑

### 坑 1：只 clone 仓库，不创建 `/root/longblog-sync`
结果：
- env 找不到
- 日志路径不存在
- runner 报错

### 坑 2：Git 能 fetch 不能 push
结果：
- 自动化运行了
- 但 GitHub 不更新

### 坑 3：Trilium webhook secret 不一致
结果：
- 日志里会看到 `signature verification failed`

### 坑 4：Nginx 反代没加 `/trilium-sync-webhook`
结果：
- webhook 请求打不到 Python 服务

### 坑 5：模板 note 还带真实值
结果：
- 会不断触发模板 webhook
- 造成噪音甚至状态混乱

### 坑 6：只看 webhook 是否收到，不看 `last_report.json`
结果：
- 你会误以为“收到 webhook = 自动化成功”
- 其实真正成功要看有没有更新、有无 Git push、有无 build 成功

---

## 十八、迁移成功的验收标准

你可以用这张清单验收：

### 必须全部满足
- [ ] `/root/longBlog` 仓库存在且能 `git status`
- [ ] `/root/longblog-sync/env.sh` 已配置
- [ ] `/root/longBlog/ops/trilium_sync_webhook.py` 能启动
- [ ] `127.0.0.1:8787` 正在监听
- [ ] Nginx 的 `/trilium-sync-webhook` 反代生效
- [ ] 手动 `curl` webhook 返回 200
- [ ] `python3 scripts/sync_trilium_posts.py` 能跑
- [ ] `/root/longblog-sync/last_report.json` 能生成
- [ ] GitHub 能自动 push
- [ ] `npm run build` 能成功

如果这些都满足，迁移基本就成功了。

---

## 十九、建议的最终目录结构（推荐照抄）

```text
/root/
├── longBlog/                         # 主 Git 仓库
│   ├── scripts/
│   │   ├── run_sync_and_build.sh
│   │   ├── sync_trilium_posts.py
│   │   └── ai_generate_meta.py
│   ├── ops/
│   │   ├── trilium_sync_webhook.py
│   │   └── archive/
│   ├── docs/
│   ├── src/
│   ├── public/
│   └── dist/
├── longblog-sync/                    # 运行态目录
│   ├── env.sh
│   ├── last_report.json
│   ├── sync.log
│   ├── build.log
│   └── last_webhook.json
└── .ssh/
    └── id_ed25519_longblog
```

---

## 二十、一句话总结

如果你完全照这篇做，核心原则只有一句：

> **先让“脚本、环境、Git、Nginx、curl 模拟请求”全部手动验证通过，再让 Trilium 真正接管自动化。**

别反过来，不然就会一边收正式流量，一边现场修火。
