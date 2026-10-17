import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { createService } from '../cloudfunctions/terminal-chat-service/service.js';
import { createCloudStore } from '../cloudfunctions/terminal-chat-service/store.js';
import { cleanupExpired } from '../cloudfunctions/terminal-chat-service/cleanup.js';
import { createMemoryStore } from './helpers/terminal-chat-memory-store.cjs';

const hex = bytes => randomBytes(bytes).toString('hex');
const visitor = () => ({ sessionId: hex(16), token: hex(32) });
function fixture({ notificationFails = false } = {}) {
  const notifications = [];
  const reports = [];
  let time = 1800000000000;
  const store = createMemoryStore();
  const signingKey = hex(32);
  const service = createService({ store, signingKey, apiBaseUrl: 'https://chat.test/terminal-chat', allowedOrigins: ['https://huowenlong.com'],
    now: () => time, replyHtml: '<html>reply</html>', replyJs: '// reply', report: code => reports.push(code),
    async notify(value) { notifications.push(value); if (notificationFails) throw new Error('secret webhook detail'); },
  });
  const request = async (path, { method = 'GET', body, token = '', origin = 'https://huowenlong.com', ip = '203.0.113.1', raw } = {}) => {
    const url = new URL(path, 'https://chat.test');
    const result = await service({ path: url.pathname, httpMethod: method, headers: { Origin: origin, Authorization: `Bearer ${token}` },
      body: raw ?? (body === undefined ? '' : JSON.stringify(body)), queryStringParameters: Object.fromEntries(url.searchParams), requestContext: { sourceIp: ip } });
    let data; try { data = JSON.parse(result.body); } catch { data = result.body; }
    return { ...result, data };
  };
  const send = (who, message = '你好', messageId = hex(16), extra = {}) => request('/terminal-chat/chat/send', {
    method: 'POST', token: who.token, body: { sessionId: who.sessionId, messageId, message }, ...extra,
  });
  const poll = (who, cursor = 0) => request(`/terminal-chat/chat/poll?sessionId=${who.sessionId}&cursor=${cursor}`, { token: who.token });
  const author = index => ({ sessionId: notifications[index].sessionId, token: new URLSearchParams(new URL(notifications[index].replyUrl).hash.slice(1)).get('token') });
  const reply = (who, message = '可以交流', messageId = hex(16)) => request('/terminal-chat/chat/reply', { method: 'POST', token: who.token, body: { sessionId: who.sessionId, messageId, message } });
  return { request, send, poll, author, reply, store, notifications, reports, signingKey, advance: ms => { time += ms; } };
}

test('visitor → WeCom scoped link → author → visitor, with server sequence cursor', async () => {
  const f = fixture(); const user = visitor();
  const sent = await f.send(user, '<img src=x onerror=alert(1)>');
  assert.equal(sent.statusCode, 200); assert.equal(sent.data.notification, 'sent');
  assert.equal(f.notifications.length, 1);
  assert.equal(new URL(f.notifications[0].replyUrl).search, '', 'credentials stay out of query strings');
  assert.equal((await f.reply(f.author(0))).statusCode, 200);
  const received = await f.poll(user);
  assert.deepEqual(received.data.messages.map(value => value.sender), ['user', 'author']);
  assert.deepEqual(received.data.messages.map(value => value.sequence), [1, 2]);
  assert.equal(received.data.messages[0].text, '<img src=x onerror=alert(1)>');
  assert.equal((await f.poll(user, 2)).data.messages.length, 0);
  for (const value of [user.token, f.signingKey, 'visitorKeyHash', 'purgeAfter']) assert.ok(!JSON.stringify(received).includes(value));
});

test('message retries are atomic, idempotent and notify only once', async () => {
  const f = fixture(); const user = visitor(); const messageId = hex(16);
  const results = await Promise.all([f.send(user, 'hello', messageId), f.send(user, 'hello', messageId)]);
  assert.ok(results.every(value => value.statusCode === 200));
  assert.equal(f.notifications.length, 1); assert.equal((await f.poll(user)).data.messages.length, 1);
  assert.equal((await f.send(user, 'different content', messageId)).statusCode, 409);
  const author = f.author(0); const replyId = hex(16);
  await Promise.all([f.reply(author, 'reply', replyId), f.reply(author, 'reply', replyId)]);
  assert.equal((await f.poll(user)).data.messages.length, 2);
});

test('visitor and author credentials cannot cross sessions or impersonate the author', async () => {
  const f = fixture(); const a = visitor(); const b = visitor();
  await f.send(a); await f.send(b);
  assert.equal((await f.poll({ ...a, token: b.token })).statusCode, 403);
  assert.equal((await f.send({ ...a, token: b.token })).statusCode, 403);
  assert.equal((await f.reply(a)).statusCode, 401);
  assert.equal((await f.reply({ ...f.author(0), sessionId: b.sessionId })).statusCode, 403);
  assert.equal((await f.poll({ ...a, token: f.author(1).token })).statusCode, 403);
  assert.equal((await f.poll({ ...a, token: f.author(0).token + 'tampered' })).statusCode, 401);
  assert.equal((await f.send(a, 'spoof', hex(16), { body: { sessionId: a.sessionId, messageId: hex(16), message: 'spoof', sender: 'author' } })).statusCode, 429);
});

test('notification failure preserves an acknowledged message and does not leak errors', async () => {
  const f = fixture({ notificationFails: true }); const user = visitor();
  const result = await f.send(user);
  assert.equal(result.statusCode, 200); assert.equal(result.data.notification, 'failed');
  assert.equal((await f.poll(user)).data.messages.length, 1);
  assert.deepEqual(f.reports, ['notification_failed']); assert.doesNotMatch(result.body, /secret/);
});

test('CORS, invalid payloads, missing credentials and wrong routes fail closed', async () => {
  const f = fixture(); const user = visitor();
  assert.equal((await f.send(user, 'x', hex(16), { origin: 'https://evil.test' })).statusCode, 403);
  assert.equal((await f.send(user, 'x'.repeat(501))).statusCode, 400);
  assert.equal((await f.send(user, ' ')).statusCode, 400);
  assert.equal((await f.send({ ...user, token: '' })).statusCode, 403);
  assert.equal((await f.send(user, 'x', hex(16), { raw: '{broken' })).statusCode, 400);
  assert.equal((await f.send(user, 'x', hex(16), { raw: 'x'.repeat(8193) })).statusCode, 413);
  assert.equal((await f.send(user, 'x', hex(16), { body: { sessionId: [user.sessionId], messageId: hex(16), message: 'x' } })).statusCode, 400);
  assert.equal((await f.request('/evil/chat/send', { method: 'POST', raw: '{}' })).statusCode, 404);
  const preflight = await f.request('/terminal-chat/chat/send', { method: 'OPTIONS' });
  assert.equal(preflight.statusCode, 204); assert.equal(preflight.headers['Access-Control-Allow-Origin'], 'https://huowenlong.com');
  assert.equal((await f.request('/terminal-chat/reply')).headers['Referrer-Policy'], 'no-referrer');
});

test('per-session throttling rolls back rates; IP caps apply across sessions', async () => {
  const f = fixture(); const user = visitor();
  assert.equal((await f.send(user)).statusCode, 200);
  assert.equal((await f.send(user)).statusCode, 429);
  f.advance(2000); assert.equal((await f.send(user)).statusCode, 200);
  for (let i = 0; i < 4; i++) assert.equal((await f.send(visitor())).statusCode, 200);
  assert.equal((await f.send(visitor())).statusCode, 429, 'five new sessions per IP per hour');
  assert.equal((await f.send(visitor(), 'new network', hex(16), { ip: '203.0.113.2' })).statusCode, 200);
});

test('24-hour reply tokens expire independently of seven-day visitor sessions', async () => {
  const f = fixture(); const user = visitor(); await f.send(user); const author = f.author(0);
  f.advance(86400001);
  assert.equal((await f.reply(author)).statusCode, 401); assert.equal((await f.poll(user)).statusCode, 200);
  f.advance(7 * 86400000); assert.equal((await f.poll(user)).statusCode, 410); assert.equal((await f.send(user)).statusCode, 410);
});

test('pagination drains more than fifty replies sharing the same timestamp without loss', async () => {
  const f = fixture(); const user = visitor(); await f.send(user); const author = f.author(0);
  for (let i = 0; i < 55; i++) assert.equal((await f.reply(author, `reply ${i}`)).statusCode, 200);
  const first = await f.poll(user); assert.equal(first.data.messages.length, 50); assert.equal(first.data.hasMore, true);
  const next = await f.poll(user, first.data.cursor); assert.equal(next.data.messages.length, 6); assert.equal(next.data.hasMore, false);
  assert.equal(new Set([...first.data.messages, ...next.data.messages].map(value => value.id)).size, 56);
  assert.equal((await f.poll(user, -1)).statusCode, 400);
  assert.equal((await f.poll(user, 999)).statusCode, 400);
});

test('CloudBase adapter handles transaction vs query shapes, strips _id and surfaces SDK errors', async () => {
  let error = false; const written = [];
  const ref = { async get() { return error ? { code: 'DATABASE_REQUEST_FAILED' } : { data: { _id: 'sid', sequence: 3 } }; },
    async set(value) { written.push(value); return {}; }, async update() { return { updated: 1 }; } };
  const db = { collection: () => ({ doc: () => ref }), runTransaction: fn => fn(db) };
  const store = createCloudStore(db);
  const result = await store.transaction(async tx => { const session = await tx.getSession('sid'); await tx.putSession('sid', session); return session.sequence; });
  assert.equal(result, 3); assert.deepEqual(written, [{ sequence: 3 }]);
  ref.get = async () => ({ data: [{ _id: 'sid', sequence: 4 }] }); assert.deepEqual(await store.getSession('sid'), { sequence: 4 });
  ref.get = async () => ({ code: 'DATABASE_REQUEST_FAILED' }); await assert.rejects(store.getSession('sid'), { code: 'DATABASE_REQUEST_FAILED' });
  ref.set = async () => ({ code: 'DATABASE_TRANSACTION_CONFLICT' });
  await assert.rejects(store.transaction(tx => tx.putSession('sid', {})), { code: 'DATABASE_TRANSACTION_CONFLICT' });
});

test('retention cleanup only touches its two collections, uses expiry queries and bounds batch size', async () => {
  const removed = []; const queries = []; let concurrent = 0; let maximum = 0;
  const db = { command: { lte: date => ({ before: date }) }, collection(name) {
    assert.ok(['terminal_chat_messages', 'terminal_chat_sessions'].includes(name));
    return {
      where(query) { queries.push(query); return { limit(value) { assert.equal(value, 50); return { async get() {
        return { data: Array.from({ length: 23 }, (_, index) => ({ _id: `${name}_${index}` })) };
      } }; } }; },
      doc(id) { return { async remove() { concurrent++; maximum = Math.max(maximum, concurrent); await new Promise(resolve => setImmediate(resolve)); removed.push(id); concurrent--; return { deleted: 1 }; } }; },
    };
  } };
  assert.deepEqual(await cleanupExpired(db, 1800000000000), { deleted: 46 });
  assert.equal(removed.length, 46); assert.ok(maximum <= 10); assert.equal(queries[0].purgeAfter.before.getTime(), 1800000000000);
});
