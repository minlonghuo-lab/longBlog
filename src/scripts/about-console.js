export const COMMANDS = ['profile', 'knowledge', 'projects', 'history', 'clear'];
const ALIASES = { fastfetch: 'profile', whoami: 'profile' };
const MAX_BLOCKS = 30;
const MAX_HISTORY = 100;

export function mountAboutConsole(root) {
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
    const raw = String(value).trim().slice(0, 160);
    if (!raw) return;
    history.push(raw);
    if (history.length > MAX_HISTORY) history.shift();
    historyIndex = history.length; draft = ''; input.value = '';
    sizeInput(); hideSuggestions();
    const normalized = raw.toLowerCase();
    const command = Object.hasOwn(ALIASES, normalized) ? ALIASES[normalized] : normalized;
    if (command === 'clear') {
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
      } else if (COMMANDS.includes(command)) {
        const template = root.querySelector(`template[data-output="${command}"]`);
        block.append(template.content.cloneNode(true));
      } else {
        const message = document.createElement('p');
        message.className = 'terminal-error';
        // Treat arbitrary input as text, never HTML or executable code.
        message.textContent = `command not found: ${raw}\n可用命令：${COMMANDS.join(' / ')}`;
        block.append(message);
      }
      transcript.append(block);
      while (transcript.children.length > MAX_BLOCKS) transcript.firstElementChild.remove();
      updateTheme();
      announcement.textContent = COMMANDS.includes(command) ? `${command} 已执行。输出在输入框上方。` : '未知命令，请使用下方命令入口。';
    }
    scrollToPrompt();
    if (focusInput) input.focus({ preventScroll: true });
  };

  form.addEventListener('submit', event => { event.preventDefault(); execute(input.value, true); }, { signal });
  root.addEventListener('click', event => {
    const button = event.target.closest?.('button[data-command]');
    if (button && root.contains(button)) execute(button.dataset.command);
  }, { signal });
  input.addEventListener('input', () => { sizeInput(); hideSuggestions(); }, { signal });
  inputShell?.addEventListener('click', () => input.focus({ preventScroll: true }), { signal });
  input.addEventListener('keydown', event => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      if (historyIndex === history.length) draft = input.value;
      historyIndex = Math.max(0, Math.min(history.length, historyIndex + (event.key === 'ArrowUp' ? -1 : 1)));
      input.value = historyIndex === history.length ? draft : history[historyIndex];
      sizeInput(); hideSuggestions();
    } else if (event.key === 'Tab' && !event.shiftKey && input.value.trim()) {
      const value = input.value.trim().toLowerCase();
      const matches = [...COMMANDS, ...Object.keys(ALIASES)].filter(command => command.startsWith(value));
      if (matches.length === 1 && matches[0] !== value) {
        event.preventDefault(); input.value = matches[0]; sizeInput(); hideSuggestions();
      } else if (matches.length > 1) {
        event.preventDefault(); showMatches(matches);
        announcement.textContent = `匹配命令：${matches.join('、')}。继续输入或点击选择。`;
      }
    } else if (event.key === 'Escape') hideSuggestions();
  }, { signal });

  root.querySelectorAll('[data-terminal-form], [data-terminal-shortcuts], [data-terminal-help]').forEach(node => { node.hidden = false; });
  updateTheme(); sizeInput();
  return () => { disposed = true; controller.abort(); observer.disconnect(); };
}

const lifecycles = new WeakMap();
export function installAboutConsole(document = globalThis.document) {
  if (lifecycles.has(document)) return lifecycles.get(document);
  let currentRoot = null;
  let dispose = null;
  const cleanup = () => { dispose?.(); dispose = null; currentRoot = null; };
  const setup = () => {
    const root = document.querySelector('[data-about-console]');
    if (root === currentRoot) return;
    cleanup();
    if (root) { currentRoot = root; dispose = mountAboutConsole(root); }
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
  };
  lifecycles.set(document, uninstall); setup();
  return uninstall;
}
