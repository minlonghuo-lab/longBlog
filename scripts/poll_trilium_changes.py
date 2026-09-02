#!/usr/bin/env python3
import hashlib
import json
import os
import subprocess
import sys
import time
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import Dict, List

import requests

BASE_URL = os.environ.get("TRILIUM_BASE_URL", "http://127.0.0.1:8080").rstrip("/")
TOKEN = os.environ.get("TRILIUM_ETAPI_TOKEN", "")
ROOT_NOTE_ID = os.environ.get("TRILIUM_BLOG_ROOT_NOTE_ID", "zB8WioyKlvOw")
SERVICE_DIR = Path(__file__).resolve().parent
ROOT_DIR = SERVICE_DIR.parent
RUNTIME_DIR = Path(os.environ.get("LONGBLOG_RUNTIME_DIR", str(ROOT_DIR / "runtime")))
REPO_DIR = os.environ.get("LONGBLOG_REPO_DIR", str(ROOT_DIR / "workspace" / "current"))
STATE_DIR = RUNTIME_DIR / "state"
LOG_DIR = RUNTIME_DIR / "logs"
SNAPSHOT_FILE = STATE_DIR / "trilium_poll_snapshot.json"
CTX_FILE = STATE_DIR / "last_webhook.json"
LOCK_DIR = STATE_DIR / "poller.lock"
LOG_FILE = LOG_DIR / "poller.log"
RUNNER = SERVICE_DIR / "run_sync_and_build.sh"
TEMPLATE_NOTE_ID = "MC7PtiChdF5S"
SKIP_KEYWORDS = ("template", "模板", "logo", "素材", "draft-template", "index-template")
TZ_UTC8 = timezone(timedelta(hours=8))
HEADERS = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}


def now_iso() -> str:
    return datetime.now(TZ_UTC8).isoformat()


def log(msg: str):
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    with LOG_FILE.open("a", encoding="utf-8") as f:
        f.write(f"{now_iso()} {msg}\n")


def get_json(path: str):
    r = requests.get(f"{BASE_URL}{path}", headers=HEADERS, timeout=30)
    r.raise_for_status()
    return r.json()


def get_text(path: str) -> str:
    r = requests.get(f"{BASE_URL}{path}", headers=HEADERS, timeout=60)
    r.raise_for_status()
    return r.text


def label_map(note: dict) -> Dict[str, List[str]]:
    out: Dict[str, List[str]] = {}
    for a in note.get("attributes") or []:
        if a.get("type") == "label":
            out.setdefault(a.get("name") or "", []).append(str(a.get("value") or ""))
    return out


def last_label(labels: Dict[str, List[str]], name: str, default: str = "") -> str:
    values = labels.get(name) or []
    for value in reversed(values):
        if value.strip() != "":
            return value.strip()
    return default


def bool_label(labels: Dict[str, List[str]], name: str, default: bool = False) -> bool:
    values = [v.strip().lower() for v in labels.get(name, [])]
    if any(v in {"true", "1", "yes", "on"} for v in values):
        return True
    if any(v in {"false", "0", "no", "off"} for v in values):
        return False
    return default


def is_template(note: dict) -> bool:
    title = (note.get("title") or "").lower()
    if note.get("noteId") == TEMPLATE_NOTE_ID or "template" in title or "模板" in title:
        return True
    labels = label_map(note)
    return "template" in labels and last_label(labels, "template", "") == ""


def should_skip(note: dict) -> bool:
    title = (note.get("title") or "").lower()
    return any(k in title for k in SKIP_KEYWORDS)


def walk(root_id: str) -> List[dict]:
    out, stack, seen = [], [root_id], set()
    while stack:
        note_id = stack.pop()
        if note_id in seen:
            continue
        seen.add(note_id)
        note = get_json(f"/etapi/notes/{note_id}")
        out.append(note)
        for child_id in reversed(note.get("childNoteIds") or []):
            stack.append(child_id)
    return out


def content_hash(note_id: str) -> str:
    try:
        text = get_text(f"/etapi/notes/{note_id}/content")
    except Exception:
        text = ""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def build_snapshot() -> Dict[str, dict]:
    snapshot = {}
    for note in walk(ROOT_NOTE_ID):
        if note.get("noteId") == ROOT_NOTE_ID or is_template(note) or should_skip(note):
            continue
        labels = label_map(note)
        publish = bool_label(labels, "publish", False)
        sync = bool_label(labels, "sync", False)
        ai_refresh = bool_label(labels, "aiRefresh", False)
        pinned = bool_label(labels, "pinned", False)
        sync_hash = last_label(labels, "syncHash", "")
        item = {
            "id": note.get("noteId"),
            "title": note.get("title") or "未命名",
            "publish": publish,
            "sync": sync,
            "aiRefresh": ai_refresh,
            "pinned": pinned,
            "publishedAt": last_label(labels, "publishedAt", ""),
            "updatedAt": last_label(labels, "updatedAt", ""),
            "syncHash": sync_hash,
        }
        if publish or sync or ai_refresh or sync_hash:
            item["contentHash"] = content_hash(note["noteId"])
        snapshot[note["noteId"]] = item
    return snapshot


def load_snapshot() -> Dict[str, dict]:
    if not SNAPSHOT_FILE.exists():
        return {}
    try:
        return json.loads(SNAPSHOT_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_snapshot(snapshot: Dict[str, dict]):
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    tmp = SNAPSHOT_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")
    tmp.replace(SNAPSHOT_FILE)


def diff_snapshot(old: Dict[str, dict], new: Dict[str, dict]) -> List[dict]:
    changes = []
    for note_id, item in new.items():
        prev = old.get(note_id)
        if prev is None:
            if item.get("publish") or item.get("sync") or item.get("aiRefresh"):
                changes.append({"type": "new", "note": item})
            continue
        watched = ["title", "publish", "sync", "aiRefresh", "pinned", "contentHash"]
        changed = [k for k in watched if prev.get(k) != item.get(k)]
        if changed:
            changes.append({"type": "changed", "changed": changed, "note": item, "previous": prev})
    for note_id, prev in old.items():
        if note_id not in new and (prev.get("publish") or prev.get("syncHash")):
            changes.append({"type": "removed", "note": prev})
    return changes


def choose_context(changes: List[dict]) -> dict:
    priority = {"sync": 0, "aiRefresh": 1, "publish": 2, "pinned": 3, "contentHash": 4, "title": 5}
    def score(ch):
        changed = ch.get("changed") or []
        if ch["type"] == "new":
            return 2
        if ch["type"] == "removed":
            return 2
        return min([priority.get(k, 9) for k in changed] or [9])
    ch = sorted(changes, key=score)[0]
    note = ch["note"]
    changed = ch.get("changed") or []
    event = "sync_requested"
    ctx = {
        "requestId": f"poller-{note.get('id')}-{int(time.time())}",
        "event": event,
        "noteId": note.get("id"),
        "noteTitle": note.get("title"),
        "sync": "true",
        "triggeredAt": now_iso(),
        "source": "poller",
        "changes": changed or [ch["type"]],
    }
    if "pinned" in changed:
        ctx.update({"event": "pinned_changed", "pinned": str(note.get("pinned", False)).lower(), "sync": None})
    elif "publish" in changed:
        ctx.update({"event": "publish_changed", "publish": str(note.get("publish", False)).lower(), "sync": None})
    elif "aiRefresh" in changed and note.get("aiRefresh"):
        ctx.update({"event": "ai_refresh_requested", "aiRefresh": "true", "sync": None})
    return ctx


def run_runner(ctx: dict) -> bool:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    CTX_FILE.write_text(json.dumps(ctx, ensure_ascii=False, indent=2), encoding="utf-8")
    env = os.environ.copy()
    env["LONGBLOG_RUNTIME_DIR"] = str(RUNTIME_DIR)
    env["LONGBLOG_REPO_DIR"] = REPO_DIR
    p = subprocess.run(["/bin/sh", str(RUNNER)], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=900)
    return p.returncode == 0


def main() -> int:
    if not TOKEN:
        log("ERROR missing TRILIUM_ETAPI_TOKEN")
        return 2
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    try:
        LOCK_DIR.mkdir()
    except FileExistsError:
        log("skip: previous poller still running")
        return 0
    try:
        old = load_snapshot()
        new = build_snapshot()
        if not old:
            save_snapshot(new)
            log(f"initialized snapshot notes={len(new)}")
            return 0
        changes = diff_snapshot(old, new)
        if not changes:
            log(f"no changes notes={len(new)}")
            return 0
        ctx = choose_context(changes)
        log(f"changes={len(changes)} event={ctx.get('event')} noteId={ctx.get('noteId')} title={ctx.get('noteTitle')} changed={ctx.get('changes')}")
        ok = run_runner(ctx)
        if ok:
            after = build_snapshot()
            save_snapshot(after)
            log("runner ok; snapshot updated")
            return 0
        log("ERROR runner failed; snapshot not updated")
        return 1
    except Exception as e:
        log(f"ERROR {type(e).__name__}: {e}")
        return 1
    finally:
        try:
            LOCK_DIR.rmdir()
        except Exception:
            pass


if __name__ == "__main__":
    raise SystemExit(main())
