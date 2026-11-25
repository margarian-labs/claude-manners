const root = document.getElementById('session-diagram');
const list = root ? root.querySelector('ol.moments') : null;
const items = list ? [...list.querySelectorAll(':scope > .moment')] : [];
const tabs = [];
const bodies = [];

function select(index) {
  tabs.forEach((tab, i) => {
    const on = i === index;
    tab.setAttribute('aria-expanded', String(on));
    tab.setAttribute('aria-disabled', String(on));
    bodies[i].hidden = !on;
  });
}

items.forEach((item, i) => {
  const id = item.dataset.moment;
  const heading = item.querySelector('.moment__title');
  const title = heading.textContent;

  const tab = document.createElement('button');
  tab.type = 'button';
  tab.className = 'sx-tab';
  tab.id = `sx-tab-${id}`;
  tab.setAttribute('aria-controls', `sx-body-${id}`);
  const name = document.createElement('span');
  name.className = 'sx-tab__title';
  name.textContent = title;
  tab.append(name);
  if (item.dataset.event) {
    const event = document.createElement('span');
    event.className = 'sx-tab__event measured';
    event.textContent = item.dataset.event;
    tab.append(event);
  }

  const body = document.createElement('div');
  body.className = 'sx-body';
  body.id = `sx-body-${id}`;
  body.setAttribute('role', 'region');
  body.setAttribute('aria-labelledby', tab.id);
  const head = document.createElement('p');
  head.className = 'sx-body__title';
  head.setAttribute('aria-hidden', 'true');
  head.textContent = title;
  body.append(head, ...[...item.children].filter((el) => el !== heading));

  heading.replaceChildren(tab);
  item.append(body);
  tab.addEventListener('click', () => {
    root.dataset.moved = 'true';
    select(i);
  });
  tabs.push(tab);
  bodies.push(body);
});

for (const does of root ? root.querySelectorAll('.moment__does') : []) {
  const pieces = does.textContent.split(/(\B-[a-z]+\b)/);
  if (pieces.length < 2) continue;
  does.replaceChildren(...pieces.map((text, n) => {
    if (n % 2 === 0) return text;
    const flag = document.createElement('code');
    flag.className = 'sx-flag measured';
    flag.textContent = text;
    return flag;
  }));
}

if (tabs.length) {
  list.addEventListener('keydown', (e) => {
    const at = tabs.indexOf(e.target);
    if (at < 0) return;
    const to = { ArrowDown: at + 1, ArrowRight: at + 1, ArrowUp: at - 1, ArrowLeft: at - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    tabs[(to + tabs.length) % tabs.length].focus();
  });
  root.classList.add('sx-on');
  select(0);
}
