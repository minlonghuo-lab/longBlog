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


def main():
    if not API_KEY:
        raise SystemExit('DEEPSEEK_API_KEY not set')

    payload = json.load(sys.stdin)
    system_prompt = (
        '你是中文技术博客元数据助手。请根据文章标题与正文，生成 summary、tags。'
        '要求：\n'
        '1. summary：50-120字，中文自然，不要使用“本文介绍了/通过本文你可以”等模板句。\n'
        '2. tags：返回3-6个具体标签，避免“技术/博客/记录/分享”等泛词。\n'
        '3. 只输出 JSON，对象格式为 {"summary": string, "tags": string[]}。\n'
        '4. 不要输出 Markdown，不要解释。'
    )
    user_prompt = {
        'title': payload.get('title', ''),
        'content': payload.get('content', '')[:12000],
        'existing_tags': payload.get('tags', []),
        'existing_summary': payload.get('summary', '')
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
    result = {
        'summary': str(parsed.get('summary', '')).strip(),
        'tags': [str(x).strip() for x in (parsed.get('tags') or []) if str(x).strip()],
    }
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
