import json, subprocess, sys


def extract_json_block(text: str):
    text = (text or '').strip()
    start = text.find('{')
    end = text.rfind('}')
    if start == -1 or end == -1 or end <= start:
        raise ValueError('No JSON object found in model output')
    return json.loads(text[start:end + 1])


def main():
    payload = json.load(sys.stdin)
    system_prompt = (
        '你是中文技术博客元数据助手。请根据文章标题与正文，生成 summary、tags、slug。'
        '要求：\n'
        '1. summary：50-120字，中文自然，不要使用“本文介绍了/通过本文你可以”等模板句。\n'
        '2. tags：返回3-6个具体标签，避免“技术/博客/记录/分享”等泛词。\n'
        '3. slug：尽量可读、稳定、简短；可保留中文；空格改连字符；去特殊字符。\n'
        '4. 只输出 JSON，对象格式为 {"summary": string, "tags": string[], "slug": string}。\n'
        '5. 不要输出 Markdown，不要解释。'
    )
    user_prompt = {
        'title': payload.get('title', ''),
        'content': payload.get('content', '')[:12000],
        'existing_slug': payload.get('slug', ''),
        'existing_tags': payload.get('tags', []),
        'existing_summary': payload.get('summary', '')
    }
    req = {
        'messages': [
            {'role': 'system', 'content': system_prompt},
            {'role': 'user', 'content': json.dumps(user_prompt, ensure_ascii=False)}
        ],
        'temperature': 0.2,
        'max_tokens': 800
    }
    res = subprocess.run(
        ['minis-model-use', 'run', '--model', 'MiniMax-M2.7'],
        input=json.dumps(req, ensure_ascii=False),
        capture_output=True,
        text=True,
        timeout=180
    )
    if res.returncode != 0:
        raise SystemExit('AI meta generation failed')
    data = extract_json_block(res.stdout or '')
    result = {
        'summary': str(data.get('summary', '')).strip(),
        'tags': [str(x).strip() for x in (data.get('tags') or []) if str(x).strip()],
        'slug': str(data.get('slug', '')).strip(),
    }
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
