let pagefindPromise;

function loadPagefind() {
  // Generated after Astro builds; load the index only when a visitor searches.
  return pagefindPromise ??= import(/* @vite-ignore */ '/pagefind/pagefind.js').catch(error => {
    pagefindPromise = undefined;
    throw error;
  });
}

export function initSearch(root = document, loadIndex = loadPagefind) {
  const panel = root.querySelector('#search-panel');
  const toggle = root.querySelector('#search-toggle');
  const input = root.querySelector('#search-input');
  const closeButton = root.querySelector('#search-close');
  const results = root.querySelector('#search-results');
  const status = root.querySelector('#search-status');
  const more = root.querySelector('#search-more');
  if (!panel || !toggle || !input || !closeButton || !results || !status || !more || panel.dataset.searchMounted) return;
  panel.dataset.searchMounted = 'true';

  const doc = panel.ownerDocument;
  const win = doc.defaultView;
  const events = new win.AbortController();
  const on = (target, type, handler) => target.addEventListener(type, handler, { signal: events.signal });
  let timer;
  let frame;
  let revision = 0;
  let disposed = false;
  let handles = [];
  let shown = 0;
  let loading = false;
  let previousOverflow = '';
  let returnFocus;
  const pageSize = 10;

  const setStatus = text => { status.textContent = text; };
  const idle = () => {
    results.replaceChildren();
    more.hidden = true;
    results.setAttribute('aria-busy', 'false');
    setStatus('输入关键词，搜索文章标题、标签与正文。');
  };

  // Keep only text and Pagefind's highlight marks, never arbitrary article HTML.
  const appendExcerpt = (target, html) => {
    const template = doc.createElement('template');
    template.innerHTML = html;
    const append = (parent, node) => {
      if (node.nodeType === 3) parent.append(doc.createTextNode(node.textContent));
      else if (node.nodeType === 1) {
        const next = node.nodeName === 'MARK' ? doc.createElement('mark') : parent;
        if (next !== parent) parent.append(next);
        node.childNodes.forEach(child => append(next, child));
      }
    };
    template.content.childNodes.forEach(node => append(target, node));
  };

  const appendPage = async token => {
    if (loading || token !== revision) return;
    loading = true;
    more.disabled = true;
    results.setAttribute('aria-busy', 'true');
    try {
      const page = await Promise.all(handles.slice(shown, shown + pageSize).map(result => result.data()));
      if (disposed || token !== revision) return;
      const fragment = doc.createDocumentFragment();
      for (const data of page) {
        const url = new URL(data.url, win.location.origin);
        if (url.origin !== win.location.origin || !/^\/blog\/[A-Za-z0-9_-]+\/$/.test(url.pathname)) continue;
        const link = doc.createElement('a');
        link.className = 'search-result-item';
        link.href = url.pathname + url.hash;
        const title = doc.createElement('div');
        title.className = 'search-result-title';
        title.textContent = data.meta.title || '未命名文章';
        const excerpt = doc.createElement('p');
        excerpt.className = 'search-result-excerpt';
        appendExcerpt(excerpt, data.excerpt || '');
        link.append(title, excerpt);
        fragment.append(link);
      }
      results.append(fragment);
      shown += page.length;
      more.hidden = shown >= handles.length;
      more.textContent = '加载更多';
      setStatus(`找到 ${handles.length} 篇文章，已显示 ${shown} 篇。`);
    } catch {
      if (disposed || token !== revision) return;
      setStatus('搜索结果加载失败，请重试。');
      more.hidden = false;
      more.textContent = '重试加载';
    } finally {
      if (token === revision && !disposed) {
        loading = false;
        more.disabled = false;
        results.setAttribute('aria-busy', 'false');
      }
    }
  };

  const search = async (query, token) => {
    if (disposed || token !== revision || panel.hidden) return;
    if (!query) { idle(); return; }
    setStatus('正在搜索…');
    results.setAttribute('aria-busy', 'true');
    try {
      const index = await loadIndex();
      if (disposed || token !== revision) return;
      const response = await index.search(query);
      if (disposed || token !== revision) return;
      handles = response.results;
      shown = 0;
      if (!handles.length) {
        results.setAttribute('aria-busy', 'false');
        setStatus('没有找到匹配的文章，请尝试其他关键词。');
        return;
      }
      await appendPage(token);
    } catch {
      if (disposed || token !== revision) return;
      results.setAttribute('aria-busy', 'false');
      setStatus('搜索暂时不可用，请稍后重新输入关键词重试。');
    }
  };

  const queueSearch = () => {
    win.clearTimeout(timer);
    const token = ++revision;
    loading = false;
    handles = [];
    shown = 0;
    results.replaceChildren();
    more.hidden = true;
    const query = input.value.trim();
    if (!query) { idle(); return; }
    setStatus('正在搜索…');
    results.setAttribute('aria-busy', 'true');
    timer = win.setTimeout(() => search(query, token), 150);
  };

  const open = () => {
    if (!panel.hidden) return;
    returnFocus = doc.activeElement;
    previousOverflow = doc.body.style.overflow;
    doc.body.style.overflow = 'hidden';
    panel.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    frame = win.requestAnimationFrame(() => {
      panel.classList.add('is-open');
      input.focus();
    });
    queueSearch();
  };

  const close = (restoreFocus = true) => {
    if (panel.hidden) return;
    ++revision;
    win.clearTimeout(timer);
    win.cancelAnimationFrame(frame);
    panel.hidden = true;
    panel.classList.remove('is-open');
    toggle.setAttribute('aria-expanded', 'false');
    doc.body.style.overflow = previousOverflow;
    if (restoreFocus && returnFocus?.isConnected) returnFocus.focus();
  };

  on(toggle, 'click', () => panel.hidden ? open() : close());
  on(closeButton, 'click', () => close());
  on(input, 'input', event => { if (!event.isComposing) queueSearch(); });
  on(input, 'compositionend', queueSearch);
  on(more, 'click', () => appendPage(revision));
  on(panel, 'click', event => { if (event.target === panel) close(); });
  on(doc, 'keydown', event => {
    if (event.isComposing) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      panel.hidden ? open() : close();
    } else if (!panel.hidden && event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (!panel.hidden && event.key === 'Tab') {
      const focusable = [...panel.querySelectorAll('input, button:not([disabled]), a[href]')].filter(el => !el.hidden);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && doc.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && doc.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  idle();

  return () => {
    close(false);
    disposed = true;
    ++revision;
    win.clearTimeout(timer);
    win.cancelAnimationFrame(frame);
    events.abort();
    delete panel.dataset.searchMounted;
  };
}
