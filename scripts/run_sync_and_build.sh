#!/bin/sh
set -eu

SERVICE_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT_DIR=$(dirname "$SERVICE_DIR")
DEFAULT_RUNTIME_DIR="$ROOT_DIR/runtime"
DEFAULT_WORKSPACE_DIR="$ROOT_DIR/workspace/current"

RUNTIME_DIR=${LONGBLOG_RUNTIME_DIR:-$DEFAULT_RUNTIME_DIR}
WORKSPACE_DIR=${LONGBLOG_REPO_DIR:-${LONGBLOG_WORKSPACE_DIR:-$DEFAULT_WORKSPACE_DIR}}
LOCK_DIR=$RUNTIME_DIR/state/run.lock
PENDING_RERUN_FILE=$RUNTIME_DIR/state/pending_rerun
REPORT_FILE=$RUNTIME_DIR/reports/last_report.json
WEBHOOK_CTX_FILE=$RUNTIME_DIR/state/last_webhook.json
SYNC_LOG=$RUNTIME_DIR/logs/sync.log
BUILD_LOG=$RUNTIME_DIR/logs/build.log
ENV_FILE=$RUNTIME_DIR/env.sh

refresh_runtime_paths() {
  RUNTIME_DIR=${LONGBLOG_RUNTIME_DIR:-$DEFAULT_RUNTIME_DIR}
  WORKSPACE_DIR=${LONGBLOG_REPO_DIR:-${LONGBLOG_WORKSPACE_DIR:-$DEFAULT_WORKSPACE_DIR}}
  LOCK_DIR=$RUNTIME_DIR/state/run.lock
  PENDING_RERUN_FILE=$RUNTIME_DIR/state/pending_rerun
  REPORT_FILE=$RUNTIME_DIR/reports/last_report.json
  WEBHOOK_CTX_FILE=$RUNTIME_DIR/state/last_webhook.json
  SYNC_LOG=$RUNTIME_DIR/logs/sync.log
  BUILD_LOG=$RUNTIME_DIR/logs/build.log
  ENV_FILE=$RUNTIME_DIR/env.sh
}

ensure_base_dirs() {
  mkdir -p "$RUNTIME_DIR/logs" "$RUNTIME_DIR/reports" "$RUNTIME_DIR/state" "$(dirname "$WORKSPACE_DIR")"
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
  printf '%s\n' "$LOCK_REPORT" >> "$SYNC_LOG"
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

prepare_workspace() {
  REPO_URL=${LONGBLOG_REPO_URL:-git@github.com:minlonghuo-lab/longBlog.git}
  GIT_REMOTE=${LONGBLOG_GIT_REMOTE:-origin}
  GIT_BRANCH=${LONGBLOG_GIT_BRANCH:-main}
  GIT_SSH_COMMAND_VALUE=${LONGBLOG_GIT_SSH_COMMAND:-ssh -i /root/.ssh/id_ed25519_longblog -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes}

  if [ ! -d "$WORKSPACE_DIR/.git" ]; then
    GIT_SSH_COMMAND="$GIT_SSH_COMMAND_VALUE" git clone "$REPO_URL" "$WORKSPACE_DIR" >> "$BUILD_LOG" 2>&1
  fi

  cd "$WORKSPACE_DIR"

  if git remote | grep -qx "$GIT_REMOTE"; then
    git remote set-url "$GIT_REMOTE" "$REPO_URL" >> "$BUILD_LOG" 2>&1
  else
    git remote add "$GIT_REMOTE" "$REPO_URL" >> "$BUILD_LOG" 2>&1
  fi

  git config core.sshCommand "$GIT_SSH_COMMAND_VALUE"
  if [ -n "${LONGBLOG_GIT_USER_NAME:-}" ]; then
    git config user.name "$LONGBLOG_GIT_USER_NAME"
  fi
  if [ -n "${LONGBLOG_GIT_USER_EMAIL:-}" ]; then
    git config user.email "$LONGBLOG_GIT_USER_EMAIL"
  fi

  GIT_SSH_COMMAND="$GIT_SSH_COMMAND_VALUE" git fetch "$GIT_REMOTE" "$GIT_BRANCH" >> "$BUILD_LOG" 2>&1
  if git rev-parse --verify "$GIT_REMOTE/$GIT_BRANCH" >/dev/null 2>&1; then
    git checkout -B "$GIT_BRANCH" "$GIT_REMOTE/$GIT_BRANCH" >> "$BUILD_LOG" 2>&1
    git reset --hard "$GIT_REMOTE/$GIT_BRANCH" >> "$BUILD_LOG" 2>&1
  fi
}

run_once() {
  ensure_base_dirs
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

  if [ ! -f "$ENV_FILE" ]; then
    echo "Missing env file: $ENV_FILE" >&2
    exit 1
  fi

  . "$ENV_FILE"
  export LONGBLOG_RUNTIME_DIR="$RUNTIME_DIR"
  export LONGBLOG_REPO_DIR="$WORKSPACE_DIR"
  refresh_runtime_paths
  ensure_base_dirs

  {
    printf '[runner] SERVICE_DIR=%s\n' "$SERVICE_DIR"
    printf '[runner] ROOT_DIR=%s\n' "$ROOT_DIR"
    printf '[runner] RUNTIME_DIR=%s\n' "$RUNTIME_DIR"
    printf '[runner] WORKSPACE_DIR=%s\n' "$WORKSPACE_DIR"
    printf '[runner] REPORT_FILE=%s\n' "$REPORT_FILE"
    printf '[runner] WEBHOOK_CTX_FILE=%s\n' "$WEBHOOK_CTX_FILE"
  } >> "$SYNC_LOG"

  prepare_workspace
  cd "$WORKSPACE_DIR"

  PYTHON_BIN=$(command -v python3)
  NPM_BIN=$(command -v npm)
  SYNC_SCRIPT="$SERVICE_DIR/sync_trilium_posts.py"
  BARK_BASE_URL=${LONGBLOG_BARK_BASE_URL:-}
  BARK_ICON_URL=${LONGBLOG_BARK_ICON_URL:-}

  SYNC_ARGS=$(consume_webhook_args)
  if [ -n "$SYNC_ARGS" ]; then
    SYNC_JSON=$(eval "$PYTHON_BIN \"$SYNC_SCRIPT\" $SYNC_ARGS")
  else
    SYNC_JSON=$($PYTHON_BIN "$SYNC_SCRIPT")
  fi

  run_finished_at=$(date '+%Y-%m-%d %H:%M:%S%z')
  SYNC_JSON=$(printf '%s' "$SYNC_JSON" | $PYTHON_BIN -c 'import sys,json; d=json.load(sys.stdin); d["runStartedAt"] = sys.argv[1]; d["runFinishedAt"] = sys.argv[2]; d["lockSkipped"] = False; d["lockReason"] = ""; print(json.dumps(d, ensure_ascii=False, indent=2))' "$run_started_at" "$run_finished_at")
  printf '%s\n' "$SYNC_JSON" >> "$SYNC_LOG"
  printf '%s\n' "$SYNC_JSON" > "$REPORT_FILE"

  GIT_CHANGED=$(printf '%s' "$SYNC_JSON" | $PYTHON_BIN -c 'import sys,json; d=json.load(sys.stdin); print("true" if d.get("gitChanged") else "false")')
  BUILD_RAN=false
  INSTALL_RAN=false
  LOCK_HASH_FILE=$RUNTIME_DIR/state/package-lock.sha256
  CURRENT_HASH=$(sha256sum package-lock.json 2>/dev/null | awk '{print $1}')
  PREV_HASH=""
  if [ -f "$LOCK_HASH_FILE" ]; then
    PREV_HASH=$(cat "$LOCK_HASH_FILE" 2>/dev/null || true)
  fi
  if [ "$GIT_CHANGED" = "true" ]; then
    if [ ! -d node_modules ] || [ "$CURRENT_HASH" != "$PREV_HASH" ]; then
      "$NPM_BIN" install >> "$BUILD_LOG" 2>&1
      CURRENT_HASH=$(sha256sum package-lock.json 2>/dev/null | awk '{print $1}')
      printf '%s' "$CURRENT_HASH" > "$LOCK_HASH_FILE"
      INSTALL_RAN=true
    fi
    "$NPM_BIN" run build >> "$BUILD_LOG" 2>&1
    BUILD_RAN=true
  fi

  FINAL_JSON=$(printf '%s' "$SYNC_JSON" | $PYTHON_BIN -c 'import sys,json; d=json.load(sys.stdin); d["installRan"] = (sys.argv[1] == "true"); d["buildRan"] = (sys.argv[2] == "true"); print(json.dumps(d, ensure_ascii=False, indent=2))' "$INSTALL_RAN" "$BUILD_RAN")
  printf '%s\n' "$FINAL_JSON" > "$REPORT_FILE"

  if [ -n "$BARK_BASE_URL" ]; then
    TITLE=$(printf '%s' "$FINAL_JSON" | $PYTHON_BIN -c 'import sys,json,urllib.parse; d=json.load(sys.stdin); failed=len(d.get("failed") or []); title="longBlog 自动发布失败" if failed else "longBlog 自动发布"; print(urllib.parse.quote(title, safe=""))')
    BODY=$(printf '%s' "$FINAL_JSON" | $PYTHON_BIN -c 'import sys,json,urllib.parse; d=json.load(sys.stdin); updated=len(d.get("updated") or []); unchanged=len(d.get("unchanged") or []); removed=len(d.get("removed") or []); removed_assets=len(d.get("removedAssets") or []); failed=len(d.get("failed") or []); ai=len(d.get("aiUpdated") or []); git_changed=d.get("gitChanged"); git_pushed=d.get("gitPushed"); req=d.get("requestId") or "-"; evt=d.get("event") or "-"; build_ran=d.get("buildRan"); workspace=d.get("workspaceDir") or "-"; msg=f"事件 {evt}｜请求 {req}｜更新{updated}篇｜撤下{removed}篇｜清理资源{removed_assets}个｜未变{unchanged}篇｜失败{failed}篇｜AI {ai}篇｜Git变更 {git_changed}｜已推送 {git_pushed}｜构建 {build_ran}"; print(urllib.parse.quote(msg, safe=""))')
    BARK_QUERY="?group=longBlog&level=active"
    if [ -n "$BARK_ICON_URL" ]; then
      ICON_ENCODED=$(printf '%s' "$BARK_ICON_URL" | $PYTHON_BIN -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.stdin.read().strip(), safe=""))')
      BARK_QUERY="$BARK_QUERY&icon=$ICON_ENCODED"
    fi
    curl -fsS "$BARK_BASE_URL/$TITLE/$BODY$BARK_QUERY" >/dev/null 2>&1 || true
  fi

  trap - EXIT INT TERM
  cleanup
}

run_once
if [ -f "$PENDING_RERUN_FILE" ]; then
  rm -f "$PENDING_RERUN_FILE"
  run_once
fi
