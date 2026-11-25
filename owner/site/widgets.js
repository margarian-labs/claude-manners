const TYPED = /"([^"]+)"|(^|[\s(])((?:claude )?--?[A-Za-z][A-Za-z-]*(?: \d+)?|\/[a-z][a-z-]+|~\/[\w./-]*[\w/])/g;
const COMMAND = /^(-|\/|node |claude\b)/;

function el(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function markTyped(node, everyQuote) {
  const text = node.textContent;
  const out = [];
  let last = 0;
  for (const m of text.matchAll(TYPED)) {
    const quoted = m[1] !== undefined;
    const command = quoted && COMMAND.test(m[1]);
    if (quoted && !command && !everyQuote && m.index > 0) continue;
    out.push(text.slice(last, m.index));
    if (!quoted) out.push(m[2], el('span', m[3].startsWith('~') ? 'measured' : 'wg-typed measured', m[3]));
    else if (command) out.push(el('span', 'wg-typed measured', m[1]));
    else out.push('“', el('span', 'wg-typed', m[1]), '”');
    last = m.index + m[0].length;
  }
  out.push(text.slice(last));
  node.replaceChildren(...out);
}

for (const item of document.querySelectorAll('#start-gallery .start')) {
  const trigger = item.querySelector('.start__trigger');
  const cases = item.querySelector('.start__cases');
  markTyped(trigger, true);
  for (const line of cases.children) markTyped(line, false);
  const more = el('div', 'wg-start__more', '');
  more.id = `wg-start-${item.dataset.part}`;
  more.hidden = true;
  more.append(cases, item.querySelector('.start__more'));
  const toggle = el('button', 'btn wg-start__toggle', 'Examples');
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', more.id);
  toggle.setAttribute('aria-label', `Examples for ${item.querySelector('.start__title').textContent}`);
  toggle.addEventListener('click', () => {
    more.hidden = !more.hidden;
    toggle.setAttribute('aria-expanded', String(!more.hidden));
  });
  trigger.after(toggle, more);
}

const picker = document.getElementById('flag-picker');
const out = picker?.querySelector('.wg-flags__out');
if (out) {
  const chosenText = out.querySelector('.wg-flags__chosen');
  const does = out.querySelector('.wg-flags__does');
  const empty = out.querySelector('.wg-flags__empty');
  const chosen = [];
  for (const item of picker.querySelectorAll('.flag')) {
    const flag = { name: item.dataset.flag, does: item.querySelector('.flag__does').textContent };
    const button = el('button', 'wg-flag', '');
    button.type = 'button';
    button.setAttribute('aria-pressed', 'false');
    button.append(...item.childNodes);
    item.append(button);
    button.addEventListener('click', () => {
      const at = chosen.indexOf(flag);
      if (at < 0) chosen.push(flag);
      else chosen.splice(at, 1);
      button.setAttribute('aria-pressed', String(at < 0));
      chosenText.replaceChildren(...chosen.flatMap((f) => [' ', el('span', '', f.name)]));
      const row = at < 0 && el('li', '', '');
      if (row) {
        row.dataset.flag = flag.name;
        row.append(el('code', 'measured', flag.name), el('span', '', flag.does));
        does.append(row);
      } else {
        [...does.children].find((r) => r.dataset.flag === flag.name).remove();
      }
      does.hidden = !chosen.length;
      empty.hidden = chosen.length > 0;
    });
  }
  picker.classList.add('wg-on');
  out.hidden = false;
  picker.querySelector('.flag[data-flag="-q"] .wg-flag')?.click();
}

const flow = document.getElementById('flow-diagram');
const panels = [...(flow?.querySelectorAll('.wg-flow__panel') ?? [])];
if (panels.length) {
  const tablist = el('div', 'wg-tabs', '');
  tablist.setAttribute('role', 'tablist');
  tablist.setAttribute('aria-label', 'Flows');
  const tabs = panels.map((panel) => {
    const name = panel.querySelector('.wg-flow__name');
    const tab = el('button', 'wg-tab', name.textContent);
    tab.type = 'button';
    tab.id = `${panel.id}-tab`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', panel.id);
    name.hidden = true;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', tab.id);
    panel.tabIndex = 0;
    return tab;
  });
  const select = (index, byUser) => {
    tabs.forEach((tab, i) => {
      tab.setAttribute('aria-selected', String(i === index));
      tab.tabIndex = i === index ? 0 : -1;
      panels[i].hidden = i !== index;
      panels[i].classList.toggle('wg-in', byUser && i === index);
    });
    if (byUser) tabs[index].focus();
  };
  tabs.forEach((tab, i) => tab.addEventListener('click', () => select(i, true)));
  tablist.addEventListener('keydown', (event) => {
    const i = tabs.indexOf(document.activeElement);
    const last = tabs.length - 1;
    const to = { ArrowRight: i === last ? 0 : i + 1, ArrowLeft: i === 0 ? last : i - 1, Home: 0, End: last }[event.key];
    if (to === undefined) return;
    event.preventDefault();
    select(to, true);
  });
  tablist.append(...tabs);
  flow.prepend(tablist);
  flow.classList.add('wg-on');
  select(0, false);
}
