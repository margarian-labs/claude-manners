const DEFAULTS = { q: '', group: 'all', use: 'all', level: 'all', sort: 'catalog' };
const USE_TEXT = { you: 'you start it', auto: 'works on its own' };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const words = (q) => q.toLowerCase().split(/\s+/).filter(Boolean);
const haystack = (p) => [p.title, p.id, p.summary, p.solves, p.trigger, ...p.use_cases].join('\n').toLowerCase();
const blockers = (p, s) => [
  s.group !== 'all' && p.group !== s.group && 'group',
  s.use !== 'all' && p.use !== s.use && 'use',
  s.level !== 'all' && p.level !== s.level && 'level',
  !words(s.q).every((w) => haystack(p).includes(w)) && 'q',
].filter(Boolean);
const matches = (p, s) => blockers(p, s).length === 0;
const sortIds = (parts, sort) => (sort === 'cost' ? [...parts].sort((a, b) => (b.tokens_always_on ?? -1) - (a.tokens_always_on ?? -1)) : parts).map((p) => p.id);
const parseState = (search, groups) => {
  const u = new URLSearchParams(search);
  const pick = (k, ok) => (ok.includes(u.get(k)) ? u.get(k) : DEFAULTS[k]);
  return { q: u.get('q') ?? '', group: pick('group', groups), use: pick('use', ['you', 'auto']), level: pick('level', ['recommended', 'optional']), sort: pick('sort', ['cost']) };
};
const queryOf = (s) => {
  const u = new URLSearchParams();
  for (const k of Object.keys(DEFAULTS)) if (s[k].trim() && s[k] !== DEFAULTS[k]) u.set(k, s[k]);
  const t = u.toString();
  return t ? `?${t}` : '';
};
const describe = (s) => [
  s.q.trim() && `search “${s.q.trim()}”`,
  s.group !== 'all' && `group ${cap(s.group)}`,
  s.use !== 'all' && USE_TEXT[s.use],
  s.level !== 'all' && s.level,
].filter(Boolean).join(', ');

const root = document.getElementById('explorer');
const data = JSON.parse(document.getElementById('site-data').textContent);
const list = document.getElementById('parts-list');
const input = document.getElementById('ex-q');
const count = document.getElementById('ex-count');
const empty = root.querySelector('.ex-empty');
const emptyWhat = document.getElementById('ex-empty-what');
const byId = new Map(data.parts.map((p) => [p.id, p]));
const liById = new Map([...list.children].map((li) => [li.dataset.id, li]));
const total = data.stats.parts.toLocaleString('en-US');
let state = parseState(location.search, data.groups);
let shownSort = 'catalog';

const groupOpts = document.getElementById('ex-groups');
document.getElementById('ex-all-n').textContent = total;
for (const g of data.groups) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn ex-opt';
  b.dataset.key = 'group';
  b.dataset.value = g;
  const n = document.createElement('span');
  n.className = 'ex-opt__n';
  n.textContent = data.parts.filter((p) => p.group === g).length;
  b.append(`${cap(g)} `, n);
  groupOpts.append(b);
}
const buttons = [...root.querySelectorAll('.ex-opt')];

const update = () => {
  let shown = 0;
  for (const [id, li] of liById) {
    li.hidden = !matches(byId.get(id), state);
    if (!li.hidden) shown++;
  }
  if (state.sort !== shownSort) {
    list.append(...sortIds(data.parts, state.sort).map((id) => liById.get(id)));
    shownSort = state.sort;
  }
  for (const b of buttons) b.setAttribute('aria-pressed', String(state[b.dataset.key] === b.dataset.value));
  if (input.value !== state.q) input.value = state.q;
  count.textContent = shown === data.parts.length ? `All ${total} parts` : `${shown} of ${total} parts`;
  list.hidden = shown === 0;
  empty.hidden = shown !== 0;
  emptyWhat.textContent = shown ? '' : `Current filters: ${describe(state)}.`;
  try {
    history.replaceState(history.state, '', location.pathname + queryOf(state) + location.hash);
  } catch {}
};

const reveal = () => {
  const m = /^#part-(.+)$/.exec(location.hash);
  const p = m && byId.get(decodeURIComponent(m[1]));
  if (!p) return;
  const hiders = blockers(p, state);
  if (hiders.length) {
    for (const k of hiders) state[k] = DEFAULTS[k];
    update();
  }
  const li = liById.get(p.id);
  li.querySelector('details').open = true;
  li.scrollIntoView({ block: 'start' });
};

for (const b of buttons) b.addEventListener('click', () => {
  state[b.dataset.key] = b.dataset.value;
  update();
});
input.addEventListener('input', () => {
  state.q = input.value;
  update();
});
document.getElementById('ex-clear').addEventListener('click', () => {
  state = { ...DEFAULTS };
  update();
  input.focus();
});
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="#part-"]');
  if (a && a.getAttribute('href') === location.hash) reveal();
});
window.addEventListener('hashchange', reveal);
root.querySelector('.ex-bar').hidden = false;
update();
reveal();
if (document.readyState !== 'complete') window.addEventListener('load', reveal, { once: true });
