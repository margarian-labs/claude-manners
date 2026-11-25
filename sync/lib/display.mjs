import os from 'node:os';
import path from 'node:path';

const CONTEXT = 3;
const MAX_LINES = 200;
const CODE_EXT = /\.(js|mjs|sh|ps1|vbs|py)$/i;
const RISKY_POINTER = /^\/(env|permissions|hooks|apiKeyHelper|mcpServers)(\/|$)/;

const PATTERNS = [
  { re: /https?:\/\//, what: 'network access', said: /network|internet|https?|online|download|upload|web/i },
  { re: /child_process|spawn|exec\(/, what: 'process launching', said: /process|spawn|subprocess|child|launch|command|shell/i },
  { re: /Invoke-WebRequest|curl |wget /, what: 'downloading', said: /network|internet|https?|online|download|upload|web/i },
  { re: /Register-ScheduledTask|schtasks/, what: 'a scheduled task', said: /scheduled|schedule|schtasks|task scheduler/i },
];
const ABS_PATH = /(?<![A-Za-z0-9])[A-Za-z]:[\\/](?![\\/])[^\s"'`]*|(?:^|[\s"'=(])(\/(?:usr|etc|opt|home|var|tmp|bin|Users|mnt)\/[^\s"'`)]*)/g;
const PATH_SAID = /outside|absolute|other folder|another folder|home folder|drive|elsewhere/i;

const toText = (b) => (b == null ? '' : Buffer.isBuffer(b) ? b.toString('utf8') : String(b));
const isBinary = (b) => Buffer.isBuffer(b) && b.includes(0);
const norm = (s) => s.replace(/\\/g, '/').replace(/^\.?\//, '');

function lines(text) {
  if (text === '') return [];
  const a = text.replace(/\r\n/g, '\n').split('\n');
  if (a[a.length - 1] === '') a.pop();
  return a;
}

function diffLines(a, b) {
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let e = 0;
  while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
  const am = a.slice(s, a.length - e);
  const bm = b.slice(s, b.length - e);
  const out = a.slice(0, s).map((x) => [' ', x]);
  const n = am.length;
  const m = bm.length;
  if (n * m > 25_000_000) {
    for (const x of am) out.push(['-', x]);
    for (const x of bm) out.push(['+', x]);
  } else {
    const w = m + 1;
    const t = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        t[i * w + j] = am[i] === bm[j] ? t[(i + 1) * w + j + 1] + 1 : Math.max(t[(i + 1) * w + j], t[i * w + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (am[i] === bm[j]) { out.push([' ', am[i]]); i++; j++; }
      else if (t[(i + 1) * w + j] >= t[i * w + j + 1]) out.push(['-', am[i++]]);
      else out.push(['+', bm[j++]]);
    }
    while (i < n) out.push(['-', am[i++]]);
    while (j < m) out.push(['+', bm[j++]]);
  }
  for (const x of a.slice(a.length - e)) out.push([' ', x]);
  return out;
}

export function unifiedDiff(oldText, newText, name, { oldMissing = false, newMissing = false } = {}) {
  const ops = diffLines(lines(oldText), lines(newText));
  const changed = [];
  ops.forEach((o, i) => { if (o[0] !== ' ') changed.push(i); });
  const head = [`--- ${oldMissing ? '/dev/null' : 'a/' + name}`, `+++ ${newMissing ? '/dev/null' : 'b/' + name}`];
  if (!changed.length) return { text: head.concat('(no changes)').join('\n'), added: [], changed: false };
  const ranges = [];
  for (const i of changed) {
    const lo = Math.max(0, i - CONTEXT);
    const hi = Math.min(ops.length - 1, i + CONTEXT);
    const last = ranges[ranges.length - 1];
    if (last && lo <= last[1] + 1) last[1] = Math.max(last[1], hi);
    else ranges.push([lo, hi]);
  }
  const body = [];
  for (const [lo, hi] of ranges) {
    let oldStart = 1;
    let newStart = 1;
    for (let k = 0; k < lo; k++) {
      if (ops[k][0] !== '+') oldStart++;
      if (ops[k][0] !== '-') newStart++;
    }
    const seg = ops.slice(lo, hi + 1);
    const oc = seg.filter((o) => o[0] !== '+').length;
    const nc = seg.filter((o) => o[0] !== '-').length;
    body.push(`@@ -${oc ? oldStart : oldStart - 1},${oc} +${nc ? newStart : newStart - 1},${nc} @@`);
    for (const [t, s] of seg) body.push(t + s);
  }
  let shown = body;
  if (body.length > MAX_LINES) shown = body.slice(0, MAX_LINES).concat(`... ${body.length - MAX_LINES} more lines`);
  return { text: head.concat(shown).join('\n'), added: ops.filter((o) => o[0] === '+').map((o) => o[1]), changed: true };
}

function section(body, title) {
  const m = new RegExp(`^## ${title}[ \\t]*\\r?\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm').exec(body || '');
  return m ? m[1].trim() : '';
}

const fmt = (v) => JSON.stringify(v);
const fileOps = (plan) => (plan.ops || []).filter((o) => (o.kind || o.type) === 'file');
const settingsOps = (plan) => (plan.ops || []).filter((o) => (o.kind || o.type) === 'settings');

function installedBytes(installed, dest) {
  if (!installed) return null;
  const v = installed instanceof Map ? installed.get(dest) : installed[dest];
  return v === undefined ? null : v;
}

export function riskyPointers(plan) {
  const out = [];
  for (const o of settingsOps(plan)) {
    if (o.op !== 'keep' && RISKY_POINTER.test(o.pointer)) out.push(o.pointer);
  }
  for (const o of plan.ops || []) {
    if ((o.kind || o.type) === 'mcp') out.push(`/mcpServers/${o.name}`);
  }
  return out;
}

function covered(touches, dest) {
  const d = norm(dest);
  return touches.some((t) => {
    const x = norm(t).replace(/\/\*{1,2}$/, '/');
    return x === d || (x.endsWith('/') ? d.startsWith(x) : d.startsWith(x + '/'));
  });
}

function settingsCovered(touches, pointer) {
  return touches.some((t) => {
    const x = norm(t);
    return x === 'settings.json' || (t.startsWith('/') && (pointer === t || pointer.startsWith(t + '/')));
  });
}

const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const andList = (a) => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
const num = (n) => n.toLocaleString('en-US');
const sentence = (s) => (/[.!?]$/.test(s) ? s : `${s}.`);

export function partCard(e, foot = {}) {
  const out = [`${e.title} (${e.level})`, `What it is: ${e.summary}`];
  if (e.solves) out.push(`Solves: ${e.solves}`);
  if (e.benefit) out.push(`Improves: ${e.benefit}`);
  if (e.use_cases?.length) out.push('Use cases:', ...e.use_cases.map((u) => `- ${u}`));

  const hooks = (foot.settings ?? []).includes('hooks');
  const mcp = foot.mcp ?? [];
  const plugins = foot.plugins ?? [];
  const writes = [];
  if (foot.files) writes.push(count(foot.files, 'file', 'files'));
  if (foot.rules) writes.push(count(foot.rules, 'rule file', 'rule files'));
  if (foot.settings?.length) writes.push(`settings (${foot.settings.join(', ')})`);
  const affects = [sentence(e.risk)];
  if (writes.length) affects.push(`Writes ${andList(writes)}.`);
  if (mcp.length) affects.push(`Adds the MCP ${mcp.length === 1 ? 'server' : 'servers'} ${andList(mcp)}.`);
  if (plugins.length) affects.push(`Installs the ${andList(plugins)} ${plugins.length === 1 ? 'plugin' : 'plugins'}.`);
  if (foot.outside) affects.push(`Has ${count(foot.outside, 'step', 'steps')} outside the Claude folder.`);
  if (foot.user) affects.push(`Leaves ${count(foot.user, 'step', 'steps')} for you to do.`);
  out.push(`Affects: ${affects.join(' ')}`);

  const uncounted = [hooks && 'its hooks', plugins.length && 'the plugin', mcp.length && 'its MCP server'].filter(Boolean);
  const always = e.tokens_always_on?.value;
  const cost = [];
  if (always === null) cost.push('session cost not measured yet');
  else if (always > 0) cost.push(`about ${num(always)} tokens in every session`);
  else if (!uncounted.length) cost.push('no tokens in every session');
  if (e.tokens_on_use) {
    const used = e.tokens_on_use.value;
    const when = e.use === 'you' ? 'when you use it' : 'when it is used';
    if (used === null) { if (!uncounted.length) cost.push('cost when used not measured yet'); }
    else if (used > 0) cost.push(`about ${num(used)} more ${when}${foot.references ? ', plus any reference files it opens' : ''}`);
    else if (cost.length) cost.push(`nothing more ${when}`);
  }
  const costLine = [];
  if (cost.length) costLine.push(sentence(cost.join(', ')));
  if (uncounted.length) costLine.push(`Text added by ${andList(uncounted)} is not counted.`);
  if (e.cost_note) costLine.push(sentence(e.cost_note));
  out.push(`Cost: ${costLine.join(' ')}`);

  if (foot.needs?.length) out.push(`Needs: ${foot.needs.join(', ')}.`);
  return out.join('\n');
}

export function card(proposal, plan, installed, opts = {}) {
  const m = proposal.meta;
  const configDir = path.resolve(opts.configDir || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')).replace(/\\/g, '/').toLowerCase();
  const out = [];
  out.push(m.title, '='.repeat(m.title.length));
  out.push(`Level: ${m.level} | Kind: ${m.kind} | Part: ${m.part}`, '');
  out.push('Why', section(proposal.body, 'Why') || '(not described)', '');
  out.push('What changes', section(proposal.body, 'What changes') || '(not described)', '');
  for (const title of ['How it affects the agent', 'Undo']) {
    const text = section(proposal.body, title);
    if (text) out.push(title, text, '');
  }
  out.push(`Tokens always on: ${m.tokens_always_on}${m.tokens_how ? ` (how: ${m.tokens_how})` : ''}`);
  out.push(`Quality: ${m.quality}`);
  out.push(`Changes: ${m.risk}`, '');

  const warnings = [];
  const touches = m.touches || [];
  const codeFlags = new Map();
  const files = fileOps(plan);
  const sets = settingsOps(plan);

  if (files.length || sets.length || (plan.ops || []).length) out.push('Files and settings');
  for (const o of files) {
    const remove = o.action === 'remove';
    const before = installedBytes(installed, o.dest);
    const after = remove ? null : o.bytes;
    const label = `${o.dest} (${remove ? 'removed' : before == null ? 'new file' : 'changed'})`;
    if (isBinary(before) || isBinary(after)) {
      out.push(`* ${label}`, `  binary file, ${after == null ? 0 : Buffer.byteLength(after)} bytes`, '');
    } else {
      const d = unifiedDiff(toText(before), toText(after), o.dest, { oldMissing: before == null, newMissing: remove });
      out.push(`* ${label}`, d.text, '');
      if (CODE_EXT.test(o.dest) && d.added.length) codeFlags.set(o.dest, d.added);
    }
    if (!covered(touches, o.dest)) warnings.push(`Plan changes ${o.dest}, which "touches" does not list.`);
  }
  for (const o of sets) {
    const kind = o.op;
    if (kind === 'add') out.push(`  + ${o.pointer} = ${fmt(o.value)}`);
    else if (kind === 'change') out.push(`  ~ ${o.pointer}: ${fmt(o.prev)} -> ${fmt(o.value)}`);
    else if (kind === 'conflict') out.push(`  ~ conflict ${o.pointer}: ${fmt(o.prev)} -> ${fmt(o.value)}`);
    else out.push(`  = ${o.pointer} (already set)`);
    if (kind !== 'keep' && !settingsCovered(touches, o.pointer)) warnings.push(`Plan changes setting ${o.pointer}, which "touches" does not list.`);
  }
  for (const o of plan.ops || []) {
    const k = o.kind || o.type;
    if (k === 'file' || k === 'settings') continue;
    out.push(`  + ${k} ${o.name || o.text || o.dest || ''}`.trimEnd());
  }
  if (files.length || sets.length || (plan.ops || []).length) out.push('');

  for (const p of riskyPointers(plan)) warnings.push(`${p}: needs typed confirmation.`);

  for (const [dest, added] of codeFlags) {
    const risk = m.risk || '';
    for (const pat of PATTERNS) {
      if (added.some((l) => pat.re.test(l)) && !pat.said.test(risk)) {
        warnings.push(`${dest} does ${pat.what}, which the Changes line does not mention.`);
      }
    }
    if (!PATH_SAID.test(risk)) {
      const outside = new Set();
      for (const l of added) {
        if (l.startsWith('#!')) continue;
        for (const x of l.matchAll(ABS_PATH)) {
          const p = (x[1] || x[0]).replace(/\\/g, '/');
          if (!p.toLowerCase().startsWith(configDir)) outside.add(p);
        }
      }
      if (outside.size) warnings.push(`${dest} uses a path outside the config folder (${[...outside][0]}), which the Changes line does not mention.`);
    }
  }
  for (const id of plan.carried || []) warnings.push(`This also brings skipped change ${id}.`);

  if (warnings.length) out.push('Warnings', ...warnings.map((w) => `! ${w}`));
  return out.join('\n').replace(/\n+$/, '') + '\n';
}
