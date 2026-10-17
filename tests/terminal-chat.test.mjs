import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test, before } from 'node:test';
import { JSDOM } from 'jsdom';
import { installAboutConsole } from '../src/scripts/about-console.js';
import * as chatModule from '../src/scripts/terminal-chat.js';
import { createService } from '../cloudfunctions/terminal-chat-service/service.js';
import { createMemoryStore } from './helpers/terminal-chat-memory-store.cjs';

const html = await readFile(new URL('../dist/about/index.html', import.meta.url), 'utf8');
before(async () => { await createMemoryStore().getSession('warmup'); });
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };
function backend() {
  const notifications = []; let time = Date.now();
  const service = createService({ store: createMemoryStore(), signingKey: 'a'.repeat(64), apiBaseUrl: 'https://chat.test/terminal-chat',
    allowedOrigins: ['https://longblog.test'], now: () => time, notify: async value => { notifications.push(value); } });
  const invoke = async (url, options = {}) => {
    const parsed = new URL(url);
    const result = await service({ path: parsed.pathname, httpMethod: options.method || 'GET', headers: options.headers,
      body: options.body, queryStringParameters: Object.fromEntries(parsed.searchParams), requestContext: { sourceIp: '203.0.113.1' } });
    return { ok: result.statusCode < 400, status: result.statusCode, json: async () => JSON.parse(result.body) };
  };
  return { notifications, invoke, advance: ms => { time += ms; }, async reply(text = '你好，已收到留言。') {
    const { replyUrl, sessionId } = notifications.at(-1);
    const token = new URLSearchParams(new URL(replyUrl).hash.slice(1)).get('token');
    return invoke('https://chat.test/terminal-chat/chat/reply', { method: 'POST', headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ sessionId, messageId: crypto.randomUUID().replaceAll('-', ''), message: text }) });
  } };
}
function fixture({ saved, api = 'https://chat.test/terminal-chat', server = backend(), fetchOverride, loadChat } = {}) {
  const dom = new JSDOM(html, { url: 'https://longblog.test/about/', pretendToBeVisual: true });
  const { window } = dom; const { document } = window;
  const root = document.querySelector('[data-about-console]'); root.dataset.chatApi = api;
  if (saved) window.sessionStorage.setItem('LONG_BLOG_TERMINAL_CHAT_V1', saved);
  const calls = []; const timers = new Map(); let nextId = 0;
  window.setTimeout = (fn, delay) => { const id = ++nextId; timers.set(id, { fn, delay }); return id; };
  window.clearTimeout = id => timers.delete(id);
  window.fetch = async (url, options) => { calls.push({ url, options }); return fetchOverride ? fetchOverride(url, options, server) : server.invoke(url, options); };
  const uninstall = installAboutConsole(document, { loadChat: loadChat || (async () => chatModule) });
  const input = root.querySelector('input');
  const submit = value => { input.value = value; root.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); };
  const key = value => input.dispatchEvent(new window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }));
  return { window, document, root, input, submit, key, calls, timers, server,
    async tick(delay = 0) {
      const timer = [...timers.entries()].find(([, timer]) => timer.delay === delay);
      if (!timer) return false;
      timers.delete(timer[0]); void timer[1].fn(); await flush(); return true;
    },
    saved: () => window.sessionStorage.getItem('LONG_BLOG_TERMINAL_CHAT_V1'),
    cleanup() { uninstall(); window.close(); },
  };
}

test('local commands never load chat or contact backend; chat entry alone stays local', async () => {
  let loaded = 0; const f = fixture({ loadChat: async () => { loaded++; return chatModule; } });
  try {
    for (const command of ['profile', 'help', 'clear', 'unknown']) f.submit(command);
    assert.equal(loaded, 0); assert.equal(f.calls.length, 0);
    f.submit('chat'); await flush();
    assert.equal(loaded, 1); assert.equal(f.calls.length, 0); assert.equal(f.saved(), null);
    assert.equal(f.input.maxLength, 500); assert.equal(f.root.querySelector('[data-terminal-shortcuts]'), null);
    assert.match(f.root.querySelector('label').textContent, /author@chat/);
    f.submit('exit'); assert.equal(f.input.maxLength, 160);
    assert.match(f.root.querySelector('[data-terminal-help]').textContent, /输入 help/);
    f.submit('profile'); assert.ok(f.root.querySelector('[data-profile-output]'));
  } finally { f.cleanup(); }
});

test('visitor-to-author round trip renders plain text, separates shell history, and clears only display', async () => {
  const f = fixture();
  try {
    f.submit('help'); f.submit('chat'); await flush();
    const profileButton = f.root.querySelector('[data-command="profile"]');
    assert.equal(profileButton.disabled, true, 'old help output cannot send commands as messages');
    profileButton.click(); await flush(); assert.equal(f.calls.length, 0);
    f.submit('<img src=x onerror=alert(1)>'); await flush();
    assert.equal(f.calls.length, 1); assert.match(f.root.querySelector('.terminal-chat-status').textContent, /已发送/);
    assert.equal(f.root.querySelector('.terminal-chat-text img'), null);
    assert.equal(f.server.notifications.length, 1);
    f.input.value = 'draft'; f.key('ArrowUp'); assert.equal(f.input.value, 'draft');
    await f.server.reply('<script>evil()</script>'); await f.tick();
    assert.equal(f.root.querySelector('.terminal-chat-author .terminal-chat-text').textContent, '<script>evil()</script>');
    assert.equal(f.root.querySelector('.terminal-chat-log script'), null);
    assert.equal(JSON.parse(f.saved()).cursor, 2);
    f.root.querySelector('[data-chat-action="clear"]').click();
    assert.equal(f.root.querySelectorAll('.terminal-chat-row').length, 0);
    assert.equal(JSON.parse(f.saved()).messages.length, 2);
    f.submit('quit'); const count = f.calls.length;
    assert.equal(profileButton.disabled, false);
    f.key('ArrowUp'); assert.equal(f.input.value, 'chat', 'private text never enters shell command recall');
    f.submit('profile'); await flush(); assert.equal(f.calls.length, count);
  } finally { f.cleanup(); }
});

test('same-tab reload restores history and catches replies sent while away', async () => {
  const server = backend(); const first = fixture({ server });
  first.submit('chat'); await flush(); first.submit('同一会话'); await flush(); await first.tick();
  const saved = first.saved(); const id = JSON.parse(saved).id; first.cleanup();
  await server.reply('离开期间的回复');
  const next = fixture({ server, saved });
  try {
    assert.equal(next.calls.length, 0, 'no automatic connection on ordinary page entry');
    next.submit('chat'); await flush(); await next.tick();
    assert.equal(JSON.parse(next.saved()).id, id);
    assert.match(next.root.querySelector('.terminal-chat-author').textContent, /离开期间/);
    assert.equal(next.root.querySelectorAll('.terminal-chat-user').length, 1);
    const separate = fixture({ server });
    try { separate.submit('chat'); await flush(); assert.equal(separate.saved(), null); assert.equal(separate.calls.length, 0); } finally { separate.cleanup(); }
  } finally { next.cleanup(); }
});

test('ambiguous send failure retries the original message ID without duplicate storage or notification', async () => {
  let failOnce = true;
  const f = fixture({ fetchOverride: async (url, options, server) => {
    const response = await server.invoke(url, options);
    if (url.endsWith('/chat/send') && failOnce) { failOnce = false; throw new Error('response lost after commit'); }
    return response;
  } });
  try {
    f.submit('chat'); await flush(); f.submit('网络超时重试'); await flush();
    assert.ok(f.root.querySelector('[data-retry]'));
    f.root.querySelector('[data-retry]').click(); await flush();
    const sends = f.calls.filter(call => call.url.endsWith('/chat/send'));
    assert.equal(JSON.parse(sends[0].options.body).messageId, JSON.parse(sends[1].options.body).messageId);
    assert.equal(f.server.notifications.length, 1);
    await f.tick(); assert.equal(f.root.querySelectorAll('.terminal-chat-user').length, 1);
    assert.match(f.root.querySelector('.terminal-chat-status').textContent, /已发送/);
  } finally { f.cleanup(); }
});

test('exit aborts in-flight poll and ignores a late response; Astro teardown prevents more requests', async () => {
  let resolvePoll;
  const f = fixture({ fetchOverride: async (url, options, server) => url.includes('/chat/poll')
    ? new Promise(resolve => { resolvePoll = resolve; }) : server.invoke(url, options) });
  try {
    f.submit('chat'); await flush(); f.submit('hello'); await flush(); await f.tick();
    const call = f.calls.at(-1); assert.match(call.url, /poll/);
    f.submit('exit'); assert.equal(call.options.signal.aborted, true);
    resolvePoll({ ok: true, json: async () => ({ messages: [{ id: 'b'.repeat(32), sender: 'author', text: 'late' }], cursor: 2 }) }); await flush();
    assert.equal(f.root.querySelector('.terminal-chat-author'), null);
    assert.equal(f.timers.size, 0);
    f.document.dispatchEvent(new f.window.Event('astro:before-swap'));
    f.submit('chat'); await flush(); assert.equal(f.calls.length, 2);
  } finally { f.cleanup(); }
});

test('unconfigured chat, composition, oversized input, visibility pause and loading cancellation', async () => {
  const f = fixture({ api: '' });
  try {
    f.submit('chat'); await flush(); f.submit('hello');
    assert.equal(f.input.value, 'hello'); assert.equal(f.calls.length, 0);
    assert.match(f.root.querySelector('.terminal-chat-notice').textContent, /尚未配置/);
    f.submit('exit'); f.input.dispatchEvent(new f.window.CompositionEvent('compositionstart')); f.submit('chat');
    assert.equal(f.root.dataset.chatMode, 'false');
    f.input.dispatchEvent(new f.window.CompositionEvent('compositionend'));
  } finally { f.cleanup(); }
  const configured = fixture();
  try {
    configured.submit('chat'); await flush(); configured.submit('x'.repeat(501));
    assert.equal(configured.calls.length, 0); assert.equal(configured.input.value.length, 501);
    configured.submit('hello'); await flush();
    Object.defineProperty(configured.document, 'hidden', { configurable: true, value: true });
    configured.document.dispatchEvent(new configured.window.Event('visibilitychange')); assert.equal(configured.timers.size, 0);
    Object.defineProperty(configured.document, 'hidden', { configurable: true, value: false });
    configured.document.dispatchEvent(new configured.window.Event('visibilitychange')); await configured.tick();
    assert.equal(configured.calls.length, 2);
  } finally { configured.cleanup(); }
  let resolveModule; const pending = fixture({ loadChat: () => new Promise(resolve => { resolveModule = resolve; }) });
  try {
    pending.submit('chat'); pending.submit('exit'); resolveModule(chatModule); await flush();
    assert.equal(pending.root.querySelector('.terminal-chat-log'), null); assert.equal(pending.calls.length, 0);
  } finally { pending.cleanup(); }
});
