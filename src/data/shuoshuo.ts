// 说说数据
export interface Shuoshuo {
  id: string;
  content: string;
  createdAt: Date;
  images?: string[];
}

export const shuoshuoList: Shuoshuo[] = [
  {
    id: '1',
    content: '今天天气不错，适合写代码 ☀️',
    createdAt: new Date('2024-03-15 10:30:00'),
  },
  {
    id: '2',
    content: 'Astro 框架真香！性能碾压其他方案 🚀',
    createdAt: new Date('2024-03-14 15:20:00'),
  },
  {
    id: '3',
    content: '终于把博客迁移到 EdgeOne Pages 了，速度飞快！',
    createdAt: new Date('2024-03-13 20:45:00'),
  },
];

// 按日期排序（最新的在前）
export function getSortedShuoshuo(): Shuoshuo[] {
  return [...shuoshuoList].sort((a, b) => 
    b.createdAt.getTime() - a.createdAt.getTime()
  );
}
