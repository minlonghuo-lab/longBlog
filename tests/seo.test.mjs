import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { createArticleSchema, serializeJsonLd } from '../src/lib/seo.js';

test('every article has valid, escaped JSON-LD matching its visible content and canonical URL', async () => {
  const manifest = JSON.parse(await readFile(new URL('../dist/pagefind/pagefind-entry.json', import.meta.url)));
  const { readdir } = await import('node:fs/promises');
  const entries = await readdir(new URL('../dist/blog/', import.meta.url), { withFileTypes: true });
  const articles = entries.filter(entry => entry.isDirectory());
  assert.equal(manifest.languages['zh-cn'].page_count, articles.length);
  for (const entry of articles) {
    const dom = new JSDOM(await readFile(new URL(`../dist/blog/${entry.name}/index.html`, import.meta.url), 'utf8'));
    const doc = dom.window.document;
    const blocks = doc.querySelectorAll('script[type="application/ld+json"]');
    assert.equal(blocks.length, 1);
    const data = JSON.parse(blocks[0].textContent);
    const canonical = `https://huowenlong.com/blog/${entry.name}/`;
    assert.equal(data['@type'], 'BlogPosting');
    assert.equal(data.headline, doc.querySelector('h1').textContent);
    assert.equal(data.description, doc.querySelector('meta[name="description"]').content);
    assert.equal(data.url, canonical);
    assert.equal(data.mainEntityOfPage['@id'], canonical);
    assert.equal(doc.querySelector('link[rel="canonical"]').href, canonical);
    assert.equal(data.datePublished, doc.querySelector('time').dateTime);
    assert.equal(data.dateModified, doc.querySelectorAll('time')[1].dateTime);
    assert.ok(data.author.name);
    assert.equal(data.author.url, 'https://huowenlong.com/about/');
    if (data.image) assert.ok(data.image.every(url => /^https?:\/\//.test(url)));
    dom.window.close();
  }
});

test('JSON-LD cannot be broken out of by article text; missing or invalid images are omitted', () => {
  const post = { id: 'Test', title: '</script><script>alert(1)</script>', summary: 'a\u2028b\u2029', publishedAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-02'), tags: [], contentHtml: '' };
  for (const html of ['', '<img src="javascript:alert(1)">', '<img src="http://[invalid">']) {
    const data = createArticleSchema({ ...post, contentHtml: html }, 'https://huowenlong.com/', 'Author', 'longBlog');
    assert.equal('image' in data, false);
    const json = serializeJsonLd(data);
    assert.equal(json.includes('<'), false);
    assert.deepEqual(JSON.parse(json), data);
    const dom = new JSDOM(`<script type="application/ld+json">${json}</script>`);
    assert.equal(dom.window.document.scripts.length, 1);
    dom.window.close();
  }
});
