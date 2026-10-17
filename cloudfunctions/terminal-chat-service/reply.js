(() => {
  const base = new URL('./', location.href);
  const storageKey = `LONG_BLOG_AUTHOR_REPLY:${base.pathname}`;
  let token = new URLSearchParams(location.hash.slice(1)).get('token');
  try {
    if (token) sessionStorage.setItem(storageKey, token);
    else token = sessionStorage.getItem(storageKey);
  } catch { /* The current page still works without storage. */ }
  history.replaceState(null, '', location.pathname);
  const form = document.getElementById('reply-form');
  const input = document.getElementById('reply');
  const button = document.getElementById('send');
  const status = document.getElementById('status');
  const messages = document.getElementById('messages');
  const setStatus = (text, error = false) => { status.textContent = text; status.dataset.error = String(error); };
  let sessionId;
  try {
    const encoded = token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(encoded));
    if (payload.role !== 'author' || !/^[a-f0-9]{32}$/.test(payload.sessionId) || payload.exp <= Date.now()) throw new Error();
    sessionId = payload.sessionId;
  } catch { setStatus('回复链接无效或已过期，请打开最新的企业微信通知。', true); return; }
  document.getElementById('session').textContent = `访客 ${sessionId.slice(0, 8)}`;
  let cursor = 0;
  let timer;
  let polling = false;
  let stopped = false;
  let sending = false;
  let valid = false;
  let pending = null;
  const seen = new Set();
  const requests = new Set();
  const request = async (path, options = {}) => {
    const controller = new AbortController(); requests.add(controller);
    const timeout = setTimeout(() => controller.abort(), 18000);
    try {
      const response = await fetch(new URL(path, base), { ...options, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } });
      const data = await response.json();
      if (!response.ok) { const error = new Error(data.error || '请求失败。'); error.status = response.status; throw error; }
      return data;
    } finally { clearTimeout(timeout); requests.delete(controller); }
  };
  const render = message => {
    const key = `${message.sender}:${message.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    const row = document.createElement('div'); row.className = `message ${message.sender}`;
    const name = document.createElement('div'); name.className = 'name'; name.textContent = message.sender === 'author' ? '[作者]' : '[访客]';
    const text = document.createElement('p'); text.className = 'text'; text.textContent = message.text;
    row.append(name, text); messages.append(row);
    while (messages.children.length > 100) messages.firstElementChild.remove();
    messages.scrollTop = messages.scrollHeight;
  };
  const schedule = delay => { clearTimeout(timer); if (!stopped && !document.hidden) timer = setTimeout(poll, delay); };
  async function poll() {
    if (polling || stopped || document.hidden) return;
    polling = true;
    try {
      const data = await request(`chat/poll?sessionId=${sessionId}&cursor=${cursor}`);
      if (stopped) return;
      data.messages.forEach(render); cursor = data.cursor; valid = true;
      button.disabled = sending;
      if (status.textContent === '正在读取对话…' || status.dataset.pollError) { delete status.dataset.pollError; setStatus('对话已加载。'); }
      schedule(data.hasMore ? 0 : 10000);
    } catch (error) {
      if (stopped) return;
      if ([401, 403, 404, 410].includes(error.status)) { valid = false; button.disabled = true; stopped = true; }
      status.dataset.pollError = 'true'; setStatus(error.status ? error.message : '暂时无法读取对话，正在重试。', true); schedule(15000);
    } finally { polling = false; }
  }
  input.addEventListener('input', () => { document.getElementById('count').textContent = `${input.value.length} / 500`; });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text || sending || !valid) return;
    if (!pending || pending.text !== text) {
      pending = { text, id: Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('') };
    }
    sending = true; button.disabled = true; input.readOnly = true; setStatus('正在保存回复…');
    try {
      const data = await request('chat/reply', { method: 'POST', body: JSON.stringify({ sessionId, messageId: pending.id, message: text }) });
      if (stopped) return;
      render(data.message); pending = null; input.value = ''; document.getElementById('count').textContent = '0 / 500';
      setStatus('回复已保存。访客连接时会自动获取。'); schedule(0);
    } catch (error) {
      if (!stopped) setStatus(error.status ? error.message : '发送结果未确认，请再次点击发送；不会重复保存同一条回复。', true);
    } finally { sending = false; button.disabled = !valid; input.readOnly = false; }
  });
  document.addEventListener('visibilitychange', () => { clearTimeout(timer); if (!document.hidden) schedule(0); });
  window.addEventListener('pagehide', () => { stopped = true; clearTimeout(timer); requests.forEach(controller => controller.abort()); });
  window.addEventListener('pageshow', event => { if (event.persisted) { stopped = false; schedule(0); } });
  void poll();
})();
