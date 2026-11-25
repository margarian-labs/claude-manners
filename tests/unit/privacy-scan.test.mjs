import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scanText, mask, entropy, identifierLike, globToRegExp, defaultWordsPath, EMPTY_ALLOW } from '../../owner/privacy-scan.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCAN = path.join(REPO, 'owner', 'privacy-scan.mjs');
const FIXTURES = path.join(REPO, 'tests', 'fixtures', 'privacy');
const j = (...p) => p.join('');

const dirs = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'privacy-scan-')); dirs.push(d); return d; };
test.after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

const NO_WORDS = path.join(os.tmpdir(), 'privacy-scan-no-such-words-file.txt');
function cli(args, { env = {}, cwd } = {}) {
  const r = spawnSync(process.execPath, [SCAN, ...args], {
    encoding: 'utf8', cwd, env: { ...process.env, CLAUDE_SETUP_PRIVACY_WORDS: NO_WORDS, ...env },
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const write = (dir, name, text) => {
  const p = path.join(dir, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
  return p;
};
const rulesOf = (text, opts) => scanText(text, opts).map((f) => f.rule);

const FAKE = {
  aws: j('AKIA', 'ABCDEFGHIJKLMNOP'),
  github: j('gh', 'p_', 'a1B2c3D4'.repeat(5).slice(0, 36)),
  githubPat: j('github', '_pat_', 'a1B2c3D4'.repeat(4)),
  slack: j('xo', 'xb-', '1234567890-abcdefgh'),
  telegram: j('1234567890', ':', 'a1B2c3D4'.repeat(5).slice(0, 35)),
  anthropic: j('sk-', 'ant-', 'api03-', 'a1B2c3D4'.repeat(3)),
  openai: j('sk-', 'a1B2c3D4'.repeat(3)),
  jwt: j('ey', 'JhbGciOiJIUzI1NiJ9', '.', 'ey', 'JzdWIiOiIxMjM0NTY3ODkwIn0', '.', 'c2lnbmF0dXJl'),
  generic: j('api_key', ' = "', 'Zk3pQ9wL2mX7'),
  genericJson: j('"pass', 'word": "', 'Zk3pQ9wL2mX7', '"'),
  entropy: j('Xk3Pq9Lm2Wz7', 'Vb5Nc8Hd4Jf6', 'Gs1Ra0Ty'),
};
const PK = (algo) => j('-----', 'BEGIN ', algo, 'PRIVATE', ' KEY-----');

test('mask keeps first and last two characters for long text and hides short text', () => {
  assert.equal(mask('abcdefghijkl'), 'ab********kl');
  assert.equal(mask('abc'), '***');
  assert.equal(mask('abcdef'), 'a****f');
  assert.ok(!mask(FAKE.github).includes(FAKE.github.slice(2, -2)));
  assert.equal(mask('x'.repeat(100)).length, 16);
});

test('entropy and identifierLike basics', () => {
  assert.equal(entropy('aaaa'), 0);
  assert.ok(entropy(FAKE.entropy) > 4.0);
  assert.ok(identifierLike('payload/skills/hallmark/references/macrostructures'));
  assert.ok(identifierLike('ExpressionChangedAfterItHasBeenCheckedErrorMessage'));
  assert.ok(!identifierLike(FAKE.entropy));
});

test('globToRegExp: star, double star, question mark', () => {
  assert.ok(globToRegExp('a/**').test('a/b/c.txt'));
  assert.ok(!globToRegExp('a/**').test('b/a/c.txt'));
  assert.ok(globToRegExp('**/c.txt').test('c.txt'));
  assert.ok(globToRegExp('**/c.txt').test('a/b/c.txt'));
  assert.ok(globToRegExp('a/*.json').test('a/x.json'));
  assert.ok(!globToRegExp('a/*.json').test('a/b/x.json'));
  assert.ok(globToRegExp('a/?.md').test('a/x.md'));
  assert.ok(!globToRegExp('a/?.md').test('a/xy.md'));
  assert.ok(globToRegExp('a.b').test('a.b'));
  assert.ok(!globToRegExp('a.b').test('aXb'));
});

test('defaultWordsPath ends in the documented location', () => {
  const p = defaultWordsPath().split(path.sep).join('/');
  assert.ok(p.endsWith('/.claude/state/claude-manners/privacy-words.txt'));
});

test('email rule: positive, safe domains, file names and version pins', () => {
  const bad = j('jane.doe', '@', 'fake-mail.invalid');
  const f = scanText(`Mail me at ${bad}.`);
  assert.deepEqual(f.map((x) => [x.rule, x.line, x.col, x.raw]), [['email', 1, 12, bad]]);
  for (const d of ['example.com', 'sub.example.org', 'example.net', 'company.com', 'runner.test']) {
    assert.deepEqual(rulesOf(j('a', '@', d)), [], d);
  }
  assert.deepEqual(rulesOf(j('logo', '@', '2x.png')), []);
  assert.deepEqual(rulesOf('left-pad@1.3.0 and @types/node'), []);
});

test('email rule: allow-list exact address and @domain', () => {
  const a = j('jane', '@', 'fake-mail.invalid');
  const b = j('bob', '@', 'corp.invalid');
  const allow = { ...EMPTY_ALLOW, emails: [a, '@corp.invalid'] };
  assert.deepEqual(rulesOf(`${a} ${b}`, { allow }), []);
  assert.deepEqual(rulesOf(j('zed', '@', 'fake-mail.invalid'), { allow }), ['email']);
});

test('key rules: each pattern is found with the right id', () => {
  const cases = [
    ['key-aws', FAKE.aws],
    ['key-github', FAKE.github],
    ['key-github', FAKE.githubPat],
    ['key-slack', FAKE.slack],
    ['key-telegram', FAKE.telegram],
    ['key-anthropic', FAKE.anthropic],
    ['key-openai', FAKE.openai],
    ['key-jwt', FAKE.jwt],
    ['key-generic', FAKE.generic],
    ['key-generic', FAKE.genericJson],
    ['key-private', PK('')],
    ['key-private', PK('RSA ')],
    ['key-private', PK('OPENSSH ')],
    ['key-private', PK('ENCRYPTED ')],
  ];
  for (const [rule, text] of cases) {
    assert.deepEqual(rulesOf(`x = ${text} y`), [rule], text.slice(0, 12));
  }
});

test('key rules: generic reports the value position, not the key name', () => {
  const [f] = scanText(FAKE.generic);
  assert.equal(f.raw, 'Zk3pQ9wL2mX7');
  assert.equal(f.col, FAKE.generic.indexOf('Zk3p') + 1);
});

test('key rules: near misses and placeholders are clean', () => {
  const clean = [
    j('AKIA', 'SHORT'),
    j('AKIA', 'ABCDEFGHIJKLMNOPQ'),
    j('gh', 'p_', 'tooshort'),
    j('sk-', 'ant-', '...'),
    j('sk-', 'short'),
    j('xo', 'xb-', 'x'),
    j('token', ' = "', 'short', '"'),
    j('pass', 'word: "<your-password-here>"'),
    j('tok', 'en = "${GITHUB_TOKEN_VALUE}"'),
    j('api', '_key = os.environ["API_KEY"]'),
    j('-----BEGIN ', 'PUBLIC KEY-----'),
  ];
  for (const text of clean) assert.deepEqual(rulesOf(text), [], text);
});

test('path rule: real user names are found in every form', () => {
  const forms = [
    j('C:', '\\Users\\', 'jsmith', '\\x'),
    j('C:', '/Users/', 'jsmith', '/x'),
    j('c:', '\\\\Users\\\\', 'jsmith', '\\\\x'),
    j('/c', '/Users/', 'jsmith'),
    j('/mnt', '/c/Users/', 'jsmith'),
    j('/ho', 'me/', 'jsmith', '/app'),
    j('/Us', 'ers/', 'jsmith'),
  ];
  for (const text of forms) {
    const f = scanText(`cd ${text}`);
    assert.deepEqual(f.map((x) => [x.rule, x.raw]), [['path-home', 'jsmith']], text);
    assert.equal(f[0].col, 4 + text.indexOf('jsmith'));
  }
});

test('path rule: placeholders and look-alikes are clean', () => {
  const clean = [
    'C:\\Users\\<name>\\x', 'C:/Users/USER/x', 'C:\\Users\\Public', 'C:\\Users\\Default', 'C:\\Users\\%USERNAME%\\x',
    '/home/$USER/x', '/home/${USER}/x', '/Users/you/x', '/home/example/x', '/home/me/x', 'C:\\Users\\username\\x',
    'src/home/index.ts', './Users/list.json', 'C:\\Users', '/home/', 'see `/home/` and `/Users/` here',
  ];
  for (const text of clean) assert.deepEqual(rulesOf(text), [], text);
});

test('entropy rule: random token found; hashes, slugs, identifiers and short strings are clean', () => {
  assert.deepEqual(rulesOf(`k=${FAKE.entropy}`), ['entropy']);
  assert.deepEqual(rulesOf(FAKE.entropy.slice(0, 31)), []);
  const clean = [
    '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    'a'.repeat(40),
    'payload/skills/hallmark/references/macrostructures/01-bento-grid-layout',
    'ExpressionChangedAfterItHasBeenCheckedErrorMessage',
    'family=Atkinson+Hyperlegible+Mono+Sans+Extra',
  ];
  for (const text of clean) assert.deepEqual(rulesOf(text), [], text);
});

test('entropy rule: allow-listed string is skipped, a key hit is not reported twice', () => {
  const allow = { ...EMPTY_ALLOW, strings: [FAKE.entropy] };
  assert.deepEqual(rulesOf(FAKE.entropy, { allow }), []);
  assert.deepEqual(rulesOf(FAKE.github), ['key-github']);
});

test('skipRules drops a rule and its sub-rules', () => {
  const text = `${FAKE.github} ${FAKE.entropy}`;
  assert.deepEqual(rulesOf(text, { skipRules: ['key'] }), ['entropy']);
  assert.deepEqual(rulesOf(text, { skipRules: ['entropy'] }), ['key-github']);
});

test('scanText reports line and column (1-based) across lines and CRLF', () => {
  const f = scanText(`one\r\ntwo ${FAKE.aws}\r\nthree`);
  assert.deepEqual(f.map((x) => [x.line, x.col]), [[2, 5]]);
});

test('CLI: negatives fixture is clean (exit 0)', () => {
  const r = cli(['--files', path.join(FIXTURES, 'negatives.txt')]);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /1 files scanned, 0 findings/);
});

test('CLI: positives are found, output is masked and never holds the secret', () => {
  const d = tmp();
  const secrets = [FAKE.github, FAKE.aws, FAKE.anthropic, FAKE.entropy, 'Zk3pQ9wL2mX7', j('jane.doe', '@', 'fake-mail.invalid')];
  const f = write(d, 'leak.txt', [FAKE.github, FAKE.aws, FAKE.anthropic, FAKE.entropy, FAKE.generic, j('jane.doe', '@', 'fake-mail.invalid')].join('\n') + '\n');
  for (const args of [['--files', f], ['--files', f, '--json']]) {
    const r = cli(args);
    assert.equal(r.code, 1);
    for (const s of secrets) {
      assert.ok(!(r.out + r.err).includes(s), `output holds ${s.slice(0, 6)}`);
      assert.ok(!(r.out + r.err).includes(s.slice(2, -2)), `output holds the middle of ${s.slice(0, 6)}`);
    }
  }
  const json = JSON.parse(cli(['--files', f, '--json']).out);
  assert.equal(json.ok, false);
  assert.deepEqual(json.findings.map((x) => x.rule), ['key-github', 'key-aws', 'key-anthropic', 'entropy', 'key-generic', 'email']);
  assert.deepEqual(json.findings.map((x) => x.line), [1, 2, 3, 4, 5, 6]);
  assert.match(json.findings[0].text, /^gh\*+.{2}$/);
  assert.match(cli(['--files', f]).out, /leak\.txt:1:1 {2}key-github {2}gh\*+/);
});

test('CLI: personal word list from env, whole word, case-insensitive, phrases, comments', () => {
  const d = tmp();
  const words = write(d, 'words.txt', '\uFEFF# my words\r\nZorblax\r\n\r\nQuux Corp\r\n');
  const f = write(d, 'notes.txt', 'a zorblax b\nZORBLAX.\nQuux   corp rules\nzorblaxian xzorblax\nclean line\n');
  const r = cli(['--files', f, '--json'], { env: { CLAUDE_SETUP_PRIVACY_WORDS: words } });
  assert.equal(r.code, 1);
  const json = JSON.parse(r.out);
  assert.deepEqual(json.findings.map((x) => [x.rule, x.line, x.col]), [['word', 1, 3], ['word', 2, 1], ['word', 3, 1]]);
  assert.deepEqual(json.warnings, []);
  for (const bad of ['Zorblax', 'zorblax', 'ZORBLAX', 'Quux']) assert.ok(!r.out.includes(bad) && !r.err.includes(bad));
});

test('CLI: word rule also checks file names', () => {
  const d = tmp();
  const words = write(d, 'words.txt', 'zorblax\n');
  const f = write(d, 'zorblax-notes.txt', 'nothing here\n');
  const json = JSON.parse(cli(['--files', f, '--json'], { env: { CLAUDE_SETUP_PRIVACY_WORDS: words } }).out);
  assert.deepEqual(json.findings.map((x) => [x.rule, x.line]), [['word', 0]]);
});

test('CLI: missing word list is a warning, not a failure', () => {
  const d = tmp();
  const f = write(d, 'ok.txt', 'hello\n');
  const r = cli(['--files', f]);
  assert.equal(r.code, 0);
  assert.match(r.err, /warning: personal word list not found/);
  const json = JSON.parse(cli(['--files', f, '--json']).out);
  assert.equal(json.ok, true);
  assert.equal(json.warnings.length, 1);
  const empty = write(d, 'empty-words.txt', '# nothing\n\n');
  assert.match(cli(['--files', f], { env: { CLAUDE_SETUP_PRIVACY_WORDS: empty } }).err, /empty/);
});

test('CLI: binary files are skipped and named, UTF-16 text is scanned', () => {
  const d = tmp();
  const bin = path.join(d, 'blob.bin');
  fs.writeFileSync(bin, Buffer.concat([Buffer.from([0, 1, 2, 3]), Buffer.from(FAKE.github)]));
  const u16 = path.join(d, 'utf16.txt');
  fs.writeFileSync(u16, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`token ${FAKE.aws}\n`, 'utf16le')]));
  const r = cli(['--files', bin, '--json']);
  assert.equal(r.code, 0);
  const json = JSON.parse(r.out);
  assert.equal(json.binarySkipped.length, 1);
  assert.match(json.binarySkipped[0], /blob\.bin$/);
  assert.match(cli(['--files', bin]).out, /binary, not scanned: .*blob\.bin/);
  const r2 = cli(['--files', u16, '--json']);
  assert.equal(r2.code, 1);
  assert.deepEqual(JSON.parse(r2.out).findings.map((x) => x.rule), ['key-aws']);
});

test('CLI: allow-list strings, emails and path globs with rule limits', () => {
  const d = tmp();
  const mail = j('jane', '@', 'fake-mail.invalid');
  write(d, 'docs/a.txt', `${FAKE.entropy}\n${mail}\n${FAKE.github}\n`);
  write(d, 'docs/deep/b.txt', `${FAKE.entropy}\n${mail}\n`);
  write(d, 'other/c.txt', `${FAKE.entropy}\n`);
  const words = write(d, 'words.txt', 'zorblax\n');
  write(d, 'docs/deep/w.txt', 'zorblax\n');
  const scan = (allow, files) => {
    fs.writeFileSync(path.join(d, 'allow.json'), JSON.stringify(allow));
    const args = ['--root', d, '--allow', path.join(d, 'allow.json'), '--json', '--files', ...files.map((f) => path.join(d, f))];
    const r = cli(args, { env: { CLAUDE_SETUP_PRIVACY_WORDS: words } });
    return JSON.parse(r.out).findings.map((x) => `${x.file}:${x.line}:${x.rule}`);
  };
  const all = ['docs/a.txt', 'docs/deep/b.txt', 'docs/deep/w.txt', 'other/c.txt'];
  assert.deepEqual(scan({}, all), [
    'docs/a.txt:1:entropy', 'docs/a.txt:2:email', 'docs/a.txt:3:key-github',
    'docs/deep/b.txt:1:entropy', 'docs/deep/b.txt:2:email', 'docs/deep/w.txt:1:word', 'other/c.txt:1:entropy',
  ]);
  assert.deepEqual(scan({ strings: [{ value: FAKE.entropy, why: 'test' }], emails: [mail] }, all), [
    'docs/a.txt:3:key-github', 'docs/deep/w.txt:1:word',
  ]);
  assert.deepEqual(scan({ paths: [{ glob: 'docs/**', rules: ['entropy', 'word'], why: 'test' }] }, all), [
    'docs/a.txt:2:email', 'docs/a.txt:3:key-github', 'docs/deep/b.txt:2:email', 'other/c.txt:1:entropy',
  ]);
  assert.deepEqual(scan({ paths: [{ glob: 'docs/deep/*.txt', why: 'whole file' }, 'other/**'] }, all), [
    'docs/a.txt:1:entropy', 'docs/a.txt:2:email', 'docs/a.txt:3:key-github',
  ]);
  assert.deepEqual(scan({ paths: [{ glob: 'docs/a.txt', rules: ['key'], why: 'test' }] }, ['docs/a.txt']), [
    'docs/a.txt:1:entropy', 'docs/a.txt:2:email',
  ]);
});

test('CLI: allow-list that is not valid is a usage error', () => {
  const d = tmp();
  const f = write(d, 'a.txt', 'hi\n');
  const bad = write(d, 'bad.json', '{not json');
  assert.equal(cli(['--files', f, '--allow', bad]).code, 2);
  const wrong = write(d, 'wrong.json', '{"emails": "x"}');
  assert.equal(cli(['--files', f, '--allow', wrong]).code, 2);
  assert.equal(cli(['--files', f, '--allow', path.join(d, 'missing.json')]).code, 2);
});

test('CLI: usage errors exit 2', () => {
  const d = tmp();
  const f = write(d, 'a.txt', 'hi\n');
  assert.equal(cli(['--nope']).code, 2);
  assert.equal(cli(['--files']).code, 2);
  assert.equal(cli(['--files', path.join(d, 'missing.txt')]).code, 2);
  assert.equal(cli(['--all', '--files', f]).code, 2);
  assert.equal(cli(['--allow']).code, 2);
  assert.equal(cli(['--all', '--root', d]).code, 2);
  assert.equal(cli(['--help']).code, 0);
});

function gitRepo() {
  const d = tmp();
  const g = (...a) => {
    const r = spawnSync('git', a, { cwd: d, encoding: 'utf8' });
    assert.equal(r.status, 0, `git ${a.join(' ')}: ${r.stderr}`);
  };
  g('init', '-q');
  return { d, g };
}

test('CLI: default mode scans staged and untracked files, not ignored or committed ones', () => {
  const { d, g } = gitRepo();
  write(d, 'old.txt', `${FAKE.github}\n`);
  g('add', 'old.txt');
  g('-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', 'commit', '-q', '--no-verify', '-m', 'x');
  write(d, '.gitignore', 'ignored.log\n');
  write(d, 'ignored.log', `${FAKE.aws}\n`);
  write(d, 'staged.txt', `${FAKE.aws}\n`);
  g('add', 'staged.txt');
  write(d, 'untracked.txt', `${FAKE.slack}\n`);
  write(d, 'clean.txt', 'nothing\n');
  const files = (args) => JSON.parse(cli([...args, '--root', d, '--json']).out).findings.map((x) => x.file);
  assert.deepEqual(files([]), ['staged.txt', 'untracked.txt']);
  assert.deepEqual(files(['--all']), ['old.txt', 'staged.txt']);
});

test('CLI: staged content is what counts in default mode', () => {
  const { d, g } = gitRepo();
  write(d, 'a.txt', `${FAKE.aws}\n`);
  g('add', 'a.txt');
  write(d, 'a.txt', 'cleaned afterwards\n');
  assert.equal(cli(['--root', d]).code, 1);
  g('add', 'a.txt');
  assert.equal(cli(['--root', d]).code, 0);
});

test('CLI: a scanned repo with no changes is clean', () => {
  const { d } = gitRepo();
  const r = cli(['--root', d]);
  assert.equal(r.code, 0);
  assert.match(r.out, /0 files scanned, 0 findings/);
});

test('scanner, its test, fixtures and allow-list pass their own scan', () => {
  const r = cli(['--files', SCAN, path.join(REPO, 'tests', 'unit', 'privacy-scan.test.mjs'), path.join(FIXTURES, 'negatives.txt'), path.join(REPO, 'owner', 'privacy-allow.json')]);
  assert.equal(r.code, 0, r.out);
});

test('real repo: --all runs and returns valid JSON', () => {
  const r = cli(['--all', '--json']);
  assert.ok([0, 1].includes(r.code), r.err);
  const json = JSON.parse(r.out);
  assert.ok(json.scanned > 100);
  assert.equal(json.ok, r.code === 0);
});
