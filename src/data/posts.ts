import { triliumPosts } from './trilium-posts.generated';

export interface Post {
  id: string;
  slug: string;
  title: string;
  publishedAt: Date;
  updatedAt: Date;
  tags: string[];
  summary: string;
  contentHtml: string;
  pinned?: boolean;
}

function toDate(v?: string) {
  if (!v) return new Date();
  const normalized = v.replace(' ', 'T').replace(/(\+\d{2})(\d{2})$/, '$1:$2');
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function comparePosts(a: Post, b: Post) {
  const aPinned = !!a.pinned;
  const bPinned = !!b.pinned;

  if (aPinned !== bPinned) {
    return aPinned ? -1 : 1;
  }

  if (aPinned && bPinned) {
    const diff = a.publishedAt.getTime() - b.publishedAt.getTime();
    if (diff !== 0) return diff;
    return a.id.localeCompare(b.id, 'zh-CN');
  }

  const diff = b.publishedAt.getTime() - a.publishedAt.getTime();
  if (diff !== 0) return diff;
  return a.id.localeCompare(b.id, 'zh-CN');
}

export const posts: Post[] = triliumPosts.map((p) => ({
  id: p.id,
  slug: p.slug,
  title: p.title,
  publishedAt: toDate(p.publishedAt || p.updatedAt),
  updatedAt: toDate(p.updatedAt),
  tags: p.tags ?? [],
  summary: p.summary ?? '',
  contentHtml: p.contentHtml ?? '',
  pinned: !!p.pinned,
}));

export function getSortedPosts(): Post[] {
  return [...posts].sort(comparePosts);
}

export function getPinnedPosts(): Post[] {
  return posts.filter((post) => post.pinned).sort(comparePosts);
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
