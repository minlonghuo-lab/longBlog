// Auto-generated from Trilium ETAPI
export interface TriliumPostRecord {
  id: string; slug: string; title: string; createdAt: string; updatedAt: string; tags: string[]; summary: string; contentHtml: string; pinned?: boolean; syncHash?: string; syncStatus?: string; publishedAt?: string;
}

export const triliumPosts: TriliumPostRecord[] = [
  {
    "id": "yAEdBzTrtiHe",
    "slug": "这是一个测试博客",
    "title": "这是一个测试博客",
    "updatedAt": "2026-03-30 13:38:02.902+0800",
    "publishedAt": "2026-03-29 22:38:03.613+0800",
    "tags": [
      "自动化",
      "博客发布",
      "longBlog",
      "兜底策略",
      "流程优化"
    ],
    "summary": "自动化流程将内容发布到longBlog平台，简化博客发布流程。",
    "contentHtml": "<p>该帖子由自动化流发布到longBlog。确实挺不错的，加了好几层兜底策略。🥳</p>",
    "pinned": true,
    "syncHash": "49b8b76e1f3aa6fdc500bd82e4555d4926a3ec96b2c300a96ecfa94c53d86b1b",
    "syncStatus": "published"
  }
];
