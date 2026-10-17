import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';

test('a new notification fragment reinitializes an existing invalid reply tab', async () => {
  const script = await readFile(new URL('../cloudfunctions/terminal-chat-service/reply.js', import.meta.url), 'utf8');
  const listeners = new Map(); let reloads = 0;
  const nodes = new Map();
  const location = { href: 'https://chat.test/terminal-chat/reply', pathname: '/terminal-chat/reply', hash: '', reload() { reloads++; } };
  runInNewContext(script, { URL, URLSearchParams, location, history: { replaceState() {} }, sessionStorage: { getItem: () => null },
    window: { addEventListener: (name, handler) => listeners.set(name, handler) },
    document: { getElementById(id) { if (!nodes.has(id)) nodes.set(id, { dataset: {} }); return nodes.get(id); } } });
  assert.match(nodes.get('status').textContent, /无效或已过期/);
  location.hash = '#unrelated=1'; listeners.get('hashchange')(); assert.equal(reloads, 0);
  location.hash = '#token=fresh-scoped-link'; listeners.get('hashchange')(); assert.equal(reloads, 1);
});
