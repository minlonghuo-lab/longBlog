/**
 * Memos API 服务
 */

import { memosConfig } from "./config";
import type { MemosMemo, MemosPost } from "./types";

/**
 * 将 Memos 转换为说说格式
 * 支持图片和文件展示
 */
function convertMemoToPost(memo: MemosMemo): MemosPost {
  const id = parseInt(memo.name.split("/")[1] || "0", 10) || Date.now();

  // 处理附件
  const images: string[] = [];
  const files: { name: string; url: string }[] = [];
  const attachments = memo.attachments || [];

  for (const attachment of attachments) {
    const attachmentId = (attachment.name || "").replace("attachments/", "");
    const filename = attachment.filename || "";
    if (!attachmentId || !filename) continue;

    // 构建直链 URL
    const fileUrl = `${memosConfig.apiBaseUrl}/file/attachments/${attachmentId}/${encodeURIComponent(filename)}`;

    if (attachment.type && attachment.type.startsWith("image/")) {
      images.push(fileUrl);
    } else {
      files.push({
        name: filename,
        url: fileUrl,
      });
    }
  }

  // 从内容中提取 Markdown 图片
  const mdImages = extractMarkdownImages(memo.content);
  for (const img of mdImages) {
    if (!images.includes(img)) {
      images.push(img);
    }
  }

  return {
    id,
    slug: `memos-${id}`,
    content: memo.content,
    createdAt: new Date(memo.createTime),
    updatedAt: new Date(memo.updateTime),
    tags: memo.tags,
    pinned: memo.pinned,
    images,
    files,
  };
}

/**
 * 从 Markdown 内容中提取图片 URL
 */
function extractMarkdownImages(content: string): string[] {
  const images: string[] = [];
  const regex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    images.push(match[2]);
  }
  return images;
}

/**
 * 获取说说列表
 */
export async function getMemos(): Promise<MemosPost[]> {
  try {
    const apiUrl = `${memosConfig.apiBaseUrl}/api/v1/memos?pageSize=${memosConfig.pageSize}`;

    const response = await fetch(apiUrl, {
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      console.error("[Memos] API request failed:", response.status);
      return [];
    }

    const data = await response.json();

    if (!data.memos || !Array.isArray(data.memos)) {
      return [];
    }

    // 转换并排序（置顶在前，按时间倒序）
    const posts = data.memos
      .filter((memo: MemosMemo) => memo.visibility === "PUBLIC")
      .map(convertMemoToPost)
      .sort((a: MemosPost, b: MemosPost) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return b.createdAt.getTime() - a.createdAt.getTime();
      });

    return posts;
  } catch (error) {
    console.error("[Memos] Error fetching memos:", error);
    return [];
  }
}

/**
 * 加载更多说说
 */
export async function loadMoreMemos(pageToken: string): Promise<{ memos: MemosPost[]; nextPageToken: string }> {
  try {
    const apiUrl = pageToken
      ? `${memosConfig.apiBaseUrl}/api/v1/memos?pageSize=${memosConfig.pageSize}&pageToken=${pageToken}`
      : `${memosConfig.apiBaseUrl}/api/v1/memos?pageSize=${memosConfig.pageSize}`;

    const response = await fetch(apiUrl, {
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      return { memos: [], nextPageToken: "" };
    }

    const data = await response.json();
    const memos = (data.memos || [])
      .filter((memo: MemosMemo) => memo.visibility === "PUBLIC")
      .map(convertMemoToPost)
      .sort((a: MemosPost, b: MemosPost) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return b.createdAt.getTime() - a.createdAt.getTime();
      });

    return {
      memos,
      nextPageToken: data.nextPageToken || "",
    };
  } catch (error) {
    console.error("[Memos] Load more error:", error);
    return { memos: [], nextPageToken: "" };
  }
}
