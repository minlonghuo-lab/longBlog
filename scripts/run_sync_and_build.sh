#!/bin/sh
set -eu
. /root/longblog-sync/env.sh
cd /root/longBlog
PYTHON_BIN=$(command -v python3)
NPM_BIN=$(command -v npm)
BARK_BASE_URL=${LONGBLOG_BARK_BASE_URL:-https://api.day.app/5YTBSzUQQgehUnihoSKdU}
SYNC_JSON=$($PYTHON_BIN scripts/sync_trilium_posts.py)
printf '%s\n' "$SYNC_JSON" >> /root/longblog-sync/sync.log
REPORT_FILE=/root/longblog-sync/last_report.json
printf '%s\n' "$SYNC_JSON" > "$REPORT_FILE"
GIT_CHANGED=$(printf '%s' "$SYNC_JSON" | $PYTHON_BIN -c 'import sys,json; data=json.load(sys.stdin); print("true" if data.get("gitChanged") else "false")')
UPDATED_COUNT=$(printf '%s' "$SYNC_JSON" | $PYTHON_BIN -c 'import sys,json; data=json.load(sys.stdin); print(len(data.get("updated") or []))')
FAILED_COUNT=$(printf '%s' "$SYNC_JSON" | $PYTHON_BIN -c 'import sys,json; data=json.load(sys.stdin); print(len(data.get("failed") or []))')
REMOVED_COUNT=$(printf '%s' "$SYNC_JSON" | $PYTHON_BIN -c 'import sys,json; data=json.load(sys.stdin); print(len(data.get("removed") or []))')
BUILD_RAN=false
INSTALL_RAN=false
LOCK_HASH_FILE=/root/longblog-sync/package-lock.sha256
CURRENT_HASH=$(sha256sum package-lock.json 2>/dev/null | awk '{print $1}')
PREV_HASH=""
if [ -f "$LOCK_HASH_FILE" ]; then
  PREV_HASH=$(cat "$LOCK_HASH_FILE" 2>/dev/null || true)
fi
if [ "$GIT_CHANGED" = "true" ]; then
  if [ ! -d node_modules ] || [ "$CURRENT_HASH" != "$PREV_HASH" ]; then
    "$NPM_BIN" install >> /root/longblog-sync/build.log 2>&1
    printf '%s' "$CURRENT_HASH" > "$LOCK_HASH_FILE"
    INSTALL_RAN=true
  fi
  "$NPM_BIN" run build >> /root/longblog-sync/build.log 2>&1
  BUILD_RAN=true
fi
TITLE="longBlog 自动发布"
BODY=$(printf '%s' "$SYNC_JSON" | $PYTHON_BIN -c 'import sys,json,urllib.parse; d=json.load(sys.stdin); updated=len(d.get("updated") or []); unchanged=len(d.get("unchanged") or []); removed=len(d.get("removed") or []); removed_assets=len(d.get("removedAssets") or []); failed=len(d.get("failed") or []); ai=len(d.get("aiUpdated") or []); git_changed=d.get("gitChanged"); git_pushed=d.get("gitPushed"); msg=f"更新{updated}篇｜撤下{removed}篇｜清理资源{removed_assets}个｜未变{unchanged}篇｜失败{failed}篇｜AI {ai}篇｜Git变更 {git_changed}｜已推送 {git_pushed}"; print(urllib.parse.quote(msg, safe=""))')
INFO=$(printf 'build=%s install=%s' "$BUILD_RAN" "$INSTALL_RAN" | $PYTHON_BIN -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.stdin.read().strip(), safe=""))')
curl -fsS "$BARK_BASE_URL/$TITLE/$BODY?group=longBlog&url=&icon=https://ssaw.top/favicon.ico&level=active&copy=$INFO" >/dev/null 2>&1 || true
