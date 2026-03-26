// 博客文章数据
export interface Post {
  slug: string;
  title: string;
  summary: string;
  publishedAt: Date;
  tags: string[];
  pinned?: boolean;
}

export const posts: Post[] = [
  {
    slug: 'welcome-to-longblog',
    title: '欢迎来到 longBlog',
    summary: '这是一个全新的开始。在这里，我将分享技术与生活的点点滴滴。',
    publishedAt: new Date('2024-01-15'),
    tags: ['随笔'],
    pinned: true,
  },
  {
    slug: 'getting-started-with-astro',
    title: 'Astro 框架入门指南',
    summary: 'Astro 是一个专注于构建内容驱动网站的现代框架，它独特的 Islands 架构让性能达到极致。',
    publishedAt: new Date('2024-01-20'),
    tags: ['技术', 'Astro'],
  },
  {
    slug: 'modern-web-development',
    title: '现代 Web 开发实践',
    summary: '探讨现代 Web 开发中的最佳实践，包括性能优化、SEO 友好、以及用户体验设计。',
    publishedAt: new Date('2024-02-01'),
    tags: ['技术', 'Web'],
  },
];

// 按日期排序
export function getSortedPosts(): Post[] {
  return [...posts].sort((a, b) => 
    b.publishedAt.getTime() - a.publishedAt.getTime()
  );
}

// 获取置顶文章
export function getPinnedPosts(): Post[] {
  return posts.filter(p => p.pinned);
}

// 按标签筛选
export function getPostsByTag(tag: string): Post[] {
  if (!tag) return getSortedPosts();
  return getSortedPosts().filter(p => p.tags.includes(tag));
}

// 获取所有标签
export function getAllTags(): { name: string; count: number }[] {
  const tagCount: Record<string, number> = {};
  posts.forEach(p => {
    p.tags.forEach(tag => {
      tagCount[tag] = (tagCount[tag] || 0) + 1;
    });
  });
  return Object.entries(tagCount)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}
