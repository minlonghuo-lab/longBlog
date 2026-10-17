import { initBlogList } from './blog-list.js';
import { initMemosPage } from './memos.js';
import { initSearch } from './search.js';

let cleanup = [];

function initPage() {
  cleanup = [initBlogList(), initMemosPage(), initSearch()].filter(Boolean);
}

// after-swap runs inside Astro's view-transition update callback. The new
// snapshot must already contain filtered posts and any cached memos.
document.addEventListener('astro:before-swap', (event) => {
  cleanup.forEach(dispose => dispose());
  cleanup = [];
  const theme = document.documentElement.dataset.theme;
  if (theme) {
    event.newDocument.documentElement.dataset.theme = theme;
    event.newDocument.documentElement.style.colorScheme = theme;
  }
});

document.addEventListener('astro:after-swap', initPage);
initPage();
