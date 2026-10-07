/**
 * Guards the note HTML the blog consumes.
 *
 * The sync script that produces `trilium-posts.content.generated.ts` runs from a
 * deployed copy on the server, so a fix there only takes effect once someone
 * redeploys it. These two transforms therefore live on the consuming side as
 * well: whatever the producer emits, the blog renders clean content.
 *
 * Both mirror transforms in `scripts/sync_trilium_posts.py`.
 */

/** The Trilium host injects its own asset loader at the top of every note body. */
const HOST_INJECTION =
  /<link\b[^>]*data-trilium-fnos-manager[^>]*>\s*|<script\b[^>]*data-trilium-fnos-manager[^>]*>\s*(?:<\/script>)?\s*/gi;

/**
 * An image figure whose `<img>` has no source. Trilium renders nothing for it,
 * and on the blog it would leave a stray box and margin.
 */
const EMPTY_IMAGE_FIGURE =
  /<figure\b[^>]*\bclass="[^"]*\bimage\b[^"]*"[^>]*>\s*<img\b[^>]*>\s*<\/figure>/gi;

export function stripHostInjections(html: string): string {
  if (!html.includes('data-trilium-fnos-manager')) return html;
  return html.replace(HOST_INJECTION, '');
}

export function stripEmptyImageFigures(html: string): string {
  if (!html.includes('<img')) return html;
  return html.replace(EMPTY_IMAGE_FIGURE, (match) =>
    // Only a figure that holds nothing but a source-less <img> is dropped.
    /src=/i.test(match) ? match : '',
  );
}

export function sanitizeNoteHtml(html: string): string {
  return stripEmptyImageFigures(stripHostInjections(html));
}
