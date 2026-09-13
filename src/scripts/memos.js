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

  let pageToken = '';
  let hasMore = true;
  let loading = false;
  let pinnedReady = false;
  const seen = new Set();
  const memoStore = new Map();

  const PAGE_SIZE = 10;
  const CACHE_KEY = `LONG_BLOG_MEMOS_CACHE_V3:${memosApiBase}`;
  const CACHE_TTL = 30 * 1000;
  const MAX_SAME_TOKEN_HITS = 2;
  let lastNextPageToken = '';
  let sameTokenHits = 0;
  let requestPageSize = PAGE_SIZE;

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
    const attachments = Array.isArray(memo.attachments) ? memo.attachments : [];

    for (const att of attachments) {
      const attachmentId = (att.name || '').replace('attachments/', '');
      const filename = att.filename || '';
      if (!attachmentId || !filename) continue;
      const fileUrl = `${memosApiBase}/file/attachments/${attachmentId}/${encodeURIComponent(filename)}`;
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

  function renderMemo(memo) {
    const content = processContent(memo.content || '');
    const { images, files } = mapAttachments(memo);
    const tags = (memo.tags || []).filter((t) => !String(t).startsWith('#'));
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
          <time>${escapeHTML(formatDate(memo.createTime))}</time>
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
      return new Date(b.createTime).getTime() - new Date(a.createTime).getTime();
    });

    // Retain unchanged cards (especially decoded thumbnails) during refresh/pagination.
    const existing = new Map(Array.from(listEl.children).map(node => [node.dataset.memoKey, node]));
    items.forEach((memo, index) => {
      const key = String(memo.name || `${memo.createTime}-${memo.updateTime}-${memo.content?.slice(0, 16) || ''}`);
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
      const memoKey = String(memo.name || `${memo.createTime}-${memo.updateTime}-${memo.content?.slice(0, 16) || ''}`);
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

  async function fetchPage(pageTokenValue = '', pageSize = PAGE_SIZE) {
    const qs = new URLSearchParams({ pageSize: String(pageSize) });
    if (pageTokenValue) qs.set('pageToken', pageTokenValue);
    const resp = await fetch(`${memosApiBase}/api/v1/memos?${qs.toString()}`, { cache: 'no-store', signal: controller.signal });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  }

  async function loadMore() {
    if (disposed || !hasMore || loading) return;
    loading = true;
    loadingEl.style.display = 'block';
    errorEl.style.display = 'none';

    try {
      const data = await fetchPage(pageToken, requestPageSize);
      if (disposed) return;
      let memos = Array.isArray(data.memos) ? data.memos : [];

      if (!pinnedReady) {
        try {
          const pinData = await fetchPage('', 100);
          const pinMemos = Array.isArray(pinData?.memos) ? pinData.memos.filter((m) => m?.pinned) : [];
          if (pinMemos.length) {
            const mergeMap = new Map();
            for (const m of [...pinMemos, ...memos]) {
              const key = String(m.name || `${m.createTime}-${m.updateTime}-${m.content?.slice(0, 16) || ''}`);
              mergeMap.set(key, m);
            }
            memos = [...mergeMap.values()];
          }
        } catch {}
        pinnedReady = true;
      }

      if (disposed) return;
      const publicMemos = memos.filter((m) => m.visibility === 'PUBLIC');
      const beforeCount = seen.size;
      mergeMemos(publicMemos);
      const addedCount = seen.size - beforeCount;

      if (!pageToken) {
        refreshedAt = Date.now();
        setCachedFirstPage({ memos: publicMemos, nextPageToken: data.nextPageToken || '' });
      }

      const nextToken = data.nextPageToken || '';
      if (nextToken) {
        if (nextToken === lastNextPageToken) sameTokenHits += 1;
        else sameTokenHits = 0;
        lastNextPageToken = nextToken;
        pageToken = nextToken;
        hasMore = sameTokenHits < MAX_SAME_TOKEN_HITS;
      } else {
        pageToken = '';
        if (addedCount > 0 && memos.length >= requestPageSize) {
          requestPageSize += PAGE_SIZE;
          hasMore = true;
        } else {
          hasMore = false;
        }
      }

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
      pageToken = cached.nextPageToken || '';
      hasMore = restored ? restored.hasMore : !!pageToken;
      pinnedReady = restored?.pinnedReady || false;
      requestPageSize = restored?.requestPageSize || PAGE_SIZE;
      lastNextPageToken = restored?.lastNextPageToken || '';
      sameTokenHits = restored?.sameTokenHits || 0;
      refreshedAt = restored?.ts || refreshedAt;
      mergeMemos(cached.memos);
      loadingEl.style.display = 'none';
      if (Date.now() - refreshedAt < CACHE_TTL) return;
      // Show the restored list immediately; refresh only changed cards in the background.
      loading = true;
      try {
        const data = await fetchPage('', PAGE_SIZE);
        if (disposed) return;
        const memos = Array.isArray(data.memos) ? data.memos.filter(m => m.visibility === 'PUBLIC') : [];
        if (!restored || restored.memos.length <= PAGE_SIZE) {
          pageToken = data.nextPageToken || '';
          hasMore = !!pageToken;
        }
        mergeMemos(memos);
        refreshedAt = Date.now();
        setCachedFirstPage({ memos, nextPageToken: data.nextPageToken || '' });
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
      nextPageToken: pageToken,
      hasMore,
      pinnedReady,
      requestPageSize,
      lastNextPageToken,
      sameTokenHits,
      ts: refreshedAt,
    };
    disposed = true;
    controller.abort();
    io.disconnect();
    document.body.classList.remove('lightbox-open');
    document.body.style.overflow = '';
  };
}
