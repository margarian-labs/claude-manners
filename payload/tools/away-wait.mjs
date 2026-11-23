#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PAD_S = 120;
const MIN_S = 60;
const FALLBACK_S = 15 * 60;
const TICK_MS = 15000;

const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const at = args.indexOf('--seconds');
const forced = at === -1 ? null : Number(args[at + 1]);
const dir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const nowS = () => Math.floor(Date.now() / 1000);

function read(name) {
  try {
    const [pct, rst] = fs.readFileSync(path.join(dir, name), 'utf8').trim().split(/\s+/).map(Number);
    return Number.isFinite(pct) && Number.isFinite(rst) && rst > nowS() ? { pct, rst } : null;
  } catch {
    return null;
  }
}

function pick() {
  if (forced !== null) return { secs: Math.round(forced), win: 'manual' };
  const week = read('usage-weekly.txt');
  const five = read('usage-5h.txt');
  const hit = week && week.pct >= 100 ? { rst: week.rst, win: 'weekly' } : five ? { rst: five.rst, win: '5h' } : null;
  if (!hit) return { secs: FALLBACK_S, win: 'fallback' };
  return { secs: Math.max(MIN_S, hit.rst - nowS() + PAD_S), win: hit.win };
}

const pad = (n) => String(n).padStart(2, '0');
const span = (s) => (s >= 3600 ? `${Math.floor(s / 3600)}h ${pad(Math.floor((s % 3600) / 60))}m` : s >= 60 ? `${Math.floor(s / 60)}m ${pad(s % 60)}s` : `${s}s`);
const stamp = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

if (forced !== null && !(Number.isFinite(forced) && forced >= 0)) {
  console.error('away-wait: --seconds needs a number of seconds');
  process.exitCode = 2;
} else {
  const { secs, win } = pick();
  const target = Date.now() + secs * 1000;
  console.log(`Wake-up timer: waiting ${span(secs)} (${secs} s) until ${stamp(new Date(target))} local, window: ${win}.`);
  if (!dry) {
    const timer = setInterval(() => {
      if (Date.now() < target) return;
      clearInterval(timer);
      console.log('Usage window reset: continue the unfinished task (away mode: from progress.md)');
    }, Math.max(250, Math.min(TICK_MS, secs * 1000)));
  }
}
