import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const GROUPS = ['rules', 'settings', 'workflow', 'hooks', 'agents', 'skills', 'plugins', 'tools', 'integrations', 'lessons'];
const SITE = path.join('owner', 'site');
const OUT = path.join('docs', 'index.html');
const SKIP = new Set(['sync-engine']);
const NEED_LABEL = { node: 'Node', python: 'Python', git: 'Git', pwsh: 'PowerShell 7' };
const SKILL_DOC = /^skills\/[^/]+\/(?!(?:SKILL|VENDOR|SOURCES|LICENSE|README)\.md$).+\.md$/;
const MOMENTS = [
  ['every-session', null, 'Every session'],
  ['session-start', 'SessionStart', 'A session starts'],
  ['prompt', 'UserPromptSubmit', 'You send a message'],
  ['skill-fits', null, 'A task fits a skill'],
  ['tool-call', 'PreToolUse', 'Claude is about to use a tool'],
  ['permission', 'PermissionRequest', 'Claude needs a permission'],
  ['notification', 'Notification', 'Claude needs your attention'],
  ['compaction', 'PreCompact', 'The conversation gets compacted'],
  ['stop', 'Stop', 'Claude finishes a turn'],
];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (n) => n.toLocaleString('en-US');
const uniq = (a) => [...new Set(a)];
const readIf = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n') : null);

export function readCatalog(repoDir) {
  const dir = path.join(repoDir, 'catalog');
  const rank = (g) => { const i = GROUPS.indexOf(g); return i < 0 ? GROUPS.length : i; };
  return fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort()
    .map((n) => JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')))
    .filter((e) => !SKIP.has(e.id))
    .sort((a, b) => rank(a.group) - rank(b.group) || a.title.localeCompare(b.title));
}

function walk(abs, rel = '') {
  if (!fs.existsSync(abs)) return [];
  if (!fs.statSync(abs).isDirectory()) return [rel];
  return fs.readdirSync(abs).sort().flatMap((n) => walk(path.join(abs, n), rel ? `${rel}/${n}` : n));
}

export function footprint(repoDir, e, byId) {
  const dests = (e.files ?? []).flatMap((f) => walk(path.join(repoDir, f.src)).map((r) => (r ? `${f.dest}/${r}` : f.dest)));
  return {
    files: dests.length,
    rules: (e.rules ?? []).length,
    settings: uniq((e.settings ?? []).flatMap((f) => Object.keys(JSON.parse(fs.readFileSync(path.join(repoDir, f), 'utf8'))))),
    mcp: (e.mcp ?? []).map((m) => m.name),
    plugins: (e.plugins ?? []).map((x) => x.name),
    outside: (e.machine_steps ?? []).length,
    user: (e.user_steps ?? []).length,
    references: dests.some((d) => SKILL_DOC.test(d)),
    needs: (e.needs ?? []).flatMap((n) => (n.startsWith('cmd:') ? [NEED_LABEL[n.slice(4)] ?? n.slice(4)] : n.startsWith('part:') ? [byId.get(n.slice(5))?.title ?? n.slice(5)] : n.startsWith('plugin:') ? [`the ${n.slice(7)} plugin`] : [])),
  };
}

export function hookEvents(repoDir, entries) {
  const out = {};
  for (const e of entries) {
    for (const f of e.settings ?? []) {
      for (const ev of Object.keys(JSON.parse(fs.readFileSync(path.join(repoDir, f), 'utf8')).hooks ?? {})) (out[ev] ??= []).push(e.id);
    }
  }
  return out;
}

export function loadStory(repoDir, entries) {
  const raw = readIf(path.join(repoDir, SITE, 'story.json'));
  if (raw) return JSON.parse(raw);
  const events = hookEvents(repoDir, entries);
  return { moments: MOMENTS.map(([id, event, title]) => ({ id, event, title, what: 'Not written yet.', actor: id === 'prompt' ? 'you' : 'setup', parts: (events[event] ?? []).map((p) => ({ id: p, does: 'Not written yet.' })) })) };
}

export function validateStory(repoDir, story, entries) {
  const moments = story?.moments;
  if (!Array.isArray(moments)) return ['story.json: moments must be a list'];
  const errs = [];
  const want = MOMENTS.map(([id]) => id);
  const got = moments.map((m) => m?.id);
  if (got.join() !== want.join()) errs.push(`story.json: moments must be ${want.join(', ')} in that order (got ${got.join(', ')})`);
  const known = new Set(entries.map((e) => e.id));
  const events = hookEvents(repoDir, entries);
  const text = (v, max) => typeof v === 'string' && v.trim() !== '' && v.length <= max;
  for (const m of moments.map((x) => x ?? {})) {
    const at = `story.json ${m.id}`;
    const spec = MOMENTS.find(([id]) => id === m.id);
    if (spec && m.event !== spec[1]) errs.push(`${at}: event must be ${spec[1]}`);
    if (m.actor !== 'you' && m.actor !== 'setup') errs.push(`${at}: actor must be you or setup`);
    if (!text(m.title, 40)) errs.push(`${at}: title must be 1 to 40 characters`);
    if (!text(m.what, 120)) errs.push(`${at}: what must be 1 to 120 characters`);
    if (!Array.isArray(m.parts)) { errs.push(`${at}: parts must be a list`); continue; }
    const ids = m.parts.map((p) => p?.id);
    for (const p of m.parts.map((x) => x ?? {})) {
      if (!known.has(p.id)) errs.push(`${at}: unknown part ${p.id}`);
      if (!text(p.does, 110)) errs.push(`${at}: ${p.id} does must be 1 to 110 characters`);
    }
    for (const id of uniq(ids.filter((id, i) => ids.indexOf(id) !== i))) errs.push(`${at}: ${id} appears more than once`);
    if (!spec) continue;
    if (spec[1]) {
      const hooked = uniq(events[spec[1]] ?? []);
      const missing = hooked.filter((id) => !ids.includes(id));
      const extra = uniq(ids.filter((id) => !hooked.includes(id)));
      if (missing.length) errs.push(`${at}: missing parts with a ${spec[1]} hook: ${missing.join(', ')}`);
      if (extra.length) errs.push(`${at}: parts without a ${spec[1]} hook: ${extra.join(', ')}`);
    } else if (m.parts.length < 1 || m.parts.length > 8) errs.push(`${at}: needs 1 to 8 parts (has ${m.parts.length})`);
  }
  return errs;
}

export async function model(repoDir) {
  const { partCard } = await import(pathToFileURL(path.join(repoDir, 'sync', 'lib', 'display.mjs')).href);
  const entries = readCatalog(repoDir);
  const byId = new Map(entries.map((e) => [e.id, e]));
  const line = (card, label) => (card.split('\n').find((l) => l.startsWith(`${label}: `)) ?? '').slice(label.length + 2);
  const parts = entries.map((e) => {
    const card = partCard(e, footprint(repoDir, e, byId));
    return {
      id: e.id, title: e.title, group: e.group, level: e.level, use: e.use === 'you' ? 'you' : 'auto', trigger: e.trigger || '',
      summary: e.summary, solves: e.solves ?? '', benefit: e.benefit ?? '', use_cases: e.use_cases ?? [],
      affects: line(card, 'Affects'), cost: line(card, 'Cost'), needs: line(card, 'Needs'),
      tokens_always_on: e.tokens_always_on?.value ?? null, tokens_on_use: e.tokens_on_use?.value ?? null,
    };
  });
  const story = loadStory(repoDir, entries);
  const moments = story.moments.map((m) => ({ ...m, parts: m.parts.map((p) => ({ ...p, title: byId.get(p.id)?.title ?? p.id })) }));
  const flags = (byId.get('flags')?.use_cases ?? []).map((u) => /^"(-[a-z]+)": (.+)$/.exec(u)).filter(Boolean).map((m) => ({ flag: m[1], does: m[2] }));
  const sum = (list) => list.reduce((n, p) => n + (p.tokens_always_on ?? 0), 0);
  const rec = parts.filter((p) => p.level === 'recommended');
  const stats = {
    parts: parts.length, auto: parts.filter((p) => p.use === 'auto').length, you: parts.filter((p) => p.use === 'you').length,
    recommended: rec.length, optional: parts.length - rec.length, 'tokens-recommended': sum(rec), 'tokens-all': sum(parts),
  };
  return { parts, moments, flags, stats, groups: GROUPS.filter((g) => parts.some((p) => p.group === g)) };
}

const USE_LABEL = { you: 'you start it', auto: 'works on its own' };
const tokenText = (p) => (p.tokens_always_on === null ? 'not measured' : p.tokens_always_on === 0 && p.cost.includes('not counted') ? 'not counted' : `${num(p.tokens_always_on)} tokens`);

export function partsHtml(parts) {
  const fact = (dt, dd) => (dd ? `<dt>${dt}</dt><dd>${dd}</dd>` : '');
  return ['<ul class="parts" id="parts-list">', ...parts.map((p) => [
    `<li class="part" id="part-${p.id}" data-id="${p.id}" data-group="${p.group}" data-use="${p.use}" data-level="${p.level}" data-tokens="${p.tokens_always_on ?? ''}">`,
    '<details>',
    '<summary>',
    `<span class="part__title">${esc(p.title)}</span>`,
    `<span class="part__chips"><span class="chip chip--level">${p.level}</span><span class="chip chip--${p.use}">${USE_LABEL[p.use]}</span></span>`,
    `<span class="part__solves">${esc(p.solves)}</span>`,
    `<span class="part__cost measured">${tokenText(p)}</span>`,
    '</summary>',
    '<div class="part__body"><dl class="part__facts">',
    fact('What it is', esc(p.summary)),
    fact('Solves', esc(p.solves)),
    fact('Improves', esc(p.benefit)),
    fact('Use cases', p.use_cases.length ? `<ul class="part__cases">${p.use_cases.map((u) => `<li>${esc(u)}</li>`).join('')}</ul>` : ''),
    fact('You start it by', esc(p.trigger)),
    fact('Affects', esc(p.affects)),
    fact('Cost', esc(p.cost)),
    fact('Needs', esc(p.needs)),
    '</dl></div>',
    '</details>',
    '</li>',
  ].filter(Boolean).join('\n')), '</ul>'].join('\n');
}

export function startsHtml(parts) {
  return ['<ul class="starts" id="starts">', ...parts.filter((p) => p.use === 'you').map((p) => [
    `<li class="start" data-part="${p.id}">`,
    `<h3 class="start__title">${esc(p.title)}</h3>`,
    `<p class="start__trigger">${esc(p.trigger)}</p>`,
    `<ul class="start__cases">${p.use_cases.slice(0, 3).map((u) => `<li>${esc(u)}</li>`).join('')}</ul>`,
    `<a class="start__more" href="#part-${p.id}">All details</a>`,
    '</li>',
  ].join('\n')), '</ul>'].join('\n');
}

export function flagsHtml(flags) {
  return ['<ul class="flags" id="flags">', ...flags.map((f) => `<li class="flag" data-flag="${esc(f.flag)}"><code class="flag__name measured">${esc(f.flag)}</code><span class="flag__does">${esc(f.does)}</span></li>`), '</ul>'].join('\n');
}

export function momentsHtml(moments) {
  return ['<ol class="moments" id="moments">', ...moments.map((m) => [
    `<li class="moment" data-moment="${m.id}" data-event="${m.event ?? ''}" data-actor="${m.actor}">`,
    `<h3 class="moment__title">${esc(m.title)}</h3>`,
    `<p class="moment__what">${esc(m.what)}</p>`,
    `<ul class="moment__parts">${m.parts.map((p) => `<li data-part="${p.id}"><a href="#part-${p.id}">${esc(p.title)}</a> <span class="moment__does">${esc(p.does)}</span></li>`).join('')}</ul>`,
    '</li>',
  ].join('\n')), '</ol>'].join('\n');
}

export function askHtml(parts) {
  const p = parts[0];
  return [
    '<div class="ask" id="ask" role="group" aria-label="Try the install question">',
    '<div class="ask__stone" aria-live="polite">',
    `<div><p class="ask__q">Install ${esc(p.title)}?</p><p class="ask__what">${esc(p.summary)}</p></div>`,
    `<div class="ask__facts"><p class="ask__solves">Solves: ${esc(p.solves)}</p><p class="ask__cost">Cost: ${esc(p.cost)}</p></div>`,
    '</div>',
    '<button class="ask__btn ask__yes" type="button" hidden>Install</button>',
    '<button class="ask__btn ask__no" type="button" hidden>Skip</button>',
    '</div>',
    `<div class="ask__foot"><p class="ask__note">This is the question you get for each part. Try it, nothing is installed from this page.</p><p class="ask__count">1 of ${parts.length}</p></div>`,
  ].join('\n');
}

const FALLBACK_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>claude-manners</title>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500&display=swap" rel="stylesheet">
<!-- site:css -->
</head>
<body>
<main class="container">
<section id="top"><h1><!-- site:stat:parts --> parts. You approve each one.</h1></section>
<section id="session"><h2>One session, moment by moment</h2><!-- include:session.html --></section>
<section id="start"><h2>What you can start yourself</h2><!-- include:start.html --></section>
<section id="yours"><h2>How it stays yours</h2><!-- include:flow.html --></section>
<section id="parts"><h2>Every part</h2><!-- include:explorer.html --></section>
<section id="join"><h2>Join</h2></section>
</main>
<!-- site:data -->
<!-- site:js -->
</body>
</html>
`;
const FALLBACK_FRAGMENT = {
  'session.html': '<div id="session-diagram"><!-- site:moments --></div>',
  'start.html': '<div id="start-gallery"><!-- site:starts --></div>\n<div id="flag-picker"><!-- site:flags --></div>',
  'flow.html': '<div id="flow-diagram"></div>\n<div id="files-diagram"></div>',
  'explorer.html': '<div id="explorer"><!-- site:parts --></div>',
};
const CSS_FILES = ['site.css', 'session.css', 'widgets.css', 'explorer.css'];
const JS_FILES = ['site.js', 'session.js', 'widgets.js', 'explorer.js'];

export async function render(repoDir) {
  const dir = path.join(repoDir, SITE);
  const m = await model(repoDir);
  let html = readIf(path.join(dir, 'page.html')) ?? FALLBACK_PAGE;
  html = html.replace(/<!-- include:([a-z-]+\.html) -->/g, (_, name) => readIf(path.join(dir, name)) ?? FALLBACK_FRAGMENT[name] ?? '');
  const inlineImports = (css) => css.replace(/^@import url\("\.\/([a-z-]+\.css)"\);[ \t]*$/gm, (_, name) => (readIf(path.join(dir, name)) ?? '').trim());
  const first = readIf(path.join(dir, 'site.css')) ?? '@import url("./tokens.css");\n@import url("./base.css");\n@import url("./shared.css");\n';
  const css = [inlineImports(first), ...CSS_FILES.slice(1).map((f) => readIf(path.join(dir, f)) ?? '')].map((s) => s.trim()).filter(Boolean).join('\n');
  const js = JS_FILES.map((f) => readIf(path.join(dir, f))).filter(Boolean).map((s) => `(() => {\n${s.trim()}\n})();`).join('\n');
  const data = JSON.stringify({ parts: m.parts, moments: m.moments, flags: m.flags, stats: m.stats, groups: m.groups }).replace(/</g, '\\u003c');
  const fill = {
    'site:css': `<style>\n${css}\n</style>`,
    'site:data': `<script type="application/json" id="site-data">${data}</script>`,
    'site:js': js ? `<script>\n${js}\n</script>` : '',
    'site:ask': askHtml(m.parts),
    'site:parts': partsHtml(m.parts),
    'site:starts': startsHtml(m.parts),
    'site:flags': flagsHtml(m.flags),
    'site:moments': momentsHtml(m.moments),
  };
  for (const [k, v] of Object.entries(m.stats)) fill[`site:stat:${k}`] = num(v).replace(/,/g, '<span class="num-sep">,</span>');
  html = html.replace(/<!-- (site:[a-z:-]+) -->/g, (all, key) => (key in fill ? fill[key] : all));
  return html.replace(/\r\n/g, '\n');
}

const REQUIRED = ['page.html', 'session.html', 'start.html', 'flow.html', 'explorer.html', 'site.css', 'session.css', 'widgets.css', 'explorer.css', 'tokens.css', 'base.css', 'shared.css', 'story.json'];
const DASH = new RegExp(`[${String.fromCharCode(0x2014)}${String.fromCharCode(0x2013)}]`);

export async function problems(repoDir) {
  const dir = path.join(repoDir, SITE);
  const out = REQUIRED.filter((f) => !fs.existsSync(path.join(dir, f))).map((f) => `missing owner/site/${f}`);
  const entries = readCatalog(repoDir);
  if (fs.existsSync(path.join(dir, 'story.json'))) out.push(...validateStory(repoDir, loadStory(repoDir, entries), entries));
  const { flags } = await model(repoDir);
  if (flags.length < 8) out.push(`only ${flags.length} flags parsed from the flags part (need 8 or more)`);
  const html = await render(repoDir);
  for (const k of uniq(html.match(/<!-- (?:site|include):[\s\S]*?-->/g) ?? [])) out.push(`marker left in the page: ${k}`);
  html.split('\n').forEach((l, i) => { if (DASH.test(l)) out.push(`em or en dash on line ${i + 1} of the page`); });
  return out;
}

async function main(argv) {
  let repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  let out = null;
  let check = false;
  let strict = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--repo') repoDir = path.resolve(argv[++i]);
    else if (argv[i] === '--out') out = path.resolve(argv[++i]);
    else if (argv[i] === '--check') check = true;
    else if (argv[i] === '--strict') strict = true;
    else { console.error('usage: build-site.mjs [--out file] [--check] [--strict] [--repo dir]'); return 2; }
  }
  const target = out ?? path.join(repoDir, OUT);
  const html = await render(repoDir);
  const errs = strict || check || !out ? await problems(repoDir) : [];
  for (const e of errs) console.error(e);
  if (check) {
    const same = readIf(target) === html;
    console.log(same ? 'demo page is up to date' : 'demo page is out of date (run: node owner/build-site.mjs)');
    return same && !errs.length ? 0 : 1;
  }
  if (errs.length) return 1;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, html);
  console.log(`wrote ${target} (${html.length} characters)`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(await main(process.argv.slice(2)));
