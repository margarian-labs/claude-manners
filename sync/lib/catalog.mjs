import fs from 'node:fs';
import path from 'node:path';

export const NEEDS_RE = /^(windows|second-profile|memohopper-connected|fable-access|haiku-access|part:[a-z0-9-]+|plugin:[a-z0-9-]+|cmd:[a-z0-9.-]+|claude>=[0-9.]+)$/;

const KEYS = ['id', 'title', 'group', 'level', 'summary', 'details', 'use', 'trigger', 'needs', 'files', 'settings', 'rules', 'mcp', 'plugins', 'values', 'user_steps', 'machine_steps', 'verify', 'tokens_always_on', 'quality', 'risk', 'ask_alone', 'license'];
const GROUPS = ['rules', 'settings', 'workflow', 'hooks', 'agents', 'skills', 'plugins', 'tools', 'integrations', 'lessons'];
const LEVELS = ['recommended', 'optional'];
const MODES = ['managed', 'rendered', 'seed'];
const QUALITIES = ['measured', 'tried', 'untested'];
const HOWS = ['measured /context', 'estimated chars/4', 'not measured yet'];
const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DASH_RE = new RegExp('[' + String.fromCharCode(0x2014) + String.fromCharCode(0x2013) + ']');

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string' && v.length > 0;

function sameKeys(obj, keys) {
  const k = Object.keys(obj);
  return k.length === keys.length && keys.every((x, i) => k[i] === x);
}

function strList(e, key, errs) {
  if (!Array.isArray(e[key])) { errs.push(`${key}: must be an array`); return false; }
  e[key].forEach((v, i) => { if (!isStr(v)) errs.push(`${key}[${i}]: must be a non-empty string`); });
  return true;
}

function relDest(d) {
  const x = d.replace(/^\{memory_dir\}[\\/]?/, '');
  return !(/^([A-Za-z]:|[\\/])/.test(x) || x.split(/[\\/]/).includes('..'));
}

export function validateEntry(entry, allIds) {
  const errs = [];
  if (!isObj(entry)) return ['entry must be an object'];
  const ids = allIds instanceof Set ? allIds : new Set(allIds instanceof Map ? allIds.keys() : allIds || []);
  const keys = Object.keys(entry);
  const missing = KEYS.filter((k) => !keys.includes(k));
  const extra = keys.filter((k) => !KEYS.includes(k));
  if (missing.length) errs.push(`missing keys: ${missing.join(', ')}`);
  if (extra.length) errs.push(`unknown keys: ${extra.join(', ')}`);
  if (!missing.length && !extra.length && !sameKeys(entry, KEYS)) errs.push(`keys out of order, expected: ${KEYS.join(', ')}`);

  if (!isStr(entry.id) || !ID_RE.test(entry.id)) errs.push('id: must be kebab-case');
  if (!isStr(entry.title)) errs.push('title: must be a non-empty string');
  if (!GROUPS.includes(entry.group)) errs.push(`group: must be one of ${GROUPS.join(', ')}`);
  if (!LEVELS.includes(entry.level)) errs.push(`level: must be one of ${LEVELS.join(', ')}`);
  if (!isStr(entry.summary)) errs.push('summary: must be a non-empty string');
  else if (entry.summary.length > 140) errs.push(`summary: ${entry.summary.length} characters, max 140`);
  if (typeof entry.details !== 'string' || entry.details.trim().length < 40) errs.push('details: must be a plain paragraph of at least 40 characters');
  else if (entry.details.length > 600) errs.push(`details: ${entry.details.length} characters, max 600`);

  if (!['auto', 'you'].includes(entry.use)) errs.push('use: must be auto or you');
  if (typeof entry.trigger !== 'string') errs.push('trigger: must be a string');
  else if (entry.use === 'you' && entry.trigger.trim().length < 10) errs.push('trigger: say what the person types or runs to use it');
  else if (entry.use === 'auto' && entry.trigger !== '') errs.push('trigger: must be empty when use is auto');

  if (strList(entry, 'needs', errs)) {
    for (const n of entry.needs) {
      if (typeof n !== 'string' || !n) continue;
      if (!NEEDS_RE.test(n)) { errs.push(`needs: "${n}" is not an allowed form`); continue; }
      if (n.startsWith('part:')) {
        const p = n.slice(5);
        if (p === entry.id) errs.push(`needs: "${n}" refers to itself`);
        else if (!ids.has(p)) errs.push(`needs: part "${p}" does not exist`);
      }
    }
  }

  if (!Array.isArray(entry.files)) errs.push('files: must be an array');
  else entry.files.forEach((f, i) => {
    if (!isObj(f) || !sameKeys(f, ['src', 'dest', 'mode'])) { errs.push(`files[${i}]: keys must be src, dest, mode`); return; }
    if (!isStr(f.src) || /^([A-Za-z]:|[\\/])/.test(f.src) || f.src.split(/[\\/]/).includes('..')) errs.push(`files[${i}].src: must be a relative repo path`);
    if (!isStr(f.dest) || !relDest(f.dest)) errs.push(`files[${i}].dest: must be a relative path`);
    if (!MODES.includes(f.mode)) errs.push(`files[${i}].mode: must be one of ${MODES.join(', ')}`);
  });

  strList(entry, 'settings', errs);
  strList(entry, 'rules', errs);

  if (!Array.isArray(entry.mcp)) errs.push('mcp: must be an array');
  else entry.mcp.forEach((m, i) => {
    if (!isObj(m) || !sameKeys(m, ['name', 'config'])) errs.push(`mcp[${i}]: keys must be name, config`);
    else if (!isStr(m.name) || !isObj(m.config)) errs.push(`mcp[${i}]: name must be a string and config an object`);
  });

  if (!Array.isArray(entry.plugins)) errs.push('plugins: must be an array');
  else entry.plugins.forEach((p, i) => {
    if (!isObj(p) || !sameKeys(p, ['name', 'marketplace'])) errs.push(`plugins[${i}]: keys must be name, marketplace`);
    else if (!isStr(p.name) || !/^[^/\s]+\/[^/\s]+$/.test(p.marketplace || '')) errs.push(`plugins[${i}]: name must be a string and marketplace owner/repo`);
  });

  if (!Array.isArray(entry.values)) errs.push('values: must be an array');
  else entry.values.forEach((v, i) => {
    const withFm = isObj(v) && sameKeys(v, ['key', 'file', 'frontmatter', 'ask', 'default']);
    if (!isObj(v) || !(withFm || sameKeys(v, ['key', 'file', 'ask', 'default']))) { errs.push(`values[${i}]: keys must be key, file, [frontmatter,] ask, default`); return; }
    if (!isStr(v.key)) errs.push(`values[${i}].key: must be a non-empty string`);
    if (!isStr(v.file) || !relDest(v.file)) errs.push(`values[${i}].file: must be a relative dest path`);
    if (withFm && !isStr(v.frontmatter)) errs.push(`values[${i}].frontmatter: must be a non-empty string`);
    if (!isStr(v.ask)) errs.push(`values[${i}].ask: must be a non-empty string`);
    if (typeof v.default !== 'string') errs.push(`values[${i}].default: must be a string`);
  });

  strList(entry, 'user_steps', errs);
  strList(entry, 'machine_steps', errs);
  strList(entry, 'verify', errs);

  const t = entry.tokens_always_on;
  if (!isObj(t) || !sameKeys(t, ['value', 'how'])) errs.push('tokens_always_on: keys must be value, how');
  else {
    if (!(t.value === null || (typeof t.value === 'number' && Number.isFinite(t.value)))) errs.push('tokens_always_on.value: must be a number or null');
    if (!HOWS.includes(t.how)) errs.push(`tokens_always_on.how: must be one of ${HOWS.join(', ')}`);
  }
  if (!QUALITIES.includes(entry.quality)) errs.push(`quality: must be one of ${QUALITIES.join(', ')}`);
  if (!isStr(entry.risk)) errs.push('risk: must be a non-empty string');
  if (typeof entry.ask_alone !== 'boolean') errs.push('ask_alone: must be true or false');
  if (!(entry.license === null || isStr(entry.license))) errs.push('license: must be a string or null');

  if (DASH_RE.test(JSON.stringify(entry))) errs.push('contains an em or en dash');
  return errs;
}

export function loadCatalog(repoDir) {
  const dir = path.join(repoDir, 'catalog');
  const map = new Map();
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    let e;
    try { e = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (err) { throw new Error(`catalog/${f}: ${err.message}`); }
    const want = f.replace(/\.json$/, '');
    if (!isObj(e) || e.id !== want) throw new Error(`catalog/${f}: id must equal the file name "${want}"`);
    map.set(e.id, e);
  }
  return map;
}
