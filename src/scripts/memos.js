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
  const nodeSignatures = new WeakMap();

  let cursor = '';
  let offset = 0;
  let hasMore = true;
  let loading = false;
  const seen = new Set();
  const memoStore = new Map();

  const PAGE_SIZE = 10;
  const CACHE_KEY = `LONG_BLOG_MEMOS_CACHE_V3:${memosApiBase}`;
  const CACHE_TTL = 30 * 1000;

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

  function renderAllMemos() {
    const items = [...memoStore.values()].sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return (b.displayTs || b.createdTs) - (a.displayTs || a.createdTs);
    });

    // Retain unchanged cards (especially decoded thumbnails) during refresh/pagination.
    const existing = new Map(Array.from(listEl.children).map(node => [node.dataset.memoKey, node]));
    items.forEach((memo, index) => {
      const key = memoKeyOf(memo);
      const signature = JSON.stringify(memo);
      let node = existing.get(key);
      if (!node || nodeSignatures.get(node) !== signature) {
        const updated = renderMemo(memo);
        updated.dataset.memoKey = key;
        nodeSignatures.set(updated, signature);
        if (node) node.replaceWith(updated);
        node = updated;
      }
      if (listEl.children[index] !== node) listEl.insertBefore(node, listEl.children[index] || null);
      existing.delete(key);
    });
    for (const node of existing.values()) node.remove();

    emptyEl.style.display = items.length ? 'none' : 'block';
    endEl.style.display = !hasMore && items.length ? 'block' : 'none';
  }

  function mergeMemos(memos) {
    for (const memo of memos) {
      const memoKey = memoKeyOf(memo);
      seen.add(memoKey);
      memoStore.set(memoKey, memo);
    }
    renderAllMemos();
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
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data }));
    } catch {}
  }

  async function requestJson(url) {
    const resp = await fetch(url, { cache: 'no-store', signal: controller.signal });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    // 旧路径在新版实例上会被前端路由接管并返回 HTML，这里显式拦掉
    const contentType = resp.headers.get('content-type') || '';
    if (!contentType.includes('json')) throw new Error(`Unexpected content-type: ${contentType}`);
    return await resp.json();
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
  async function fetchPage(pageSize = PAGE_SIZE) {
    await detectApi();
    if (disposed) return { memos: [], nextToken: '' };

    if (modernApi) {
      const qs = new URLSearchParams({ limit: String(pageSize), offset: String(offset) });
      const data = await requestJson(`${apiBase}/api/v1/memo?${qs.toString()}`);
      return { memos: Array.isArray(data) ? data : [], nextToken: '' };
    }

    const qs = new URLSearchParams({ pageSize: String(pageSize) });
    if (cursor) qs.set('pageToken', cursor);
    const data = await requestJson(`${apiBase}/api/v1/memos?${qs.toString()}`);
    return { memos: Array.isArray(data?.memos) ? data.memos : [], nextToken: data?.nextPageToken || '' };
  }

  // 隐藏：只展示公开且未被归档的说说，PRIVATE / ARCHIVED 一律不渲染
  function visibleMemos(rawMemos) {
    return rawMemos
      .map(normalizeMemo)
      .filter((m) => m.visibility === 'PUBLIC' && m.state === 'NORMAL');
  }

  function advancePagination(batchLength, nextToken, addedCount) {
    if (modernApi) {
      offset += PAGE_SIZE;
      // 返回数量不足一页说明已到底
      hasMore = batchLength >= PAGE_SIZE;
    } else {
      cursor = nextToken;
      hasMore = Boolean(cursor);
    }
    // 防止整页都是不可见内容时无限循环
    if (hasMore && addedCount === 0) hasMore = false;
  }

  async function loadMore() {
    if (disposed || !hasMore || loading) return;
    loading = true;
    loadingEl.style.display = 'block';
    errorEl.style.display = 'none';

    try {
      const data = await fetchPage(PAGE_SIZE);
      if (disposed) return;
      const memos = visibleMemos(data.memos);
      const beforeCount = seen.size;
      mergeMemos(memos);
      const addedCount = seen.size - beforeCount;

      const isFirstPage = modernApi ? offset === 0 : !cursor;
      if (isFirstPage) {
        refreshedAt = Date.now();
        setCachedFirstPage({ memos: [...memoStore.values()], offset, cursor, hasMore });
      }

      advancePagination(data.memos.length, data.nextToken, addedCount);

      if (!hasMore) {
        loadingEl.style.display = 'none';
        endEl.style.display = listEl.children.length ? 'block' : 'none';
      }
      if (!listEl.children.length) emptyEl.style.display = 'block';
    } catch (err) {
      if (disposed) return;
      loadingEl.style.display = 'none';
      errorEl.textContent = '加载失败，请稍后刷新重试';
      errorEl.style.display = 'block';
      console.error('[memos] load error:', err);
      return;
    } finally {
      loading = false;
      if (hasMore) loadingEl.style.display = 'none';
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
      // Show the restored list immediately; refresh only changed cards in the background.
      loading = true;
      try {
        const data = await fetchPage(PAGE_SIZE);
        if (disposed) return;
        const memos = visibleMemos(data.memos);
        if (!restored || restored.memos.length <= PAGE_SIZE) {
          // 首页整体替换后，分页状态需要归零重建
          offset = 0;
          cursor = '';
          hasMore = true;
          advancePagination(data.memos.length, data.nextToken, memos.length);
        }
        mergeMemos(memos);
        refreshedAt = Date.now();
        setCachedFirstPage({ memos, offset, cursor, hasMore });
      } catch {
        // The restored content remains usable when the refresh is unavailable.
      } finally {
        loading = false;
      }
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
    if (!disposed) io.observe(sentinelEl);
  });

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
    controller.abort();
    io.disconnect();
    document.body.classList.remove('lightbox-open');
    document.body.style.overflow = '';
  };
}
