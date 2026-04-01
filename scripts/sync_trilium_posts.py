#!/usr/bin/env python3
import argparse
import os
import re
import json
import hashlib
import mimetypes
import subprocess
import time
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Optional, Tuple

import requests

BASE_URL = os.environ.get("TRILIUM_BASE_URL", "https://blog.ssaw.top").rstrip("/")
TOKEN = os.environ.get("TRILIUM_ETAPI_TOKEN", "")
ROOT_NOTE_ID = os.environ.get("TRILIUM_BLOG_ROOT_NOTE_ID", "zB8WioyKlvOw")
BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT_CONTENT_TS = os.path.join(BASE_DIR, "src", "data", "trilium-posts.content.generated.ts")
OUT_META_TS = os.path.join(BASE_DIR, "src", "data", "trilium-posts.meta.generated.ts")
LEGACY_OUT_TS = os.path.join(BASE_DIR, "src", "data", "trilium-posts.generated.ts")
ASSET_DIR = os.path.join(BASE_DIR, "public", "trilium-assets")
AUTO_PUSH = os.environ.get("LONGBLOG_AUTO_PUSH", "false").lower() == "true"
GIT_REMOTE = os.environ.get("LONGBLOG_GIT_REMOTE", "origin")
GIT_BRANCH = os.environ.get("LONGBLOG_GIT_BRANCH", "main")
TEMPLATE_NOTE_ID = "MC7PtiChdF5S"

if not TOKEN:
    raise SystemExit("TRILIUM_ETAPI_TOKEN not set")

HEADERS_JSON = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}
HEADERS_AUTH = {"Authorization": f"Bearer {TOKEN}"}
SKIP_KEYWORDS = ("template", "模板", "logo", "素材", "draft-template", "index-template")
TZ_UTC8 = timezone(timedelta(hours=8))
STATE_LABEL_NAMES = ["publish", "sync", "aiRefresh", "pinned", "syncStatus"]


def now_str() -> str:
    return datetime.now(TZ_UTC8).strftime("%Y-%m-%d %H:%M:%S.%f")[:-3] + "+0800"


def request(method: str, path: str, *, json_data=None, params=None, timeout=30, expected=None):
    r = requests.request(method, f"{BASE_URL}{path}", headers=HEADERS_JSON, json=json_data, params=params, timeout=timeout)
    if expected and r.status_code not in expected:
        raise requests.HTTPError(f"{method} {path} -> {r.status_code}: {r.text[:300]}", response=r)
    r.raise_for_status()
    return r


def get_json(path: str, params=None):
    return request("GET", path, params=params).json()


def get_text(path: str):
    return request("GET", path).text


def patch_json(path: str, payload: dict, expected=(200, 204)):
    return request("PATCH", path, json_data=payload, expected=expected)


def post_json(path: str, payload: dict, expected=(200, 201)):
    return request("POST", path, json_data=payload, expected=expected)


def delete_path(path: str, expected=(200, 204)):
    return request("DELETE", path, expected=expected)


def ensure_dir(path: str):
    os.makedirs(path, exist_ok=True)


def slugify(title: str) -> str:
    t = normalize_whitespace(title).strip().lower()
    t = re.sub(r"\s+", "-", t)
    t = re.sub(r"[^\w\-\u4e00-\u9fff]", "", t)
    t = re.sub(r"-+", "-", t).strip("-")
    return t or "post"


def ensure_unique_slug(base_slug: str, note_id: str, used_slugs: set, previous_slug_map: Dict[str, str]) -> str:
    slug = base_slug or "post"
    previous_slug = (previous_slug_map.get(note_id) or "").strip()
    if previous_slug and slug == previous_slug:
        used_slugs.add(slug)
        return slug
    if slug not in used_slugs:
        used_slugs.add(slug)
        return slug
    suffix = note_id[:6].lower()
    candidate = f"{slug}-{suffix}"
    if candidate == previous_slug or candidate not in used_slugs:
        used_slugs.add(candidate)
        return candidate
    index = 2
    while True:
        candidate = f"{slug}-{suffix}-{index}"
        if candidate == previous_slug or candidate not in used_slugs:
            used_slugs.add(candidate)
            return candidate
        index += 1


def normalize_whitespace(text: str) -> str:
    text = (text or "").replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def normalize_label_value(text: str) -> str:
    return normalize_whitespace(str(text or "")).replace("T", " ")


def label_attrs(attrs: List[dict]) -> Dict[str, List[dict]]:
    out: Dict[str, List[dict]] = {}
    for a in attrs or []:
        if a.get("type") != "label":
            continue
        out.setdefault(a.get("name", ""), []).append(a)
    return out


def last_label_value(attr_map: Dict[str, List[dict]], name: str, default: str = "") -> str:
    items = attr_map.get(name) or []
    if not items:
        return default
    for item in reversed(items):
        value = str(item.get("value") or "").strip()
        if value != "":
            return value
    return default


def bool_label_value(attr_map: Dict[str, List[dict]], name: str, default: bool = False) -> bool:
    items = attr_map.get(name) or []
    if not items:
        return default
    values = [str(item.get("value") or "").strip().lower() for item in items]
    if any(v in {"true", "1", "yes", "on"} for v in values):
        return True
    if any(v in {"false", "0", "no", "off"} for v in values):
        return False
    return default


def set_label(note_id: str, name: str, value: str):
    value = normalize_label_value(value)
    live_attrs = (get_json(f"/etapi/notes/{note_id}").get("attributes", []) or [])
    matches = [a for a in live_attrs if a.get("type") == "label" and a.get("name") == name]
    if matches:
        primary = matches[-1]
        patch_json(f"/etapi/attributes/{primary['attributeId']}", {"value": value})
        for extra in matches[:-1]:
            try:
                delete_path(f"/etapi/attributes/{extra['attributeId']}")
            except Exception:
                pass
        return
    post_json("/etapi/attributes", {"noteId": note_id, "type": "label", "name": name, "value": value})


def dedupe_state_labels(note_id: str):
    live_attrs = (get_json(f"/etapi/notes/{note_id}").get("attributes", []) or [])
    for name in STATE_LABEL_NAMES:
        matches = [a for a in live_attrs if a.get("type") == "label" and a.get("name") == name]
        for extra in matches[:-1]:
            try:
                delete_path(f"/etapi/attributes/{extra['attributeId']}")
            except Exception:
                pass


def is_template_note(note: dict) -> bool:
    note_id = note.get("noteId", "")
    if note_id == TEMPLATE_NOTE_ID:
        return True
    title = (note.get("title") or "").lower()
    if "template" in title or "模板" in title:
        return True
    attrs = note.get("attributes", []) or []
    for a in attrs:
        if a.get("type") == "label" and a.get("name") == "template" and not str(a.get("value") or "").strip():
            return True
    return False


def should_skip_note(note: dict) -> bool:
    title = (note.get("title") or "").lower()
    return any(k.lower() in title for k in SKIP_KEYWORDS)


def walk_note_tree(note_id: str) -> List[dict]:
    results: List[dict] = []
    stack = [note_id]
    seen = set()
    while stack:
        nid = stack.pop()
        if nid in seen:
            continue
        seen.add(nid)
        note = get_json(f"/etapi/notes/{nid}")
        results.append(note)
        for child_id in reversed(note.get("childNoteIds", []) or []):
            stack.append(child_id)
    return results


def ext_from_meta(url: str, content_type: str = "") -> str:
    base = url.split("?")[0]
    _, ext = os.path.splitext(base)
    if ext:
        return ext.lower()
    if content_type:
        e = mimetypes.guess_extension(content_type.split(";")[0].strip())
        if e:
            return e
    return ".bin"


def to_abs_attachment_url(u: str) -> str:
    if u.startswith("http://") or u.startswith("https://"):
        return u
    if u.startswith("/api/attachments/"):
        return f"{BASE_URL}{u}"
    if u.startswith("api/attachments/"):
        return f"{BASE_URL}/{u}"
    return u


def extract_attachment_id(abs_url: str) -> str:
    m = re.search(r"/api/attachments/([^/]+)/", abs_url)
    return m.group(1) if m else ""


def download_attachment_by_etapi(attachment_id: str) -> Tuple[Optional[bytes], Optional[str]]:
    if not attachment_id:
        return None, None
    try:
        meta = get_json(f"/etapi/attachments/{attachment_id}")
        r = requests.get(f"{BASE_URL}/etapi/attachments/{attachment_id}/content", headers=HEADERS_AUTH, timeout=60)
        if not r.ok:
            return None, None
        content_type = r.headers.get("content-type", meta.get("mime", ""))
        return r.content, content_type
    except Exception:
        return None, None


def find_attachment_urls(html: str) -> List[str]:
    pattern = re.compile(r'(https?://[^"\'\)\s]*/api/attachments/[^"\'\)\s]+|/api/attachments/[^"\'\)\s]+|api/attachments/[^"\'\)\s]+)')
    return sorted(set(pattern.findall(html or "")))


def localize_attachments(html: str, note_id: str) -> Tuple[str, List[str], bool]:
    urls = find_attachment_urls(html)
    if not urls:
        return html, [], False
    note_dir = os.path.join(ASSET_DIR, note_id)
    ensure_dir(note_dir)
    changed = False
    local_assets: List[str] = []
    for raw in urls:
        abs_url = to_abs_attachment_url(raw)
        attachment_id = extract_attachment_id(abs_url)
        content, content_type = download_attachment_by_etapi(attachment_id)
        if content is None:
            continue
        h = hashlib.md5(abs_url.encode("utf-8")).hexdigest()[:16]
        ext = ext_from_meta(abs_url, content_type or "")
        fname = f"{h}{ext}"
        fpath = os.path.join(note_dir, fname)
        local_url = f"/trilium-assets/{note_id}/{fname}"
        local_assets.append(local_url)
        old = None
        if os.path.exists(fpath):
            with open(fpath, "rb") as f:
                old = f.read()
        if old != content:
            with open(fpath, "wb") as f:
                f.write(content)
            changed = True
        html = html.replace(raw, local_url).replace(abs_url, local_url)
    return html, local_assets, changed


def parse_tags(attr_map: Dict[str, List[dict]]) -> List[str]:
    values = [a.get("value", "") for a in attr_map.get("tags", [])]
    if len(values) == 1 and "," in values[0]:
        values = [x.strip() for x in values[0].split(",")]
    return [v.strip() for v in values if v and v.strip()]


def generate_ai_meta(title: str, content_html: str, existing_summary: str, existing_tags: List[str], *, tags_only: bool) -> dict:
    payload = {
        "title": title,
        "content": content_html,
        "summary": existing_summary,
        "tags": existing_tags,
    }
    cmd = ["python3", os.path.join(BASE_DIR, "scripts", "ai_generate_meta.py")]
    if tags_only:
        cmd.extend(["--mode", "tags_only"])
    output = subprocess.check_output(cmd, input=json.dumps(payload, ensure_ascii=False), text=True)
    data = json.loads(output)
    tags = [str(x).strip() for x in (data.get("tags") or []) if str(x).strip()]
    summary = str(data.get("summary") or existing_summary).strip()
    return {"summary": summary, "tags": tags}


def build_post_record(note: dict, used_slugs: set, previous_slug_map: Dict[str, str], *, force_ai_refresh: bool = False) -> Tuple[dict, dict]:
    note_id = note["noteId"]
    attr_map = label_attrs(note.get("attributes", []) or [])
    title = (note.get("title") or "未命名").strip()
    html = get_text(f"/etapi/notes/{note_id}/content")
    html_localized, local_assets, assets_changed = localize_attachments(html, note_id)
    explicit_slug = last_label_value(attr_map, "slug", "").strip()
    base_slug = explicit_slug or slugify(title)
    slug = ensure_unique_slug(base_slug, note_id, used_slugs, previous_slug_map)
    ai_refresh = force_ai_refresh or bool_label_value(attr_map, "aiRefresh", False)
    summary = last_label_value(attr_map, "summary", "").strip()
    tags = parse_tags(attr_map)
    ai_generated = False
    ai_tags_only = False

    if ai_refresh or not summary or not tags:
        try:
            ai_result = generate_ai_meta(title, html_localized, summary, tags, tags_only=bool(tags))
            if not summary:
                summary = ai_result.get("summary", summary).strip()
            tags = ai_result.get("tags", tags)
            ai_generated = True
            ai_tagsOnly = bool(tags) and bool(attr_map.get("tags"))
            ai_tags_only = ai_tagsOnly
        except Exception:
            pass

    pinned = bool_label_value(attr_map, "pinned", False)
    payload_for_hash = {
        "title": title,
        "slug": slug,
        "summary": summary,
        "tags": tags,
        "contentHtml": html_localized,
    }
    sync_hash = hashlib.sha256(json.dumps(payload_for_hash, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()
    post = {
        "id": note_id,
        "slug": slug,
        "title": title,
        "updatedAt": last_label_value(attr_map, "updatedAt", "").strip() or note.get("dateModified") or note.get("utcDateModified") or now_str(),
        "publishedAt": last_label_value(attr_map, "publishedAt", "").strip(),
        "tags": tags,
        "summary": summary,
        "contentHtml": html_localized,
        "pinned": pinned,
        "syncHash": sync_hash,
        "syncStatus": last_label_value(attr_map, "syncStatus", ""),
    }
    meta = {
        "assetsChanged": assets_changed,
        "localAssets": local_assets,
        "computedSyncHash": sync_hash,
        "prevSyncHash": last_label_value(attr_map, "syncHash", ""),
        "aiRefresh": ai_refresh,
        "aiGenerated": ai_generated,
        "aiTagsOnly": ai_tags_only,
        "syncRequested": bool_label_value(attr_map, "sync", False),
    }
    return post, meta


def split_post_records(posts: List[dict]) -> Tuple[List[dict], List[dict]]:
    contents = []
    metas = []
    for post in posts:
        contents.append({
            "id": post["id"],
            "title": post["title"],
            "summary": post["summary"],
            "contentHtml": post["contentHtml"],
        })
        metas.append({
            "id": post["id"],
            "slug": post["slug"],
            "updatedAt": post["updatedAt"],
            "publishedAt": post.get("publishedAt", ""),
            "tags": post.get("tags", []),
            "pinned": bool(post.get("pinned")),
            "syncHash": post.get("syncHash", ""),
            "syncStatus": post.get("syncStatus", ""),
        })
    return contents, metas


def sort_meta_records(metas: List[dict]) -> List[dict]:
    return sorted(metas, key=lambda x: (x.get("pinned", False), x.get("publishedAt", x.get("updatedAt", "")), x.get("id", "")), reverse=True)


def write_generated_files(posts: List[dict]):
    contents, metas = split_post_records(posts)
    metas = sort_meta_records(metas)

    content_text = "// Auto-generated from Trilium ETAPI\n"
    content_text += "export interface TriliumPostContentRecord {\n"
    content_text += "  id: string; title: string; summary: string; contentHtml: string;\n"
    content_text += "}\n\n"
    content_text += "export const triliumPostContents: TriliumPostContentRecord[] = " + json.dumps(contents, ensure_ascii=False, indent=2) + ";\n"
    with open(OUT_CONTENT_TS, "w", encoding="utf-8") as f:
        f.write(content_text)

    meta_text = "// Auto-generated from Trilium ETAPI\n"
    meta_text += "export interface TriliumPostMetaRecord {\n"
    meta_text += "  id: string; slug: string; updatedAt: string; publishedAt?: string; tags: string[]; pinned?: boolean; syncHash?: string; syncStatus?: string;\n"
    meta_text += "}\n\n"
    meta_text += "export const triliumPostMetas: TriliumPostMetaRecord[] = " + json.dumps(metas, ensure_ascii=False, indent=2) + ";\n"
    with open(OUT_META_TS, "w", encoding="utf-8") as f:
        f.write(meta_text)


def load_existing_meta_records() -> List[dict]:
    if not os.path.exists(OUT_META_TS):
        return []
    text = open(OUT_META_TS, "r", encoding="utf-8").read()
    marker = "export const triliumPostMetas: TriliumPostMetaRecord[] = "
    start = text.find(marker)
    if start == -1:
        return []
    start += len(marker)
    end = text.rfind(";")
    if end == -1 or end <= start:
        return []
    raw = text[start:end].strip()
    try:
        data = json.loads(raw)
    except Exception:
        return []
    return data if isinstance(data, list) else []


def write_meta_only(metas: List[dict]):
    metas = sort_meta_records(metas)
    meta_text = "// Auto-generated from Trilium ETAPI\n"
    meta_text += "export interface TriliumPostMetaRecord {\n"
    meta_text += "  id: string; slug: string; updatedAt: string; publishedAt?: string; tags: string[]; pinned?: boolean; syncHash?: string; syncStatus?: string;\n"
    meta_text += "}\n\n"
    meta_text += "export const triliumPostMetas: TriliumPostMetaRecord[] = " + json.dumps(metas, ensure_ascii=False, indent=2) + ";\n"
    with open(OUT_META_TS, "w", encoding="utf-8") as f:
        f.write(meta_text)


def handle_pinned_only_update(args, report) -> bool:
    if args.event != "pinned_changed" or not args.noteId:
        return False
    metas = load_existing_meta_records()
    if not metas:
        return False

    target_pinned = None
    if getattr(args, "pinned", ""):
        raw = str(args.pinned).strip().lower()
        if raw in {"true", "1", "yes", "on"}:
            target_pinned = True
        elif raw in {"false", "0", "no", "off"}:
            target_pinned = False

    note = None
    attr_map = {}
    pinned = False
    for attempt in range(4):
        note = get_json(f"/etapi/notes/{args.noteId}")
        attr_map = label_attrs(note.get("attributes", []) or [])
        pinned = bool_label_value(attr_map, "pinned", False)
        if target_pinned is None or pinned == target_pinned:
            break
        time.sleep(0.6)

    updated_at = now_str()
    found = False
    changed = False
    for meta in metas:
        if meta.get("id") != args.noteId:
            continue
        found = True
        old_pinned = bool(meta.get("pinned"))
        if old_pinned != pinned:
            meta["pinned"] = pinned
            meta["updatedAt"] = updated_at
            changed = True
        meta["syncStatus"] = "published"
        report[("updated" if changed else "unchanged")].append({
            "id": args.noteId,
            "title": note.get("title", "未命名"),
            "pinned": bool(meta.get("pinned")),
        })
        break
    if not found:
        return False
    set_label(args.noteId, "syncStatus", "published")
    if changed:
        set_label(args.noteId, "updatedAt", updated_at)
    write_meta_only(metas)
    report["gitChanged"] = git_has_changes()
    report["autoPushEnabled"] = AUTO_PUSH
    if AUTO_PUSH and report["gitChanged"]:
        message = f"chore(trilium): {'pin' if pinned else 'unpin'} post - {note.get('title', '未命名')}"
        ok, output = git_commit_and_push(message)
        report["gitPushed"] = ok
        report["gitMessage"] = message
        report["gitOutput"] = output[-2000:]
    else:
        report["gitPushed"] = False
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return True


def cleanup_removed_assets(note_ids: List[str]) -> List[str]:
    removed_dirs = []
    for note_id in note_ids:
        path = os.path.join(ASSET_DIR, note_id)
        if os.path.isdir(path):
            subprocess.run(["rm", "-rf", path], check=False)
            removed_dirs.append(note_id)
    return removed_dirs


def git_has_changes() -> bool:
    r = subprocess.run(["git", "status", "--porcelain", "src/data/trilium-posts.content.generated.ts", "src/data/trilium-posts.meta.generated.ts", "public/trilium-assets"], cwd=BASE_DIR, capture_output=True, text=True)
    return bool(r.stdout.strip())


def git_sync_remote() -> Tuple[bool, str]:
    fetch_res = subprocess.run(["git", "fetch", GIT_REMOTE, GIT_BRANCH], cwd=BASE_DIR, capture_output=True, text=True)
    fetch_text = (fetch_res.stdout or "") + (fetch_res.stderr or "")
    if fetch_res.returncode != 0:
        return False, fetch_text.strip()

    local_head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=BASE_DIR, capture_output=True, text=True)
    remote_head = subprocess.run(["git", "rev-parse", f"{GIT_REMOTE}/{GIT_BRANCH}"], cwd=BASE_DIR, capture_output=True, text=True)
    if local_head.returncode != 0 or remote_head.returncode != 0:
        details = []
        if fetch_text.strip():
            details.append(fetch_text.strip())
        if local_head.returncode != 0:
            details.append((local_head.stderr or local_head.stdout).strip())
        if remote_head.returncode != 0:
            details.append((remote_head.stderr or remote_head.stdout).strip())
        return False, "\n".join([x for x in details if x])

    if local_head.stdout.strip() == remote_head.stdout.strip():
        return True, fetch_text.strip()

    rebase_res = subprocess.run(["git", "rebase", f"{GIT_REMOTE}/{GIT_BRANCH}"], cwd=BASE_DIR, capture_output=True, text=True)
    rebase_text = (rebase_res.stdout or "") + (rebase_res.stderr or "")
    if rebase_res.returncode != 0:
        subprocess.run(["git", "rebase", "--abort"], cwd=BASE_DIR, capture_output=True, text=True)
        details = []
        if fetch_text.strip():
            details.append(fetch_text.strip())
        if rebase_text.strip():
            details.append(rebase_text.strip())
        return False, "\n".join(details)

    details = []
    if fetch_text.strip():
        details.append(fetch_text.strip())
    if rebase_text.strip():
        details.append(rebase_text.strip())
    return True, "\n".join(details)


def git_commit_and_push(message: str) -> Tuple[bool, str]:
    add_res = subprocess.run(["git", "add", "src/data/trilium-posts.content.generated.ts", "src/data/trilium-posts.meta.generated.ts", "public/trilium-assets", "src/data/posts.ts"], cwd=BASE_DIR, capture_output=True, text=True)
    if add_res.returncode != 0:
        return False, (add_res.stderr or add_res.stdout).strip()
    commit_res = subprocess.run(["git", "commit", "-m", message], cwd=BASE_DIR, capture_output=True, text=True)
    commit_text = (commit_res.stdout or "") + (commit_res.stderr or "")
    if commit_res.returncode != 0:
        if "nothing to commit" in commit_text.lower():
            return True, "nothing to commit"
        return False, commit_text.strip()
    push_res = subprocess.run(["git", "push", GIT_REMOTE, GIT_BRANCH], cwd=BASE_DIR, capture_output=True, text=True)
    push_text = (push_res.stdout or "") + (push_res.stderr or "")
    if push_res.returncode != 0:
        return False, push_text.strip()
    return True, (commit_text + "\n" + push_text).strip()


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--requestId", default="")
    p.add_argument("--event", default="")
    p.add_argument("--noteId", default="")
    p.add_argument("--pinned", default="")
    return p.parse_args()


def main():
    args = parse_args()
    root = get_json(f"/etapi/notes/{ROOT_NOTE_ID}")
    report = {
        "requestId": args.requestId,
        "event": args.event,
        "noteId": args.noteId,
        "rootTitle": root.get("title", ""),
        "scanned": 0,
        "publishedCandidates": 0,
        "updated": [],
        "unchanged": [],
        "failed": [],
        "aiUpdated": [],
        "removed": [],
        "removedAssets": []
    }

    if handle_pinned_only_update(args, report):
        return

    if AUTO_PUSH:
        sync_ok, sync_text = git_sync_remote()
        report["gitRemoteSynced"] = sync_ok
        if sync_text.strip():
            report["gitSyncOutput"] = sync_text[-2000:]
        if not sync_ok:
            report["gitChanged"] = False
            report["autoPushEnabled"] = AUTO_PUSH
            report["gitPushed"] = False
            print(json.dumps(report, ensure_ascii=False, indent=2))
            return

    all_notes = walk_note_tree(ROOT_NOTE_ID)
    notes_by_id = {n.get("noteId"): n for n in all_notes}
    if args.noteId and args.noteId in notes_by_id:
        ordered_notes = [notes_by_id[args.noteId]] + [n for n in all_notes if n.get("noteId") != args.noteId]
    else:
        ordered_notes = all_notes

    candidates = []
    for note in ordered_notes:
        report["scanned"] += 1
        if note.get("noteId") == ROOT_NOTE_ID:
            continue
        if note.get("type") != "text":
            continue
        if is_template_note(note):
            continue
        if should_skip_note(note):
            continue
        try:
            dedupe_state_labels(note["noteId"])
            note = get_json(f"/etapi/notes/{note['noteId']}")
        except Exception:
            pass
        attr_map = label_attrs(note.get("attributes", []) or [])
        publish_value = "true" if bool_label_value(attr_map, "publish", False) else "false"
        if publish_value != "true":
            if last_label_value(attr_map, "syncStatus", "") == "published":
                try:
                    ts = now_str()
                    set_label(note["noteId"], "syncStatus", "removed")
                    set_label(note["noteId"], "updatedAt", ts)
                    set_label(note["noteId"], "sync", "false")
                    report["removed"].append({"id": note["noteId"], "title": note.get("title", "未命名")})
                except Exception as e:
                    report["failed"].append({"id": note.get("noteId"), "title": note.get("title"), "error": str(e)[:300]})
            continue
        candidates.append(note)

    posts: List[dict] = []
    existing_meta = load_existing_meta_records()
    previous_slug_map = {str(meta.get("id") or "").strip(): str(meta.get("slug") or "").strip() for meta in existing_meta if str(meta.get("id") or "").strip()}
    used_slugs = {slug for slug in previous_slug_map.values() if slug}

    for note in candidates:
        report["publishedCandidates"] += 1
        try:
            targeted_note = bool(args.noteId and note.get("noteId") == args.noteId)
            force_ai_refresh = targeted_note and args.event == "ai_refresh_requested"
            post, meta = build_post_record(note, used_slugs, previous_slug_map, force_ai_refresh=force_ai_refresh)
            first_publish = not post["publishedAt"]
            targeted_event_for_note = targeted_note and args.event in {"publish_changed", "sync_requested", "pinned_changed", "ai_refresh_requested"}
            needs_publish = first_publish or meta["syncRequested"] or meta["aiRefresh"] or targeted_event_for_note
            if needs_publish:
                set_label(note["noteId"], "syncStatus", "publishing")
                ts = now_str()
                set_label(note["noteId"], "slug", post["slug"])
                if meta["aiGenerated"]:
                    if post["summary"]:
                        set_label(note["noteId"], "summary", post["summary"])
                    set_label(note["noteId"], "tags", ",".join(post["tags"]))
                    report["aiUpdated"].append({
                        "id": note["noteId"],
                        "title": post["title"],
                        "tagsOnly": meta["aiTagsOnly"],
                        "tags": post["tags"],
                    })
                if not post["publishedAt"]:
                    post["publishedAt"] = ts
                    set_label(note["noteId"], "publishedAt", ts)
                set_label(note["noteId"], "syncHash", meta["computedSyncHash"])
                set_label(note["noteId"], "updatedAt", ts)
                set_label(note["noteId"], "syncStatus", "published")
                set_label(note["noteId"], "sync", "false")
                if meta["aiRefresh"]:
                    set_label(note["noteId"], "aiRefresh", "false")
                post["syncStatus"] = "published"
                post["updatedAt"] = ts
                report["updated"].append({"id": note["noteId"], "title": post["title"], "pinned": post["pinned"]})
            else:
                set_label(note["noteId"], "syncStatus", "published")
                post["syncStatus"] = "published"
                report["unchanged"].append({"id": note["noteId"], "title": post["title"], "pinned": post["pinned"]})
            posts.append(post)
        except Exception as e:
            try:
                set_label(note["noteId"], "syncStatus", "error")
            except Exception:
                pass
            report["failed"].append({"id": note.get("noteId"), "title": note.get("title"), "error": str(e)[:300]})

    report["removedAssets"] = cleanup_removed_assets([item["id"] for item in report["removed"]])
    write_generated_files(posts)
    report["gitChanged"] = git_has_changes()
    report["autoPushEnabled"] = AUTO_PUSH
    if AUTO_PUSH and report["gitChanged"]:
        if report["updated"]:
            titles = [item["title"] for item in report["updated"][:3]]
            suffix = "..." if len(report["updated"]) > 3 else ""
            message = f"chore(trilium): sync {len(report['updated'])} post(s) - {', '.join(titles)}{suffix}"
        else:
            message = "chore(trilium): sync generated content"
        ok, output = git_commit_and_push(message)
        report["gitPushed"] = ok
        report["gitMessage"] = message
        report["gitOutput"] = output[-2000:]
    else:
        report["gitPushed"] = False
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
