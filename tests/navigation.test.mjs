import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';

// Use Astro's generated pages so selectors, SSR visibility and hydration stay in sync.
const pages = {};
for (const route of ['', 'blog', 'shuoshuo', 'friends', 'about']) {
  pages[`/${route}`] = await readFile(new URL(`../dist/${route ? route + '/' : ''}index.html`, import.meta.url), 'utf8');
}
const dom = new JSDOM(pages['/'], { url: 'https://longblog.test/', pretendToBeVisual: true });
const { window } = dom;
Object.assign(globalThis, {
  window,
  document: window.document,
  HTMLElement: window.HTMLElement,
  HTMLButtonElement: window.HTMLButtonElement,
  AbortController: window.AbortController,
  sessionStorage: window.sessionStorage,
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
});
window.scrollTo = () => {};
const observers = [];
globalThis.IntersectionObserver = class {
  constructor(callback) { this.callback = callback; this.connected = false; observers.push(this); }
  observe() { this.connected = true; }
  disconnect() { this.connected = false; }
  intersect() { if (this.connected) this.callback([{ isIntersecting: true }]); }
};
const memos = Array.from({ length: 26 }, (_, i) => ({
  name: `memos/${i}`, createTime: new Date(Date.UTC(2026, 8, 26 - i)).toISOString(),
  content: `说说 ${i}\n多行文本与图片`, visibility: 'PUBLIC', pinned: i === 0,
  attachments: [{ name: `attachments/${i}`, filename: 'image.png', type: 'image/png' }],
}));
let requests = [], pending = [];
globalThis.fetch = (input, { signal }) => new Promise((resolve, reject) => {
  // Like native fetch, an already-aborted signal must not send a new request.
  if (signal.aborted) {
    reject(new window.DOMException('aborted', 'AbortError'));
    return;
  }
  const url = new URL(input, window.location.origin);
  requests.push({ url, signal });
  const settle = () => {
    const start = Number(url.searchParams.get('pageToken') || 0);
    const size = Number(url.searchParams.get('pageSize'));
    resolve({ ok: true, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ memos: memos.slice(start, start + size), nextPageToken: start + size < memos.length ? String(start + size) : '' }) });
  };
  signal.addEventListener('abort', () => reject(new window.DOMException('aborted', 'AbortError')), { once: true });
  pending.push(settle);
});
async function settleRequests() {
  for (let i = 0; i < 8; i++) {
    pending.splice(0).forEach(resolve => resolve());
    await new Promise(resolve => setImmediate(resolve));
    if (!pending.length) break;
  }
}
function swap(path) {
  const url = new URL(path, window.location.origin);
  const next = new window.DOMParser().parseFromString(pages[url.pathname], 'text/html');
  const event = new window.Event('astro:before-swap');
  Object.defineProperty(event, 'newDocument', { value: next });
  document.dispatchEvent(event);
  document.body.replaceWith(document.adoptNode(next.body));
  window.history.replaceState({ index: 7, scrollX: 0, scrollY: 0 }, '', url);
  document.dispatchEvent(new window.Event('astro:after-swap'));
  return next;
}
const visiblePosts = () => [...document.querySelectorAll('.post-row')].filter(row => !row.hidden);
await import('../src/scripts/page-navigation.js');

test('navigation state is ready before the new snapshot, with repeatable cleanup', async (t) => {
  await t.test('article first page is paginated synchronously on every entry', () => {
    for (const via of ['/friends', '/about', '/']) {
      swap(via);
      swap('/blog');
      assert.equal(visiblePosts().length, 10);
      assert.equal(document.querySelector('#pagination').hidden, false);
      assert.ok(visiblePosts().every(row => row.style.opacity !== '0' && !row.classList.contains('is-hidden')));
    }
  });
  await t.test('page/tag query, back state and history metadata stay consistent', () => {
    swap('/blog?page=2');
    assert.equal(visiblePosts().length, document.querySelectorAll('.post-row').length - 10);
    const tag = document.querySelector('#tag-row .tag-link[data-tag]:not([data-tag=""])');
    const tagName = tag.dataset.tag;
    tag.click();
    assert.equal(new URL(window.location.href).searchParams.get('page'), null);
    assert.ok(visiblePosts().every(row => row.dataset.tags.split('|').includes(tagName)));
    assert.equal(window.history.state.index, 7);
    window.history.replaceState(window.history.state, '', '/blog?page=2');
    window.dispatchEvent(new window.PopStateEvent('popstate'));
    assert.equal(document.querySelector('.page-number.active').textContent, '2');
    swap('/friends');
    const length = window.history.length;
    window.history.replaceState(window.history.state, '', '/friends?page=99');
    window.dispatchEvent(new window.PopStateEvent('popstate'));
    assert.equal(window.history.length, length, 'detached article handlers must not change history');
  });
  await t.test('first memos load does not race the paging observer', async () => {
    swap('/shuoshuo');
    assert.equal(observers.at(-1).connected, false);
    await settleRequests();
    assert.equal(document.querySelectorAll('.memo-item').length, 10);
    assert.equal(observers.at(-1).connected, true);
    const firstCard = document.querySelector('.memo-item');
    observers.at(-1).intersect();
    await settleRequests();
    assert.equal(document.querySelectorAll('.memo-item').length, 20);
    assert.equal(document.querySelector('.memo-item'), firstCard, 'pagination must retain existing image/card nodes');
  });
  await t.test('returning restores every loaded page before any async work', () => {
    swap('/friends');
    assert.equal(observers.at(-1).connected, false);
    const count = requests.length;
    swap('/shuoshuo');
    assert.equal(document.querySelectorAll('.memo-item').length, 20);
    assert.equal(document.querySelector('#memos-loading').style.display, 'none');
    assert.equal(requests.length, count, 'fresh cache must avoid a redundant first-page request');
  });
  await t.test('paging resumes with its previous cursor', async () => {
    await settleRequests();
    observers.at(-1).intersect();
    // API version detection can complete before the actual cursor request.
    await settleRequests();
    assert.equal(requests.at(-1).url.searchParams.get('pageToken'), '20');
    assert.equal(document.querySelectorAll('.memo-item').length, 26);
  });
  await t.test('stale cache remains visible, and a late request is aborted on departure', async () => {
    const now = Date.now;
    try {
      Date.now = () => now() + 31000;
      swap('/blog');
      swap('/shuoshuo');
      assert.equal(document.querySelectorAll('.memo-item').length, 26);
      assert.equal(document.querySelector('#memos-loading').style.display, 'none');
      const activeRequest = requests.at(-1);
      swap('/friends');
      assert.equal(activeRequest.signal.aborted, true);
      const count = requests.length;
      window.dispatchEvent(new window.Event('scroll'));
      await settleRequests();
      assert.equal(requests.length, count, 'old memos scroll handler must be removed');
      swap('/shuoshuo');
      assert.equal(document.querySelectorAll('.memo-item').length, 26);
      const firstCard = document.querySelector('.memo-item');
      await settleRequests();
      assert.equal(document.querySelectorAll('.memo-item').length, 26);
      assert.equal(document.querySelector('.memo-item'), firstCard, 'unchanged refresh must retain decoded thumbnails');
    } finally { Date.now = now; }
  });
  await t.test('theme attributes are applied before the destination is swapped', () => {
    document.documentElement.dataset.theme = 'dark';
    const next = swap('/blog');
    assert.equal(next.documentElement.dataset.theme, 'dark');
    assert.equal(next.documentElement.style.colorScheme, 'dark');
  });
  swap('/');
  dom.window.close();
});
