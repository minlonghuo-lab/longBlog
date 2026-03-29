#!/usr/bin/env python3
import os
import re
import json
import hashlib
import mimetypes
import subprocess
import tempfile
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
    r = requests.request(
        method,
        f"{BASE_URL}{path}",
        headers=HEADERS_JSON,
        json=json_data,
        params=params,
        timeout=timeout,
    )
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


def slugify(title: str, note_id: str) -> str:
    t = (title or "").strip().lower()
    t = re.sub(r"\s+", "-", t)
    t = re.sub(r"[^\w\-\u4e00-\u9fff]", "", t)
    t = re.sub(r"-+", "-", t).strip("-")
    if not t:
        t = "post"
    return f"{t}-{note_id[:6]}"


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
    for a in attrs or []:
        if a.get("type") == "label" and a.get("name") == name:
            patch_json(f"/etapi/attributes/{a['attributeId']}", {"value": value})
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
        r = requests.get(
            f"{BASE_URL}/etapi/attachments/{attachment_id}/content",
            headers=HEADERS_AUTH,
            timeout=60,
        )
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

        existing = None
        if os.path.exists(fpath):
            with open(fpath, "rb") as f:
                existing = f.read()
        if existing != content:
            with open(fpath, "wb") as f:
                f.write(content)
            changed = True

        if raw != local_url:
            new_html = html.replace(raw, local_url).replace(abs_url, local_url)
            if new_html != html:
                changed = True
                html = new_html

    return html, sorted(set(local_assets)), changed


def compute_sync_hash(*, title: str, content_html: str, attachments: List[str], slug: str, summary: str, tags: List[str]) -> str:
    payload = {
        "title": normalize_whitespace(title),
        "contentHtml": normalize_whitespace(content_html),
        "attachments": sorted(attachments),
        "slug": normalize_whitespace(slug),
        "summary": normalize_whitespace(summary),
        "tags": sorted([normalize_whitespace(t) for t in tags if normalize_whitespace(t)]),
    }
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()


def generate_ai_meta(title: str, content_html: str, slug: str, tags: List[str], summary: str) -> dict:
    plain = re.sub(r"<[^>]+>", " ", content_html or "")
    plain = normalize_whitespace(plain)
    payload = {
        "title": title,
        "content": plain[:12000],
        "slug": slug,
        "tags": tags,
        "summary": summary,
    }
    with tempfile.NamedTemporaryFile("w", delete=False, suffix=".json", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)
        input_path = f.name
    try:
        res = subprocess.run(
            ["python3", os.path.join(BASE_DIR, "scripts", "ai_generate_meta.py"), input_path],
            capture_output=True,
            text=True,
            timeout=240,
        )
        if res.returncode != 0:
            raise RuntimeError((res.stderr or res.stdout).strip() or "AI meta generation failed")
        data = json.loads((res.stdout or "").strip())
        return {
            "summary": normalize_whitespace(data.get("summary", "")),
            "tags": [normalize_whitespace(x) for x in (data.get("tags") or []) if normalize_whitespace(x)],
            "slug": normalize_whitespace(data.get("slug", "")),
        }
    finally:
        try:
            os.unlink(input_path)
        except OSError:
            pass


def build_post_record(note: dict) -> Tuple[dict, dict, List[dict]]:
    attrs = note.get("attributes", []) or []
    attr_map = label_attrs(attrs)
    title = note.get("title", "未命名")
    existing_slug = first_label_value(attr_map, "slug", "").strip()
    slug = existing_slug or slugify(title, note["noteId"])
    tags_raw = first_label_value(attr_map, "tags", "")
    tags = [x.strip() for x in re.split(r"[,，]", tags_raw) if x.strip()]
    summary = first_label_value(attr_map, "summary", "").strip()
    html_raw = get_text(f"/etapi/notes/{note['noteId']}/content")
    html_localized, local_assets, assets_changed = localize_attachments(html_raw, note["noteId"])

    ai_refresh = first_label_value(attr_map, "aiRefresh", "false").lower() == "true"
    needs_ai = ai_refresh or not existing_slug or not tags or not summary
    ai_generated = False
    if needs_ai:
        ai_meta = generate_ai_meta(title, html_localized, slug, tags, summary)
        if (ai_refresh or not summary) and ai_meta.get("summary"):
            summary = ai_meta["summary"]
            ai_generated = True
        if (ai_refresh or not tags) and ai_meta.get("tags"):
            tags = ai_meta["tags"]
            ai_generated = True
        if (ai_refresh or not existing_slug) and ai_meta.get("slug"):
            slug = ai_meta["slug"]
            ai_generated = True
        if not slug:
            slug = slugify(title, note["noteId"])

    sync_hash = compute_sync_hash(
        title=title,
        content_html=html_localized,
        attachments=local_assets,
        slug=slug,
        summary=summary,
        tags=tags,
    )
    post = {
        "id": note["noteId"],
        "slug": slug,
        "title": title,
        "createdAt": note.get("dateCreated") or note.get("utcDateCreated") or now_str(),
        "updatedAt": note.get("dateModified") or note.get("utcDateModified") or now_str(),
        "tags": tags,
        "summary": summary,
        "contentHtml": html_localized,
        "pinned": first_label_value(attr_map, "pinned", "").lower() == "true",
        "syncHash": sync_hash,
        "syncStatus": first_label_value(attr_map, "syncStatus", ""),
        "publishedAt": first_label_value(attr_map, "publishedAt", ""),
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


def git_has_changes() -> bool:
    r = subprocess.run(
        ["git", "status", "--porcelain", "src/data/trilium-posts.generated.ts", "public/trilium-assets"],
        cwd=BASE_DIR,
        capture_output=True,
        text=True,
    )
    return bool(r.stdout.strip())


def git_commit_and_push(message: str) -> Tuple[bool, str]:
    add_cmd = ["git", "add", "src/data/trilium-posts.generated.ts", "public/trilium-assets"]
    add_res = subprocess.run(add_cmd, cwd=BASE_DIR, capture_output=True, text=True)
    if add_res.returncode != 0:
        return False, (add_res.stderr or add_res.stdout).strip()

    commit_res = subprocess.run(
        ["git", "commit", "-m", message],
        cwd=BASE_DIR,
        capture_output=True,
        text=True,
    )
    commit_text = (commit_res.stdout or "") + (commit_res.stderr or "")
    if commit_res.returncode != 0:
        if "nothing to commit" in commit_text.lower():
            return True, "nothing to commit"
        return False, commit_text.strip()

    push_cmd = ["sh", "/var/minis/skills/github-sync-helper/scripts/gh_sync.sh", "push-main", "--yes"]
    push_res = subprocess.run(push_cmd, cwd=BASE_DIR, capture_output=True, text=True)
    push_text = (push_res.stdout or "") + (push_res.stderr or "")
    if push_res.returncode != 0:
        return False, push_text.strip()
    return True, (commit_text + "\n" + push_text).strip()


def main():
    root = get_json(f"/etapi/notes/{ROOT_NOTE_ID}")
    all_notes = walk_note_tree(ROOT_NOTE_ID)
    candidates = []
    report = {"rootTitle": root.get("title", ""), "scanned": 0, "publishedCandidates": 0, "updated": [], "unchanged": [], "failed": []}

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
        if first_label_value(attr_map, "publish", "false").lower() != "true":
            continue

        candidates.append(note)

    posts: List[dict] = []
    for note in candidates:
        report["publishedCandidates"] += 1
        attrs = note.get("attributes", []) or []
        try:
            set_label(note["noteId"], attrs, "syncStatus", "publishing")
            post, meta, attrs = build_post_record(note)
            needs_publish = (
                not meta["prevSyncHash"]
                or meta["prevSyncHash"] != meta["computedSyncHash"]
                or meta["aiRefresh"]
            )

            if not post["publishedAt"]:
                post["publishedAt"] = first_label_value(label_attrs(attrs), "publishedAt", "")

            if needs_publish:
                ts = now_str()
                if meta["aiGenerated"]:
                    set_label(note["noteId"], attrs, "summary", post["summary"])
                    set_label(note["noteId"], attrs, "tags", ",".join(post["tags"]))
                    set_label(note["noteId"], attrs, "slug", post["slug"])
                if not post["publishedAt"]:
                    post["publishedAt"] = ts
                    set_label(note["noteId"], attrs, "publishedAt", ts)
                set_label(note["noteId"], attrs, "syncHash", meta["computedSyncHash"])
                set_label(note["noteId"], attrs, "updatedAt", ts)
                set_label(note["noteId"], attrs, "syncStatus", "published")
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
