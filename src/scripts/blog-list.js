export function initBlogList() {
  const rows = Array.from(document.querySelectorAll('.post-row'));
  const postsList = document.getElementById('posts-list');
  const empty = document.getElementById('posts-empty');
  const tagLinks = Array.from(document.querySelectorAll('#tag-row .tag-link'));
  const tagToggle = document.getElementById('tag-toggle');
  const tagExtra = document.getElementById('tag-extra');
  const pagination = document.getElementById('pagination');
  const pageNumbers = document.getElementById('page-numbers');
  const pagePrev = document.getElementById('page-prev');
  const pageNext = document.getElementById('page-next');
  if (!(postsList instanceof HTMLElement)) return;
  const controller = new AbortController();
  const pageSize = Number(postsList.dataset.pageSize || 10);
  let tagHideTimer;

  const getCurrentPage = () => {
    const raw = Number(new URLSearchParams(window.location.search).get('page') || '1');
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 1;
  };

  const setPageInUrl = (page, replace = false) => {
    const url = new URL(window.location.href);
    if (page > 1) url.searchParams.set('page', String(page));
    else url.searchParams.delete('page');
    window.history[replace ? 'replaceState' : 'pushState'](window.history.state, '', url);
  };

  const renderPagination = (totalPages, currentPage) => {
    if (!(pagination instanceof HTMLElement) || !(pageNumbers instanceof HTMLElement)) return;
    pagination.hidden = totalPages <= 1;
    pageNumbers.innerHTML = '';
    if (totalPages <= 1) return;

    const makeButton = (page) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'page-number';
      button.textContent = String(page);
      button.setAttribute('aria-label', `第 ${page} 页`);
      button.classList.toggle('active', page === currentPage);
      button.addEventListener('click', () => {
        setPageInUrl(page);
        applyFilter(new URLSearchParams(window.location.search).get('tag') || '', page, true);
      });
      return button;
    };

    const pages = [];
    for (let page = 1; page <= totalPages; page += 1) {
      if (page === 1 || page === totalPages || Math.abs(page - currentPage) <= 1) pages.push(page);
    }

    let prevPage = 0;
    for (const page of pages) {
      if (prevPage && page - prevPage > 1) {
        const gap = document.createElement('span');
        gap.className = 'page-gap';
        gap.textContent = '…';
        pageNumbers.appendChild(gap);
      }
      pageNumbers.appendChild(makeButton(page));
      prevPage = page;
    }

    if (pagePrev instanceof HTMLButtonElement) pagePrev.disabled = currentPage <= 1;
    if (pageNext instanceof HTMLButtonElement) pageNext.disabled = currentPage >= totalPages;
  };

  const applyFilter = (selectedTag, requestedPage = getCurrentPage(), shouldScroll = false) => {
    const matchedRows = rows.filter((row) => {
      const tagStr = row.getAttribute('data-tags') || '';
      const tags = tagStr ? tagStr.split('|') : [];
      return !selectedTag || tags.includes(selectedTag);
    });
    const totalPages = Math.max(1, Math.ceil(matchedRows.length / pageSize));
    const currentPage = Math.min(Math.max(1, requestedPage), totalPages);
    const start = (currentPage - 1) * pageSize;
    const visibleSet = new Set(matchedRows.slice(start, start + pageSize));

    if (requestedPage !== currentPage) setPageInUrl(currentPage, true);

    for (const row of rows) {
      const visible = visibleSet.has(row);
      row.hidden = !visible;
    }

    if (empty) empty.style.display = matchedRows.length === 0 ? 'block' : 'none';
    renderPagination(totalPages, currentPage);

    for (const link of tagLinks) {
      const tag = link.getAttribute('data-tag') || '';
      link.classList.toggle('active', tag === selectedTag);
    }

    if (shouldScroll) {
      const top = postsList instanceof HTMLElement ? postsList.getBoundingClientRect().top + window.scrollY - 120 : 0;
      window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }
  };

  if (tagToggle && tagExtra) {
    tagToggle.addEventListener('click', () => {
      window.clearTimeout(tagHideTimer);
      const expanded = tagToggle.getAttribute('aria-expanded') === 'true';
      tagToggle.setAttribute('aria-expanded', String(!expanded));
      tagToggle.textContent = expanded ? '+' : '-';

      if (expanded) {
        tagExtra.classList.remove('is-visible');
        tagHideTimer = window.setTimeout(() => {
          tagExtra.hidden = true;
        }, 180);
      } else {
        tagExtra.hidden = false;
        tagExtra.classList.remove('is-visible');
        void tagExtra.offsetWidth;
        requestAnimationFrame(() => {
          requestAnimationFrame(() => tagExtra.classList.add('is-visible'));
        });
        requestAnimationFrame(() => {
          tagExtra.scrollTop = 0;
        });
      }
    });
  }

  const currentTag = new URLSearchParams(window.location.search).get('tag') || '';
  applyFilter(currentTag);

  for (const link of tagLinks) {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      const tag = link.getAttribute('data-tag') || '';
      const url = new URL(window.location.href);
      if (tag) {
        url.searchParams.set('tag', tag);
      } else {
        url.searchParams.delete('tag');
      }
      url.searchParams.delete('page');
      window.history.pushState(window.history.state, '', url);
      applyFilter(tag, 1, true);
    });
  }

  pagePrev?.addEventListener('click', () => {
    const page = Math.max(1, getCurrentPage() - 1);
    setPageInUrl(page);
    applyFilter(new URLSearchParams(window.location.search).get('tag') || '', page, true);
  });

  pageNext?.addEventListener('click', () => {
    const tag = new URLSearchParams(window.location.search).get('tag') || '';
    const visibleCount = rows.filter((row) => {
      const tagStr = row.getAttribute('data-tags') || '';
      const tags = tagStr ? tagStr.split('|') : [];
      return !tag || tags.includes(tag);
    }).length;
    const totalPages = Math.max(1, Math.ceil(visibleCount / pageSize));
    const page = Math.min(totalPages, getCurrentPage() + 1);
    setPageInUrl(page);
    applyFilter(tag, page, true);
  });

  window.addEventListener('popstate', () => {
    const tag = new URLSearchParams(window.location.search).get('tag') || '';
    applyFilter(tag);
  }, { signal: controller.signal });

  return () => {
    controller.abort();
    window.clearTimeout(tagHideTimer);
  };
}
