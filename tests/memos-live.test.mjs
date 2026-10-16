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

async function setup({ count = 25, legacy = false, reducedMotion = false } = {}) {
  const dom = new JSDOM(html, { url: 'https://longblog.test/shuoshuo/', pretendToBeVisual: true });
  const { window } = dom;
  window.document.querySelector('.memos-wrap').dataset.memosApiBase = `https://memos-${++sequence}.test`;
  Object.assign(globalThis, { window, document: window.document, HTMLElement: window.HTMLElement,
    AbortController: window.AbortController, sessionStorage: window.sessionStorage });
  const state = { rows: Array.from({ length: count }, (_, i) => memo(count - i)),
    requests: [], timers: new Map(), observers: [], fail: false, hold: false, waiting: [], scrolls: [], detailErrors: {} };
  let timerId = 0;
  window.setTimeout = (callback, delay) => { state.timers.set(++timerId, { callback, delay }); return timerId; };
  window.clearTimeout = id => state.timers.delete(id);
  window.scrollBy = options => state.scrolls.push(options);
  window.matchMedia = () => ({ matches: reducedMotion });
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
      const detailId = url.pathname.match(/^\/api\/v1\/memos?\/(.+)$/)?.[1];
      if (detailId !== undefined) {
        const row = state.rows.find(row => String(row.id) === decodeURIComponent(detailId));
        const error = state.detailErrors[detailId];
        const status = error?.status || (row ? 200 : 404);
        resolve({ ok: status === 200, status,
          headers: new Headers({ 'content-type': error?.contentType || 'application/json' }),
          json: async () => row ? (legacy ? { ...row, id: undefined, name: `memos/${row.id}` } : row) : { error: 'Not found' } });
        return;
      }
      let data;
      if (state.badList || (legacy && url.pathname === '/api/v1/memo')) data = {};
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
  const finishExits = async () => {
    for (const node of document.querySelectorAll('.memo-item-exit')) {
      const event = new window.Event('animationend', { bubbles: true });
      Object.defineProperty(event, 'animationName', { value: 'memo-exit' });
      node.dispatchEvent(event);
    }
    await settle();
  };
  return { state, window, cards, poll, page, finishExits, close: async () => { dispose(); await settle(); dom.window.close(); } };
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
    assert.equal(ctx.state.requests.findLast(request => request.url.pathname === '/api/v1/memo').url.searchParams.get('limit'), '40');
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
    assert.equal(document.querySelectorAll('.memo-item-exit').length, 3);
    await ctx.finishExits();
    assert.deepEqual(ctx.cards().map(card => card.dataset.memoKey), ['2', '1']);
  } finally { await ctx.close(); }
});

test('deletion on a partial page fades in place and preserves unchanged cards', async () => {
  const ctx = await setup();
  try {
    const removed = ctx.cards()[0];
    const kept = ctx.cards()[1];
    ctx.state.rows = ctx.state.rows.filter(row => row.id !== 25);
    await ctx.poll();
    assert.ok(removed.isConnected, 'deleted card remains until its exit finishes');
    assert.equal(document.querySelector('.memo-item'), removed, 'the exit stays in its old position');
    assert.ok(removed.classList.contains('memo-item-exit'));
    assert.ok(removed.inert);
    assert.equal(document.querySelector('[data-memo-key="24"]'), kept);
    assert.ok(ctx.state.requests.some(request => request.url.pathname === '/api/v1/memo/25'));
    await ctx.finishExits();
    assert.ok(!removed.isConnected);
    assert.equal(document.querySelector('.memo-item'), kept);
    const cached = JSON.parse(ctx.window.sessionStorage.getItem([...Object.keys(ctx.window.sessionStorage)][0]));
    assert.ok(cached.data.memos.every(row => row.id !== '25'), 'deleted cards must not return from cache');
  } finally { await ctx.close(); }
});

test('cursor API deletion is confirmed through its detail route', async () => {
  const ctx = await setup({ legacy: true });
  try {
    ctx.state.rows = ctx.state.rows.filter(row => row.id !== 25);
    await ctx.poll();
    assert.ok(document.querySelector('[data-memo-key="memos/25"]').classList.contains('memo-item-exit'));
    assert.ok(ctx.state.requests.some(request => request.url.pathname === '/api/v1/memos/25'));
    await ctx.finishExits();
    assert.equal(document.querySelector('[data-memo-key="memos/25"]'), null);
  } finally { await ctx.close(); }
});

test('missing cards survive detail errors, HTML 404 pages and malformed list responses', async () => {
  const ctx = await setup();
  try {
    const old = ctx.cards().at(-1);
    ctx.state.rows.unshift(memo(26)); // pushes 16 outside the returned prefix, but it still exists.
    ctx.state.detailErrors[16] = { status: 503 };
    await ctx.poll();
    assert.ok(old.isConnected && !old.classList.contains('memo-item-exit'));
    ctx.state.rows = ctx.state.rows.filter(row => row.id !== 26);
    ctx.state.detailErrors[26] = { status: 404, contentType: 'text/html' };
    await ctx.poll();
    assert.ok(document.querySelector('[data-memo-key="26"]'));
    ctx.state.badList = true;
    const before = ctx.cards();
    await ctx.poll();
    assert.deepEqual(ctx.cards(), before);
  } finally { await ctx.close(); }
});

test('the final card leaves before the empty state appears, with a timer fallback', async () => {
  const ctx = await setup({ count: 1 });
  try {
    ctx.state.rows = [];
    await ctx.poll();
    assert.equal(ctx.cards().length, 1);
    assert.equal(document.querySelector('#memos-empty').style.display, 'none');
    const fallback = [...ctx.state.timers].find(([, timer]) => timer.delay === 450);
    assert.ok(fallback);
    fallback[1].callback();
    assert.equal(ctx.cards().length, 0);
    assert.equal(document.querySelector('#memos-empty').style.display, 'block');
  } finally { await ctx.close(); }
});

test('a card restored during its exit cancels removal and survives the old timeout', async () => {
  const ctx = await setup({ count: 5 });
  try {
    const node = ctx.cards()[0];
    const row = ctx.state.rows.shift();
    await ctx.poll();
    const fallback = [...ctx.state.timers].find(([, timer]) => timer.delay === 450)[1];
    ctx.state.rows.unshift(row);
    ctx.window.dispatchEvent(new ctx.window.Event('focus'));
    await settle();
    fallback.callback();
    assert.equal(ctx.cards()[0], node);
    assert.ok(!node.classList.contains('memo-item-exit'));
    assert.ok(!node.inert);
  } finally { await ctx.close(); }
});

test('reduced motion removes confirmed deletions immediately', async () => {
  const ctx = await setup({ count: 5, reducedMotion: true });
  try {
    ctx.state.rows.shift();
    await ctx.poll();
    assert.equal(ctx.cards().length, 4);
    assert.equal(document.querySelectorAll('.memo-item-exit').length, 0);
  } finally { await ctx.close(); }
});

test('finishing a removal above the reading anchor keeps that anchor in place', async () => {
  const ctx = await setup({ count: 5 });
  try {
    Object.defineProperty(ctx.window, 'scrollY', { value: 500, configurable: true });
    const list = document.querySelector('#memos-list');
    list.getBoundingClientRect = () => ({ top: -200 });
    const kept = ctx.cards()[1];
    kept.getBoundingClientRect = () => ({ top: document.querySelector('[data-memo-key="5"]') ? 120 : 20, bottom: 250 });
    ctx.state.rows.shift();
    await ctx.poll();
    assert.equal(ctx.state.scrolls.length, 0, 'the fade must not move the reader');
    await ctx.finishExits();
    assert.deepEqual(ctx.state.scrolls, [{ top: -100, behavior: 'instant' }]);
  } finally { await ctx.close(); }
});
