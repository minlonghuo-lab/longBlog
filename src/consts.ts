// Site Configuration
const env = import.meta.env;

export const SITE_TITLE = env.PUBLIC_SITE_TITLE || 'longBlog';
export const SITE_DESCRIPTION = env.PUBLIC_SITE_DESCRIPTION || '基于 Astro 复刻 flare-stack-blog 的极简博客';

// Author Info
export const AUTHOR = env.PUBLIC_SITE_AUTHOR || 'Minlonghuo';
export const AUTHOR_INTRO = env.PUBLIC_SITE_AUTHOR_INTRO || '分享技术、产品和日常记录。';

// Social / Contact
export const SITE_GITHUB = env.PUBLIC_SITE_GITHUB || 'https://github.com/minlonghuo-lab';
export const CONTACT_EMAIL = env.PUBLIC_SITE_EMAIL || 'hello@example.com';
export const SOCIAL_LINKS = [
  { platform: 'github', url: SITE_GITHUB, label: 'GitHub' },
  { platform: 'email', url: `mailto:${CONTACT_EMAIL}`, label: CONTACT_EMAIL },
];

// Public service URLs
export const MEMOS_URL = (env.PUBLIC_MEMOS_URL || 'https://memos.ssaw.top').replace(/\/$/, '');
export const TRILIUM_BASE_URL = (env.PUBLIC_TRILIUM_BASE_URL || 'https://blog.ssaw.top').replace(/\/$/, '');
export const TRILIUM_TREE_API_URL = (env.PUBLIC_TRILIUM_TREE_API_URL || '').trim();
export const SITE_HISTORY_IMAGE_URL = (env.PUBLIC_SITE_HISTORY_IMAGE_URL || '').trim();
export const SITE_URL = (env.PUBLIC_SITE_URL || '').trim();

// Footer / ICP / links
export const ICP_URL = env.PUBLIC_ICP_URL || 'https://icp.gov.moe/?keyword=20260550';
export const ICP_TEXT = env.PUBLIC_ICP_TEXT || '萌ICP备20260550号';
export const FOOTER_TRILIUM_URL = env.PUBLIC_FOOTER_POWERED_TRILIUM_URL || 'https://github.com/TriliumNext/Trilium';
export const FOOTER_ASTRO_URL = env.PUBLIC_FOOTER_POWERED_ASTRO_URL || 'https://github.com/withastro/astro';

// Analytics
export const UMAMI_SCRIPT_URL = env.PUBLIC_UMAMI_SCRIPT_URL || 'https://cloud.umami.is/script.js';
export const UMAMI_WEBSITE_ID = env.PUBLIC_UMAMI_WEBSITE_ID || 'a6048160-1a40-41bb-93e5-361c47a998b3';

// Navigation
export const NAV_ITEMS = [
  { name: '主页', href: '/' },
  { name: '文章', href: '/blog' },
  { name: '说说', href: '/shuoshuo' },
  { name: '友链', href: '/friends' },
  { name: '关于', href: '/about' },
];
