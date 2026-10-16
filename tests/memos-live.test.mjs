import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { initMemosPage } from '../src/scripts/memos.js';

const html = await readFile(new URL('../dist/shuoshuo/index.html', import.meta.url), 'utf8');
let sequence = 0;
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve)); };
const memo = id => ({ id, content: `Memo ${id}`, createdTs: id, displayTs: id,
  updatedTs: id, visibility: 'PUBLIC', rowStatus: 'NORMAL', resourceList: [] });

async function setup({ count = 25, legacy = false } = {}) {
  const dom = new JSDOM(html, { url: 'https://longblog.test/shuoshuo/', pretendToBeVisual: true });
  const { window } = dom;
  window.document.querySelector('.memos-wrap').dataset.memosApiBase = `https://memos-${++sequence}.test`;
  Object.assign(globalThis, { window, document: window.document, HTMLElement: window.HTMLElement,
    AbortController: window.AbortController, sessionStorage: window.sessionStorage });
  const state = { rows: Array.from({ length: count }, (_, i) => memo(count - i)),
    requests: [], timers: new Map(), observers: [], fail: false, hold: false, waiting: [], scrolls: [] };
  let timerId = 0;
  window.setTimeout = (callback, delay) => { state.timers.set(++timerId, { callback, delay }); return timerId; };
  window.clearTimeout = id => state.timers.delete(id);
  window.scrollBy = options => state.scrolls.push(options);
  globalThis.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; this.connected = false; state.observers.push(this); }
    observe() { this.connected = true; }
    disconnect() { this.connected = false; }
    intersect() { if (this.connected) this.callback([{ isIntersecting: true }]); }
  };
  globalThis.fetch = (input, options) => new Promise((resolve, reject) => {
    const url = new URL(input);
    state.requests.push({ url, ...options });
    const respond = () => {
      if (options.signal.aborted) { reject(new window.DOMException('aborted', 'AbortError')); return; }
      if (state.fail) { reject(new TypeError('Offline')); return; }
      let data;
      if (legacy && url.pathname === '/api/v1/memo') data = {};
      else {
        const offset = Number(url.searchParams.get(legacy ? 'pageToken' : 'offset') || 0);
        const size = Number(url.searchParams.get(legacy ? 'pageSize' : 'limit'));
        const rows = state.rows.slice(offset, offset + size);
        data = legacy ? { memos: rows.map(row => ({ ...row, id: undefined, name: `memos/${row.id}` })),
          nextPageToken: offset + size < state.rows.length ? String(offset + size) : '' } : rows;
      }
      resolve({ ok: true, headers: new Headers({ 'content-type': 'application/json' }), json: async () => data });
    };
    options.signal.addEventListener('abort', () => reject(new window.DOMException('aborted', 'AbortError')), { once: true });
    if (state.hold) state.waiting.push(respond);
    else respond();
  });
  const dispose = initMemosPage();
  await settle();
  const cards = () => [...document.querySelectorAll('.memo-item')];
  const poll = async () => {
    const entry = [...state.timers].find(([, timer]) => timer.delay > 15000);
    assert.ok(entry, 'a periodic refresh should be scheduled');
    state.timers.delete(entry[0]);
    entry[1].callback();
    await settle();
  };
  const page = async () => { state.observers.at(-1).intersect(); await settle(); };
  return { state, window, cards, poll, page, close: async () => { dispose(); await settle(); dom.window.close(); } };
}

test('new posts appear during an open session without rebuilding unchanged cards', async () => {
  const ctx = await setup();
  try {
    const first = ctx.cards()[0];
    await ctx.poll();
    assert.equal(ctx.cards()[0], first);
    first.classList.remove('memo-item-enter');
    ctx.state.rows.unshift(memo(26));
    await ctx.poll();
    assert.equal(ctx.cards()[0].dataset.memoKey, '26');
    assert.ok(ctx.cards()[0].classList.contains('memo-item-enter'));
    assert.equal(ctx.cards()[1], first);
    assert.ok(!first.classList.contains('memo-item-enter'), 'unchanged cards must not animate again');
    assert.equal(new Set(ctx.cards().map(card => card.dataset.memoKey)).size, ctx.cards().length);
    assert.ok(ctx.state.requests.every(request => request.cache === 'no-store'));
  } finally { await ctx.close(); }
});

test('large bursts rebase offset paging without skipping unseen older posts', async () => {
  const ctx = await setup({ count: 80 });
  try {
    await ctx.page(); await ctx.page(); await ctx.page();
    assert.equal(ctx.cards().length, 40);
    ctx.state.rows.unshift(...Array.from({ length: 50 }, (_, i) => memo(130 - i)));
    await ctx.poll();
    assert.equal(ctx.state.requests.at(-1).url.searchParams.get('limit'), '40');
    for (let i = 0; i < 12; i++) await ctx.page();
    assert.equal(ctx.cards().length, 130);
    assert.deepEqual(ctx.cards().map(card => Number(card.dataset.memoKey)), ctx.state.rows.map(row => row.id));
  } finally { await ctx.close(); }
});

test('cursor APIs also continue from the refreshed prefix', async () => {
  const ctx = await setup({ legacy: true });
  try {
    await ctx.page();
    ctx.state.rows.unshift(...[28, 27, 26].map(memo));
    await ctx.poll();
    await ctx.page();
    assert.equal(ctx.cards().length, 28);
    assert.equal(ctx.cards()[0].dataset.memoKey, 'memos/28');
  } finally { await ctx.close(); }
});

test('a failed refresh keeps content and retries on the next poll', async () => {
  const ctx = await setup();
  try {
    const before = ctx.cards();
    ctx.state.fail = true;
    await ctx.poll();
    assert.deepEqual(ctx.cards(), before);
    assert.equal(document.querySelector('#memos-error').style.display, 'none');
    ctx.state.fail = false;
    ctx.state.rows.unshift(memo(26));
    await ctx.poll();
    assert.equal(ctx.cards()[0].dataset.memoKey, '26');
  } finally { await ctx.close(); }
});

test('hidden tabs pause, visibility/focus/network recovery refresh immediately', async () => {
  const ctx = await setup();
  try {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new ctx.window.Event('visibilitychange'));
    assert.equal(ctx.state.timers.size, 0);
    const count = ctx.state.requests.length;
    ctx.window.dispatchEvent(new ctx.window.Event('focus'));
    await settle();
    assert.equal(ctx.state.requests.length, count);
    ctx.state.rows.unshift(memo(26));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new ctx.window.Event('visibilitychange'));
    await settle();
    assert.equal(ctx.cards()[0].dataset.memoKey, '26');
    ctx.state.rows.unshift(memo(27));
    ctx.window.dispatchEvent(new ctx.window.Event('focus'));
    await settle();
    assert.equal(ctx.cards()[0].dataset.memoKey, '27');
    ctx.state.rows.unshift(memo(28));
    ctx.window.dispatchEvent(new ctx.window.Event('online'));
    await settle();
    assert.equal(ctx.cards()[0].dataset.memoKey, '28');
  } finally { await ctx.close(); }
});

test('new entries preserve the position of the card being read', async () => {
  const ctx = await setup();
  try {
    const list = document.querySelector('#memos-list');
    Object.defineProperty(ctx.window, 'scrollY', { value: 500, configurable: true });
    list.getBoundingClientRect = () => ({ top: -200 });
    const first = ctx.cards()[0];
    first.getBoundingClientRect = () => ({ top: list.firstElementChild === first ? -40 : 160, bottom: 200 });
    ctx.state.rows.unshift(memo(26));
    await ctx.poll();
    assert.deepEqual(ctx.state.scrolls, [{ top: 200, behavior: 'instant' }]);
  } finally { await ctx.close(); }
});

test('cleanup aborts late checks, clears timers and removes event listeners', async () => {
  const ctx = await setup();
  ctx.state.hold = true;
  ctx.window.dispatchEvent(new ctx.window.Event('focus'));
  await settle();
  const active = ctx.state.requests.at(-1);
  await ctx.close();
  assert.equal(active.signal.aborted, true);
  assert.equal(ctx.state.timers.size, 0);
  const count = ctx.state.requests.length;
  ctx.window.dispatchEvent(new ctx.window.Event('focus'));
  ctx.window.dispatchEvent(new ctx.window.Event('online'));
  await settle();
  assert.equal(ctx.state.requests.length, count);
});

test('a complete refresh removes deleted, private and archived entries', async () => {
  const ctx = await setup({ count: 5 });
  try {
    ctx.state.rows = ctx.state.rows.filter(row => row.id !== 5);
    ctx.state.rows[0].visibility = 'PRIVATE';
    ctx.state.rows[1].rowStatus = 'ARCHIVED';
    await ctx.poll();
    assert.deepEqual(ctx.cards().map(card => card.dataset.memoKey), ['2', '1']);
  } finally { await ctx.close(); }
});
