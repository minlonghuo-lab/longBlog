// Keep all loaded pages when navigating away, including the pagination cursor.
let memoSession = null;

export function initMemosPage() {
  const wrap = document.querySelector('.memos-wrap');
  if (!(wrap instanceof HTMLElement)) return;
  const memosApiBase = wrap.dataset.memosApiBase || '';

  const listEl = document.getElementById('memos-list');
  const loadingEl = document.getElementById('memos-loading');
  const endEl = document.getElementById('memos-end');
  const emptyEl = document.getElementById('memos-empty');
  const errorEl = document.getElementById('memos-error');

  const sentinelEl = document.getElementById('memos-sentinel');
  const previewEl = document.getElementById('image-preview');
  const previewImgEl = document.getElementById('preview-image');
  const closeBtn = document.getElementById('preview-close');

  const controller = new AbortController();
  let disposed = false;
  let refreshedAt = 0;
  let refreshTimer;
  const nodeSignatures = new WeakMap();
  const pendingRemovals = new Map();

  let cursor = '';
  let offset = 0;
  let hasMore = true;
  let loading = false;
  const memoStore = new Map();

  const PAGE_SIZE = 10;
  const CACHE_KEY = `LONG_BLOG_MEMOS_CACHE_V3:${memosApiBase}`;
  const CACHE_TTL = 30 * 1000;
  const REFRESH_INTERVAL = 30 * 1000;

  // 新版（v1.0.0）用 /api/v1/memo 偏移分页，旧版用 /api/v1/memos 游标分页
  // null = 尚未探测，true = 新接口，false = 旧接口
  let modernApi = null;
  let apiBase = memosApiBase;

  function formatDate(input) {
    const d = new Date(input);
    return d.toLocaleString('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function processContent(content) {
    return content
      .split('\n')
      .map((line) => line.replace(/^(\s*#\S+\s*)+/, '').trimStart())
      .join('\n')
      .trim();
  }

  function escapeHTML(str) {
    return (str || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function extractMarkdownImages(content) {
    const images = [];
    const regex = /!\[[^\]]*\]\(([^)]+)\)/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
      images.push(match[1]);
    }
    return images;
  }

  function mapAttachments(memo) {
    const images = [];
    const files = [];
    // 新版字段是 resourceList，旧版是 attachments
    const attachments = Array.isArray(memo.resourceList)
      ? memo.resourceList
      : (Array.isArray(memo.attachments) ? memo.attachments : []);

    for (const att of attachments) {
      const filename = att.filename || '';
      if (!filename) continue;

      let fileUrl = att.externalLink || '';
      if (!fileUrl) {
        const rawId = String(att.id || att.name || '').replace(/^(attachments|resource)\//, '');
        if (!rawId) continue;
        fileUrl = modernApi
          ? `${apiBase}/api/v1/resource/${encodeURIComponent(rawId)}/file`
          : `${apiBase}/file/attachments/${rawId}/${encodeURIComponent(filename)}`;
      }

      if ((att.type || '').startsWith('image/')) {
        images.push(fileUrl);
      } else {
        files.push({
          name: filename,
          url: fileUrl,
          type: att.type || 'file',
        });
      }
    }

    for (const mdImg of extractMarkdownImages(memo.content || '')) {
      if (!images.includes(mdImg)) images.push(mdImg);
    }

    return { images, files };
  }

  function normalizeTags(memo) {
    const raw = Array.isArray(memo.tagList)
      ? memo.tagList.map((t) => (t && typeof t === 'object' ? t.name : t))
      : (Array.isArray(memo.tags) ? memo.tags : []);
    return raw
      .map((t) => String(t || '').replace(/^#/, '').trim())
      .filter(Boolean);
  }

  function memoKeyOf(memo) {
    return String(memo.id || memo.name || `${memo.displayTs}-${memo.content?.slice(0, 16) || ''}`);
  }

  // 把新旧两种接口返回统一成内部结构
  function normalizeMemo(raw) {
    const id = String(raw.id ?? raw.name ?? '');
    const createdTs = typeof raw.createdTs === 'number'
      ? raw.createdTs
      : Math.floor(new Date(raw.createTime || 0).getTime() / 1000);
    const updatedTs = typeof raw.updatedTs === 'number'
      ? raw.updatedTs
      : Math.floor(new Date(raw.updateTime || raw.createTime || 0).getTime() / 1000);
    const displayTs = typeof raw.displayTs === 'number' ? raw.displayTs : createdTs;

    return {
      id,
      name: raw.name,
      content: raw.content || '',
      // 新旧字段名不同，统一到 pinned / visibility / state
      pinned: Boolean(raw.pinned),
      visibility: String(raw.visibility || 'PUBLIC'),
      state: String(raw.rowStatus || raw.state || 'NORMAL'),
      createdTs,
      updatedTs,
      displayTs,
      tagList: normalizeTags(raw),
      resourceList: raw.resourceList,
      attachments: raw.attachments,
    };
  }

  function renderMemo(memo) {
    const content = processContent(memo.content || '');
    const { images, files } = mapAttachments(memo);
    const tags = normalizeTags(memo);
    const article = document.createElement('article');
    article.className = 'memo-item';

    const imageGridHTML = images.length
      ? `<div class="memo-images memo-images-${Math.min(images.length, 9)}" style="--thumb-size:4.8rem;max-width:15.2rem;">${images
          .map((img) => `<button class="memo-img-btn" data-img="${escapeHTML(img)}" style="width:4.8rem;height:4.8rem;max-width:4.8rem;max-height:4.8rem;" aria-label="查看大图"><img src="${escapeHTML(img)}" loading="lazy" alt="图片缩略图" style="width:100%;height:100%;object-fit:cover;" /></button>`)
          .join('')}</div>`
      : '';

    const filesHTML = files.length
      ? `<div class="memo-files">${files
          .map((file) => `<a href="${escapeHTML(file.url)}" target="_blank" rel="noopener noreferrer" class="memo-file"><span class="memo-file-name">📎 ${escapeHTML(file.name)}</span><span class="memo-file-type">${escapeHTML(file.type)}</span></a>`)
          .join('')}</div>`
      : '';

    const tagsHTML = tags.length
      ? `<div class="memo-tags">${tags
          .map((tag) => `<span>#${escapeHTML(String(tag))}</span>`)
          .join('')}</div>`
      : '';

    article.innerHTML = `
      <div class="timeline-line"></div>
      <div class="timeline-dot"></div>
      <div class="memo-body">
        <div class="memo-meta">
          <time>${escapeHTML(formatDate(memo.displayTs * 1000))}</time>
          ${memo.pinned ? '<span class="memo-pinned">置顶</span>' : ''}
        </div>
        <div class="memo-content">${escapeHTML(content).replaceAll('\n', '<br>')}</div>
        ${imageGridHTML}
        ${filesHTML}
        ${tagsHTML}
      </div>
    `;

    return article;
  }

  function captureReadingAnchor() {
    if (window.scrollY <= 0 || listEl.getBoundingClientRect().top >= 0) return null;
    const node = [...listEl.children].find(node => {
      if (!memoStore.has(node.dataset.memoKey) || pendingRemovals.has(node.dataset.memoKey)) return false;
      const rect = node.getBoundingClientRect();
      return rect.bottom > 100 && rect.top < window.innerHeight;
    });
    return node ? { key: node.dataset.memoKey, top: node.getBoundingClientRect().top } : null;
  }

  function restoreReadingAnchor(anchor) {
    if (!anchor) return;
    const node = [...listEl.children].find(node => node.dataset.memoKey === anchor.key);
    const delta = node ? node.getBoundingClientRect().top - anchor.top : 0;
    // The site uses smooth scrolling; anchoring must happen within this frame.
    if (delta) window.scrollBy({ top: delta, behavior: 'instant' });
  }

  function updateListStatus() {
    emptyEl.style.display = !memoStore.size && !pendingRemovals.size ? 'block' : 'none';
    endEl.style.display = !hasMore && memoStore.size ? 'block' : 'none';
  }

  function cancelRemoval(key) {
    const pending = pendingRemovals.get(key);
    if (!pending) return;
    window.clearTimeout(pending.timer);
    pending.node.removeEventListener('animationend', pending.onEnd);
    pendingRemovals.delete(key);
    pending.node.classList.remove('memo-item-exit');
    pending.node.removeAttribute('aria-hidden');
    pending.node.inert = false;
  }

  function removeCard(node, animate) {
    const key = node.dataset.memoKey;
    if (pendingRemovals.has(key)) return;
    if (!animate) { node.remove(); return; }
    const finish = () => {
      if (disposed || !pendingRemovals.has(key)) return;
      const anchor = captureReadingAnchor();
      cancelRemoval(key);
      node.remove();
      updateListStatus();
      restoreReadingAnchor(anchor);
    };
    const onEnd = event => {
      if (event.target === node && event.animationName === 'memo-exit') finish();
    };
    node.classList.remove('memo-item-enter');
    node.classList.add('memo-item-exit');
    node.setAttribute('aria-hidden', 'true');
    node.inert = true;
    node.addEventListener('animationend', onEnd);
    // Also finish when animations are disabled/cancelled while the card exits.
    pendingRemovals.set(key, { node, onEnd, timer: window.setTimeout(finish, 450) });
  }

  function renderAllMemos({ animate = false, preserveScroll = false } = {}) {
    const shouldAnimate = animate && !window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    const anchor = preserveScroll ? captureReadingAnchor() : null;
    const items = [...memoStore.values()].sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return (b.displayTs || b.createdTs) - (a.displayTs || a.createdTs)
        || memoKeyOf(b).localeCompare(memoKeyOf(a), undefined, { numeric: true });
    });

    // Retain unchanged cards (especially decoded thumbnails) during refresh/pagination.
    const existing = new Map(Array.from(listEl.children).map(node => [node.dataset.memoKey, node]));
    // Leave outgoing cards in their original position until the fade finishes.
    for (const [key, node] of existing) {
      if (!memoStore.has(key)) removeCard(node, shouldAnimate);
      else cancelRemoval(key);
    }
    const nextActive = node => {
      while (node && pendingRemovals.has(node.dataset.memoKey)) node = node.nextElementSibling;
      return node;
    };
    let position = nextActive(listEl.firstElementChild);
    items.forEach(memo => {
      const key = memoKeyOf(memo);
      const signature = JSON.stringify(memo);
      let node = existing.get(key);
      const isNew = !node;
      if (!node || nodeSignatures.get(node) !== signature) {
        const updated = renderMemo(memo);
        updated.dataset.memoKey = key;
        nodeSignatures.set(updated, signature);
        if (position === node) position = updated;
        if (node) node.replaceWith(updated);
        node = updated;
      }
      if (shouldAnimate && isNew) {
        node.classList.add('memo-item-enter');
        node.addEventListener('animationend', () => node.classList.remove('memo-item-enter'),
          { once: true, signal: controller.signal });
      }
      if (position !== node) listEl.insertBefore(node, position);
      position = nextActive(node.nextElementSibling);
    });
    updateListStatus();
    restoreReadingAnchor(anchor);
  }

  function mergeMemos(memos, options) {
    for (const memo of memos) {
      const memoKey = memoKeyOf(memo);
      memoStore.set(memoKey, memo);
    }
    renderAllMemos(options);
  }

  function getCachedFirstPage() {
    try {
      const raw = sessionStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.ts || !Array.isArray(parsed.data?.memos)) return null;
      refreshedAt = parsed.ts;
      return parsed.data;
    } catch {
      return null;
    }
  }

  function setCachedFirstPage(data) {
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ts: refreshedAt, data }));
    } catch {}
  }

  async function requestJson(url) {
    const request = new AbortController();
    const abort = () => request.abort();
    if (controller.signal.aborted) abort();
    controller.signal.addEventListener('abort', abort, { once: true });
    const timeout = window.setTimeout(abort, 15000);
    try {
      const resp = await fetch(url, { cache: 'no-store', signal: request.signal });
      const contentType = resp.headers.get('content-type') || '';
      if (!resp.ok) throw Object.assign(new Error(`HTTP ${resp.status}`), { status: resp.status, contentType });
      // 旧路径在新版实例上会被前端路由接管并返回 HTML，这里显式拦掉
      if (!contentType.includes('json')) throw new Error(`Unexpected content-type: ${contentType}`);
      return await resp.json();
    } finally {
      window.clearTimeout(timeout);
      controller.signal.removeEventListener('abort', abort);
    }
  }

  // 探测实例版本：新版 /api/v1/memo 返回 JSON 数组，旧版 /api/v1/memos 返回 { memos: [...] }
  async function detectApi() {
    if (modernApi !== null) return modernApi;

    const bases = [apiBase, 'https://memos.ssaw.top']
      .filter((v, i, arr) => v && arr.indexOf(v) === i);

    for (const base of bases) {
      try {
        const data = await requestJson(`${base}/api/v1/memo?limit=1`);
        if (Array.isArray(data)) {
          modernApi = true;
          apiBase = base;
          return true;
        }
      } catch {}
      try {
        const data = await requestJson(`${base}/api/v1/memos?pageSize=1`);
        if (data && Array.isArray(data.memos)) {
          modernApi = false;
          apiBase = base;
          return false;
        }
      } catch {}
    }

    modernApi = false;
    return false;
  }

  // 新版：offset/limit 分页，直接返回数组；旧版：pageToken 游标分页
  // 注意：必须传 object 而不是「值」，否则调用方读取 modernApi 时它还是 null，
  // 会把 offset 误当成 cursor 传进来，导致分页永远停在第一页。
  async function fetchPageAt(target, pageSize) {
    await detectApi();
    if (disposed) return { memos: [], nextToken: '' };

    if (modernApi) {
      const at = typeof target?.offset === 'number' ? target.offset : offset;
      const qs = new URLSearchParams({ limit: String(pageSize), offset: String(at) });
      const data = await requestJson(`${apiBase}/api/v1/memo?${qs.toString()}`);
      if (!Array.isArray(data)) throw new Error('Invalid memo list');
      return { memos: data, nextToken: '' };
    }

    const token = typeof target?.cursor === 'string' ? target.cursor : cursor;
    const qs = new URLSearchParams({ pageSize: String(pageSize) });
    if (token) qs.set('pageToken', token);
    const data = await requestJson(`${apiBase}/api/v1/memos?${qs.toString()}`);
    if (!Array.isArray(data?.memos)) throw new Error('Invalid memo list');
    return { memos: data.memos, nextToken: data?.nextPageToken || '' };
  }

  async function noLongerPublic(memo) {
    const id = String(memo.id || memo.name || '').replace(/^memos?\//, '');
    if (!id) return false;
    try {
      const endpoint = modernApi ? 'memo' : 'memos';
      const result = await requestJson(`${apiBase}/api/v1/${endpoint}/${encodeURIComponent(id)}`);
      const raw = result?.memo || result;
      // A valid detail may now be archived/private. Malformed responses and
      // transport failures never count as evidence that a post was deleted.
      return raw && (raw.id !== undefined || raw.name) && memoKeyOf(raw) === memoKeyOf(memo)
        && visibleMemos([raw]).length === 0;
    } catch (error) {
      return [403, 404, 410].includes(error.status) && error.contentType?.includes('json');
    }
  }

  // 取当前分页位置，不传参即使用当前进度
  function fetchPage(pageSize = PAGE_SIZE) {
    return fetchPageAt({ offset, cursor }, pageSize);
  }

  // 隐藏：只展示公开且未被归档的说说，PRIVATE / ARCHIVED 一律不渲染
  function visibleMemos(rawMemos) {
    return rawMemos
      .map(normalizeMemo)
      .filter((m) => m.visibility === 'PUBLIC' && m.state === 'NORMAL');
  }

  // 分页推进只看服务端返回的批次大小，不用去重后的新增数量判断，
  // 否则「重复请求同一页」或「整页都是不可见内容」都会被误判成已经到底。
  function advancePagination(batchLength, nextToken) {
    if (modernApi) {
      // 推进到下一页；返回数量不足一页说明已到底，等于一页则认为后面可能还有
      offset += PAGE_SIZE;
      hasMore = batchLength >= PAGE_SIZE;
    } else {
      cursor = nextToken;
      hasMore = Boolean(cursor);
    }
  }

  // Guard servers that ignore paging parameters without stopping on already
  // loaded (but different) pages after a live update rebases the cursor.
  const MAX_REPEATED_PAGES = 3;
  let repeatedPageStreak = 0;
  let previousPageKeys = '';

  async function loadMore() {
    if (disposed || !hasMore || loading) return;
    loading = true;
    loadingEl.style.display = 'block';
    errorEl.style.display = 'none';

    try {
      const data = await fetchPage(PAGE_SIZE);
      if (disposed) return;
      const memos = visibleMemos(data.memos);
      mergeMemos(memos, { animate: true });

      // 首屏请求（offset 仍为 0）才写缓存；后续翻页不覆盖，避免把进度写回起点
      const isFirstPage = modernApi ? offset === 0 : !cursor;
      if (isFirstPage) {
        refreshedAt = Date.now();
      }

      // A refresh can move the paging boundary back over already loaded entries.
      // Stop only when the server repeats the SAME page, not merely known IDs.
      const pageKeys = JSON.stringify(data.memos.map(memoKeyOf));
      repeatedPageStreak = pageKeys === previousPageKeys ? repeatedPageStreak + 1 : 0;
      previousPageKeys = pageKeys;

      advancePagination(data.memos.length, data.nextToken);
      if (repeatedPageStreak >= MAX_REPEATED_PAGES) hasMore = false;

      setCachedFirstPage({ memos: [...memoStore.values()], offset, cursor, hasMore });

      if (!hasMore) {
        loadingEl.style.display = 'none';
        endEl.style.display = listEl.children.length ? 'block' : 'none';
      }
      if (!listEl.children.length) emptyEl.style.display = 'block';
    } catch (err) {
      if (disposed) return;
      loadingEl.style.display = 'none';
      errorEl.textContent = '加载失败，稍后将自动重试';
      errorEl.style.display = 'block';
      console.error('[memos] load error:', err);
      return;
    } finally {
      loading = false;
      if (hasMore) loadingEl.style.display = 'none';
    }
  }

  function scheduleRefresh(delay = REFRESH_INTERVAL) {
    window.clearTimeout(refreshTimer);
    if (disposed || document.visibilityState === 'hidden' || window.navigator.onLine === false) return;
    refreshTimer = window.setTimeout(refreshLatest, delay);
  }

  async function refreshLatest() {
    window.clearTimeout(refreshTimer);
    if (disposed || document.visibilityState === 'hidden' || window.navigator.onLine === false) return;
    if (loading || document.body.classList.contains('lightbox-open')) {
      scheduleRefresh(1000);
      return;
    }
    loading = true;
    try {
      // Revalidate the loaded prefix in one request. Rebase pagination to that
      // prefix's actual end so even a burst larger than one page cannot skip posts.
      const size = Math.max(PAGE_SIZE, offset, memoStore.size);
      const data = await fetchPageAt({ offset: 0, cursor: '' }, size);
      if (disposed) return;
      const memos = visibleMemos(data.memos);
      const visibleKeys = new Set(memos.map(memoKeyOf));
      const returnedKeys = new Set(data.memos.map(memoKeyOf));
      const complete = modernApi ? data.memos.length < size : !data.nextToken;
      const removed = new Set();
      for (const raw of data.memos) {
        const key = memoKeyOf(raw);
        if (!visibleKeys.has(key)) removed.add(key);
      }
      const missing = [...memoStore.values()].filter(memo => !returnedKeys.has(memoKeyOf(memo)));
      if (complete) missing.forEach(memo => removed.add(memoKeyOf(memo)));
      else {
        // New posts can push a loaded card outside this prefix. Check missing
        // cards individually before removing them, with bounded concurrency.
        for (let i = 0; i < missing.length; i += 3) {
          if (disposed) return;
          await Promise.all(missing.slice(i, i + 3).map(async memo => {
            if (await noLongerPublic(memo)) removed.add(memoKeyOf(memo));
          }));
        }
      }
      if (disposed) return;
      removed.forEach(key => memoStore.delete(key));
      offset = modernApi ? data.memos.length : 0;
      cursor = data.nextToken;
      hasMore = modernApi ? !complete : Boolean(cursor);
      previousPageKeys = '';
      repeatedPageStreak = 0;
      mergeMemos(memos, { animate: true, preserveScroll: true });
      refreshedAt = Date.now();
      setCachedFirstPage({ memos: [...memoStore.values()], offset, cursor, hasMore });
      loadingEl.style.display = 'none';
      errorEl.style.display = 'none';
    } catch {
      // Keep the current list and pagination on failure; the next check retries.
    } finally {
      loading = false;
      scheduleRefresh();
    }
  }

  async function boot() {
    const restored = memoSession?.api === memosApiBase && memoSession.ts > 0 ? memoSession : null;
    const cached = restored || getCachedFirstPage();
    if (cached && Array.isArray(cached.memos)) {
      offset = restored ? (restored.offset || 0) : (cached.offset || 0);
      cursor = restored ? (restored.cursor || '') : (cached.cursor || '');
      hasMore = restored ? restored.hasMore : cached.hasMore !== false;
      refreshedAt = restored?.ts || refreshedAt;
      mergeMemos(cached.memos);
      loadingEl.style.display = 'none';
      if (Date.now() - refreshedAt < CACHE_TTL) return;
      await refreshLatest();
    } else {
      await loadMore();
    }
  }

  const io = new IntersectionObserver(
    (entries) => {
      const entry = entries[0];
      if (entry && entry.isIntersecting) loadMore();
    },
    { rootMargin: '360px 0px' },
  );

  window.addEventListener('scroll', () => {
    if (disposed || !hasMore || loading) return;
    const remain = document.documentElement.scrollHeight - (window.scrollY + window.innerHeight);
    if (remain < 420) loadMore();
  }, { passive: true, signal: controller.signal });

  listEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.memo-img-btn');
    if (!btn) return;
    const src = btn.getAttribute('data-img');
    if (!src) return;
    previewImgEl.setAttribute('src', src);
    previewEl.style.display = 'flex';
    document.body.classList.add('lightbox-open');
    document.body.style.overflow = 'hidden';
  });

  closeBtn.addEventListener('click', () => {
    previewEl.style.display = 'none';
    previewImgEl.setAttribute('src', '');
    document.body.classList.remove('lightbox-open');
    document.body.style.overflow = '';
  });

  previewEl.addEventListener('click', (e) => {
    if (e.target === previewEl) {
      previewEl.style.display = 'none';
      previewImgEl.setAttribute('src', '');
      document.body.classList.remove('lightbox-open');
      document.body.style.overflow = '';
    }
  });

  // boot() restores cached content synchronously before the transition captures this page.
  const bootPromise = boot();
  bootPromise.finally(() => {
    if (!disposed) {
      io.observe(sentinelEl);
      scheduleRefresh(refreshedAt ? Math.max(0, REFRESH_INTERVAL - (Date.now() - refreshedAt)) : REFRESH_INTERVAL);
    }
  });

  window.addEventListener('focus', refreshLatest, { signal: controller.signal });
  window.addEventListener('online', refreshLatest, { signal: controller.signal });
  window.addEventListener('offline', () => window.clearTimeout(refreshTimer), { signal: controller.signal });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') window.clearTimeout(refreshTimer);
    else refreshLatest();
  }, { signal: controller.signal });

  return () => {
    memoSession = {
      api: memosApiBase,
      memos: [...memoStore.values()],
      offset,
      cursor,
      hasMore,
      ts: refreshedAt,
    };
    disposed = true;
    window.clearTimeout(refreshTimer);
    for (const key of [...pendingRemovals.keys()]) cancelRemoval(key);
    controller.abort();
    io.disconnect();
    document.body.classList.remove('lightbox-open');
    document.body.style.overflow = '';
  };
}
