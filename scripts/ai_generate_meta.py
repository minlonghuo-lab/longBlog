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
    parser.add_argument('--mode', choices=['summary_tags', 'tags_only'], default='summary_tags')
    args = parser.parse_args()

    if not API_KEY:
        raise SystemExit('DEEPSEEK_API_KEY not set')

    payload = json.load(sys.stdin)
    existing_tags = [str(x).strip() for x in (payload.get('tags') or []) if str(x).strip()]
    existing_summary = str(payload.get('summary') or '').strip()

    if args.mode == 'tags_only':
        system_prompt = (
            '你是中文技术博客标签补全助手。请根据文章标题、正文、已有标签，补充更具体且不重复的标签。\n'
            '要求：\n'
            '1. 优先复用已有合适标签，不要无意义改写。\n'
            '2. 仅补充缺失的细分标签，避免输出与已有标签同义或重复的标签。\n'
            '3. 最终返回 3-8 个标签，总结果需包含原本合理标签 + 新增标签。\n'
            '4. 只输出 JSON，对象格式为 {"tags": string[]}。\n'
            '5. 不要输出 Markdown，不要解释。'
        )
    else:
        system_prompt = (
            '你是中文技术博客元数据助手。请根据文章标题、正文、已有标签与已有摘要，输出更完整的 summary、tags。\n'
            '要求：\n'
            '1. summary：仅在现有摘要缺失或明显不足时重写；若现有摘要已经合适，可沿用或轻微润色。长度 50-120 字。\n'
            '2. tags：必须保留已有合适标签，并在此基础上增量补充 0-3 个更具体标签。避免“技术/博客/记录/分享”等泛词。\n'
            '3. 不要删除明显合理的已有标签，除非它明显错误。\n'
            '4. 只输出 JSON，对象格式为 {"summary": string, "tags": string[]}。\n'
            '5. 不要输出 Markdown，不要解释。'
        )

    user_prompt = {
        'title': payload.get('title', ''),
        'content': payload.get('content', '')[:12000],
        'existing_tags': existing_tags,
        'existing_summary': existing_summary,
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

    if args.mode == 'tags_only':
        result = {
            'tags': merged_tags,
        }
    else:
        summary = str(parsed.get('summary', '')).strip() or existing_summary
        result = {
            'summary': summary,
            'tags': merged_tags,
        }
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
