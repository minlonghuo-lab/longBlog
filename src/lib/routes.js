// Page URLs are directory URLs; do not derive article URLs from editable titles.
export const PAGE_PATHS = Object.freeze({
  home: '/', blog: '/blog/', shuoshuo: '/shuoshuo/', friends: '/friends/', about: '/about/',
});

/** @param {string} noteId */
export function getPostRouteId(noteId) {
  if (typeof noteId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(noteId)) {
    throw new Error('Article routes require a non-empty ASCII Trilium noteId');
  }
  return noteId;
}

/** @param {string} noteId */
export function getPostPath(noteId) {
  return `${PAGE_PATHS.blog}${getPostRouteId(noteId)}/`;
}
