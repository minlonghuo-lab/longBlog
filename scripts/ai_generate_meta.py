#!/usr/bin/env python3
import argparse
import json
import os
import sys

import requests

API_BASE = os.environ.get('DEEPSEEK_API_BASE', 'https://api.deepseek.com').rstrip('/')
API_KEY = os.environ.get('DEEPSEEK_API_KEY', '')
MODEL = os.environ.get('LONGBLOG_DEEPSEEK_MODEL', 'deepseek-chat')


def extract_json_block(text: str):
    text = (text or '').strip()
    start = text.find('{')
    end = text.rfind('}')
    if start == -1 or end == -1 or end <= start:
        raise ValueError('No JSON object found in model output')
    return json.loads(text[start:end + 1])


def merge_tags(existing_tags, suggested_tags):
    merged = []
    seen = set()
    for tag in (existing_tags or []) + (suggested_tags or []):
        t = str(tag or '').strip()
        if not t:
            continue
        key = t.casefold()
        if key in seen:
            continue
        seen.add(key)
        merged.append(t)
    return merged


def main():
    parser = argparse.ArgumentParser()
    parser.parse_args()

    if not API_KEY:
        raise SystemExit('DEEPSEEK_API_KEY not set')

    payload = json.load(sys.stdin)
    existing_tags = [str(x).strip() for x in (payload.get('tags') or []) if str(x).strip()]
    existing_summary = str(payload.get('summary') or '').strip()
    max_total_tags = max(0, int(payload.get('max_total_tags') or 5))
    max_new_tags = max(0, int(payload.get('max_new_tags') or max_total_tags))
    force_summary = bool(payload.get('force_summary'))

    system_prompt = (
        '你是中文技术博客元数据助手。请根据文章标题、正文、已有标签与已有摘要，输出更完整的 summary、tags。\n'
        '要求：\n'
        '1. summary：当 force_summary=true 时，必须重新生成或明显润色摘要；否则仅在现有摘要缺失或明显不足时重写。长度 50-120 字。\n'
        '2. tags：必须保留已有合适标签，不要删除已有标签。你最多只能新增 max_new_tags 个标签，且最终 tags 总数绝不能超过 max_total_tags。\n'
        '3. 若 existing_tags 已达到 max_total_tags，则不要新增任何标签，直接保留 existing_tags。\n'
        '4. 新增标签应更具体，避免“技术/博客/记录/分享”等泛词，且不要与已有标签同义重复。\n'
        '5. 只输出 JSON，对象格式为 {"summary": string, "tags": string[]}。\n'
        '6. 不要输出 Markdown，不要解释。'
    )

    user_prompt = {
        'title': payload.get('title', ''),
        'content': payload.get('content', '')[:12000],
        'existing_tags': existing_tags,
        'existing_summary': existing_summary,
        'max_total_tags': max_total_tags,
        'max_new_tags': max_new_tags,
        'force_summary': force_summary,
    }
    req = {
        'model': MODEL,
        'messages': [
            {'role': 'system', 'content': system_prompt},
            {'role': 'user', 'content': json.dumps(user_prompt, ensure_ascii=False)}
        ],
        'temperature': 0.2,
        'max_tokens': 800,
        'stream': False,
    }
    res = requests.post(
        f'{API_BASE}/chat/completions',
        headers={
            'Authorization': f'Bearer {API_KEY}',
            'Content-Type': 'application/json',
        },
        json=req,
        timeout=180,
    )
    res.raise_for_status()
    data = res.json()
    content = (((data.get('choices') or [{}])[0].get('message') or {}).get('content') or '').strip()
    parsed = extract_json_block(content)

    model_tags = [str(x).strip() for x in (parsed.get('tags') or []) if str(x).strip()]
    merged_tags = merge_tags(existing_tags, model_tags)
    final_tags = merged_tags[:len(existing_tags)]
    remaining_slots = max(0, max_total_tags - len(final_tags))
    if remaining_slots > 0:
        final_tags.extend(merged_tags[len(existing_tags):len(existing_tags) + min(remaining_slots, max_new_tags)])
    summary = str(parsed.get('summary', '')).strip() or existing_summary
    result = {
        'summary': summary,
        'tags': final_tags[:max_total_tags],
    }
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
