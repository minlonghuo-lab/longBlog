import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { parseEnv } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const localPath = resolve(root, '.env.terminal-chat.local');
let content;
try { content = await readFile(localPath, 'utf8'); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  const template = await readFile(resolve(root, '.env.terminal-chat.example'), 'utf8');
  content = template.replace('CHAT_SIGNING_KEY=\n', `CHAT_SIGNING_KEY=${randomBytes(32).toString('hex')}\n`);
  await writeFile(localPath, content, { mode: 0o600 });
}
await chmod(localPath, 0o600);
const values = parseEnv(content);
const required = ['CHAT_API_BASE_URL', 'CHAT_ALLOWED_ORIGINS', 'CHAT_SIGNING_KEY', 'WECOM_BOT_WEBHOOK'];
const missing = required.filter(key => !values[key]);
if (missing.length) {
  console.log(`已准备私密配置：${localPath}`);
  console.log(`仍需填写：${missing.join(', ')}。不会打印任何密钥。`);
  process.exitCode = 1;
} else {
  if (!/^[a-f0-9]{64,}$/.test(values.CHAT_SIGNING_KEY)) throw new Error('CHAT_SIGNING_KEY 格式不正确');
  const webhook = new URL(values.WECOM_BOT_WEBHOOK);
  if (webhook.origin !== 'https://qyapi.weixin.qq.com' || webhook.pathname !== '/cgi-bin/webhook/send' || !webhook.searchParams.get('key')) throw new Error('企业微信 Webhook 格式不正确');
  const config = JSON.parse(await readFile(resolve(root, 'cloudbaserc.chat.json'), 'utf8'));
  config.functions[0].envVariables = Object.fromEntries(required.map(key => [key, values[key]]));
  config.functions[0].envVariables.CHAT_CLOUDBASE_ENV_ID = config.envId;
  await mkdir(resolve(root, '.cloudbase'), { recursive: true, mode: 0o700 });
  const target = resolve(root, '.cloudbase/terminal-chat.deploy.json');
  await writeFile(target, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await chmod(target, 0o600);
  console.log(`私密部署配置已生成：${target}。请勿提交或分享此文件。`);
}
