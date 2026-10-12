# Stable article URLs and EdgeOne routing

Canonical article URLs are `/blog/<Trilium noteId>/`. The noteId is stable and
ASCII; titles and article content remain Chinese. `post.slug` is retained for
search and migration compatibility, not used to generate new article URLs.

- Shared page/article URL helpers: `src/lib/routes.js`.
- Static output: `dist/blog/<noteId>/index.html`.
- Astro remains a static site, with directory output and trailing-slash URLs.
- Homepage, article cards, search results, tags, navigation and terminal links
  use the same directory URL convention. Pagination retains its query state.
- Do not edit generated Trilium metadata/content to change route IDs. The next
  content sync can overwrite generated files, but these frontend route helpers
  remain independent of that sync.

## EdgeOne Makers

`edgeone.json` declares `npm run build` and `dist`. It preserves the 16 articles'
legacy title-based paths known at migration time, both raw Chinese and URL-encoded,
with and without a trailing slash, as direct 301 redirects to the noteId URL.
These are a permanent migration snapshot: do not regenerate them from new titles
or delete an old alias merely because an article was renamed.

Exact rewrites support slashless section links and noteId links by resolving them
to the actual `index.html`. There is no catch-all SPA fallback; unknown pages must
not silently show the homepage. New posts automatically get noteId URLs from the
normal Trilium sync and need no new rewrite rule. If importing more pre-existing
title URLs later, add their old-to-new mappings, checking the platform's 100-rule
and 500-character redirect limits.

`npm test` checks every generated article, primary internal links, Chinese search,
legacy redirect targets, route uniqueness and existing navigation/terminal/content
regressions. It does not prove that EdgeOne has applied those rules: after deploying,
check `/blog/`, `/shuoshuo/`, `/friends/`, `/about/`, a noteId article URL and a
legacy Chinese URL (both status and destination).

Only frontend routing and deployment configuration change. Article data, ETAPI
credentials, server automation, DNS and account settings are not modified.
