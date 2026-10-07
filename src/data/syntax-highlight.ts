import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import latex from 'highlight.js/lib/languages/latex';
import python from 'highlight.js/lib/languages/python';
import yaml from 'highlight.js/lib/languages/yaml';

hljs.registerLanguage('bash', bash);
hljs.registerLanguage('latex', latex);
hljs.registerLanguage('python', python);
hljs.registerLanguage('yaml', yaml);

/**
 * Trilium tags a code block with `language-<mime>` and highlights by that MIME,
 * so the class carries a MIME type rather than a highlight.js language id.
 *
 * `text-x-trilium-auto` means "detect the language", and Trilium's renderer only
 * auto-detects inside the app: `applySingleBlockSyntaxHighlight` guards the
 * auto branch with `!isShare`, so shared and exported content leaves those blocks
 * plain. It is deliberately absent here for the same reason.
 */
const LANGUAGE_BY_MIME: Record<string, string> = {
  'text-x-sh': 'bash',
  'text-x-shell': 'bash',
  'text-x-bash': 'bash',
  'text-x-zsh': 'bash',
  'text-x-yaml': 'yaml',
  'text-x-yml': 'yaml',
  'text-x-python': 'python',
  'text-x-latex': 'latex',
  'text-x-tex': 'latex',
};

const CODE_BLOCK = /<pre><code class="language-([^"]+)">([\s\S]*?)<\/code><\/pre>/g;

/**
 * Reverses the entity escaping CKEditor applies to code text. `&amp;` is decoded
 * last so an escaped entity in the source survives as text.
 */
function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, '\u00a0')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, '&');
}

/**
 * Highlights the code blocks of one note's stored HTML at build time.
 *
 * Trilium does this in the browser with highlight.js and marks the `<pre>` with
 * `hljs`; producing it here means the blog ships the same markup without the
 * runtime cost. Blocks whose language Trilium would leave alone pass through
 * untouched.
 */
export function highlightCodeBlocks(html: string): string {
  if (!html.includes('<pre><code')) return html;

  return html.replace(CODE_BLOCK, (match, mime: string, encoded: string) => {
    const language = LANGUAGE_BY_MIME[mime];
    if (!language) return match;

    const { value } = hljs.highlight(decodeEntities(encoded), { language });
    return `<pre class="hljs"><code class="language-${mime}">${value}</code></pre>`;
  });
}
