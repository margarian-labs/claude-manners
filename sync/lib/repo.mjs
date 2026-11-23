import { execFileSync } from 'node:child_process';

const MAX = 512 * 1024 * 1024;

function run(args, cwd, encoding) {
  return execFileSync('git', args, { cwd, encoding, maxBuffer: MAX, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
}

export function git(args, cwd) {
  return run(args, cwd, 'utf8');
}

export function headCommit(repo) {
  return git(['rev-parse', 'HEAD'], repo).trim();
}

export function resolveVersion(repo, tagOrSha) {
  return git(['rev-parse', '--verify', '--quiet', `${tagOrSha}^{commit}`], repo).trim();
}

export function showFileAt(repo, commit, path) {
  return run(['-c', 'core.autocrlf=false', 'cat-file', '--filters', `${commit}:${path}`], repo, 'buffer');
}

export function lsTree(repo, commit, path) {
  const out = git(['ls-tree', '-r', '-z', '--full-tree', commit, '--', path], repo);
  return out
    .split('\0')
    .filter(Boolean)
    .map((l) => {
      const [meta, p] = l.split('\t');
      return { mode: meta.split(' ')[0], path: p };
    });
}

export function listTags(repo) {
  const out = git(['for-each-ref', '--format=%(refname:short)%09%(objectname)%09%(*objectname)%09%(contents:subject)', 'refs/tags'], repo);
  return out
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [tag, obj, deref, message] = l.split('\t');
      const sha = deref || obj;
      return { tag, sha, message: message || '', n: Number(git(['rev-list', '--count', sha], repo)) };
    })
    .sort((a, b) => b.n - a.n)
    .map(({ n, ...t }) => t);
}

export function isAfter(repo, commit, target) {
  if (!commit || commit === target) return false;
  try {
    run(['merge-base', '--is-ancestor', commit, target], repo, 'utf8');
    return false;
  } catch (e) {
    return e.status === 1;
  }
}

export function diffNames(repo, from, to) {
  return git(['diff', '--name-only', from, to], repo).split('\n').filter(Boolean);
}

export function fetchAndUpdate(repo) {
  const from = headCommit(repo);
  git(['fetch', '--tags'], repo);
  git(['merge', '--ff-only'], repo);
  return { from, to: headCommit(repo) };
}
