import { highlightCodeBlocks } from './syntax-highlight';
import { triliumPostContents } from './trilium-posts.content.generated';
import { triliumPostMetas } from './trilium-posts.meta.generated';

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

function toDate(...values: Array<string | undefined>) {
  for (const value of values) {
    if (!value) continue;
    const normalized = value.replace(' ', 'T').replace(/(\+\d{2})(\d{2})$/, '$1:$2');
    const date = new Date(normalized);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return new Date(0);
}

function normalizeTags(values?: string[]) {
  return [...new Set((values ?? []).map((tag) => tag.trim()).filter(Boolean))];
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

const contentMap = new Map(triliumPostContents.map((p) => [p.id, p]));

export const posts: Post[] = triliumPostMetas
  .map((meta) => {
    const content = contentMap.get(meta.id);
    if (!content) return null;
    return {
      id: meta.id,
      slug: meta.slug,
      title: content.title,
      publishedAt: toDate(meta.publishedAt, meta.updatedAt),
      updatedAt: toDate(meta.updatedAt, meta.publishedAt),
      tags: normalizeTags(meta.tags),
      summary: content.summary ?? '',
      contentHtml: highlightCodeBlocks(content.contentHtml ?? ''),
      pinned: !!meta.pinned,
    } satisfies Post;
  })
  .filter((post): post is Post => post !== null);

export function getSortedPosts(): Post[] {
  return [...posts].sort(comparePosts);
}

export function getPinnedPosts(): Post[] {
  return posts.filter((post) => post.pinned).sort(comparePosts);
}

export function getHomePosts(limit = 10): Post[] {
  const pinned = getPinnedPosts();
  const latest = posts
    .filter((post) => !post.pinned)
    .sort((a, b) => {
      const diff = b.publishedAt.getTime() - a.publishedAt.getTime();
      if (diff !== 0) return diff;
      return a.id.localeCompare(b.id, 'zh-CN');
    })
    .slice(0, limit);

  return [...pinned, ...latest];
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
    .sort((a, b) => {
      const countDiff = b.count - a.count;
      if (countDiff !== 0) return countDiff;
      return a.name.localeCompare(b.name, 'zh-CN');
    });
}
