import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const EM = String.fromCharCode(0x2014);
const EN = String.fromCharCode(0x2013);
const BINARY_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.pdf', '.zip', '.gz', '.woff', '.woff2', '.ttf', '.otf', '.eot', '.mp3', '.mp4', '.mov', '.webm', '.bin', '.exe', '.dll']);

export function listFiles(repoDir) {
  const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: repoDir, encoding: 'utf8', maxBuffer: 1 << 28 });
  return [...new Set(out.split('\0').filter(Boolean))];
}

export function scanFiles(repoDir, files) {
  const hits = [];
  for (const rel of files) {
    const abs = path.resolve(repoDir, rel);
    if (BINARY_EXT.has(path.extname(rel).toLowerCase())) continue;
    let buf;
    try {
      if (!fs.statSync(abs).isFile()) continue;
      buf = fs.readFileSync(abs);
    } catch { continue; }
    if (buf.includes(0)) continue;
    const lines = buf.toString('utf8').split('\n');
    lines.forEach((line, i) => {
      if (line.includes(EM)) hits.push({ file: rel, line: i + 1, char: 'U+2014' });
      if (line.includes(EN)) hits.push({ file: rel, line: i + 1, char: 'U+2013' });
    });
  }
  return hits;
}

function main(argv) {
  let repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  let files = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--repo') repoDir = path.resolve(argv[++i]);
    else if (argv[i] === '--files') { files = []; while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) files.push(argv[++i]); }
    else { console.error('usage: dash-scan.mjs [--files a b ...] [--repo dir]'); return 2; }
  }
  const hits = scanFiles(repoDir, files ?? listFiles(repoDir));
  for (const h of hits) console.log(`${h.file}:${h.line}: ${h.char}`);
  if (hits.length) { console.error(`${hits.length} dash character(s) found`); return 1; }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)));
