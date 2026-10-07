import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';

// Regression cover for Trilium -> blog rendering parity. These assertions run
// against the built output (npm test builds first), so they fail if either the
// stylesheet contract or the published note data drifts.

const distRoot = new URL('../dist/', import.meta.url);

async function readBuiltCss() {
  const dir = new URL('_astro/', distRoot);
  const files = (await readdir(dir)).filter((name) => name.endsWith('.css'));
  const parts = await Promise.all(files.map((name) => readFile(new URL(name, dir), 'utf8')));
  return parts.join('\n');
}

// Minimal extractor for flat CSS rules whose selector list contains `selector`
// verbatim. Astro emits minified but unscoped selectors for these rules.
function declarationsFor(css, selector) {
  const found = [];
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  while ((match = rule.exec(css)) !== null) {
    const selectors = match[1].split(',').map((part) => part.trim());
    if (selectors.includes(selector)) found.push(match[2]);
  }
  return found;
}

function declaredValue(declarations, property) {
  for (const block of declarations) {
    for (const decl of block.split(';')) {
      const [name, ...rest] = decl.split(':');
      if (name.trim() === property) return rest.join(':').trim();
    }
  }
  return undefined;
}

test('code blocks keep the preformatted whitespace contract', async () => {
  const css = await readBuiltCss();

  // Inline code is allowed to wrap; a code block must not.
  assert.equal(
    declaredValue(declarationsFor(css, '.content code'), 'white-space'),
    'normal',
    'inline code should still wrap inside prose',
  );

  // The bug this guards: `.content code` also matches the <code> inside a
  // <pre>, so its `white-space: normal` collapses every newline and run of
  // spaces in a code block unless `pre code` restores `pre`.
  assert.equal(
    declaredValue(declarationsFor(css, '.content pre code'), 'white-space'),
    'pre',
    '.content pre code must restore white-space: pre',
  );

  assert.equal(
    declaredValue(declarationsFor(css, '.content pre'), 'white-space'),
    'pre',
    '.content pre must preserve newlines even without a nested <code>',
  );

  // Long ASCII diagrams must scroll rather than re-wrap.
  assert.equal(
    declaredValue(declarationsFor(css, '.content pre'), 'overflow-x'),
    'auto',
    '.content pre must scroll horizontally',
  );

  // Wrapping hints inherited from the shared inline-code rule must be undone.
  const preCode = declarationsFor(css, '.content pre code').join(';');
  assert.match(preCode, /overflow-wrap:\s*normal/, 'pre code must not break long tokens');
  assert.match(preCode, /word-break:\s*normal/, 'pre code must not break words');
});

test('published note content carries no Trilium host injections', async () => {
  const generated = await readFile(
    new URL('../src/data/trilium-posts.content.generated.ts', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(
    generated,
    /data-trilium-fnos-manager/,
    'the Trilium host asset loader must not reach published content',
  );

  const pages = await readdir(new URL('blog/', distRoot), { withFileTypes: true });
  for (const page of pages.filter((entry) => entry.isDirectory())) {
    const html = await readFile(new URL(`blog/${page.name}/index.html`, distRoot), 'utf8');
    assert.doesNotMatch(html, /data-trilium-fnos-manager/, `${page.name} still carries an injected tag`);
  }
});

test('embedded notes resolve to a link card instead of a blank placeholder', async () => {
  const html = await readFile(
    new URL('blog/基于tlock和cryptomator的时间胶囊/index.html', distRoot),
    'utf8',
  );
  const { document } = new JSDOM(html).window;

  // Trilium expands `.include-note` in the browser; published HTML must not ship
  // the bare placeholder, which renders as an empty gap.
  const placeholders = document.querySelectorAll('.content .include-note');
  assert.equal(placeholders.length, 0, 'no unresolved embed placeholder should remain');

  const card = document.querySelector('.content .include-note-card');
  assert.ok(card, 'the embed should render as a card');
  assert.equal(
    card.getAttribute('href'),
    '/blog/使用-cryptomator为云存储提供零知识加密',
    'the card must link to the embedded note',
  );
  assert.match(card.textContent, /使用 Cryptomator/, 'the card names its target');
  assert.ok(
    card.querySelector('.include-note-card-summary')?.textContent.trim().length > 0,
    'the card carries the target summary',
  );
});

test('no built page ships an unresolved embed placeholder', async () => {
  const pages = await readdir(new URL('blog/', distRoot), { withFileTypes: true });
  for (const page of pages.filter((entry) => entry.isDirectory())) {
    const html = await readFile(new URL(`blog/${page.name}/index.html`, distRoot), 'utf8');
    const { document } = new JSDOM(html).window;
    assert.equal(
      document.querySelectorAll('.include-note').length,
      0,
      `${page.name} still has an unresolved embed placeholder`,
    );
  }
});

test('ASCII diagrams survive the pipeline byte for byte', async () => {
  const html = await readFile(
    new URL('blog/记一次华为杯数学建模协作经验/index.html', distRoot),
    'utf8',
  );
  const { document } = new JSDOM(html).window;

  const blocks = [...document.querySelectorAll('.content pre code')];
  assert.ok(blocks.length > 0, 'the post should render code blocks');

  // The diagram that regressed: box drawing plus a nested layout. Match on the
  // diagram's own markers so the docker-compose block above it cannot satisfy
  // the lookup.
  const diagram = blocks.find(
    (block) => block.textContent.includes('Windows 电脑') && block.textContent.includes('┌'),
  );
  assert.ok(diagram, 'the ASCII architecture diagram should be present');

  const text = diagram.textContent;
  assert.match(text, /\n/, 'newlines inside the code block must be preserved');
  assert.match(text, /┌/, 'box drawing characters must be preserved');

  // Alignment depends on runs of spaces not collapsing.
  const indented = text.split('\n').filter((line) => /^ {2,}\S/.test(line));
  assert.ok(indented.length > 0, 'leading indentation must be preserved');

  // A collapsed block would render as one long line; the real diagram is many.
  assert.ok(text.split('\n').length > 10, 'the diagram should keep its line structure');
});
