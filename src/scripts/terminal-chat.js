// Loaded only after the visitor explicitly enters chat. No SDK or background connection.
const STORAGE_KEY = 'LONG_BLOG_TERMINAL_CHAT_V1';
const MAX_MESSAGES = 100;
const EXIT_NOTE = '已进入作者留言通道。消息会通知作者，回复可能需要一些时间。\n同一标签页可续聊，记录保留 7 天。输入 exit 退出。';

export function mountTerminalChat(root, { announce, scroll }) {
  const document = root.ownerDocument;
  const window = document.defaultView;
  const transcript = root.querySelector('[data-terminal-transcript]');
  const log = document.createElement('section');
  log.className = 'terminal-chat-log terminal-block';
  log.setAttribute('aria-label', '与作者的对话');
  const notice = document.createElement('p');
  notice.className = 'terminal-chat-notice';
  const rows = document.createElement('div');
  rows.className = 'terminal-chat-messages';
  log.append(notice, rows);
  let api = '';
  try {
    const url = new URL(root.dataset.chatApi);
    if (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
      api = url.href.replace(/\/$/, '');
    }
  } catch { /* An unconfigured chat must never affect local commands. */ }
  let active = false;
  let disposed = false;
  let timer;
  let generation = 0;
  let inFlight = false;
  let pollFailures = 0;
  let idlePolls = 0;
  const requests = new Set();
  const nodes = new Map();
  const randomHex = size => Array.from(window.crypto.getRandomValues(new Uint8Array(size)), byte => byte.toString(16).padStart(2, '0')).join('');
  let session = null;
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY));
    if (saved?.api === api && /^[a-f0-9]{32}$/.test(saved.id) && /^[a-f0-9]{64}$/.test(saved.key)
      && saved.expiresAt > Date.now() && Number.isSafeInteger(saved.cursor) && saved.cursor >= 0 && Array.isArray(saved.messages)) {
      session = saved;
      session.messages = saved.messages.filter(message => /^[a-f0-9]{32}$/.test(message.id)
        && ['user', 'author'].includes(message.sender) && typeof message.text === 'string' && message.text.length <= 1000).slice(-MAX_MESSAGES);
      session.messages.forEach(message => { if (message.status === 'sending') message.status = 'failed'; });
    }
  } catch { /* Storage may be disabled; an in-memory session still works. */ }
  const save = () => {
    if (!session) return;
    session.messages = session.messages.slice(-MAX_MESSAGES);
    try { window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session)); } catch { /* Best effort. */ }
  };
  const setNotice = text => { notice.textContent = text; announce(text); };
  const trim = () => {
    while (rows.children.length > MAX_MESSAGES) {
      const first = rows.firstElementChild;
      nodes.delete(first.dataset.messageKey); first.remove();
    }
  };
  const orderRows = () => {
    const ordered = [...session.messages].sort((a, b) => (a.sequence ?? Infinity) - (b.sequence ?? Infinity));
    for (const message of ordered) {
      const node = nodes.get(`${message.sender}:${message.id}`);
      if (node) rows.append(node);
    }
  };
  const render = message => {
    if (disposed) return;
    const key = `${message.sender}:${message.id}`;
    let row = nodes.get(key);
    if (!row) {
      row = document.createElement('div');
      row.className = `terminal-chat-row terminal-chat-${message.sender}`;
      row.dataset.messageKey = key;
      const name = document.createElement('span'); name.className = 'terminal-chat-name';
      name.textContent = message.sender === 'author' ? '[作者]' : '[你]';
      const text = document.createElement('span'); text.className = 'terminal-chat-text'; text.textContent = message.text;
      const status = document.createElement('span'); status.className = 'terminal-chat-status';
      row.append(name, text, status); rows.append(row); nodes.set(key, row);
    }
    const status = row.querySelector('.terminal-chat-status');
    status.replaceChildren();
    row.dataset.status = message.status || 'sent';
    if (message.sender === 'user') {
      status.textContent = message.status === 'sending' ? '发送中…' : message.status === 'failed' ? '发送未确认 ' : '已发送';
      if (message.status === 'failed') {
        const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = '重试';
        retry.dataset.retry = message.id; retry.setAttribute('aria-label', '重试发送这条消息'); status.append(retry);
      }
    }
    trim();
  };
  const request = async (path, options = {}) => {
    const controller = new window.AbortController();
    requests.add(controller);
    const timeout = window.setTimeout(() => controller.abort(), 18000);
    try {
      const response = await window.fetch(`${api}${path}`, {
        ...options, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.key}`, ...options.headers },
      });
      const data = await response.json();
      if (!response.ok) {
        const error = new Error(data.error || '请求失败，请稍后重试。'); error.status = response.status; throw error;
      }
      return data;
    } finally { requests.delete(controller); window.clearTimeout(timeout); }
  };
  const schedule = delay => {
    window.clearTimeout(timer);
    if (active && session?.attempted && !document.hidden) timer = window.setTimeout(poll, delay);
  };
  const poll = async () => {
    if (!active || !session?.attempted || document.hidden || inFlight) return;
    inFlight = true;
    const version = generation;
    try {
      const data = await request(`/chat/poll?sessionId=${session.id}&cursor=${session.cursor}`);
      if (!active || disposed || version !== generation) return;
      if (!Array.isArray(data.messages) || !Number.isSafeInteger(data.cursor) || data.cursor < session.cursor) throw new Error('回复数据暂不可用。');
      let received = 0;
      for (const message of data.messages) {
        if (!/^[a-f0-9]{32}$/.test(message.id) || !['user', 'author'].includes(message.sender) || typeof message.text !== 'string') continue;
        const existing = session.messages.find(item => item.id === message.id && item.sender === message.sender);
        if (existing) Object.assign(existing, message, { status: 'sent' });
        else { session.messages.push({ ...message, status: 'sent' }); if (message.sender === 'author') received++; }
        render(existing || session.messages.at(-1));
      }
      session.cursor = data.cursor; orderRows(); save();
      pollFailures = 0;
      idlePolls = data.messages.length ? 0 : idlePolls + 1;
      if (received) { announce(`收到作者的 ${received} 条回复。`); scroll(); }
      if (notice.dataset.connectionIssue) { delete notice.dataset.connectionIssue; setNotice(EXIT_NOTE); }
      schedule(data.hasMore ? 0 : idlePolls > 20 ? 30000 : idlePolls > 5 ? 15000 : 4000);
    } catch (error) {
      if (!active || disposed || version !== generation) return;
      pollFailures++;
      if ([401, 403, 410].includes(error.status)) {
        setNotice('会话已失效。请退出聊天后刷新页面，重新留言。');
        session.expiresAt = 0; save(); return;
      }
      if (pollFailures >= 3) {
        notice.dataset.connectionIssue = 'true'; setNotice('暂时无法获取回复，正在重连；已保存的消息不会因此删除。');
      }
      schedule(Math.min(30000, 4000 * 2 ** Math.min(pollFailures, 3)));
    } finally { if (version === generation) inFlight = false; }
  };
  const deliver = async message => {
    if (!active || disposed || message.status === 'sending') return;
    message.status = 'sending'; session.attempted = true; save(); render(message); scroll();
    const version = generation;
    try {
      const data = await request('/chat/send', { method: 'POST', body: JSON.stringify({ sessionId: session.id, messageId: message.id, message: message.text }) });
      if (!active || disposed || version !== generation) return;
      Object.assign(message, data.message, { status: 'sent' });
      orderRows();
      if (data.expiresAt) session.expiresAt = data.expiresAt;
      if (data.notification === 'failed') setNotice('留言已保存；作者通知暂未成功，请稍后查看回复。');
      else announce('消息已发送。作者回复会显示在这里。');
      idlePolls = 0;
    } catch (error) {
      if (!active || disposed || version !== generation) return;
      message.status = 'failed'; announce(error.status ? error.message : '网络暂不可用，发送结果未确认，可以重试。');
      if (error.status) setNotice(error.message);
    } finally {
      if (!disposed && version === generation) { save(); render(message); schedule(0); }
    }
  };
  const retryHandler = event => {
    const button = event.target.closest?.('button[data-retry]');
    if (!button || !active) return;
    const message = session?.messages.find(item => item.id === button.dataset.retry && item.sender === 'user');
    if (message) void deliver(message);
  };
  const visibilityHandler = () => {
    window.clearTimeout(timer);
    if (!document.hidden) schedule(0);
  };
  const stop = () => {
    active = false; generation++; inFlight = false; window.clearTimeout(timer);
    requests.forEach(controller => controller.abort()); requests.clear();
    session?.messages.forEach(message => { if (message.status === 'sending') { message.status = 'failed'; render(message); } });
    save();
  };
  rows.addEventListener('click', retryHandler);
  document.addEventListener('visibilitychange', visibilityHandler);
  return {
    enter() {
      if (disposed || active) return;
      active = true;
      if (!log.isConnected) transcript.append(log);
      rows.replaceChildren(); nodes.clear(); session?.messages.forEach(render);
      setNotice(api ? EXIT_NOTE : '作者留言通道尚未配置，请稍后再来。输入 exit 返回终端。');
      schedule(0); scroll();
    },
    send(text) {
      if (!api) { setNotice('作者留言通道尚未配置，消息没有发送。'); return false; }
      if (text.length > 500) { setNotice('每条消息最多 500 字，请缩短后发送。'); return false; }
      if (session?.expiresAt <= Date.now()) { setNotice('会话已失效。请退出聊天后刷新页面，重新留言。'); return false; }
      if ((session?.messages.filter(message => message.status === 'sending').length || 0) >= 3) {
        announce('请等待当前消息发送完成。'); return false;
      }
      try {
        session ??= { api, id: randomHex(16), key: randomHex(32), cursor: 0, expiresAt: Date.now() + 7 * 86400000, messages: [] };
        const message = { id: randomHex(16), sender: 'user', text, status: 'new' };
        session.messages.push(message); void deliver(message); return true;
      } catch { setNotice('当前浏览器无法建立安全会话，请更新浏览器后重试。'); return false; }
    },
    clearScreen() { rows.replaceChildren(); nodes.clear(); announce('聊天屏幕已清空，会话仍然保留。'); },
    pause: stop,
    dispose() { stop(); disposed = true; rows.removeEventListener('click', retryHandler); document.removeEventListener('visibilitychange', visibilityHandler); },
  };
}
