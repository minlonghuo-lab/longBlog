// Replace older bundles retained by ClientRouter with one document listener.
const installationKey = Symbol.for('longBlog.friendSiteInfo');
document[installationKey]?.abort();
const controller = new AbortController();
document[installationKey] = controller;
const { signal } = controller;

function enableCopy() {
  document.querySelectorAll('[data-copy-site-info]').forEach(button => { button.disabled = false; });
}

document.addEventListener('click', async event => {
  const button = event.target.closest?.('[data-copy-site-info]');
  if (!button || button.disabled) return;
  const code = button.closest('[data-friend-site-info]')?.querySelector('[data-site-info-code]');
  const label = button.querySelector('[data-copy-label]');
  if (!code || !label) return;
  button.disabled = true;
  label.textContent = '复制中';
  try {
    await navigator.clipboard.writeText(code.textContent);
    label.textContent = '已复制';
  } catch {
    const range = document.createRange();
    range.selectNodeContents(code);
    const selection = document.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    label.textContent = '请手动复制';
  } finally {
    button.disabled = false;
  }
}, { signal });
document.addEventListener('astro:page-load', enableCopy, { signal });
enableCopy();
