import { triliumPosts } from './trilium-posts.generated';

export interface Post {
  id: string;
  slug: string;
  title: string;
  date: Date;
  updatedAt: Date;
  tags: string[];
  summary: string;
  contentHtml: string;
  pinned?: boolean;
}

function toDate(v?: string) {
  if (!v) return new Date();
  // Trilium格式: 2026-03-09 22:38:06.700+0800
  const normalized = v.replace(' ', 'T').replace(/(\+\d{2})(\d{2})$/, '$1:$2');
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

export const posts: Post[] = triliumPosts.map((p) => ({
  id: p.id,
  slug: p.slug,
  title: p.title,
  date: toDate(p.createdAt),
  updatedAt: toDate(p.updatedAt),
  tags: p.tags ?? [],
  summary: p.summary ?? '',
  contentHtml: p.contentHtml ?? '',
  pinned: !!p.pinned,
}));

export function getSortedPosts(): Post[] {
  return [...posts].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}

export function getPinnedPosts(): Post[] {
  return posts.filter((post) => post.pinned);
}

export function getAllTags(): { name: string; count: number }[] {
  const tagMap = new Map<string, number>();
  for (const post of posts) {
    for (const tag of post.tags) {
      tagMap.set(tag, (tagMap.get(tag) || 0) + 1);
    }
  }
  return [...tagMap.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}
