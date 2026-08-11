// 友链数据
export interface FriendLink {
  name: string;
  url: string;
  description: string;
  avatar?: string;
}

export const friendLinks: FriendLink[] = [
  {
    name: 'skqfly',
    url: 'https://mmdskq.top',
    description: '个人网站主要记录个人学习、科研、编程实践以及生活中的一些思考。',
    avatar: 'https://img.mmdskq.top/file/1784280888930_skqfly.webp',
  },
  {
    name: 'Open Minis',
    url: 'https://openminis.app',
    description: '我的AI助手',
    avatar: '/friend-icons/minis.png',
  },
  {
    name: 'Web Teleporter',
    url: 'https://webteleporter.top',
    description: '这是一个传送门',
    avatar: '/friend-icons/webteleporter.ico',
  },
  {
    name: '青萍叙事',
    url: 'https://blog.lusyoe.com',
    description: '一个懂技术的产品汪🐶',
    avatar: '/friend-icons/lusyoe.ico',
  },
  {
    name: 'NatsuKaze',
    url: 'https://nkblog.top',
    description: '不忘初心，方得始终',
    avatar: '/friend-icons/nkblog.ico',
  },
  {
    name: '流月的博客',
    url: 'https://blog.sitrmoo.com',
    description: '且行且记，不负光阴',
    avatar: '/friend-icons/sitrmoo.svg',
  },
];
