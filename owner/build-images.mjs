import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DOCS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const IMAGES = [
  { file: 'banner-dark.png', theme: 'dark', width: 1660, height: 600 },
  { file: 'banner-light.png', theme: 'light', width: 1660, height: 600 },
  { file: 'share.png', theme: 'dark', width: 1280, height: 640, share: true },
];
const CSS = `* { box-sizing: border-box; margin: 0; }
body { font-family: "IBM Plex Mono", monospace; font-weight: 500; letter-spacing: -0.045em; background: var(--bg); color: var(--ink); }
.dark { --bg: #14171B; --ink: #EEF0F2; --ink-2: #C9CED4; --stone: #20242A; --key: #E8667E; --key-ink: #14171B; }
.light { --bg: #FFFFFF; --ink: #15181C; --ink-2: #3B424A; --stone: #E9ECEF; --key: #B0304A; --key-ink: #FFFFFF; }
.card { display: grid; grid-template-rows: auto 1fr auto; width: 1660px; height: 600px; padding: 56px 64px; }
.top { display: flex; justify-content: space-between; align-items: center; }
.name { font-size: 38px; letter-spacing: -0.03em; }
.logo { height: 46px; }
h1 { align-self: center; font-size: 112px; font-weight: 500; line-height: 1.04; word-spacing: -0.22em; }
small { display: block; margin-top: 28px; font: 400 28px/1.4 "IBM Plex Sans", sans-serif; letter-spacing: 0; word-spacing: 0; color: var(--ink-2); }
.course { display: grid; grid-template-columns: 1fr auto; gap: 6px; font-size: 34px; letter-spacing: -0.03em; word-spacing: -0.15em; }
.course div { padding: 28px 40px; background: var(--stone); }
.course .key { background: var(--key); color: var(--key-ink); transform: translateY(-18px); }
.share { width: 1280px; height: 640px; padding: 60px 68px 64px; }
.share .name { font-size: 34px; } .share .logo { height: 42px; } .share h1 { font-size: 88px; }
.share .course { font-size: 28px; } .share .course div { padding: 28px 32px; }`;

const page = ({ theme, share }) => `<!doctype html><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500&family=IBM+Plex+Sans:wght@400&display=block" rel="stylesheet">
<style>${CSS}</style>
<body class="${theme}"><div class="card${share ? ' share' : ''}">
<div class="top"><span class="name">claude-manners</span><img class="logo" src="${pathToFileURL(path.join(DOCS, `logo-on-${theme}.svg`)).href}" alt=""></div>
<h1>Claude,<br>on its best behavior.${share ? '<small>A shared Claude Code setup for Windows</small>' : ''}</h1>
<div class="course"><div>Every part optional.</div><div class="key">You approve each one.</div></div>
</div>`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-manners-images-'));
let failed = false;
for (const image of IMAGES) {
  const html = path.join(tmp, `${image.file}.html`);
  const png = path.join(tmp, image.file);
  fs.writeFileSync(html, page(image));
  spawnSync(CHROME, ['--headless=new', '--no-sandbox', '--hide-scrollbars', '--allow-file-access-from-files', `--user-data-dir=${path.join(tmp, 'profile')}`, `--window-size=${image.width},${image.height}`, '--virtual-time-budget=8000', `--screenshot=${png}`, pathToFileURL(html).href], { timeout: 60000 });
  for (let i = 0; i < 80 && !fs.existsSync(png); i++) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
  const bytes = fs.existsSync(png) ? fs.readFileSync(png) : null;
  const ok = bytes && bytes.readUInt32BE(16) === image.width && bytes.readUInt32BE(20) === image.height && bytes.length < 1 << 20;
  if (ok) fs.copyFileSync(png, path.join(DOCS, image.file));
  else failed = true;
  console.log(`${ok ? 'wrote' : 'FAILED'} docs/${image.file}${bytes ? ` (${image.width}x${image.height}, ${bytes.length} bytes)` : ''}`);
}
try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch {}
process.exitCode = failed ? 1 : 0;
