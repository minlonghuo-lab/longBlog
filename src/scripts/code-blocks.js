// Code-block actions, mirroring what Trilium applies at display time: a copy
// button on every code block and click-to-copy on inline code. Trilium's markup
// is reproduced so the stylesheet can target the same selectors, and so a reader
// who has seen one renders the other identically.

const COPY_TITLE = '复制代码';
const INLINE_COPY_TITLE = '点击复制';

function copyText(text) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  // The async clipboard API needs a secure context; over plain HTTP fall back to
  // the selection-based command so the button still works.
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.top = '-1000px';
  document.body.appendChild(area);
  area.select();
  try {
    document.execCommand('copy');
  } finally {
    area.remove();
  }
  return Promise.resolve();
}

function addCopyButton(pre, code) {
  if (pre.querySelector(':scope > button.copy-button')) return;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'copy-button';
  button.title = COPY_TITLE;
  button.setAttribute('aria-label', COPY_TITLE);
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    copyText(code.textContent ?? '');
  });
  pre.appendChild(button);
}

function addInlineCopy(code) {
  if (code.classList.contains('copyable-inline-code')) return;

  code.classList.add('copyable-inline-code');
  code.title = INLINE_COPY_TITLE;
  code.addEventListener('click', () => {
    copyText(code.textContent ?? '');
  });
}

export function installCodeBlockActions(root = document) {
  for (const pre of root.querySelectorAll('.content pre')) {
    const code = pre.querySelector('code');
    if (code) addCopyButton(pre, code);
  }
  for (const code of root.querySelectorAll('.content code:not(pre code)')) {
    addInlineCopy(code);
  }
}

document.addEventListener('astro:after-swap', () => installCodeBlockActions());
installCodeBlockActions();
