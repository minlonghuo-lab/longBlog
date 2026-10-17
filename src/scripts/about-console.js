export const COMMANDS = ['profile', 'clear', 'chat'];
const MAX_BLOCKS = 30;
const MAX_HISTORY = 100;

export function mountAboutConsole(root, { loadChat = () => import('./terminal-chat.js') } = {}) {
  const document = root.ownerDocument;
  const window = document.defaultView;
  const controller = new window.AbortController();
  const { signal } = controller;
  const form = root.querySelector('[data-terminal-form]');
  const input = form?.querySelector('input');
  const transcript = root.querySelector('[data-terminal-transcript]');
  const screen = root.querySelector('[data-terminal-screen]');
  const suggestions = root.querySelector('[data-command-suggestions]');
  const announcement = root.querySelector('[data-terminal-announcement]');
  const inputShell = root.querySelector('.terminal-input-shell');
  const profileTemplate = root.querySelector('template[data-output="profile"]')?.content.firstElementChild;
  const promptTemplate = root.querySelector('template[data-command-template]')?.content.firstElementChild;
  if (!form || !input || !transcript || !profileTemplate || !promptTemplate) return () => controller.abort();
  const history = [];
  let historyIndex = 0;
  let draft = '';
  let disposed = false;
  let mode = 'terminal';
  let chat = null;
  let chatLoading = null;
  let composing = false;
  const label = form.querySelector('label');
  const promptParts = ['.terminal-user', '.terminal-host', '.terminal-path'].map(selector => label.querySelector(selector));
  const originalPrompt = promptParts.map(node => node.textContent);
  const help = root.querySelector('[data-terminal-help]');
  const originalHelp = help.textContent;

  const setChatMode = enabled => {
    mode = enabled ? 'chat' : 'terminal';
    root.dataset.chatMode = String(enabled);
    transcript.querySelectorAll('button[data-command]').forEach(button => { button.disabled = enabled; });
    promptParts.forEach((node, i) => { node.textContent = enabled ? ['author', 'chat', '[msg] >'][i] : originalPrompt[i]; });
    root.querySelector('[data-chat-shortcuts]').hidden = !enabled;
    help.textContent = enabled ? '文字会发送给作者 · exit 退出 · 每条最多 500 字' : originalHelp;
    label.querySelector('.terminal-sr-only').textContent = enabled ? '发送给作者的消息' : '输入命令';
    input.maxLength = enabled ? 500 : 160;
    input.enterKeyHint = enabled ? 'send' : 'go';
    input.value = ''; sizeInput(); hideSuggestions();
  };
  const exitChat = () => {
    setChatMode(false); chat?.pause();
    announcement.textContent = '已退出聊天。普通命令在本地执行。';
  };
  const enterChat = async () => {
    setChatMode(true);
    announcement.textContent = '正在进入作者留言通道。';
    try {
      chatLoading ??= loadChat().then(module => {
        if (disposed) return null;
        chat = module.mountTerminalChat(root, { announce: text => { announcement.textContent = text; }, scroll: scrollToPrompt });
        return chat;
      });
      const loaded = await chatLoading;
      if (!disposed && mode === 'chat') loaded?.enter();
    } catch {
      chatLoading = null;
      if (!disposed && mode === 'chat') {
        exitChat();
        announcement.textContent = '聊天模块加载失败，请稍后重新输入 chat。';
      }
    }
  };

  const updateTheme = () => {
    const dark = document.documentElement.dataset.theme === 'dark';
    root.querySelectorAll('[data-terminal-theme]').forEach(node => { node.textContent = dark ? 'Dark' : 'Light'; });
    const toggle = root.querySelector('#theme-toggle');
    toggle?.setAttribute('aria-pressed', String(dark));
    toggle?.setAttribute('aria-label', dark ? '切换到浅色模式' : '切换到深色模式');
  };
  const observer = new window.MutationObserver(updateTheme);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const sizeInput = () => { input.style.width = `${Math.max(1, Array.from(input.value).length + .5)}ch`; };
  const hideSuggestions = () => { suggestions.hidden = true; suggestions.replaceChildren(); };
  const showMatches = matches => {
    suggestions.replaceChildren();
    matches.forEach(command => {
      const button = document.createElement('button');
      button.type = 'button'; button.dataset.command = command; button.textContent = command;
      suggestions.append(button);
    });
    suggestions.hidden = !matches.length;
  };
  const scrollToPrompt = () => {
    // Only scroll the terminal viewport. Never jump the surrounding blog page.
    screen.scrollTop = screen.scrollHeight;
  };

  const execute = (value, focusInput = false) => {
    if (disposed) return;
    if (mode === 'chat') {
      const text = String(value).trim();
      if (!text) return;
      if (['exit', 'quit', ':q'].includes(text.toLowerCase())) exitChat();
      else if (chat) { if (chat.send(text)) { input.value = ''; sizeInput(); } }
      else announcement.textContent = '聊天正在加载，请稍后发送。';
      if (focusInput) input.focus({ preventScroll: true });
      return;
    }
    const raw = String(value).trim().slice(0, 160);
    if (!raw) return;
    history.push(raw);
    if (history.length > MAX_HISTORY) history.shift();
    historyIndex = history.length; draft = ''; input.value = '';
    sizeInput(); hideSuggestions();
    const command = raw.toLowerCase();
    if (command === 'chat') {
      void enterChat();
    } else if (command === 'clear') {
      transcript.replaceChildren();
      announcement.textContent = '终端已清空。输入 profile 可重新显示个人信息。';
    } else {
      const block = document.createElement('section');
      block.className = 'terminal-block'; block.dataset.terminalBlock = '';
      const prompt = promptTemplate.cloneNode(true);
      prompt.querySelector('.terminal-command').textContent = raw;
      prompt.setAttribute('aria-label', `已执行 ${raw}`);
      block.append(prompt);
      if (command === 'profile') {
        block.append(profileTemplate.cloneNode(true));
      } else if (command === 'help') {
        const template = root.querySelector('template[data-output="help"]');
        block.append(template.content.cloneNode(true));
      } else {
        const message = document.createElement('p');
        message.className = 'terminal-error';
        // Treat arbitrary input as text, never HTML or executable code.
        message.textContent = `command not found: ${raw}\n输入 help 获取相关命令。`;
        block.append(message);
      }
      transcript.append(block);
      while (transcript.children.length > MAX_BLOCKS) transcript.firstElementChild.remove();
      updateTheme();
      announcement.textContent = COMMANDS.includes(command) || command === 'help' ? `${command} 已执行。输出在输入框上方。` : '未知命令，输入 help 获取相关命令。';
    }
    scrollToPrompt();
    if (focusInput) input.focus({ preventScroll: true });
  };

  // An already-open tab can retain a pre-chat bundle across ClientRouter swaps.
  // Own terminal input in capture phase before its legacy bubbling handlers run.
  const ownInput = handler => event => { event.stopImmediatePropagation(); handler(event); };
  const inputOptions = { signal, capture: true };
  form.addEventListener('submit', ownInput(event => { event.preventDefault(); if (!composing) execute(input.value, true); }), inputOptions);
  input.addEventListener('compositionstart', ownInput(() => { composing = true; }), inputOptions);
  input.addEventListener('compositionend', ownInput(() => { composing = false; }), inputOptions);
  root.addEventListener('click', event => {
    const action = event.target.closest?.('button[data-chat-action]');
    if (action && root.contains(action)) {
      event.stopImmediatePropagation();
      if (action.dataset.chatAction === 'exit') exitChat();
      else chat?.clearScreen();
      input.focus({ preventScroll: true });
      return;
    }
    const button = event.target.closest?.('button[data-command]');
    if (button && root.contains(button)) {
      event.stopImmediatePropagation();
      if (mode === 'terminal') execute(button.dataset.command, true);
    }
  }, inputOptions);
  input.addEventListener('input', ownInput(() => { sizeInput(); hideSuggestions(); }), inputOptions);
  inputShell?.addEventListener('click', () => input.focus({ preventScroll: true }), { signal });
  input.addEventListener('keydown', ownInput(event => {
    if (event.isComposing || event.keyCode === 229) return;
    if (mode === 'chat') return;
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      if (historyIndex === history.length) draft = input.value;
      historyIndex = Math.max(0, Math.min(history.length, historyIndex + (event.key === 'ArrowUp' ? -1 : 1)));
      input.value = historyIndex === history.length ? draft : history[historyIndex];
      sizeInput(); hideSuggestions();
    } else if (event.key === 'Tab' && !event.shiftKey && input.value.trim()) {
      const value = input.value.trim().toLowerCase();
      const matches = ['help', ...COMMANDS].filter(command => command.startsWith(value));
      if (matches.length === 1 && matches[0] !== value) {
        event.preventDefault(); input.value = matches[0]; sizeInput(); hideSuggestions();
      } else if (matches.length > 1) {
        event.preventDefault(); showMatches(matches);
        announcement.textContent = `匹配命令：${matches.join('、')}。继续输入或点击选择。`;
      }
    } else if (event.key === 'Escape') hideSuggestions();
  }), inputOptions);

  root.querySelectorAll('[data-terminal-form], [data-terminal-help]').forEach(node => { node.hidden = false; });
  updateTheme(); sizeInput();
  return () => { disposed = true; chat?.dispose(); controller.abort(); observer.disconnect(); };
}

const lifecycles = new WeakMap();
const installationKey = Symbol.for('longBlog.aboutConsole.installation');
export function installAboutConsole(document = globalThis.document, options) {
  if (lifecycles.has(document)) return lifecycles.get(document);
  // Module-local WeakMaps do not deduplicate different hashed bundle versions.
  document[installationKey]?.();
  let currentRoot = null;
  let dispose = null;
  const cleanup = () => { dispose?.(); dispose = null; currentRoot = null; };
  const setup = () => {
    const root = document.querySelector('[data-about-console]');
    if (root !== currentRoot) {
      cleanup();
      if (root) { currentRoot = root; dispose = mountAboutConsole(root, options); }
    }
    currentRoot?.querySelector('[data-terminal-form] input')?.focus({ preventScroll: true });
  };
  const onPageHide = event => { if (!event.persisted) cleanup(); };
  document.addEventListener('astro:page-load', setup);
  document.addEventListener('astro:before-swap', cleanup);
  document.defaultView.addEventListener('pagehide', onPageHide);
  document.defaultView.addEventListener('pageshow', setup);
  const uninstall = () => {
    cleanup();
    document.removeEventListener('astro:page-load', setup);
    document.removeEventListener('astro:before-swap', cleanup);
    document.defaultView.removeEventListener('pagehide', onPageHide);
    document.defaultView.removeEventListener('pageshow', setup);
    lifecycles.delete(document);
    if (document[installationKey] === uninstall) delete document[installationKey];
  };
  lifecycles.set(document, uninstall); document[installationKey] = uninstall; setup();
  return uninstall;
}
