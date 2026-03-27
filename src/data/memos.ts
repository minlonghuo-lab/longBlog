export interface MemoItem {
  id: string;
  content: string;
  createdTs: string;
  visibility: 'PUBLIC' | 'PRIVATE' | 'PROTECTED';
}

export const memos: MemoItem[] = [
  {
    id: 'm1',
    content: '今天把 longBlog 的页面结构按 flare-stack-blog 默认主题对齐完成。',
    createdTs: '2026-03-26T18:30:00+08:00',
    visibility: 'PUBLIC',
  },
  {
    id: 'm2',
    content: '说说页采用时间线布局，后续可直接切换到 memos-proxy 接口。',
    createdTs: '2026-03-26T21:00:00+08:00',
    visibility: 'PUBLIC',
  },
  {
    id: 'm3',
    content: '已预留 /api/v1/memos 的兼容结构，方便未来无缝替换真实数据。',
    createdTs: '2026-03-27T08:20:00+08:00',
    visibility: 'PUBLIC',
  },
];
