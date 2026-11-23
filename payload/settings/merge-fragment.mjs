// Usage: node merge-fragment.mjs <settings.json> <fragment.json> [--write]
// Without --write it only prints what would change and every conflict.
// Objects merge key by key; hook entries are appended per event unless an entry with the same command exists.
// A key that already holds a different value is a conflict: it is reported and left unchanged.
import fs from 'node:fs';

const [target, fragFile, flag] = process.argv.slice(2);
if (!target || !fragFile) {
  console.log('usage: node merge-fragment.mjs <settings.json> <fragment.json> [--write]');
  process.exit(1);
}
const settings = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')) : {};
const frag = JSON.parse(fs.readFileSync(fragFile, 'utf8'));
const changes = [];
const conflicts = [];

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const commandsOf = (entries) => new Set(entries.flatMap((e) => (e.hooks || []).map((h) => h.command)));

function merge(dst, src, where) {
  for (const [k, v] of Object.entries(src)) {
    const at = where ? `${where}.${k}` : k;
    if (where === 'hooks') {
      dst[k] = dst[k] || [];
      const have = commandsOf(dst[k]);
      for (const entry of v) {
        const fresh = entry.hooks.filter((h) => !have.has(h.command));
        if (!fresh.length) continue;
        dst[k].push({ ...entry, hooks: fresh });
        changes.push(`add hook ${k}: ${fresh.map((h) => h.command).join(', ')}`);
      }
    } else if (isObj(v)) {
      if (dst[k] !== undefined && !isObj(dst[k])) { conflicts.push(`${at}: has ${JSON.stringify(dst[k])}, pack wants an object`); continue; }
      dst[k] = dst[k] || {};
      merge(dst[k], v, at);
    } else if (dst[k] === undefined) {
      dst[k] = v;
      changes.push(`set ${at} = ${JSON.stringify(v)}`);
    } else if (JSON.stringify(dst[k]) !== JSON.stringify(v)) {
      conflicts.push(`${at}: has ${JSON.stringify(dst[k])}, pack wants ${JSON.stringify(v)}`);
    }
  }
}

merge(settings, frag, '');
for (const c of changes) console.log('change:', c);
for (const c of conflicts) console.log('CONFLICT:', c);
if (!changes.length && !conflicts.length) console.log('nothing to do');
if (flag === '--write' && changes.length) {
  fs.writeFileSync(target, JSON.stringify(settings, null, 2) + '\n');
  JSON.parse(fs.readFileSync(target, 'utf8'));
  console.log('written:', target);
}
process.exit(conflicts.length ? 2 : 0);
