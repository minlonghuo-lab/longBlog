import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { installAboutConsole, COMMANDS } from '../src/scripts/about-console.js';

const html = await readFile(new URL('../dist/about/index.html', import.meta.url), 'utf8');
function fixture() {
  const dom = new JSDOM(html, { url: 'https://longblog.test/about', pretendToBeVisual: true });
  const { document } = dom.window;
  const uninstall = installAboutConsole(document);
  const root = document.querySelector('[data-about-console]');
  const input = root.querySelector('input');
  const transcript = root.querySelector('[data-terminal-transcript]');
  const submit = value => {
    input.value = value;
    root.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  };
  const key = (value, options = {}) => {
    const event = new dom.window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...options });
    input.dispatchEvent(event); return event;
  };
  return { dom, document, root, input, transcript, submit, key, cleanup() { uninstall(); dom.window.close(); } };
}

test('server-rendered profile works without JS and ships no legacy graph', () => {
  const dom = new JSDOM(html);
  const root = dom.window.document.querySelector('[data-about-console]');
  assert.match(root.textContent, /huowenlong.com/);
  assert.ok(root.querySelector('noscript').textContent.includes('阅读文章'));
  assert.ok(root.querySelector('[data-terminal-form]').hidden);
  assert.equal(root.querySelectorAll('#theme-toggle').length, 1);
  assert.doesNotMatch(html, /vis-network|vis-data|knowledge-graph|data-api-url|TRILIUM_TREE_API/);
  assert.match(html, /type="module"/);
  dom.window.close();
});

test('five commands, aliases, clear, append and bounded output', () => {
  const f = fixture();
  try {
    assert.equal(f.root.querySelector('form').hidden, false);
    assert.notEqual(f.document.activeElement, f.input, 'no autofocus / soft keyboard on entry');
    assert.deepEqual([...f.root.querySelectorAll('nav [data-command]')].map(b => b.dataset.command), COMMANDS);
    for (const command of ['knowledge', 'projects', 'history', 'profile', 'fastfetch', 'whoami']) {
      const count = f.transcript.children.length;
      f.submit(command);
      assert.equal(f.transcript.children.length, count + 1);
      assert.equal(f.transcript.lastElementChild.querySelector('.terminal-command').textContent, command);
      assert.ok(f.transcript.lastElementChild.children.length > 1);
    }
    assert.ok(f.transcript.querySelector('a[href="/blog"]'));
    f.submit('clear');
    assert.equal(f.transcript.children.length, 0);
    f.submit('profile');
    assert.ok(f.transcript.querySelector('[data-profile-output]'));
    for (let i = 0; i < 110; i++) f.submit('knowledge');
    assert.equal(f.transcript.children.length, 30);
    for (let i = 0; i < 105; i++) f.key('ArrowUp');
    assert.equal(f.input.value, 'knowledge');
    f.root.querySelector('[data-command="projects"]').focus();
    f.root.querySelector('[data-command="projects"]').click();
    assert.notEqual(f.document.activeElement, f.input, 'tap shortcut must not open a software keyboard');
  } finally { f.cleanup(); }
});

test('arbitrary and prototype-name commands are rendered safely as text', () => {
  const f = fixture();
  try {
    for (const command of ['<img src=x onerror=alert(1)>', 'constructor', '__proto__', 'toString', 'p" onclick="evil()']) {
      f.submit(command);
      const block = f.transcript.lastElementChild;
      assert.equal(block.querySelector('.terminal-command').textContent, command);
      assert.match(block.querySelector('.terminal-error').textContent, /command not found/);
      assert.equal(block.querySelector('img, script, [onclick], [onerror]'), null);
    }
    const count = f.transcript.children.length;
    f.submit('   ');
    assert.equal(f.transcript.children.length, count);
  } finally { f.cleanup(); }
});

test('history keeps draft; Tab completion never traps focus; composition ignored', () => {
  const f = fixture();
  try {
    f.submit('projects'); f.submit('history');
    f.input.value = 'draft';
    f.key('ArrowUp'); assert.equal(f.input.value, 'history');
    f.key('ArrowUp'); assert.equal(f.input.value, 'projects');
    f.key('ArrowDown'); f.key('ArrowDown'); assert.equal(f.input.value, 'draft');
    f.input.value = 'kno'; assert.equal(f.key('Tab').defaultPrevented, true);
    assert.equal(f.input.value, 'knowledge');
    assert.equal(f.key('Tab').defaultPrevented, false, 'complete command lets focus leave');
    f.input.value = ''; assert.equal(f.key('Tab').defaultPrevented, false);
    f.input.value = 'pro'; f.key('Tab');
    assert.equal(f.root.querySelector('[data-command-suggestions]').hidden, false);
    f.key('Escape'); assert.equal(f.root.querySelector('[data-command-suggestions]').hidden, true);
    assert.equal(f.key('Tab', { shiftKey: true }).defaultPrevented, false);
    assert.equal(f.key('ArrowUp', { isComposing: true }).defaultPrevented, false);
  } finally { f.cleanup(); }
});

test('global theme changes update every profile, including after clear', async () => {
  const f = fixture();
  try {
    f.submit('profile');
    f.document.documentElement.dataset.theme = 'dark';
    await new Promise(resolve => setImmediate(resolve));
    assert.ok([...f.root.querySelectorAll('[data-terminal-theme]')].every(n => n.textContent === 'Dark'));
    assert.equal(f.root.querySelector('#theme-toggle').getAttribute('aria-pressed'), 'true');
    f.submit('clear'); f.submit('profile');
    assert.equal(f.root.querySelector('[data-terminal-theme]').textContent, 'Dark');
    f.document.documentElement.dataset.theme = 'light';
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.root.querySelector('[data-terminal-theme]').textContent, 'Light');
  } finally { f.cleanup(); }
});

test('repeated ClientRouter entry mounts once and releases detached handlers', async () => {
  const f = fixture();
  try {
    installAboutConsole(f.document);
    f.document.dispatchEvent(new f.dom.window.Event('astro:page-load'));
    f.document.dispatchEvent(new f.dom.window.Event('astro:page-load'));
    f.submit('projects');
    assert.equal(f.transcript.children.length, 2);
    for (let i = 0; i < 3; i++) {
      const oldRoot = f.document.querySelector('[data-about-console]');
      const oldTranscript = oldRoot.querySelector('[data-terminal-transcript]');
      const count = oldTranscript.children.length;
      f.document.dispatchEvent(new f.dom.window.Event('astro:before-swap'));
      f.document.body.replaceChildren();
      f.document.dispatchEvent(new f.dom.window.Event('astro:page-load'));
      oldRoot.querySelector('[data-command="projects"]').click();
      assert.equal(oldTranscript.children.length, count, 'old click handler cleaned');
      const parsed = new f.dom.window.DOMParser().parseFromString(html, 'text/html');
      f.document.body.replaceWith(f.document.adoptNode(parsed.body));
      f.document.dispatchEvent(new f.dom.window.Event('astro:page-load'));
      f.document.dispatchEvent(new f.dom.window.Event('astro:page-load'));
      f.document.querySelector('[data-command="knowledge"]').click();
      assert.equal(f.document.querySelector('[data-terminal-transcript]').children.length, 2);
    }
    f.document.dispatchEvent(new f.dom.window.Event('astro:before-swap'));
    f.document.documentElement.dataset.theme = 'dark';
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.document.querySelector('[data-terminal-theme]').textContent, 'Light', 'detached observer cleaned');
  } finally { f.cleanup(); }
});

test('terminal has no network calls or graph dependencies', async () => {
  const script = await readFile(new URL('../src/scripts/about-console.js', import.meta.url), 'utf8');
  assert.doesNotMatch(script, /fetch\s*\(|XMLHttpRequest|WebSocket|eval\s*\(|innerHTML/);
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(packageJson.dependencies['vis-network'], undefined);
  assert.equal(packageJson.dependencies['vis-data'], undefined);
});
