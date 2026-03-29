#!/bin/sh
set -eu
. /root/longblog-sync/env.sh
cd /root/longBlog
PYTHON_BIN=$(command -v python3)
NPM_BIN=$(command -v npm)
SYNC_JSON=$($PYTHON_BIN scripts/sync_trilium_posts.py)
printf '%s\n' "$SYNC_JSON" >> /root/longblog-sync/sync.log
GIT_CHANGED=$(printf '%s' "$SYNC_JSON" | $PYTHON_BIN -c 'import sys,json; data=json.load(sys.stdin); print("true" if data.get("gitChanged") else "false")')
if [ "$GIT_CHANGED" != "true" ]; then
  exit 0
fi
LOCK_HASH_FILE=/root/longblog-sync/package-lock.sha256
CURRENT_HASH=$(sha256sum package-lock.json 2>/dev/null | awk '{print $1}')
PREV_HASH=""
if [ -f "$LOCK_HASH_FILE" ]; then
  PREV_HASH=$(cat "$LOCK_HASH_FILE" 2>/dev/null || true)
fi
if [ ! -d node_modules ] || [ "$CURRENT_HASH" != "$PREV_HASH" ]; then
  "$NPM_BIN" install >> /root/longblog-sync/build.log 2>&1
  printf '%s' "$CURRENT_HASH" > "$LOCK_HASH_FILE"
fi
"$NPM_BIN" run build >> /root/longblog-sync/build.log 2>&1
