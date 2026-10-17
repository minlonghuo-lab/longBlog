import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { initSearch } from '../src/scripts/search.js';

const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await pause(10); }
  assert.fail('Search did not settle');
}
const result = (id, title = id) => ({ data: async () => ({ url: `/blog/${id}/`, meta: { title }, excerpt: '正文 <mark onclick="alert(1)">关键词</mark><img src=x onerror="alert(1)">' }) });
function setup(load) {
  const dom = new JSDOM(html, { url: 'https://longblog.test/', pretendToBeVisual: true });
  const doc = dom.window.document;
  const $ = selector => doc.querySelector(selector);
  const dispose = initSearch(doc, load);
  const type = value => { $('#search-input').value = value; $('#search-input').dispatchEvent(new dom.window.Event('input')); };
  return { dom, doc, $, dispose, type, close() { dispose(); dom.window.close(); } };
}

test('search loads lazily, paginates, safely highlights snippets, and manages keyboard focus', async () => {
  let loads = 0;
  const ui = setup(async () => { loads++; return { search: async () => ({ results: Array.from({ length: 11 }, (_, i) => result(`A${i}`, `中文文章${i}`)) }) }; });
  try {
    assert.equal(loads, 0);
    ui.$('#search-toggle').focus();
    ui.$('#search-toggle').click();
    await until(() => ui.doc.activeElement === ui.$('#search-input'));
    assert.equal(loads, 0, 'opening an empty panel does not download the index');
    ui.type('正文关键词');
    await until(() => ui.doc.querySelectorAll('.search-result-item').length === 10);
    assert.equal(ui.$('.search-result-item').getAttribute('href'), '/blog/A0/');
    assert.equal(ui.$('.search-result-title').textContent, '中文文章0');
    assert.equal(ui.$('mark').getAttribute('onclick'), null);
    assert.equal(ui.$('#search-results img'), null);
    ui.$('#search-more').click();
    await until(() => ui.doc.querySelectorAll('.search-result-item').length === 11);
    assert.equal(ui.$('#search-more').hidden, true);
    ui.$('#search-input').focus();
    ui.doc.dispatchEvent(new ui.dom.window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, cancelable: true }));
    assert.equal(ui.doc.activeElement, [...ui.doc.querySelectorAll('.search-result-item')].at(-1));
    ui.doc.dispatchEvent(new ui.dom.window.KeyboardEvent('keydown', { key: 'Escape' }));
    assert.equal(ui.$('#search-panel').hidden, true);
    assert.equal(ui.doc.activeElement, ui.$('#search-toggle'));
    assert.equal(ui.doc.body.style.overflow, '');
  } finally { ui.close(); }
});

test('late search responses cannot replace results for the newer query', async () => {
  const pending = new Map();
  const ui = setup(async () => ({ search: query => new Promise(resolve => pending.set(query, resolve)) }));
  try {
    ui.$('#search-toggle').click();
    ui.type('旧查询');
    await until(() => pending.has('旧查询'));
    ui.type('新查询');
    await until(() => pending.has('新查询'));
    pending.get('新查询')({ results: [result('New')] });
    await until(() => ui.$('.search-result-title')?.textContent === 'New');
    pending.get('旧查询')({ results: [result('Old')] });
    await pause(20);
    assert.equal(ui.$('.search-result-title').textContent, 'New');
  } finally { ui.close(); }
});

test('IME input waits for composition and failed result pages can be retried', async () => {
  let searches = 0;
  let fail = true;
  const ui = setup(async () => ({ search: async () => {
    searches++;
    return { results: [{ data: async () => {
      if (fail) { fail = false; throw new Error('fragment unavailable'); }
      return { url: '/blog/Chinese/', meta: { title: '中文结果' }, excerpt: '正文内容' };
    } }] };
  } }));
  try {
    ui.$('#search-toggle').click();
    const input = ui.$('#search-input');
    input.value = '中文';
    input.dispatchEvent(new ui.dom.window.InputEvent('input', { isComposing: true }));
    await pause(200);
    assert.equal(searches, 0);
    input.dispatchEvent(new ui.dom.window.CompositionEvent('compositionend'));
    await until(() => ui.$('#search-more').textContent === '重试加载');
    assert.equal(ui.$('#search-more').disabled, false);
    ui.$('#search-more').click();
    await until(() => ui.$('.search-result-title')?.textContent === '中文结果');
    assert.equal(searches, 1, 'retry reuses the query instead of rebuilding it');
    assert.equal(ui.$('#search-more').hidden, true);
  } finally { ui.close(); }
});

test('failures and empty results recover, and leaving the page cancels late rendering', async () => {
  let fail = true;
  let resolveLate;
  const ui = setup(async () => {
    if (fail) { fail = false; throw new Error('offline'); }
    return { search: async query => query === 'empty' ? { results: [] } : { results: [{ data: () => new Promise(resolve => { resolveLate = resolve; }) }] } };
  });
  try {
    ui.$('#search-toggle').click(); ui.type('first');
    await until(() => ui.$('#search-status').textContent.includes('暂时不可用'));
    ui.type('empty');
    await until(() => ui.$('#search-status').textContent.includes('没有找到'));
    ui.type('late');
    await until(() => resolveLate);
    ui.dispose();
    resolveLate({ url: '/blog/Late/', meta: { title: 'Late' }, excerpt: '' });
    await pause(20);
    assert.equal(ui.$('.search-result-item'), null);
    assert.equal(ui.doc.body.style.overflow, '');
    assert.equal(ui.$('#search-panel').hidden, true);
    const disposeAgain = initSearch(ui.doc, async () => ({ search: async () => ({ results: [] }) }));
    ui.$('#search-toggle').click();
    assert.equal(ui.$('#search-panel').hidden, false, 'one handler after remount');
    disposeAgain();
  } finally { ui.close(); }
});
