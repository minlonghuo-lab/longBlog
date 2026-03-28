import { Network } from 'vis-network/standalone/esm/vis-network';
import { DataSet } from 'vis-data/peer/esm/vis-data';

const graphEl = document.getElementById('knowledge-graph');
const loading = document.getElementById('knowledge-tree-loading');
const empty = document.getElementById('knowledge-tree-empty');
const error = document.getElementById('knowledge-tree-error');
const status = document.getElementById('tree-status');
const fitBtn = document.getElementById('graph-fit');
const resetBtn = document.getElementById('graph-reset');

if (graphEl instanceof HTMLElement) {
  const apiUrl = graphEl.dataset.apiUrl?.trim() || '';
  const triliumBaseUrl = graphEl.dataset.triliumBaseUrl?.trim() || 'https://blog.ssaw.top';
  const rootHint = 'root';
  const nodeStore = new Map<string, any>();
  const loadedNodes = new Set<string>();

  const nodes = new DataSet<any>();
  const edges = new DataSet<any>();

  const network = new Network(graphEl, { nodes, edges }, {
    autoResize: true,
    interaction: {
      hover: true,
      dragNodes: true,
      dragView: true,
      zoomView: true,
      navigationButtons: true,
      keyboard: true,
    },
    layout: {
      improvedLayout: true,
    },
    physics: {
      enabled: true,
      stabilization: { iterations: 300, fit: true },
      barnesHut: {
        gravitationalConstant: -5000,
        springLength: 150,
        springConstant: 0.03,
        damping: 0.2,
        avoidOverlap: 0.4,
      },
    },
    nodes: {
      borderWidth: 0,
    },
    edges: {
      selectionWidth: 0,
    },
  });

  const setStatus = (text: string) => {
    if (status) status.textContent = text;
  };

  const show = (el: Element | null, visible: boolean) => {
    if (el instanceof HTMLElement) el.style.display = visible ? '' : 'none';
  };

  const createUrl = (noteId: string) => {
    const url = new URL(apiUrl);
    url.searchParams.set('rootNoteId', noteId);
    return url.toString();
  };

  const normalizeNode = (node: any, depth = 0, parentId = '') => {
    if (!node || typeof node !== 'object') return null;
    const noteId = String(node.noteId || node.id || node.note_id || '');
    const title = String(node.title || node.name || node.noteTitle || noteId || '未命名笔记');
    const href = String(node.href || (noteId ? `${triliumBaseUrl}/#root/${noteId}` : triliumBaseUrl));
    const path = String(node.path || `/${title}`);
    const type = String(node.type || 'text');
    const childCount = Number(node.childCount || 0);
    const hasChildren = Boolean(node.hasChildren || childCount > 0);
    const loaded = Boolean(node.loaded);
    const prefix = node.prefix ? String(node.prefix) : '';
    const childrenRaw = Array.isArray(node.children) ? node.children : [];
    const children = childrenRaw.map((child) => normalizeNode(child, depth + 1, noteId)).filter(Boolean);

    return { noteId, title, href, path, type, childCount, hasChildren, loaded, prefix, depth, parentId, children };
  };

  const nodeColor = (node: any) => {
    if (node.type === 'noteMap') return '#ef4444';
    if (node.type === 'search') return '#f59e0b';
    if (node.hasChildren) return '#264f3a';
    return '#111827';
  };

  const upsertGraphNode = (node: any) => {
    nodeStore.set(node.noteId, node);
    const label = node.prefix ? `${node.prefix} · ${node.title}` : node.title;
    const payload = {
      id: node.noteId,
      label,
      title: `${node.path}${node.hasChildren ? `\n子节点：${node.childCount}` : ''}`,
      shape: 'dot',
      size: node.hasChildren ? 14 : 8,
      color: {
        background: nodeColor(node),
        border: nodeColor(node),
        highlight: { background: '#dc2626', border: '#dc2626' },
        hover: { background: '#0f172a', border: '#0f172a' },
      },
      font: { color: '#374151', size: node.hasChildren ? 16 : 11, face: 'Inter, system-ui, sans-serif', strokeWidth: 0 },
      physics: true,
    };
    if (nodes.get(node.noteId)) nodes.update(payload);
    else nodes.add(payload);
  };

  const edgeId = (from: string, to: string) => `${from}-->${to}`;
  const upsertEdge = (from: string, to: string) => {
    const id = edgeId(from, to);
    if (edges.get(id)) return;
    edges.add({ id, from, to, color: { color: 'rgba(148, 163, 184, 0.7)', highlight: '#94a3b8', hover: '#64748b' }, smooth: { type: 'dynamic' }, width: 1 });
  };

  const ingestNode = (node: any) => {
    upsertGraphNode(node);
    for (const child of node.children || []) {
      upsertGraphNode(child);
      upsertEdge(node.noteId, child.noteId);
    }
  };

  const loadChildren = async (noteId: string) => {
    const res = await fetch(createUrl(noteId), { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const normalized = normalizeNode(data?.root, 0, '');
    if (!normalized) throw new Error('Invalid graph node response');
    return normalized;
  };

  const renderGraph = async (data: any) => {
    const root = normalizeNode(data?.root, 0, '');
    if (!root) {
      show(loading, false);
      show(error, true);
      setStatus('知识地图暂无可展示内容');
      return;
    }

    nodes.clear();
    edges.clear();
    nodeStore.clear();
    loadedNodes.clear();

    ingestNode(root);
    root.children.forEach((child: any) => {
      child.parentId = root.noteId;
      ingestNode(child);
    });
    loadedNodes.add(root.noteId);

    show(loading, false);
    graphEl.style.display = 'block';
    network.once('stabilizationIterationsDone', () => {
      network.fit({ animation: { duration: 400, easingFunction: 'easeInOutQuad' } });
    });
    network.stabilize(180);
    setStatus('知识地图已加载：展示 root 下可见笔记，支持拖动画布、滚轮缩放、点击节点展开、双击节点打开 Trilium');
  };

  network.on('doubleClick', (params: any) => {
    const noteId = params.nodes?.[0];
    if (!noteId) return;
    const node = nodeStore.get(String(noteId));
    if (node?.href) window.open(node.href, '_blank', 'noopener,noreferrer');
  });

  network.on('click', async (params: any) => {
    const noteId = params.nodes?.[0];
    if (!noteId) return;
    const currentNode = nodeStore.get(String(noteId));
    if (!currentNode?.hasChildren) return;
    if (loadedNodes.has(String(noteId))) return;

    setStatus(`正在加载「${currentNode.title}」的子节点…`);
    try {
      const loaded = await loadChildren(String(noteId));
      currentNode.loaded = true;
      currentNode.children = loaded.children || [];
      currentNode.childCount = loaded.childCount;
      ingestNode(currentNode);
      currentNode.children.forEach((child: any) => {
        child.parentId = currentNode.noteId;
        ingestNode(child);
      });
      loadedNodes.add(String(noteId));
      network.stabilize(120);
      setStatus(`已加载「${currentNode.title}」的 ${currentNode.children.length} 个子节点，双击节点可打开 Trilium`);
    } catch (err) {
      console.error('[about] graph children load failed', err);
      setStatus('图谱子节点加载失败，请稍后重试');
    }
  });

  fitBtn?.addEventListener('click', () => {
    network.fit({ animation: { duration: 400, easingFunction: 'easeInOutQuad' } });
    setStatus('已适配当前视图');
  });

  resetBtn?.addEventListener('click', async () => {
    if (!apiUrl) return;
    show(loading, true);
    show(error, false);
    try {
      const data = await fetch(createUrl(rootHint), { headers: { Accept: 'application/json' } }).then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      });
      await renderGraph(data);
    } catch (err) {
      console.error('[about] graph reload failed', err);
      show(loading, false);
      show(error, true);
      setStatus('知识地图重新加载失败');
    }
  });

  if (!apiUrl) {
    show(loading, false);
    show(empty, true);
    setStatus('等待配置知识地图接口');
  } else {
    fetch(createUrl(rootHint), { headers: { Accept: 'application/json' } })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        show(empty, false);
        show(error, false);
        return renderGraph(data);
      })
      .catch((err) => {
        console.error('[about] knowledge graph load failed', err);
        show(loading, false);
        show(error, true);
        setStatus('知识地图加载失败');
      });
  }
}
