const fs = require('node:fs');
const path = require('node:path');
const { tcb } = require('tencentcloud-sdk-nodejs-tcb');
const { createPostgresStore } = require('./postgres-store');
const { createService } = require('./service');
let service;
function createStore() {
  const client = new tcb.v20180608.Client({
    region: 'ap-shanghai',
    credential: {
      secretId: process.env.TENCENTCLOUD_SECRETID,
      secretKey: process.env.TENCENTCLOUD_SECRETKEY,
      token: process.env.TENCENTCLOUD_SESSIONTOKEN,
    },
    profile: { httpProfile: { reqTimeout: 8, endpoint: 'tcb.tencentcloudapi.com' } },
  });
  return createPostgresStore(sql => client.ExecutePGSql({ EnvId: process.env.CHAT_CLOUDBASE_ENV_ID, Sql: sql }));
}

exports.main = async event => {
  if (!event.httpMethod && event.Type === 'Timer' && event.TriggerName === 'terminal-chat-cleanup') {
    try {
      return await createStore().cleanupExpired();
    } catch { throw new Error('terminal-chat cleanup failed'); }
  }
  try {
    if (!service) {
      const webhook = new URL(process.env.WECOM_BOT_WEBHOOK);
      if (webhook.origin !== 'https://qyapi.weixin.qq.com' || webhook.pathname !== '/cgi-bin/webhook/send' || !webhook.searchParams.get('key')) {
        throw new Error('Invalid WeCom webhook');
      }
      service = createService({
        store: createStore(),
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
