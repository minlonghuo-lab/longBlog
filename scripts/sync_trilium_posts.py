#!/usr/bin/env python3
import os
import re
import json
import requests
from datetime import datetime

BASE_URL = os.environ.get("TRILIUM_BASE_URL", "https://blog.ssaw.top").rstrip("/")
TOKEN = os.environ.get("TRILIUM_ETAPI_TOKEN", "")
ROOT_NOTE_ID = os.environ.get("TRILIUM_BLOG_ROOT_NOTE_ID", "zB8WioyKlvOw")
OUT_TS = "/var/minis/workspace/longBlog/src/data/trilium-posts.generated.ts"

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

def norm_content_links(html: str) -> str:
    # src/href="api/attachments/..." -> full URL
    html = re.sub(r'([\"\'\(])/?api/attachments/', rf'\1{BASE_URL}/api/attachments/', html)
    return html

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
    html = norm_content_links(html)

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

# newest first by updatedAt
posts.sort(key=lambda x: x.get("updatedAt", ""), reverse=True)

content = "// Auto-generated from Trilium ETAPI\n"
content += "export interface TriliumPostRecord {\n"
content += "  id: string; slug: string; title: string; createdAt: string; updatedAt: string; tags: string[]; summary: string; contentHtml: string; pinned?: boolean;\n}\n\n"
content += "export const triliumPosts: TriliumPostRecord[] = " + json.dumps(posts, ensure_ascii=False, indent=2) + ";\n"

with open(OUT_TS, "w", encoding="utf-8") as f:
    f.write(content)

print(f"generated {OUT_TS}, posts={len(posts)}")
