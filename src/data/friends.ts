// 友链数据
export interface FriendLink {
  name: string;
  url: string;
  description: string;
  avatar?: string;
}

export const friendLinks: FriendLink[] = [
  {
    name: 'flare-stack-blog',
    url: 'https://ssaw.top',
    description: '一个现代化的博客系统，基于 flare-stack 构建',
  },
  {
    name: 'Trilium Notes',
    url: 'https://github.com/zadam/trilium',
    description: '分层笔记应用，专注隐私，可离线使用',
  },
  {
    name: 'Astro',
    url: 'https://astro.build',
    description: '内容驱动的网站框架，构建更快、更轻的网站',
  },
];
