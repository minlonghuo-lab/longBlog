/**
 * Memos 数据类型定义
 */

/**
 * Memos API 返回的原始数据结构
 */
export interface MemosMemo {
  name: string;
  state: string;
  creator: string;
  createTime: string;
  updateTime: string;
  displayTime: string;
  content: string;
  visibility: "PUBLIC" | "PRIVATE" | "PROTECTED";
  tags: string[];
  pinned: boolean;
  attachments?: Array<{
    name: string;
    filename: string;
    type?: string;
  }>;
}

export interface MemosResponse {
  memos: MemosMemo[];
  nextPageToken: string;
}

/**
 * 转换后的说说类型
 */
export interface MemosPost {
  id: number;
  slug: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  tags: string[];
  pinned: boolean;
  images: string[];
  files: Array<{
    name: string;
    url: string;
  }>;
}
