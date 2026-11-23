import fs from 'node:fs';
import path from 'node:path';
import { NEEDS_RE } from './catalog.mjs';

const DASH_RE = new RegExp('[' + String.fromCharCode(0x2014) + String.fromCharCode(0x2013) + ']');
const KEY_RE = /^[a-z_][a-z0-9_]*$/;

function fail(line, msg) {
  throw new Error(`frontmatter line ${line}: ${msg}`);
}

function stripComment(s, line) {
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (q === '"' && c === '\\') i++;
      else if (c === q) q = null;
    } else if (c === '"' || c === "'") {
      if (i === 0 || /[\s,[]/.test(s[i - 1])) q = c;
    } else if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) {
      return s.slice(0, i).trimEnd();
    }
  }
  if (q) fail(line, 'unterminated quote');
  return s.trimEnd();
}

function parseScalar(raw, line, key) {
  const s = raw.trim();
  if (s === '') fail(line, `empty value for "${key}"`);
  if (s[0] === '"') {
    let v;
    try { v = JSON.parse(s); } catch { fail(line, `bad double-quoted string: ${s}`); }
    if (typeof v !== 'string') fail(line, `bad double-quoted string: ${s}`);
    return v;
  }
  if (s[0] === "'") {
    if (s.length < 2 || s[s.length - 1] !== "'") fail(line, `bad single-quoted string: ${s}`);
    return s.slice(1, -1).replace(/''/g, "'");
  }
  if (/^[{}[\]|>&*!%@`]/.test(s)) fail(line, `unsupported value syntax: ${s}`);
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (key === 'tokens_always_on' && /^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}

function splitInline(inner, line) {
  const parts = [];
  let cur = '';
  let q = null;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (q) {
      cur += c;
      if (q === '"' && c === '\\') { cur += inner[++i] ?? ''; } else if (c === q) q = null;
    } else if (c === '"' || c === "'") { q = c; cur += c; }
    else if (c === ',') { parts.push(cur); cur = ''; }
    else cur += c;
  }
  if (q) fail(line, 'unterminated quote in list');
  parts.push(cur);
  return parts;
}

function parseInlineList(s, line, key) {
  if (s[s.length - 1] !== ']') fail(line, `unterminated list for "${key}"`);
  const inner = s.slice(1, -1).trim();
  if (inner === '') return [];
  return splitInline(inner, line).map((p) => {
    const t = p.trim();
    if (t === '') fail(line, `empty list item in "${key}"`);
    if (/^[[{]/.test(t)) fail(line, `nested structures are not supported in "${key}"`);
    return parseScalar(t, line, '');
  });
}

export function parseFrontmatter(text) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  if (lines[0].trim() !== '---') throw new Error('frontmatter must start with --- on the first line');
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (end < 0) throw new Error('frontmatter is not closed with ---');
  const meta = {};
  let listKey = null;
  for (let i = 1; i < end; i++) {
    const ln = i + 1;
    const raw = lines[i];
    if (raw.trim() === '' || raw.trim().startsWith('#')) continue;
    if (/^\s/.test(raw)) {
      const m = /^\s+-\s+(.*)$/.exec(raw);
      if (!m || listKey === null) fail(ln, `unexpected indented line (nested maps are not supported): ${raw.trim()}`);
      const v = stripComment(m[1], ln);
      if (/^[[{]/.test(v)) fail(ln, 'nested structures are not supported');
      meta[listKey].push(parseScalar(v, ln, ''));
      continue;
    }
    listKey = null;
    const m = /^([^:\s]+):(?:\s+(.*)|\s*)$/.exec(raw);
    if (!m) fail(ln, `expected "key: value", got: ${raw}`);
    const key = m[1];
    if (!KEY_RE.test(key)) fail(ln, `bad key "${key}"`);
    if (Object.hasOwn(meta, key)) fail(ln, `duplicate key "${key}"`);
    const val = stripComment(m[2] ?? '', ln);
    if (val === '') { meta[key] = []; listKey = key; }
    else if (val[0] === '[') meta[key] = parseInlineList(val, ln, key);
    else if (val[0] === '{') fail(ln, 'inline maps are not supported');
    else meta[key] = parseScalar(val, ln, key);
  }
  const body = lines.slice(end + 1).join('\n').replace(/^\n+/, '');
  return { meta, body };
}

export function loadProposals(repoDir) {
  const dir = path.join(repoDir, 'proposals');
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md') && x !== 'TEMPLATE.md')) {
    let parsed;
    try { parsed = parseFrontmatter(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (err) { throw new Error(`proposals/${f}: ${err.message}`); }
    out.push({ id: parsed.meta.id ?? f.replace(/\.md$/, ''), file: f, meta: parsed.meta, body: parsed.body });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

const REQUIRED = ['id', 'title', 'kind', 'level', 'part', 'touches', 'tokens_always_on', 'quality', 'risk', 'undo'];
const OPTIONAL = ['needs', 'after', 'settings', 'runs_code', 'ask_alone', 'tokens_how'];
const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const isStr = (v) => typeof v === 'string' && v.length > 0;

export function validateProposal(p, catalogIds) {
  const errs = [];
  const ids = catalogIds instanceof Set ? catalogIds : new Set(catalogIds instanceof Map ? catalogIds.keys() : catalogIds || []);
  const m = p && p.meta;
  if (!m || typeof m !== 'object') return ['meta is missing'];
  for (const k of REQUIRED) if (!(k in m)) errs.push(`missing field: ${k}`);
  for (const k of Object.keys(m)) if (!REQUIRED.includes(k) && !OPTIONAL.includes(k)) errs.push(`unknown field: ${k}`);

  const strList = (k, each) => {
    if (!(k in m)) return;
    if (!Array.isArray(m[k])) { errs.push(`${k}: must be a list`); return; }
    m[k].forEach((v, i) => {
      if (!isStr(v)) errs.push(`${k}[${i}]: must be a non-empty string`);
      else if (each) { const e = each(v); if (e) errs.push(`${k}[${i}]: ${e}`); }
    });
  };

  if ('id' in m) {
    if (!isStr(m.id) || !ID_RE.test(m.id)) errs.push('id: must be kebab-case');
    else if (p.file && p.file !== m.id + '.md') errs.push(`id: "${m.id}" must equal the file name "${p.file.replace(/\.md$/, '')}"`);
  }
  if ('title' in m && !isStr(m.title)) errs.push('title: must be a non-empty string');
  if ('kind' in m && !['add', 'change', 'remove'].includes(m.kind)) errs.push('kind: must be add, change or remove');
  if ('level' in m && !['recommended', 'optional'].includes(m.level)) errs.push('level: must be recommended or optional');
  if ('part' in m) {
    if (!isStr(m.part)) errs.push('part: must be a string');
    else if (m.part.startsWith('new:')) { if (!ID_RE.test(m.part.slice(4))) errs.push('part: new:<id> needs a kebab-case id'); }
    else if (!ids.has(m.part)) errs.push(`part: "${m.part}" is not a catalog id`);
  }
  strList('touches');
  if (Array.isArray(m.touches) && m.touches.length === 0) errs.push('touches: must not be empty');
  if ('tokens_always_on' in m) {
    const t = m.tokens_always_on;
    if (!((typeof t === 'number' && Number.isFinite(t)) || (typeof t === 'string' && /^[+-]\d+$/.test(t)))) errs.push('tokens_always_on: must be a number or a string like "+240"');
  }
  if ('quality' in m && !['measured', 'tried', 'untested'].includes(m.quality)) errs.push('quality: must be measured, tried or untested');
  if ('risk' in m && !isStr(m.risk)) errs.push('risk: must be a non-empty string');
  if ('undo' in m && !isStr(m.undo)) errs.push('undo: must be a non-empty string');
  strList('needs', (v) => (NEEDS_RE.test(v) ? '' : 'not an allowed form'));
  strList('after', (v) => (ID_RE.test(v) ? '' : 'must be a kebab-case id'));
  strList('settings');
  for (const k of ['runs_code', 'ask_alone']) if (k in m && typeof m[k] !== 'boolean') errs.push(`${k}: must be true or false`);
  if ('tokens_how' in m && !isStr(m.tokens_how)) errs.push('tokens_how: must be a non-empty string');

  const body = p.body || '';
  for (const h of ['What changes', 'Why']) if (!new RegExp(`^## ${h}\\s*$`, 'm').test(body)) errs.push(`body: missing section "## ${h}"`);
  if (DASH_RE.test(JSON.stringify(m)) || DASH_RE.test(body)) errs.push('contains an em or en dash');
  return errs;
}

const REOPEN = new Set(['later', 'rolled-back']);
const DONE = new Set(['accept', 'baseline']);

export function pending(state, proposals, ctx) {
  const answers = (state && state.answers) || {};
  const parts = (state && state.parts) || {};
  const hidden = { answered: 0, needs: 0, after: 0 };
  const unknown = {};
  const list = [];
  for (const p of proposals) {
    const a = answers[p.id] && answers[p.id].answer;
    if (a && !REOPEN.has(a)) { hidden.answered++; continue; }
    const unk = [];
    let ok = true;
    for (const need of p.meta.needs || []) {
      const r = ctx.check(need);
      if (r === 'unknown') unk.push(need);
      else if (!r) { ok = false; break; }
    }
    if (!ok) { hidden.needs++; continue; }
    const afterOk = (p.meta.after || []).every((id) => {
      const ans = answers[id] && answers[id].answer;
      return DONE.has(ans) || (parts[id] && parts[id].installed === true);
    });
    if (!afterOk) { hidden.after++; continue; }
    if (unk.length) unknown[p.id] = unk;
    list.push(p);
  }
  return { pending: list, hidden, unknown };
}
