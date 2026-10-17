const fs = require('node:fs');
const path = require('node:path');
const cloudbase = require('@cloudbase/node-sdk');
const { createCloudStore } = require('./store');
const { createService } = require('./service');
const { cleanupExpired } = require('./cleanup');
let service;

exports.main = async event => {
  if (!event.httpMethod && event.Type === 'Timer' && event.TriggerName === 'terminal-chat-cleanup') {
    try {
      const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
      return await cleanupExpired(app.database());
    } catch { throw new Error('terminal-chat cleanup failed'); }
  }
  try {
    if (!service) {
      const webhook = new URL(process.env.WECOM_BOT_WEBHOOK);
      if (webhook.origin !== 'https://qyapi.weixin.qq.com' || webhook.pathname !== '/cgi-bin/webhook/send' || !webhook.searchParams.get('key')) {
        throw new Error('Invalid WeCom webhook');
      }
      const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
      service = createService({
        store: createCloudStore(app.database()),
        signingKey: process.env.CHAT_SIGNING_KEY,
        apiBaseUrl: process.env.CHAT_API_BASE_URL,
        allowedOrigins: (process.env.CHAT_ALLOWED_ORIGINS || 'https://huowenlong.com').split(',').map(value => value.trim()).filter(Boolean),
        replyHtml: fs.readFileSync(path.join(__dirname, 'reply.html'), 'utf8'),
        replyJs: fs.readFileSync(path.join(__dirname, 'reply.js'), 'utf8'),
        // Do not log message bodies, credentials, webhook URLs, or complete events.
        report: code => console.error(`[terminal-chat] ${code}`),
        async notify({ sessionId, text, replyUrl }) {
          const response = await fetch(webhook, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(5000),
            body: JSON.stringify({ msgtype: 'text', text: { content: `longBlog 终端新留言\n访客：${sessionId.slice(0, 8)}\n\n${text}\n\n查看并回复（24 小时内有效）：\n${replyUrl}` } }),
          });
          const result = await response.json();
          if (!response.ok || result.errcode !== 0) throw new Error('Notification failed');
        },
      });
    }
    return await service(event);
  } catch {
    console.error('[terminal-chat] configuration_error');
    return { statusCode: 503, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify({ error: '作者留言通道暂未就绪。' }) };
  }
};
