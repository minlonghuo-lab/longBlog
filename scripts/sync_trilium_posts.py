#!/usr/bin/env python3
import os
import re
import json
import hashlib
import mimetypes
import subprocess
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Optional, Tuple

import requests

BASE_URL = os.environ.get("TRILIUM_BASE_URL", "https://blog.ssaw.top").rstrip("/")
TOKEN = os.environ.get("TRILIUM_ETAPI_TOKEN", "")
ROOT_NOTE_ID = os.environ.get("TRILIUM_BLOG_ROOT_NOTE_ID", "zB8WioyKlvOw")
BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT_TS = os.path.join(BASE_DIR, "src", "data", "trilium-posts.generated.ts")
ASSET_DIR = os.path.join(BASE_DIR, "public", "trilium-assets")
AUTO_PUSH = os.environ.get("LONGBLOG_AUTO_PUSH", "false").lower() == "true"
GIT_REMOTE = os.environ.get("LONGBLOG_GIT_REMOTE", "origin")
GIT_BRANCH = os.environ.get("LONGBLOG_GIT_BRANCH", "main")

if not TOKEN:
    raise SystemExit("TRILIUM_ETAPI_TOKEN not set")

HEADERS_JSON = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}
HEADERS_AUTH = {"Authorization": f"Bearer {TOKEN}"}
SKIP_KEYWORDS = ("template", "模板", "logo", "素材", "draft-template", "index-template")
TZ_UTC8 = timezone(timedelta(hours=8))


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


def ensure_unique_slug(base_slug: str, note_id: str, used_slugs: set) -> str:
    slug = base_slug or "post"
    if slug not in used_slugs:
        used_slugs.add(slug)
        return slug
    suffix = note_id[:6].lower()
    candidate = f"{slug}-{suffix}"
    if candidate not in used_slugs:
        used_slugs.add(candidate)
        return candidate
    index = 2
    while True:
        candidate = f"{slug}-{suffix}-{index}"
        if candidate not in used_slugs:
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


def first_label_value(attr_map: Dict[str, List[dict]], name: str, default: str = "") -> str:
    items = attr_map.get(name) or []
    if not items:
        return default
    return str(items[0].get("value") or default)


def set_label(note_id: str, attrs: List[dict], name: str, value: str):
    value = normalize_label_value(value)
    live_attrs = (get_json(f"/etapi/notes/{note_id}").get("attributes", []) or [])
    matches = [a for a in live_attrs if a.get("type") == "label" and a.get("name") == name]
    if matches:
        primary = matches[0]
        patch_json(f"/etapi/attributes/{primary['attributeId']}", {"value": value})
        for extra in matches[1:]:
            try:
                delete_path(f"/etapi/attributes/{extra['attributeId']}")
            except Exception:
                pass
        return
    post_json("/etapi/attributes", {"noteId": note_id, "type": "label", "name": name, "value": value})


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


def build_post_record(note: dict, used_slugs: set) -> Tuple[dict, dict, List[dict]]:
    note_id = note["noteId"]
    attrs = note.get("attributes", []) or []
    attr_map = label_attrs(attrs)
    title = (note.get("title") or "未命名").strip()
    html = get_text(f"/etapi/notes/{note_id}/content")
    html_localized, local_assets, assets_changed = localize_attachments(html, note_id)
    explicit_slug = first_label_value(attr_map, "slug", "").strip()
    base_slug = explicit_slug or slugify(title)
    slug = ensure_unique_slug(base_slug, note_id, used_slugs)
    ai_refresh = first_label_value(attr_map, "aiRefresh", "false").lower() == "true"
    summary = first_label_value(attr_map, "summary", "").strip()
    tags = parse_tags(attr_map)
    ai_generated = False
    if ai_refresh or not summary or not tags:
        try:
            output = subprocess.check_output(["python3", os.path.join(BASE_DIR, "scripts", "ai_generate_meta.py"), note_id], text=True)
            meta = json.loads(output)
            summary = meta.get("summary", summary).strip()
            tags = meta.get("tags", tags)
            if meta.get("slug"):
                slug = ensure_unique_slug(meta["slug"], note_id, used_slugs)
            ai_generated = True
        except Exception:
            pass
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
        "updatedAt": first_label_value(attr_map, "updatedAt", "").strip() or note.get("dateModified") or note.get("utcDateModified") or now_str(),
        "publishedAt": first_label_value(attr_map, "publishedAt", "").strip(),
        "tags": tags,
        "summary": summary,
        "contentHtml": html_localized,
        "pinned": first_label_value(attr_map, "pinned", "").lower() == "true",
        "syncHash": sync_hash,
        "syncStatus": first_label_value(attr_map, "syncStatus", ""),
    }
    meta = {
        "attrs": attrs,
        "labels": attr_map,
        "assetsChanged": assets_changed,
        "localAssets": local_assets,
        "computedSyncHash": sync_hash,
        "prevSyncHash": first_label_value(attr_map, "syncHash", ""),
        "aiRefresh": ai_refresh,
        "aiGenerated": ai_generated,
        "syncRequested": first_label_value(attr_map, "sync", "false").lower() == "true",
    }
    return post, meta, attrs


def write_generated(posts: List[dict]):
    posts = sorted(posts, key=lambda x: x.get("createdAt", ""), reverse=True)
    content = "// Auto-generated from Trilium ETAPI\n"
    content += "export interface TriliumPostRecord {\n"
    content += "  id: string; slug: string; title: string; createdAt: string; updatedAt: string; tags: string[]; summary: string; contentHtml: string; pinned?: boolean; syncHash?: string; syncStatus?: string; publishedAt?: string;\n"
    content += "}\n\n"
    content += "export const triliumPosts: TriliumPostRecord[] = " + json.dumps(posts, ensure_ascii=False, indent=2) + ";\n"
    with open(OUT_TS, "w", encoding="utf-8") as f:
        f.write(content)


def cleanup_removed_assets(note_ids: List[str]) -> List[str]:
    removed_dirs = []
    for note_id in note_ids:
        path = os.path.join(ASSET_DIR, note_id)
        if os.path.isdir(path):
            subprocess.run(["rm", "-rf", path], check=False)
            removed_dirs.append(note_id)
    return removed_dirs


def git_has_changes() -> bool:
    r = subprocess.run(["git", "status", "--porcelain", "src/data/trilium-posts.generated.ts", "public/trilium-assets"], cwd=BASE_DIR, capture_output=True, text=True)
    return bool(r.stdout.strip())


def git_commit_and_push(message: str) -> Tuple[bool, str]:
    add_res = subprocess.run(["git", "add", "src/data/trilium-posts.generated.ts", "public/trilium-assets"], cwd=BASE_DIR, capture_output=True, text=True)
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


def main():
    root = get_json(f"/etapi/notes/{ROOT_NOTE_ID}")
    all_notes = walk_note_tree(ROOT_NOTE_ID)
    candidates = []
    report = {"rootTitle": root.get("title", ""), "scanned": 0, "publishedCandidates": 0, "updated": [], "unchanged": [], "failed": [], "aiUpdated": [], "removed": [], "removedAssets": []}

    for note in all_notes:
        report["scanned"] += 1
        if note.get("noteId") == ROOT_NOTE_ID:
            continue
        if note.get("type") != "text":
            continue
        if should_skip_note(note):
            continue
        attrs = note.get("attributes", []) or []
        attr_map = label_attrs(attrs)
        publish_value = first_label_value(attr_map, "publish", "false").lower()
        if publish_value != "true":
            if first_label_value(attr_map, "syncStatus", "") == "published":
                try:
                    set_label(note["noteId"], attrs, "syncStatus", "removed")
                    set_label(note["noteId"], attrs, "sync", "false")
                    report["removed"].append({"id": note["noteId"], "title": note.get("title", "未命名")})
                except Exception as e:
                    report["failed"].append({"id": note.get("noteId"), "title": note.get("title"), "error": str(e)[:300]})
            continue
        candidates.append(note)

    posts: List[dict] = []
    used_slugs = set()
    for note in candidates:
        report["publishedCandidates"] += 1
        attrs = note.get("attributes", []) or []
        try:
            post, meta, attrs = build_post_record(note, used_slugs)
            first_publish = not post["publishedAt"]
            needs_publish = first_publish or meta["syncRequested"] or meta["aiRefresh"]
            if needs_publish:
                set_label(note["noteId"], attrs, "syncStatus", "publishing")
                ts = now_str()
                set_label(note["noteId"], attrs, "slug", post["slug"])
                if meta["aiGenerated"]:
                    set_label(note["noteId"], attrs, "summary", post["summary"])
                    set_label(note["noteId"], attrs, "tags", ",".join(post["tags"]))
                    report["aiUpdated"].append({"id": note["noteId"], "title": post["title"]})
                if not post["publishedAt"]:
                    post["publishedAt"] = ts
                    set_label(note["noteId"], attrs, "publishedAt", ts)
                set_label(note["noteId"], attrs, "syncHash", meta["computedSyncHash"])
                set_label(note["noteId"], attrs, "updatedAt", ts)
                set_label(note["noteId"], attrs, "syncStatus", "published")
                set_label(note["noteId"], attrs, "sync", "false")
                if meta["aiRefresh"]:
                    set_label(note["noteId"], attrs, "aiRefresh", "false")
                post["syncStatus"] = "published"
                report["updated"].append({"id": note["noteId"], "title": post["title"]})
            else:
                set_label(note["noteId"], attrs, "syncStatus", "published")
                post["syncStatus"] = "published"
                report["unchanged"].append({"id": note["noteId"], "title": post["title"]})
            posts.append(post)
        except Exception as e:
            try:
                set_label(note["noteId"], attrs, "syncStatus", "error")
            except Exception:
                pass
            report["failed"].append({"id": note.get("noteId"), "title": note.get("title"), "error": str(e)[:300]})

    removed_asset_ids = cleanup_removed_assets([item["id"] for item in report["removed"]])
    report["removedAssets"] = removed_asset_ids
    write_generated(posts)
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
