import re, os, requests
from urllib.parse import urljoin

sites = {
    'minis': 'https://apps.apple.com/cn/app/open-minis/id6759188481',
    'webteleporter': 'https://webteleporter.top',
    'lusyoe': 'https://blog.lusyoe.com',
    'nkblog': 'https://nkblog.top',
    'sitrmoo': 'https://blog.sitrmoo.com',
}
outdir='/var/minis/workspace/longBlog/public/friend-icons'
os.makedirs(outdir, exist_ok=True)
headers={'User-Agent':'Mozilla/5.0'}

for key,url in sites.items():
    print('SITE', key, url)
    r = requests.get(url, headers=headers, timeout=20)
    r.raise_for_status()
    html = r.text
    links = re.findall(r'<link[^>]+rel=["\']([^"\']+)["\'][^>]+href=["\']([^"\']+)["\']', html, re.I)
    candidates=[]
    for rel, href in links:
        rel_l=rel.lower()
        if 'icon' in rel_l or 'apple-touch-icon' in rel_l or 'shortcut icon' in rel_l:
            candidates.append(urljoin(r.url, href))
    candidates += [urljoin(r.url, '/favicon.ico')]
    seen=[]
    for c in candidates:
        if c not in seen:
            seen.append(c)
    ok=False
    for c in seen:
        try:
            rr=requests.get(c, headers=headers, timeout=20)
            ct=rr.headers.get('content-type','')
            if rr.ok and rr.content and ('image' in ct or c.endswith(('.ico','.png','.svg','.jpg','.jpeg','.webp'))):
                if 'svg' in ct or c.endswith('.svg'):
                    ext = '.svg'
                elif 'png' in ct or c.endswith('.png'):
                    ext = '.png'
                elif 'icon' in ct or c.endswith('.ico'):
                    ext = '.ico'
                else:
                    ext = '.img'
                path=os.path.join(outdir, key+ext)
                with open(path,'wb') as f:
                    f.write(rr.content)
                print('SAVED', path, c, ct, len(rr.content))
                ok=True
                break
        except Exception as e:
            print('FAIL', c, e)
    if not ok:
        print('FAILED', key)
