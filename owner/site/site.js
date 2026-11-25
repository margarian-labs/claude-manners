document.querySelectorAll('[data-copy]').forEach((button) => {
  const label = button.querySelector('[aria-live]');
  const rest = label.textContent;
  let timer;
  button.addEventListener('click', () => {
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(button.dataset.copy).then(() => {
      label.textContent = 'Copied';
      button.dataset.copied = '';
      clearTimeout(timer);
      timer = setTimeout(() => {
        label.textContent = rest;
        delete button.dataset.copied;
      }, 2000);
    }, () => {});
  });
});
