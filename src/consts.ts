// Site Configuration
const env = import.meta.env;

export const SITE_TITLE = 'longBlog';
export const SITE_DESCRIPTION = env.DESCRIPTION || '基于 Astro 复刻 flare-stack-blog 的极简博客';

// Author Info
export const AUTHOR = 'Minlonghuo';
export const AUTHOR_INTRO = env.DESCRIPTION || '分享技术、产品和日常记录。';

const githubUrl = env.GITHUB || 'https://github.com/minlonghuo-lab';
const emailAddress = env.EMAIL || 'hello@example.com';

// Social Links
export const SOCIAL_LINKS = [
  { platform: 'github', url: githubUrl, label: 'GitHub' },
  { platform: 'email', url: `mailto:${emailAddress}`, label: emailAddress },
];

export const CONTACT_EMAIL = emailAddress;
export const MEMOS_URL = (env.MEMOS_URL || 'https://memos.ssaw.top').replace(/\/$/, '');

// Navigation
export const NAV_ITEMS = [
  { name: '主页', href: '/' },
  { name: '文章', href: '/blog' },
  { name: '说说', href: '/shuoshuo' },
  { name: '友链', href: '/friends' },
];
