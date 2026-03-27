// 友链数据
export interface FriendLink {
  name: string;
  url: string;
  description: string;
  avatar?: string;
}

export const friendLinks: FriendLink[] = [
  {
    name: 'Minis助手',
    url: 'https://apps.apple.com/cn/app/open-minis/id6759188481',
    description: '我的AI助手',
    avatar: '/friend-icons/minis.svg',
  },
  {
    name: 'Web Teleporter',
    url: 'https://webteleporter.top',
    description: '这是一个传送门',
    avatar: '/friend-icons/webteleporter.svg',
  },
  {
    name: '青萍叙事',
    url: 'https://blog.lusyoe.com',
    description: '一个懂技术的产品汪🐶',
    avatar: '/friend-icons/lusyoe.svg',
  },
  {
    name: 'NatsuKaze',
    url: 'https://nkblog.top',
    description: '不忘初心，方得始终',
    avatar: '/friend-icons/nkblog.svg',
  },
  {
    name: '流月的博客',
    url: 'https://blog.sitrmoo.com',
    description: '且行且记，不负光阴',
    avatar: '/friend-icons/sitrmoo.svg',
  },
];
