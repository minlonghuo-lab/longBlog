const { createHash, createHmac, timingSafeEqual } = require('node:crypto');
const { isIP } = require('node:net');
const DAY = 86400000;
const ID = /^[a-f0-9]{32}$/;
const VISITOR_KEY = /^[a-f0-9]{64}$/;
const digest = value => createHash('sha256').update(value).digest('hex');
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b)
  && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const fail = (status, message) => { const error = new Error(message); error.status = status; throw error; };
const publicMessage = message => ({ id: message.clientId, sender: message.sender, text: message.text, createdAt: message.createdAt, sequence: message.sequence });

function createService({ store, signingKey, apiBaseUrl, allowedOrigins, notify, now = Date.now, replyHtml, replyJs, report = () => {} }) {
  if (!/^[a-f0-9]{64,}$/.test(signingKey || '')) throw new Error('CHAT_SIGNING_KEY must contain at least 32 random bytes as hex');
  const base = new URL(apiBaseUrl);
  if (base.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(base.hostname)) throw new Error('CHAT_API_BASE_URL must use HTTPS');
  const prefix = base.pathname.replace(/\/$/, '');
  const originAllowlist = new Set(allowedOrigins);
  const sign = payload => {
    const value = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${value}.${createHmac('sha256', signingKey).update(value).digest('base64url')}`;
  };
  const authorToken = (sessionId, expiresAt) => sign({ sessionId, role: 'author', exp: Math.min(expiresAt, now() + DAY) });
  const parseAuthor = token => {
    const [value, signature, extra] = token.split('.');
    if (extra || !value || !signature || !equal(signature, createHmac('sha256', signingKey).update(value).digest('base64url'))) fail(401, '回复链接无效。');
    let payload;
    try { payload = JSON.parse(Buffer.from(value, 'base64url').toString()); } catch { fail(401, '回复链接无效。'); }
    if (payload.role !== 'author' || !ID.test(payload.sessionId) || !Number.isSafeInteger(payload.exp) || payload.exp <= now()) fail(401, '回复链接已失效，请使用最新通知中的链接。');
    return payload;
  };
  const authorize = async (sessionId, token, authorOnly = false) => {
    if (typeof sessionId !== 'string' || !ID.test(sessionId)) fail(400, '会话参数无效。');
    const session = await store.getSession(sessionId);
    if (!session || session.kind !== 'session') fail(404, '会话尚未建立，请发送或重试第一条留言。');
    if (session.expiresAt <= now()) fail(410, '会话已过期。');
    if (token.includes('.')) {
      if (parseAuthor(token).sessionId !== sessionId) fail(403, '无权访问这个会话。');
      return session;
    }
    if (authorOnly || !VISITOR_KEY.test(token) || !equal(session.visitorKeyHash, digest(token))) fail(403, '会话凭证无效。');
    return session;
  };
  const append = async ({ sessionId, messageId, text, token, sender, ip }) => {
    if (typeof sessionId !== 'string' || !ID.test(sessionId) || typeof messageId !== 'string' || !ID.test(messageId)) fail(400, '消息参数无效。');
    if (typeof text !== 'string' || !text.trim() || text.length > 500) fail(400, '每条消息需要包含 1～500 字。');
    text = text.trim();
    if (sender === 'user' && !VISITOR_KEY.test(token)) fail(403, '会话凭证无效。');
    if (sender === 'author' && parseAuthor(token).sessionId !== sessionId) fail(403, '无权回复这个会话。');
    const timestamp = now();
    const documentId = digest(`${sessionId}:${sender}:${messageId}`);
    const result = await store.appendMessage({ sessionId, messageId, text, sender, timestamp, documentId,
      visitorKeyHash: digest(token), ipHash: createHmac('sha256', signingKey).update(ip || 'unknown-gateway-ip').digest('hex') });
    let notification = result.message.notification;
    if (sender === 'user' && result.created) {
      try {
        const replyUrl = `${base.href.replace(/\/$/, '')}/reply#token=${authorToken(sessionId, result.expiresAt)}`;
        await notify({ sessionId, text, replyUrl }); notification = 'sent';
      } catch { notification = 'failed'; report('notification_failed'); }
      try { await store.setNotification(documentId, notification); } catch { report('notification_status_failed'); }
    }
    return { success: true, message: publicMessage(result.message), notification, expiresAt: result.expiresAt };
  };

  return async event => {
    const headers = Object.fromEntries(Object.entries(event.headers || {}).map(([key, value]) => [key.toLowerCase(), value]));
    const origin = headers.origin;
    const responseHeaders = {
      'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Vary: 'Origin',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    };
    if (originAllowlist.has(origin) || origin === base.origin) responseHeaders['Access-Control-Allow-Origin'] = origin;
    const respond = (statusCode, body, contentType) => ({ statusCode, headers: { ...responseHeaders, ...(contentType ? { 'Content-Type': contentType } : {}) }, body: typeof body === 'string' ? body : JSON.stringify(body) });
    try {
      if (origin && !originAllowlist.has(origin) && origin !== base.origin) fail(403, '请求来源不受支持。');
      const method = event.httpMethod?.toUpperCase();
      if (!method) fail(400, '仅支持 HTTP 访问。');
      let path = (event.path || '/').split('?')[0];
      if (prefix && path.startsWith(`${prefix}/`)) path = path.slice(prefix.length);
      if (method === 'OPTIONS') return respond(204, '');
      if (method === 'GET' && path === '/reply') return respond(200, replyHtml, 'text/html; charset=utf-8');
      if (method === 'GET' && path === '/reply.js') return respond(200, replyJs, 'text/javascript; charset=utf-8');
      const token = /^Bearer (\S{1,2048})$/.exec(headers.authorization || '')?.[1] || '';
      let body = {};
      if (method === 'POST') {
        const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString() : event.body || '';
        if (typeof raw !== 'string' || Buffer.byteLength(raw) > 8192) fail(413, '请求内容过长。');
        try { body = JSON.parse(raw); } catch { fail(400, '请求内容格式错误。'); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, '请求内容格式错误。');
      }
      if (method === 'POST' && path === '/chat/send') {
        const candidate = event.requestContext?.sourceIp || event.requestContext?.http?.sourceIp || '';
        const ip = isIP(candidate) ? candidate : '';
        return respond(200, await append({ sessionId: body.sessionId, messageId: body.messageId, text: body.message, token, sender: 'user', ip }));
      }
      if (method === 'POST' && path === '/chat/reply') {
        return respond(200, await append({ sessionId: body.sessionId, messageId: body.messageId, text: body.message, token, sender: 'author' }));
      }
      if (method === 'GET' && path === '/chat/poll') {
        const query = event.queryStringParameters || {};
        const session = await authorize(query.sessionId, token);
        const cursor = Number(query.cursor || 0);
        if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > session.sequence) fail(400, '消息游标无效。');
        const messages = await store.listMessages(query.sessionId, cursor, 51);
        const page = messages.slice(0, 50);
        return respond(200, { messages: page.map(publicMessage), cursor: page.at(-1)?.sequence || cursor, hasMore: messages.length > 50 });
      }
      return respond(404, { error: '接口不存在。' });
    } catch (error) {
      if (!error.status) report('request_failed');
      return respond(error.status || 500, { error: error.status ? error.message : '服务暂时不可用，请稍后重试。' });
    }
  };
}

module.exports = { createService };
