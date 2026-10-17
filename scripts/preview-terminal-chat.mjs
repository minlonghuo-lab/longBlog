// Local-only integration preview. Never deploy this server: it uses in-memory test data.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createService } from '../cloudfunctions/terminal-chat-service/service.js';
import { createMemoryStore } from '../tests/helpers/terminal-chat-memory-store.cjs';

const port = Number(process.env.CHAT_PREVIEW_PORT || 8787);
const origin = `http://127.0.0.1:${port}`;
const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const notifications = [];
const service = createService({ store: createMemoryStore(), signingKey: randomBytes(32).toString('hex'), apiBaseUrl: `${origin}/terminal-chat`,
  allowedOrigins: [origin], notify: async value => { notifications.push(value); console.log('本地模拟通知已生成，可在 /__preview/notifications 查看。'); },
  replyHtml: await readFile(new URL('../cloudfunctions/terminal-chat-service/reply.html', import.meta.url), 'utf8'),
  replyJs: await readFile(new URL('../cloudfunctions/terminal-chat-service/reply.js', import.meta.url), 'utf8'),
});
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.wasm': 'application/wasm' };
createServer(async (req, res) => {
  try {
    const url = new URL(req.url, origin);
    if (url.pathname === '/__preview/notifications') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); return res.end(JSON.stringify(notifications));
    }
    if (url.pathname.startsWith('/terminal-chat/')) {
      let body = '';
      for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 8192) { res.writeHead(413); return res.end(); } }
      const result = await service({ path: url.pathname, httpMethod: req.method, headers: req.headers, body,
        queryStringParameters: Object.fromEntries(url.searchParams), requestContext: { sourceIp: req.socket.remoteAddress } });
      res.writeHead(result.statusCode, result.headers); return res.end(result.body);
    }
    const pathname = decodeURIComponent(url.pathname);
    const file = resolve(dist, `.${pathname}${pathname.endsWith('/') ? 'index.html' : ''}`);
    if (!file.startsWith(`${resolve(dist)}${sep}`)) { res.writeHead(403); return res.end(); }
    let content = await readFile(file);
    if (file.endsWith(`${sep}about${sep}index.html`)) content = Buffer.from(content.toString().replace(/data-chat-api(?:="[^"]*")?/, `data-chat-api="${origin}/terminal-chat"`));
    res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(content);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(port, '127.0.0.1', () => console.log(`本地联调预览：${origin}/about/（模拟通知，不连接腾讯云或企业微信）`));
