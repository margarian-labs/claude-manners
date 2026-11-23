import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const i = process.argv.indexOf('--repo');
if (i > 0) repoDir = path.resolve(process.argv[i + 1]);

execFileSync('git', ['config', '--local', 'core.hooksPath', 'owner/hooks'], { cwd: repoDir });
console.log(`core.hooksPath = ${execFileSync('git', ['config', '--local', 'core.hooksPath'], { cwd: repoDir, encoding: 'utf8' }).trim()} (this repo only)`);
