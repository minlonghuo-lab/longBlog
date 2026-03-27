#!/usr/bin/env python3
import os
import re
import json
import hashlib
import mimetypes
import requests

BASE_URL = os.environ.get("TRILIUM_BASE_URL", "https://blog.ssaw.top").rstrip("/")
TOKEN = os.environ.get("TRILIUM_ETAPI_TOKEN", "")
ROOT_NOTE_ID = os.environ.get("TRILIUM_BLOG_ROOT_NOTE_ID", "zB8WioyKlvOw")
BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT_TS = os.path.join(BASE_DIR, "src", "data", "trilium-posts.generated.ts")
ASSET_DIR = os.path.join(BASE_DIR, "public", "trilium-assets")

if not TOKEN:
    raise SystemExit("TRILIUM_ETAPI_TOKEN not set")

headers = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}


def get_json(path: str):
    r = requests.get(f"{BASE_URL}{path}", headers=headers, timeout=30)
    r.raise_for_status()
    return r.json()


def get_text(path: str):
    r = requests.get(f"{BASE_URL}{path}", headers=headers, timeout=30)
    r.raise_for_status()
    return r.text


def slugify(title: str, note_id: str) -> str:
    t = title.strip().lower()
    t = re.sub(r"\s+", "-", t)
    t = re.sub(r"[^\w\-\u4e00-\u9fff]", "", t)
    t = t.strip("-")
    if not t:
        t = "post"
    return f"{t}-{note_id[:6]}"


def label_map(attrs):
    m = {}
    for a in attrs or []:
        if a.get("type") == "label":
            m[a.get("name", "")] = a.get("value", "")
    return m


def ensure_dir(path: str):
    os.makedirs(path, exist_ok=True)


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


def download_attachment_by_etapi(attachment_id: str):
    if not attachment_id:
        return None, None
    try:
        meta = get_json(f"/etapi/attachments/{attachment_id}")
        r = requests.get(
            f"{BASE_URL}/etapi/attachments/{attachment_id}/content",
            headers={"Authorization": f"Bearer {TOKEN}"},
            timeout=60,
        )
        if not r.ok:
            return None, None
        content_type = r.headers.get("content-type", meta.get("mime", ""))
        return r.content, content_type
    except Exception:
        return None, None


def localize_attachments(html: str, note_id: str):
    pattern = re.compile(r'(https?://[^\"\'\)\s]*/api/attachments/[^\"\'\)\s]+|/api/attachments/[^\"\'\)\s]+|api/attachments/[^\"\'\)\s]+)')
    urls = sorted(set(pattern.findall(html)))
    if not urls:
        return html

    note_dir = os.path.join(ASSET_DIR, note_id)
    ensure_dir(note_dir)

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

        with open(fpath, "wb") as f:
            f.write(content)

        local_url = f"/trilium-assets/{note_id}/{fname}"
        html = html.replace(raw, local_url)
        html = html.replace(abs_url, local_url)

    return html


root = get_json(f"/etapi/notes/{ROOT_NOTE_ID}")
child_ids = root.get("childNoteIds", [])
posts = []

for nid in child_ids:
    note = get_json(f"/etapi/notes/{nid}")
    if note.get("type") != "text":
        continue

    labels = label_map(note.get("attributes", []))
    if str(labels.get("publish", "")).lower() != "true":
        continue

    title = note.get("title", "未命名")
    tags_raw = labels.get("tags", "")
    tags = [x.strip() for x in re.split(r"[,，]", tags_raw) if x.strip()]
    summary = labels.get("summary", "").strip()

    html = get_text(f"/etapi/notes/{nid}/content")
    html = localize_attachments(html, nid)

    posts.append({
        "id": nid,
        "slug": slugify(title, nid),
        "title": title,
        "createdAt": note.get("dateCreated") or note.get("utcDateCreated"),
        "updatedAt": note.get("dateModified") or note.get("utcDateModified"),
        "tags": tags,
        "summary": summary,
        "contentHtml": html,
        "pinned": str(labels.get("pinned", "")).lower() == "true",
    })

posts.sort(key=lambda x: x.get("updatedAt", ""), reverse=True)

content = "// Auto-generated from Trilium ETAPI\n"
content += "export interface TriliumPostRecord {\n"
content += "  id: string; slug: string; title: string; createdAt: string; updatedAt: string; tags: string[]; summary: string; contentHtml: string; pinned?: boolean;\n}\n\n"
content += "export const triliumPosts: TriliumPostRecord[] = " + json.dumps(posts, ensure_ascii=False, indent=2) + ";\n"

with open(OUT_TS, "w", encoding="utf-8") as f:
    f.write(content)

print(f"generated {OUT_TS}, posts={len(posts)}")
