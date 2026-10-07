import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import {
  sanitizeNoteHtml,
  stripEmptyImageFigures,
  stripHostInjections,
} from '../src/data/sanitize-content.ts';

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

// Minimal extractor for flat CSS rules whose selector list contains `selector`.
// Astro emits minified but unscoped selectors for these rules, so combinators are
// normalized before comparing rather than relying on the source spacing.
function normalizeSelector(selector) {
  return selector
    .replace(/\s*([>+~])\s*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function declarationsFor(css, selector) {
  const wanted = normalizeSelector(selector);
  const found = [];
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  while ((match = rule.exec(css)) !== null) {
    const selectors = match[1].split(',').map(normalizeSelector);
    if (selectors.includes(wanted)) found.push(match[2]);
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

test('syntax highlighting follows the rules Trilium applies outside the app', async () => {
  const html = await readFile(new URL('blog/近期让我眼前一亮的软件/index.html', distRoot), 'utf8');
  const { document } = new JSDOM(html).window;

  const highlighted = document.querySelectorAll('.content pre.hljs');
  assert.ok(highlighted.length > 0, 'code blocks with a language must be highlighted');
  assert.ok(
    highlighted[0].querySelector('.hljs-comment, .hljs-string, .hljs-keyword'),
    'highlighting must emit token spans',
  );

  // Trilium auto-detects a language only inside the app — its renderer guards that
  // branch with `!isShare` — so `text-x-trilium-auto` blocks stay plain on the blog.
  for (const pre of document.querySelectorAll('.content pre')) {
    const code = pre.querySelector('code');
    if (code?.className.includes('language-text-x-trilium-auto')) {
      assert.ok(!pre.classList.contains('hljs'), 'auto blocks must not be highlighted');
    }
  }

  // Highlighting must not disturb the preformatted whitespace contract.
  const diagram = await readFile(
    new URL('blog/记一次华为杯数学建模协作经验/index.html', distRoot),
    'utf8',
  );
  const diagramDoc = new JSDOM(diagram).window.document;
  const art = [...diagramDoc.querySelectorAll('.content pre code')].find((block) =>
    block.textContent.includes('Windows 电脑'),
  );
  assert.match(art.textContent, /┌/, 'box drawing must survive highlighting');
});

test('the stylesheet carries the construct contracts Trilium defines', async () => {
  const css = await readBuiltCss();
  const rule = (selector) => declarationsFor(css, selector).join(';');

  // Images fill their figure and are capped only by the content column.
  assert.match(rule('.content figure.image img'), /min-width:\s*100%/, 'image fills its figure');
  assert.match(
    rule('.content figure.image.image_resized img'),
    /width:\s*100%/,
    'a resized image stretches to its figure',
  );
  assert.match(rule('.content img'), /max-width:\s*100%/, 'no pixel cap beyond the column');

  // Table cells keep a floor width and the header stays distinguishable.
  assert.match(rule('.content td'), /min-width:\s*120px/, 'cell floor width');
  assert.ok(
    declarationsFor(css, '.content th').some((block) => /background/.test(block)),
    'header background',
  );

  // Constructs that previously had no rules at all.
  assert.match(rule('.content hr'), /height:\s*4px/, 'hr rule');
  assert.match(rule('.content details.trilium-collapsible'), /overflow:\s*hidden/, 'collapsible block');
  assert.match(rule('.content .admonition'), /padding-inline-start/, 'admonition');

  // Code-block furniture.
  assert.match(rule('.content pre'), /tab-size:\s*4/, 'tab size matches Trilium');
  assert.match(rule('.content pre'), /position:\s*relative/, 'anchor for the copy button');
  assert.match(rule('.content pre > button.copy-button'), /position:\s*absolute/, 'copy button');
});

test('the icon font is emitted subset, not whole', async () => {
  const font = await readFile(new URL('fonts/boxicons-subset.woff', distRoot));
  // Only the glyphs the note content can reference are kept; the full boxicons
  // font is ~115 KB, so anything near that means the subset step was lost.
  assert.ok(font.byteLength > 500, 'the font must be present');
  assert.ok(font.byteLength < 8000, `expected a subset, got ${font.byteLength} bytes`);
  assert.equal(font.subarray(0, 4).toString('ascii'), 'wOFF', 'must be a woff file');
});

test('note html is sanitized on the consuming side', () => {
  // The sync script runs from a deployed copy on the server, so the blog cannot
  // rely on it having been redeployed; these guards hold whatever it emits.
  const injected =
    '<link rel="stylesheet" href="/__fnos/assets/update.css" data-trilium-fnos-manager>' +
    '<script defer src="/__fnos/assets/update.js" data-trilium-fnos-manager></script>' +
    '<p>正文</p>';
  assert.equal(stripHostInjections(injected), '<p>正文</p>');

  const empties =
    '<figure class="image image_resized" style="width:50%;">' +
    '<img src="/trilium-assets/a/b.jpg" width="10" height="10"></figure>' +
    '<figure class="image"><img></figure><figure class="image"><img></figure>';
  const cleaned = stripEmptyImageFigures(empties);
  assert.equal(cleaned.match(/<figure/g).length, 1, 'only the source-less figure goes');
  assert.match(cleaned, /b\.jpg/, 'a real image survives');

  // A figure holding anything else, or an image with a source, must be left alone.
  const keep = '<figure class="image"><img src="x.jpg"></figure>';
  assert.equal(stripEmptyImageFigures(keep), keep);
  const keepCaption = '<figure class="image"><img><figcaption>说明</figcaption></figure>';
  assert.equal(stripEmptyImageFigures(keepCaption), keepCaption);

  // Both transforms compose, and plain content is returned untouched.
  assert.equal(sanitizeNoteHtml('<p>a</p>'), '<p>a</p>');
  assert.equal(sanitizeNoteHtml(injected + empties).includes('fnos'), false);
});

test('no built page renders a source-less image', async () => {
  const pages = await readdir(new URL('blog/', distRoot), { withFileTypes: true });
  for (const page of pages.filter((entry) => entry.isDirectory())) {
    const html = await readFile(new URL(`blog/${page.name}/index.html`, distRoot), 'utf8');
    const { document } = new JSDOM(html).window;
    const broken = [...document.querySelectorAll('.content img')].filter(
      (img) => !img.getAttribute('src'),
    );
    assert.equal(broken.length, 0, `${page.name} renders an image without a source`);
  }
});
