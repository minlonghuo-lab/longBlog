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
GIT_CHANGED=$(printf '%s' "$SYNC_JSON" | $PYTHON_BIN -c 'import sys,json; d=json.load(sys.stdin); print("true" if d.get("gitChanged") else "false")')
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
TITLE=$(printf '%s' "$SYNC_JSON" | $PYTHON_BIN -c 'import sys,json,urllib.parse; d=json.load(sys.stdin); failed=len(d.get("failed") or []); title="longBlog 自动发布失败" if failed else "longBlog 自动发布"; print(urllib.parse.quote(title, safe=""))')
BODY=$(printf '%s' "$SYNC_JSON" | $PYTHON_BIN -c 'import sys,json,urllib.parse; d=json.load(sys.stdin); updated=len(d.get("updated") or []); unchanged=len(d.get("unchanged") or []); removed=len(d.get("removed") or []); removed_assets=len(d.get("removedAssets") or []); failed=len(d.get("failed") or []); ai=len(d.get("aiUpdated") or []); git_changed=d.get("gitChanged"); git_pushed=d.get("gitPushed"); msg=f"更新{updated}篇｜撤下{removed}篇｜清理资源{removed_assets}个｜未变{unchanged}篇｜失败{failed}篇｜AI {ai}篇｜Git变更 {git_changed}｜已推送 {git_pushed}"; print(urllib.parse.quote(msg, safe=""))')
ERROR_PART=$(printf '%s' "$SYNC_JSON" | $PYTHON_BIN -c 'import sys,json,urllib.parse; d=json.load(sys.stdin); failed=d.get("failed") or []; text="" if not failed else (failed[0].get("title","未知文章")+"："+failed[0].get("error",""))[:120]; print(urllib.parse.quote(text, safe=""))')
LEVEL=$(printf '%s' "$SYNC_JSON" | $PYTHON_BIN -c 'import sys,json; d=json.load(sys.stdin); print("timeSensitive" if (d.get("failed") or []) else "active")')
INFO=$(printf 'build=%s install=%s' "$BUILD_RAN" "$INSTALL_RAN" | $PYTHON_BIN -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.stdin.read().strip(), safe=""))')
URL="$BARK_BASE_URL/$TITLE/$BODY?group=longBlog&icon=https://ssaw.top/favicon.ico&level=$LEVEL&copy=$INFO"
if [ -n "$ERROR_PART" ]; then
  URL="$URL&body=$ERROR_PART"
fi
curl -fsS "$URL" >/dev/null 2>&1 || true
