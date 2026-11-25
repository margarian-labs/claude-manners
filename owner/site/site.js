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

const ask = document.getElementById('ask');
if (ask) {
  const { parts } = JSON.parse(document.getElementById('site-data').textContent);
  const at = (name) => document.querySelector(`.ask__${name}`);
  const yes = at('yes');
  const no = at('no');
  const still = window.matchMedia('(prefers-reduced-motion: reduce)');
  let i = 0;
  let chosen = 0;
  let busy = false;
  const show = () => {
    const part = parts[i];
    at('q').textContent = part ? `Install ${part.title}?` : `All ${parts.length} answered`;
    at('what').textContent = part ? part.summary : `You would install ${chosen} and skip ${parts.length - chosen}.`;
    at('solves').textContent = part ? `Solves: ${part.solves}` : 'When you join, your agent checks your PC first and asks these questions for real.';
    at('cost').textContent = part ? `Cost: ${part.cost}` : '';
    at('count').textContent = part ? `${i + 1} of ${parts.length}${i ? `, ${chosen} chosen, ${i - chosen} skipped` : ''}` : '';
    yes.textContent = part ? 'Install' : 'Start over';
    no.hidden = !part;
  };
  yes.addEventListener('click', () => {
    if (busy) return;
    const next = () => {
      busy = false;
      yes.classList.remove('is-in');
      if (i === parts.length) i = chosen = 0;
      else {
        i += 1;
        chosen += 1;
      }
      show();
    };
    if (still.matches) return next();
    busy = true;
    yes.classList.add('is-in');
    setTimeout(next, 240);
  });
  no.addEventListener('click', () => {
    if (busy) return;
    i += 1;
    show();
  });
  yes.hidden = no.hidden = false;
}
