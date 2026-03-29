#!/bin/sh
set -eu
. /root/longblog-sync/env.sh
cd /root/longBlog
PYTHON_BIN=$(command -v python3)
NPM_BIN=$(command -v npm)
"$PYTHON_BIN" scripts/sync_trilium_posts.py >> /root/longblog-sync/sync.log 2>&1
"$NPM_BIN" install >> /root/longblog-sync/build.log 2>&1
"$NPM_BIN" run build >> /root/longblog-sync/build.log 2>&1
