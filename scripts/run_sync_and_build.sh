#!/bin/sh
set -eu
BOOTSTRAP_ENV=/root/longBlog/ops/runtime-bootstrap.env
DEFAULT_RUNTIME_DIR=/root/longblog-sync
if [ -f "$BOOTSTRAP_ENV" ]; then
  . "$BOOTSTRAP_ENV"
fi
RUNTIME_DIR=${LONGBLOG_RUNTIME_DIR:-$DEFAULT_RUNTIME_DIR}
LOCK_DIR=$RUNTIME_DIR/run.lock
PENDING_RERUN_FILE=$RUNTIME_DIR/pending_rerun
REPORT_FILE=$RUNTIME_DIR/last_report.json
WEBHOOK_CTX_FILE=$RUNTIME_DIR/last_webhook.json

refresh_runtime_paths() {
  RUNTIME_DIR=${LONGBLOG_RUNTIME_DIR:-$DEFAULT_RUNTIME_DIR}
  LOCK_DIR=$RUNTIME_DIR/run.lock
  PENDING_RERUN_FILE=$RUNTIME_DIR/pending_rerun
  REPORT_FILE=$RUNTIME_DIR/last_report.json
  WEBHOOK_CTX_FILE=$RUNTIME_DIR/last_webhook.json
}

write_lock_report() {
  run_started_at="$1"
  lock_reason="$2"
  LOCK_REPORT=$(python3 - <<PY
import json
print(json.dumps({
  "runStartedAt": "$run_started_at",
  "runFinishedAt": "$run_started_at",
  "lockSkipped": True,
  "lockReason": "$lock_reason"
}, ensure_ascii=False, indent=2))
PY
)
  printf '%s\n' "$LOCK_REPORT" >> $RUNTIME_DIR/sync.log
  printf '%s\n' "$LOCK_REPORT" > "$REPORT_FILE"
}

consume_webhook_args() {
  if [ ! -f "$WEBHOOK_CTX_FILE" ]; then
    echo ''
    return 0
  fi

  TMP_CTX=$(mktemp)
  cp "$WEBHOOK_CTX_FILE" "$TMP_CTX"
  rm -f "$WEBHOOK_CTX_FILE"

  python3 - <<PY
import json
p='$TMP_CTX'
try:
    data=json.load(open(p))
except Exception:
    print('')
    raise SystemExit
parts=[]
for key in ('requestId','event','noteId'):
    value=data.get(key)
    if value:
        escaped=str(value).replace('"', '\\"')
        parts.append(f'--{key} "{escaped}"')
print(' '.join(parts))
PY
  rm -f "$TMP_CTX"
}

run_once() {
  run_started_at=$(date '+%Y-%m-%d %H:%M:%S%z')
  if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    : > "$PENDING_RERUN_FILE"
    write_lock_report "$run_started_at" "longBlog sync already running; queued rerun"
    echo "longBlog sync already running" >&2
    return 0
  fi

  cleanup() {
    rmdir "$LOCK_DIR" 2>/dev/null || true
  }
  trap cleanup EXIT INT TERM

  . $RUNTIME_DIR/env.sh
  refresh_runtime_paths
  cd /root/longBlog
  PYTHON_BIN=$(command -v python3)
  NPM_BIN=$(command -v npm)
  BARK_BASE_URL=${LONGBLOG_BARK_BASE_URL:-}

  SYNC_ARGS=$(consume_webhook_args)
  if [ -n "$SYNC_ARGS" ]; then
    SYNC_JSON=$(eval "$PYTHON_BIN scripts/sync_trilium_posts.py $SYNC_ARGS")
  else
    SYNC_JSON=$($PYTHON_BIN scripts/sync_trilium_posts.py)
  fi

  run_finished_at=$(date '+%Y-%m-%d %H:%M:%S%z')
  SYNC_JSON=$(printf '%s' "$SYNC_JSON" | $PYTHON_BIN -c 'import sys,json; d=json.load(sys.stdin); d["runStartedAt"] = sys.argv[1]; d["runFinishedAt"] = sys.argv[2]; d["lockSkipped"] = False; d["lockReason"] = ""; print(json.dumps(d, ensure_ascii=False, indent=2))' "$run_started_at" "$run_finished_at")
  printf '%s\n' "$SYNC_JSON" >> $RUNTIME_DIR/sync.log
  printf '%s\n' "$SYNC_JSON" > "$REPORT_FILE"

  GIT_CHANGED=$(printf '%s' "$SYNC_JSON" | $PYTHON_BIN -c 'import sys,json; d=json.load(sys.stdin); print("true" if d.get("gitChanged") else "false")')
  BUILD_RAN=false
  INSTALL_RAN=false
  LOCK_HASH_FILE=$RUNTIME_DIR/package-lock.sha256
  CURRENT_HASH=$(sha256sum package-lock.json 2>/dev/null | awk '{print $1}')
  PREV_HASH=""
  if [ -f "$LOCK_HASH_FILE" ]; then
    PREV_HASH=$(cat "$LOCK_HASH_FILE" 2>/dev/null || true)
  fi
  if [ "$GIT_CHANGED" = "true" ]; then
    if [ ! -d node_modules ] || [ "$CURRENT_HASH" != "$PREV_HASH" ]; then
      "$NPM_BIN" install >> $RUNTIME_DIR/build.log 2>&1
      printf '%s' "$CURRENT_HASH" > "$LOCK_HASH_FILE"
      INSTALL_RAN=true
    fi
    "$NPM_BIN" run build >> $RUNTIME_DIR/build.log 2>&1
    BUILD_RAN=true
  fi

  if [ -n "$BARK_BASE_URL" ]; then
    TITLE=$(printf '%s' "$SYNC_JSON" | $PYTHON_BIN -c 'import sys,json,urllib.parse; d=json.load(sys.stdin); failed=len(d.get("failed") or []); title="longBlog 自动发布失败" if failed else "longBlog 自动发布"; print(urllib.parse.quote(title, safe=""))')
    BODY=$(printf '%s' "$SYNC_JSON" | $PYTHON_BIN -c 'import sys,json,urllib.parse; d=json.load(sys.stdin); updated=len(d.get("updated") or []); unchanged=len(d.get("unchanged") or []); removed=len(d.get("removed") or []); removed_assets=len(d.get("removedAssets") or []); failed=len(d.get("failed") or []); ai=len(d.get("aiUpdated") or []); git_changed=d.get("gitChanged"); git_pushed=d.get("gitPushed"); req=d.get("requestId") or "-"; evt=d.get("event") or "-"; msg=f"事件 {evt}｜请求 {req}｜更新{updated}篇｜撤下{removed}篇｜清理资源{removed_assets}个｜未变{unchanged}篇｜失败{failed}篇｜AI {ai}篇｜Git变更 {git_changed}｜已推送 {git_pushed}"; print(urllib.parse.quote(msg, safe=""))')
    curl -fsS "$BARK_BASE_URL/$TITLE/$BODY?group=longBlog&icon=https://ssaw.top/favicon.ico&level=active" >/dev/null 2>&1 || true
  fi

  trap - EXIT INT TERM
  cleanup
}

run_once
if [ -f "$PENDING_RERUN_FILE" ]; then
  rm -f "$PENDING_RERUN_FILE"
  run_once
fi
