import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual as deepEqual } from 'node:util';

const absent = () => ({ $absent: true });
const isAbsent = (v) => isObj(v) && Object.keys(v).length === 1 && v.$absent === true;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const own = (o, k) => isObj(o) && Object.hasOwn(o, k) ? o[k] : undefined;
const clone = (v) => structuredClone(v);
const esc = (s) => String(s).replace(/~/g, '~0').replace(/\//g, '~1');
const unesc = (s) => s.replace(/~1/g, '/').replace(/~0/g, '~');
const toTokens = (p) => (p === '' ? [] : p.split('/').slice(1).map(unesc));
const toPointer = (tokens) => tokens.map((t) => '/' + esc(t)).join('');
const matcherOf = (g) => (isObj(g) ? g.matcher ?? '' : null);
const hooksOf = (g) => (Array.isArray(g.hooks) ? g.hooks : []);
const sameHook = (a, b) => isObj(a) && (typeof b.command === 'string' ? a.command === b.command : deepEqual(a, b));

function getAt(doc, tokens) {
  let cur = doc;
  for (const t of tokens) {
    if (Array.isArray(cur)) cur = cur[Number(t)];
    else if (isObj(cur) && Object.hasOwn(cur, t)) cur = cur[t];
    else return undefined;
    if (cur === undefined) return undefined;
  }
  return cur;
}

function setAt(doc, tokens, value) {
  let cur = doc;
  for (const t of tokens.slice(0, -1)) {
    if (!Object.hasOwn(cur, t)) cur[t] = {};
    cur = cur[t];
    if (!isObj(cur)) return false;
  }
  cur[tokens.at(-1)] = value;
  return true;
}

function removeAt(doc, tokens, created) {
  const parent = getAt(doc, tokens.slice(0, -1));
  const last = tokens.at(-1);
  if (Array.isArray(parent)) parent.splice(Number(last), 1);
  else if (isObj(parent)) delete parent[last];
  for (let n = tokens.length - 1; n >= 1; n--) {
    const node = getAt(doc, tokens.slice(0, n));
    if (!created.includes(toPointer(tokens.slice(0, n))) || !isObj(node) || Object.keys(node).length) break;
    delete getAt(doc, tokens.slice(0, n - 1))[tokens[n - 1]];
  }
}

function readSettings(file) {
  if (!fs.existsSync(file)) return {};
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  let doc = {};
  if (text.trim() !== '') {
    try { doc = JSON.parse(text); } catch (e) { throw new Error(`${file}: invalid JSON (${e.message})`); }
  }
  if (!isObj(doc)) throw new Error(`${file}: not a JSON object`);
  return doc;
}

function writeSettings(file, doc) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(tmp, JSON.stringify(doc, null, 2) + '\n');
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

function leaf(ops, tokens, value, cur) {
  const pointer = toPointer(tokens);
  if (cur === undefined) ops.push({ op: 'add', pointer, value: clone(value), prev: absent() });
  else ops.push({ op: deepEqual(cur, value) ? 'keep' : 'conflict', pointer, value: clone(value), prev: clone(cur) });
}

function planHooks(ops, frag, cur) {
  if (cur !== undefined && !isObj(cur)) return leaf(ops, ['hooks'], frag, cur);
  for (const [event, groups] of Object.entries(frag)) {
    const curEvent = own(cur, event);
    if (!Array.isArray(groups) || (curEvent !== undefined && !Array.isArray(curEvent))) {
      leaf(ops, ['hooks', event], groups, curEvent);
      continue;
    }
    const have = curEvent ?? [];
    for (const group of groups) {
      if (!isObj(group) || !Array.isArray(group.hooks)) throw new Error(`fragment hooks.${event}: entry is not {matcher, hooks[]}`);
      const matcher = matcherOf(group);
      const idxs = have.flatMap((g, i) => (matcherOf(g) === matcher ? [i] : []));
      if (!idxs.length) {
        if (group.hooks.length) ops.push({ op: 'add', pointer: toPointer(['hooks', event, '-']), value: clone(group), prev: absent(), match: { matcher } });
        continue;
      }
      for (const hook of group.hooks) {
        const match = { matcher, command: hook.command };
        let at = null;
        for (const i of idxs) {
          const j = hooksOf(have[i]).findIndex((h) => sameHook(h, hook));
          if (j >= 0) { at = [i, j]; break; }
        }
        if (at) ops.push({ op: 'keep', pointer: toPointer(['hooks', event, at[0], 'hooks', at[1]]), value: clone(hook), prev: clone(have[at[0]].hooks[at[1]]), match });
        else ops.push({ op: 'add', pointer: toPointer(['hooks', event, idxs[0], 'hooks', '-']), value: clone(hook), prev: absent(), match });
      }
    }
  }
}

function walk(ops, frag, cur, tokens) {
  for (const [k, v] of Object.entries(frag)) {
    const t = [...tokens, k];
    const c = own(cur, k);
    if (tokens.length === 0 && k === 'hooks' && isObj(v)) planHooks(ops, v, c);
    else if (isObj(v) && Object.keys(v).length && (c === undefined || isObj(c))) walk(ops, v, c ?? {}, t);
    else leaf(ops, t, v, c);
  }
}

export function planMerge(settings, fragment) {
  if (!isObj(settings) || !isObj(fragment)) throw new Error('settings and fragment must be JSON objects');
  const ops = [];
  walk(ops, fragment, settings, []);
  return ops;
}

function applyHook(doc, op, written, skipped) {
  const tokens = toTokens(op.pointer);
  const event = tokens[1];
  const matcher = op.match.matcher ?? '';
  const isGroup = tokens.length === 3 && tokens[2] === '-';
  const hooks = isGroup ? op.value.hooks : [op.value];
  const template = isGroup ? op.value : { matcher };
  if (!isObj(doc.hooks ?? {}) || !Array.isArray(own(doc.hooks, event) ?? [])) { skipped.push(op.pointer); return; }
  for (const hook of hooks) {
    const created = [];
    if (doc.hooks === undefined) created.push('/hooks');
    if (own(doc.hooks, event) === undefined) created.push(toPointer(['hooks', event]));
    doc.hooks ??= {};
    const groups = (doc.hooks[event] ??= []);
    const same = groups.flatMap((g, i) => (matcherOf(g) === matcher ? [[g, i]] : []));
    if (same.some(([g]) => hooksOf(g).some((h) => sameHook(h, hook)))) continue;
    let target = same[0];
    if (!target) {
      created.push(toPointer(['hooks', event, groups.length]));
      groups.push({ ...clone(template), hooks: [] });
      target = [groups.at(-1), groups.length - 1];
    }
    if (!Array.isArray(target[0].hooks)) target[0].hooks = [];
    target[0].hooks.push(clone(hook));
    written.push({
      pointer: toPointer(['hooks', event, target[1], 'hooks', target[0].hooks.length - 1]),
      value: clone(hook),
      prev: absent(),
      match: { matcher, command: hook.command },
      ...(created.length && { created }),
    });
  }
}

export function applyOps(settingsPath, ops, { accept = [] } = {}) {
  const doc = readSettings(settingsPath);
  const acceptSet = new Set(accept);
  const written = [];
  const skipped = [];
  for (const op of ops) {
    if (op.op === 'keep') continue;
    if (op.op !== 'add' && op.op !== 'conflict') throw new Error(`unknown op "${op.op}" at ${op.pointer}`);
    if (op.op === 'add' && op.match) { applyHook(doc, op, written, skipped); continue; }
    if (op.op === 'conflict' && !acceptSet.has(op.pointer)) { skipped.push(op.pointer); continue; }
    const tokens = toTokens(op.pointer);
    const cur = getAt(doc, tokens);
    if (cur !== undefined && (op.op === 'add' || deepEqual(cur, op.value))) {
      if (!deepEqual(cur, op.value)) skipped.push(op.pointer);
      continue;
    }
    const created = tokens.slice(0, -1).flatMap((_, i) => (getAt(doc, tokens.slice(0, i + 1)) === undefined ? [toPointer(tokens.slice(0, i + 1))] : []));
    if (!setAt(doc, tokens, clone(op.value))) { skipped.push(op.pointer); continue; }
    written.push({ pointer: op.pointer, value: clone(op.value), prev: cur === undefined ? absent() : clone(cur), ...(created.length && { created }) });
  }
  if (written.length) writeSettings(settingsPath, doc);
  return { written, skipped };
}

function findHook(doc, e) {
  const event = toTokens(e.pointer)[1];
  const groups = own(doc.hooks, event);
  if (!Array.isArray(groups)) return null;
  const matcher = e.match.matcher ?? '';
  for (let i = 0; i < groups.length; i++) {
    if (matcherOf(groups[i]) !== matcher) continue;
    const j = hooksOf(groups[i]).findIndex((h) => (e.match.command !== undefined ? isObj(h) && h.command === e.match.command : deepEqual(h, e.value)));
    if (j >= 0) return { event, groups, i, j };
  }
  return null;
}

export function revert(settingsPath, entries) {
  const doc = readSettings(settingsPath);
  const reverted = [];
  const conflicts = [];
  let changed = false;
  for (const e of [...entries].reverse()) {
    const tokens = toTokens(e.pointer);
    const hit = e.match ? findHook(doc, e) : null;
    const cur = e.match ? (hit ? hit.groups[hit.i].hooks[hit.j] : undefined) : getAt(doc, tokens);
    const atPrev = isAbsent(e.prev) ? cur === undefined : deepEqual(cur, e.prev);
    if (atPrev) { reverted.push(e.pointer); continue; }
    if (cur === undefined || !deepEqual(cur, e.value)) {
      conflicts.push({ pointer: e.pointer, expected: e.value, actual: cur === undefined ? absent() : cur });
      continue;
    }
    if (!e.match) {
      if (isAbsent(e.prev)) removeAt(doc, tokens, e.created ?? []);
      else setAt(doc, tokens, clone(e.prev));
    } else if (!isAbsent(e.prev)) {
      hit.groups[hit.i].hooks[hit.j] = clone(e.prev);
    } else {
      const group = hit.groups[hit.i];
      const made = e.created ?? [];
      const groupMade = made.some((p) => { const t = toTokens(p); return t.length === 3 && t[1] === hit.event; });
      group.hooks.splice(hit.j, 1);
      if (!group.hooks.length && groupMade) {
        hit.groups.splice(hit.i, 1);
        if (!hit.groups.length && made.includes(toPointer(['hooks', hit.event]))) {
          delete doc.hooks[hit.event];
          if (!Object.keys(doc.hooks).length && made.includes('/hooks')) delete doc.hooks;
        }
      }
    }
    changed = true;
    reverted.push(e.pointer);
  }
  if (changed) writeSettings(settingsPath, doc);
  return { reverted, conflicts };
}

export function pruneSkillOverrides(fragment, installedSkillNames) {
  const out = clone(fragment);
  if (isObj(out.skillOverrides)) {
    for (const k of Object.keys(out.skillOverrides)) if (!installedSkillNames.has(k)) delete out.skillOverrides[k];
    if (!Object.keys(out.skillOverrides).length) delete out.skillOverrides;
  }
  return out;
}
