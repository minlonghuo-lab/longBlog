# About Terminal

`/about/` keeps all ordinary terminal commands local. The optional `chat` mode
uses a separate CloudBase service. See [terminal-chat.md](terminal-chat.md) for
private configuration, deployment, limits and verification.

## Commands

- `profile`: public site profile; `fastfetch` and `whoami` are aliases.
- `knowledge`: static Mathematics / Code / Life directory and article link.
- `projects`: confirmed public projects.
- `history`: author-provided milestones; initially empty, not fabricated.
- `clear`: clear visible output (including the initial profile), retain command recall.
- `chat`: enter author messaging; `exit`, `quit` or `:q` returns to local commands.

Enter executes, Up/Down recalls commands, Tab completes a prefix.
All six commands have tappable entries. Chat replaces these with exit/clear controls
and keeps message text out of ordinary command recall and completion.
Keep at most 30 output blocks and 100 commands, only during the current visit.
Command input is rendered as text, never evaluated or executed as a shell.

## Maintenance

- Public content: `src/data/about.ts`.
- Terminal styles: `src/styles/about-console.css`.
- The titlebar button reuses the global `#theme-toggle` handler and
  `LONG_BLOG_THEME` preference. No separate About theme storage.
- The line-art mark derives from the existing Knowledge Spine logo.
- Basic profile and article/GitHub links work without JavaScript.
- Mount once per page root; release handlers and observers on every
  `astro:before-swap`, including repeat visits.

## Removed graph

The vis-network graph, node loading, graph controls and tree API requests are
intentionally removed, along with `vis-network` and `vis-data`.
This page no longer uses `PUBLIC_TRILIUM_TREE_API_URL` or
`PUBLIC_TRILIUM_BASE_URL`. This change does not edit deployment settings.

Trilium **article publishing/synchronization** is unaffected. Do not remove
server-side `TRILIUM_BASE_URL` or ETAPI tokens used by publishing scripts.
