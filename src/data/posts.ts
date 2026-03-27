export interface Post {
  id: number;
  slug: string;
  title: string;
  date: Date;
  tags: string[];
  pinned?: boolean;
  content: string;
}

export const posts: Post[] = [
  {
    id: 1,
    slug: 'welcome-to-longblog',
    title: '欢迎来到 longBlog',
    date: new Date('2026-03-01'),
    tags: ['随笔', '站点'],
    pinned: true,
    content: `这是 longBlog 的第一篇文章。\n\n这次重构重点是把 flare-stack-blog 的信息层次、留白与交互节奏迁移到 Astro：\n\n- 首页：简介 + 最新文章\n- 文章：标签筛选 + 列表加载\n- 说说：时间线短内容\n- 友链：卡片式展示\n\n后续会继续接入真实数据源。`,
  },
  {
    id: 2,
    slug: 'astro-ui-migration-notes',
    title: 'Astro 迁移 UI 复刻笔记',
    date: new Date('2026-03-20'),
    tags: ['Astro', '前端'],
    content: `1:1 复刻不是“像”，而是“结构、排版、动效、交互决策”都一致。\n\n本项目实现了：\n\n- 统一的极简字体栈\n- 主页问候与社交区\n- 文章页文本型标签筛选\n- 友链页轻量卡片交互`,
  },
  {
    id: 3,
    slug: 'minimal-blog-interaction-design',
    title: '极简博客交互设计拆解',
    date: new Date('2026-03-24'),
    tags: ['设计', '交互'],
    content: `交互逻辑遵循“弱打扰、快反馈”：\n\n- hover 只做轻微颜色/位移\n- 标签筛选不跳页面，保留上下文\n- 列表分段加载，减少首屏压力\n\n这也是 flare-stack-blog 默认主题体验的关键。`,
  },
  {
    id: 4,
    slug: 'edgeone-auto-deploy-flow',
    title: 'EdgeOne 自动部署联动说明',
    date: new Date('2026-03-26'),
    tags: ['EdgeOne', '部署'],
    content: `仓库推送到 GitHub 后会自动触发 EdgeOne Pages 构建。\n\n只要 main 分支保持可构建状态，就能实现稳定发布。`,
  },
];

export function getSortedPosts(): Post[] {
  return [...posts].sort((a, b) => b.date.getTime() - a.date.getTime());
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
