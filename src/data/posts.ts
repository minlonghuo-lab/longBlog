// 文章数据
export interface Post {
  slug: string;
  title: string;
  date: Date;
  tags: string[];
  pinned?: boolean;
}

export const posts: Post[] = [
  {
    slug: 'welcome-to-longblog',
    title: '欢迎来到 longBlog',
    date: new Date('2024-01-15'),
    tags: ['随笔'],
    pinned: true,
  },
  {
    slug: 'getting-started-with-astro',
    title: 'Astro 入门指南',
    date: new Date('2024-02-20'),
    tags: ['技术', 'Astro'],
  },
  {
    slug: 'modern-web-development',
    title: '现代 Web 开发趋势',
    date: new Date('2024-03-10'),
    tags: ['技术', 'Web'],
  },
];

export function getSortedPosts(): Post[] {
  return [...posts].sort((a, b) => b.date.getTime() - a.date.getTime());
}

export function getPinnedPosts(): Post[] {
  return posts.filter(post => post.pinned);
}

export function getAllTags(): string[] {
  const tags = new Set<string>();
  posts.forEach(post => post.tags.forEach(tag => tags.add(tag)));
  return Array.from(tags).sort();
}
