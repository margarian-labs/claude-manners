#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ARGS = process.argv.slice(2);
const QUIET = ARGS.includes('--quiet');
const dirIdx = ARGS.indexOf('--profile-dir');
const DIR_NAME = dirIdx >= 0 ? ARGS[dirIdx + 1] : undefined;
if (!DIR_NAME || !/^\.claude-[A-Za-z0-9_-]+$/.test(DIR_NAME)) {
  console.error('[second profile] usage: node sync-second-profile.mjs --profile-dir .claude-<name> [--quiet]');
  process.exit(2);
}
const HOME = os.homedir().replace(/\\/g, '/');
const MAIN = `${HOME}/.claude`;
const SECOND = `${HOME}/${DIR_NAME}`;
const MARKER = `${SECOND}/.accounts-setup-done`;
const LINKED = ['projects', 'file-history', 'plans', 'tasks', 'skills', 'plugins', 'channels', 'ide'];
const LINKED_IF_PRESENT = ['agents', 'commands', 'rules', 'output-styles', 'workflows', 'agent-memory', 'themes'];
const COPIED = ['settings.json', 'keybindings.json'];
const CLAUDE_MD = '@~/.claude/CLAUDE.md\n';

const changes = [];
const warnings = [];
let claudeCmd = null;

const norm = p => path.resolve(p.replace(/^\\\\\?\\/, '')).replace(/[\\/]+$/, '').toLowerCase();

function ensureLink(name, createTarget) {
  const target = path.resolve(MAIN, name);
  const link = path.resolve(SECOND, name);
  if (!fs.existsSync(target)) {
    if (!createTarget) return;
    fs.mkdirSync(target, { recursive: true });
  }
  let st = null;
  try { st = fs.lstatSync(link); } catch {}
  if (!st) {
    fs.symlinkSync(target, link, 'junction');
    changes.push(`linked ${name}`);
  } else if (!st.isSymbolicLink()) {
    warnings.push(`${name} is a real folder in ${DIR_NAME}, left as is`);
  } else if (norm(fs.readlinkSync(link)) !== norm(target)) {
    warnings.push(`${name} points to ${fs.readlinkSync(link)}, expected ${target}`);
  }
}

function writeIfChanged(file, data, label) {
  let current = null;
  try { current = fs.readFileSync(file); } catch {}
  if (current && Buffer.compare(current, data) === 0) return;
  fs.writeFileSync(file, data);
  changes.push(label);
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, sortKeys(v[k])]));
  return v;
}

const sameServer = (a, b) => !!a && !!b &&
  JSON.stringify(sortKeys({ type: 'stdio', ...a })) === JSON.stringify(sortKeys({ type: 'stdio', ...b }));

function findProject(projects, key) {
  const k = key.toLowerCase();
  const hit = Object.keys(projects || {}).find(p => p.toLowerCase() === k);
  return hit ? projects[hit] : undefined;
}

function findClaude() {
  const fromEnv = process.env.CLAUDE_ACCOUNTS_CLAUDE_BIN;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  const native = `${HOME}/.local/bin/claude.exe`;
  if (fs.existsSync(native)) return native;
  const r = spawnSync('where.exe', ['$PATH:claude'], { encoding: 'utf8', windowsHide: true });
  for (const hit of (r.stdout || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean)) {
    const lower = hit.toLowerCase();
    if (lower.endsWith('.exe')) return hit;
    if (lower.endsWith('.cmd')) {
      const exe = path.join(path.dirname(hit), 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
      if (fs.existsSync(exe)) return exe;
    }
  }
  return null;
}

function runClaude(args, cwd) {
  return spawnSync(claudeCmd, args, {
    cwd: cwd || SECOND,
    env: { ...process.env, CLAUDE_CONFIG_DIR: path.resolve(SECOND) },
    encoding: 'utf8',
    windowsHide: true,
  });
}

function syncServer(scope, name, def, have, cwd) {
  if (sameServer(def, have)) return;
  if (have) runClaude(['mcp', 'remove', '-s', scope, name], cwd);
  const r = runClaude(['mcp', 'add-json', '-s', scope, name, JSON.stringify(def)], cwd);
  const where = cwd ? ` (${cwd})` : '';
  if (r.status === 0) changes.push(`mcp ${scope} ${name}${where}`);
  else warnings.push(`mcp ${scope} ${name}${where} failed, exit ${r.status}`);
}

function syncMcp() {
  const main = readJson(`${HOME}/.claude.json`);
  if (!main) { warnings.push('cannot read ~/.claude.json, MCP not synced'); return; }
  const hasServers = Object.keys(main.mcpServers || {}).length > 0 ||
    Object.values(main.projects || {}).some(p => Object.keys(p?.mcpServers || {}).length > 0);
  if (!hasServers) return;
  claudeCmd = findClaude();
  if (!claudeCmd) { warnings.push('claude executable not found, MCP not synced (set CLAUDE_ACCOUNTS_CLAUDE_BIN)'); return; }
  const personal = readJson(`${SECOND}/.claude.json`) || {};
  for (const [name, def] of Object.entries(main.mcpServers || {})) {
    syncServer('user', name, def, personal.mcpServers?.[name]);
  }
  for (const [dir, project] of Object.entries(main.projects || {})) {
    const servers = Object.entries(project?.mcpServers || {});
    if (!servers.length) continue;
    if (!fs.existsSync(dir)) { warnings.push(`local MCP skipped, ${dir} not found`); continue; }
    const have = findProject(personal.projects, dir)?.mcpServers || {};
    for (const [name, def] of servers) syncServer('local', name, def, have[name], dir);
  }
}

function main() {
  const existed = fs.existsSync(SECOND);
  if (existed && !fs.existsSync(MARKER)) {
    console.error(`[second profile] ${SECOND} already exists but was not set up by this pack; nothing changed. See SETUP-PROMPT.md, step "existing second folder".`);
    process.exit(2);
  }
  if (!existed) {
    fs.mkdirSync(SECOND, { recursive: true });
    fs.writeFileSync(MARKER, `created by sync-second-profile.mjs ${new Date().toISOString()}\n`);
    changes.push(`created ${DIR_NAME}`);
  }
  for (const name of LINKED) ensureLink(name, true);
  for (const name of LINKED_IF_PRESENT) ensureLink(name, false);
  writeIfChanged(`${SECOND}/CLAUDE.md`, Buffer.from(CLAUDE_MD), 'CLAUDE.md import');
  for (const name of COPIED) {
    const src = `${MAIN}/${name}`;
    if (fs.existsSync(src)) writeIfChanged(`${SECOND}/${name}`, fs.readFileSync(src), `copied ${name}`);
  }
  syncMcp();
}

try {
  main();
} catch (err) {
  warnings.push(`sync stopped: ${err.message}`);
}

if (changes.length) console.log(`[second profile] ${changes.join(', ')}`);
for (const w of warnings) console.warn(`[second profile] warning: ${w}`);
if (!QUIET && !changes.length && !warnings.length) console.log('[second profile] no changes');
if (!QUIET && warnings.length) process.exitCode = 1;
