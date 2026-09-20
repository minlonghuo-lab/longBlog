// Public local content only; never include credentials or private notes.
export const aboutProfile = {
  user: 'minlonghuo', host: 'longBlog', site: 'huowenlong.com',
  stack: 'Astro + Trilium', focus: 'Mathematics / Code / Life',
  about: 'About Console', status: 'Building',
};

export const knowledgeTopics = [
  { name: 'Mathematics', description: '数学、概率与统计' },
  { name: 'Code', description: '代码、工具与系统' },
  { name: 'Life', description: '生活与日常记录' },
];

export const aboutProjects = [{
  name: 'longBlog', description: '记录数学、代码与生活的个人博客。',
  stack: 'Astro / TypeScript / Trilium', href: '/',
  github: 'https://github.com/minlonghuo-lab/longBlog',
}];

export interface AboutHistoryItem { date: string; title: string; description?: string; }
// Await actual milestones from the author. Never invent commits or dates.
export const aboutHistory: AboutHistoryItem[] = [];
