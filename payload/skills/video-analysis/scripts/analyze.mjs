#!/usr/bin/env node
// Video -> frames + manifest (+ optional transcript) so an agent can "watch" a recording.
// Zero npm deps. Needs ffmpeg/ffprobe on PATH. See SKILL.md for the workflow.

import { spawnSync, execFile } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const LONG_EDGE = 1568;          // Claude vision keeps up to this many px on the long edge
const MIN_GAP = 0.4;             // seconds; never keep two frames closer than this
const CLUSTER_GAP = 0.3;         // seconds; scored frames closer than this belong to one change
const SETTLE = 0.3;              // seconds after a change ends -> the settled state
const CHANGE_SPAN = 0.7;         // how far from the peak a transition is still "the same change"
const SCORE_FLOOR = 0.002;       // below this is cursor jitter / noise
const SILENCE_DB = -50;
const CONCURRENCY = 4;

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(SCRIPT_DIR, '..');

// ---------- args ----------
const args = process.argv.slice(2);
const opts = { maxFrames: 40, range: null, fps: 2, crop: null, audio: true, out: null, model: 'base', keep: false,
  captionsOnly: false, maxHeight: 720, maxDuration: 3600, lang: null };
let video = null;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--max-frames') opts.maxFrames = parseInt(args[++i], 10);
  else if (a === '--captions-only') opts.captionsOnly = true;
  else if (a === '--max-height') opts.maxHeight = parseInt(args[++i], 10);
  else if (a === '--max-duration') opts.maxDuration = parseInt(args[++i], 10);
  else if (a === '--lang') opts.lang = args[++i];
  else if (a === '--range') opts.range = [parseFloat(args[++i]), parseFloat(args[++i])];
  else if (a === '--fps') opts.fps = parseFloat(args[++i]);
  else if (a === '--crop') opts.crop = args[++i];
  else if (a === '--no-audio') opts.audio = false;
  else if (a === '--out') opts.out = args[++i];
  else if (a === '--whisper-model') opts.model = args[++i];
  else if (a === '--keep') opts.keep = true;
  else if (a === '-h' || a === '--help') usage(0);
  else if (a.startsWith('-')) die(`unknown option ${a}`);
  else video = a;
}
if (!video) usage(1);
const sourceUrl = /^https?:\/\//i.test(video) ? video : null;
if (sourceUrl) {
  if (!opts.out) die('--out is required for a link (the download is cached there)');
} else {
  video = resolve(video);
  if (!existsSync(video)) die(`file not found: ${video}`);
}
if (opts.captionsOnly && !sourceUrl) die('--captions-only works with a link only');
if (!(opts.maxHeight > 0) || !(opts.maxDuration > 0)) die('--max-height and --max-duration must be > 0');
if (opts.crop && !/^\d+:\d+:\d+:\d+$/.test(opts.crop)) die('--crop expects x:y:w:h (integers)');
if (opts.range && !(opts.range[1] > opts.range[0])) die('--range expects START END with END > START');
if (!(opts.maxFrames > 0)) die('--max-frames must be > 0');

function usage(code) {
  console.log(`usage: node analyze.mjs <video-file | http(s) link> [options]
  --max-frames N        frame budget for a full run (default 40)
  --captions-only       link only: transcript without downloading the video
  --max-height N        link only: download resolution cap (default 720)
  --max-duration S      link only: refuse longer videos unless --captions-only (default 3600)
  --lang CODE           link only: preferred caption language (default: the video's own, then en, hy, ru)
  --range START END     sample only this window (seconds); skips scene detection
  --fps N               sampling rate inside --range (default 2)
  --crop x:y:w:h        crop a region and upscale it (for small UI text)
  --no-audio            skip audio detection / transcription
  --whisper-model M     faster-whisper model for transcription (default base)
  --out DIR             output dir (default <video>.analysis next to the video)
  --keep                do not wipe frames/ from a previous full run`);
  process.exit(code);
}
function die(msg) { console.error(`error: ${msg}`); process.exit(2); }

// ---------- helpers ----------
function run(cmd, cmdArgs, extra = {}) {
  const r = spawnSync(cmd, cmdArgs, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...extra });
  if (r.error && r.error.code === 'ENOENT') die(`${cmd} not found on PATH (install ffmpeg, e.g. winget install Gyan.FFmpeg)`);
  if (r.error) die(`${cmd} failed: ${r.error.message}`);
  return r;
}
function runOk(cmd, cmdArgs, extra = {}) {
  const r = run(cmd, cmdArgs, extra);
  if (r.status !== 0) die(`${cmd} ${cmdArgs.slice(0, 3).join(' ')} ... exited ${r.status}\n${(r.stderr || '').trim().split('\n').slice(-5).join('\n')}`);
  return r;
}
const fmtTs = (t) => {
  const m = Math.floor(t / 60);
  const s = (t - m * 60).toFixed(2).padStart(5, '0');
  return `${String(m).padStart(2, '0')}m${s}s`;
};
const scaleFilter = (upscale) => upscale
  ? `scale='if(gt(iw,ih),${LONG_EDGE},-2)':'if(gt(iw,ih),-2,${LONG_EDGE})'`
  : `scale='if(gt(iw,ih),min(${LONG_EDGE},iw),-2)':'if(gt(iw,ih),-2,min(${LONG_EDGE},ih))'`;

// ---------- probe ----------
function probe(file) {
  const r = runOk('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
  const j = JSON.parse(r.stdout);
  const v = (j.streams || []).find((s) => s.codec_type === 'video');
  const a = (j.streams || []).find((s) => s.codec_type === 'audio');
  if (!v) die('no video stream in file');
  const rot = Math.abs(parseInt((v.side_data_list || []).find((d) => d.rotation !== undefined)?.rotation ?? v.tags?.rotate ?? 0, 10)) % 180;
  let [w, h] = [v.width, v.height];
  if (rot === 90) [w, h] = [h, w];
  const fr = (v.avg_frame_rate && v.avg_frame_rate !== '0/0' ? v.avg_frame_rate : v.r_frame_rate) || '0/1';
  const [n, d] = fr.split('/').map(Number);
  const fps = d ? +(n / d).toFixed(3) : 0;
  const duration = parseFloat(j.format?.duration ?? v.duration ?? 'NaN');
  return { width: w, height: h, fps, duration: Number.isFinite(duration) ? duration : null, hasAudio: !!a, codec: v.codec_name };
}

// ---------- scene pass ----------
function scenePass(file, outDir) {
  const scenesFile = 'scenes.txt';
  const sceneAbs = join(outDir, scenesFile);
  rmSync(sceneAbs, { force: true });
  // relative file= name on purpose: a C:\ path inside a filtergraph breaks on the colon
  runOk('ffmpeg', ['-hide_banner', '-nostats', '-loglevel', 'error', '-i', file, '-an',
    '-vf', `select='gte(scene,0)',metadata=print:file=${scenesFile}`, '-f', 'null', '-'], { cwd: outDir });
  const text = existsSync(sceneAbs) ? readFileSync(sceneAbs, 'utf8') : '';
  const frames = [];
  let cur = null;
  for (const line of text.split('\n')) {
    const m = line.match(/pts_time:([\d.]+)/);
    if (m) { cur = { t: parseFloat(m[1]), score: 0 }; frames.push(cur); continue; }
    const s = line.match(/lavfi\.scene_score=([\d.]+)/);
    if (s && cur) cur.score = parseFloat(s[1]);
  }
  return frames;
}

function clusterChanges(frames) {
  const scored = frames.filter((f) => f.score >= SCORE_FLOOR);
  const clusters = [];
  for (const f of scored) {
    const last = clusters[clusters.length - 1];
    if (last && f.t - last.end < CLUSTER_GAP) {
      last.end = f.t;
      if (f.score > last.score) { last.score = f.score; last.peak = f.t; }
    } else clusters.push({ start: f.t, end: f.t, peak: f.t, score: f.score });
  }
  return clusters;
}

function pickTimestamps(clusters, duration, budget) {
  const kept = [];
  const near = (t) => kept.some((k) => Math.abs(k.t - t) < MIN_GAP);
  const add = (t, reason, score = 0) => {
    t = Math.min(Math.max(0, t), Math.max(0, duration - 0.05));
    if (near(t)) return false;
    kept.push({ t, reason, score });
    return true;
  };
  add(0, 'start');
  if (duration > MIN_GAP * 2) add(duration - 0.1, 'end');

  // a long cluster (scrolling, typing) is anchored on its peak so the frames stay near the real event
  const afterT = (c) => Math.min(c.end, c.peak + CHANGE_SPAN) + SETTLE;
  const beforeT = (c) => c.peak - 0.1; // a fade scores highest on its first frame, so the peak is where the change begins

  const reserve = Math.ceil(budget / 4); // kept free for coverage anchors
  const byScore = [...clusters].sort((a, b) => b.score - a.score);
  const leftover = [];
  for (const c of byScore) {
    if (kept.length >= budget - reserve) { leftover.push(c); continue; }
    if (!add(afterT(c), 'after-change', c.score)) leftover.push(c);
  }
  // "before" frames for the strongest changes when nothing was captured shortly before them
  for (const c of byScore.slice(0, 5)) {
    if (kept.length >= budget) break;
    const t = beforeT(c);
    const prev = kept.filter((k) => k.t < t).sort((a, b) => b.t - a.t)[0];
    if (!prev || t - prev.t > 1) add(t, 'before-change', c.score);
  }
  // gap-fill: always put the next anchor in the middle of the largest uncovered stretch
  while (kept.length < budget) {
    const ts = kept.map((k) => k.t).sort((a, b) => a - b);
    let best = { gap: 0, mid: 0 };
    for (let i = 1; i < ts.length; i++) {
      const gap = ts[i] - ts[i - 1];
      if (gap > best.gap) best = { gap, mid: (ts[i] + ts[i - 1]) / 2 };
    }
    if (best.gap < MIN_GAP * 3 || best.gap < 1) break;
    add(best.mid, 'anchor');
  }
  for (const c of leftover) {
    if (kept.length >= budget) break;
    add(afterT(c), 'after-change', c.score);
  }
  return kept.sort((a, b) => a.t - b.t);
}

// ---------- extraction ----------
function extractAll(file, stamps, dir, crop) {
  mkdirSync(dir, { recursive: true });
  const vf = (crop ? `crop=${crop.split(':').slice(2).join(':')}:${crop.split(':').slice(0, 2).join(':')},` : '') + scaleFilter(!!crop);
  const jobs = stamps.map((s, i) => ({ ...s, file: join(dir, `${String(i + 1).padStart(3, '0')}_${fmtTs(s.t)}.png`) }));
  let idx = 0;
  const worker = () => new Promise((done) => {
    const next = () => {
      const j = jobs[idx++];
      if (!j) return done();
      execFile('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', j.t.toFixed(3), '-i', file,
        '-frames:v', '1', '-vf', vf, j.file], { maxBuffer: 16 * 1024 * 1024 }, (err, _o, stderr) => {
        if (err) j.error = (stderr || err.message).trim().split('\n').pop();
        next();
      });
    };
    next();
  });
  return Promise.all(Array.from({ length: CONCURRENCY }, worker)).then(() => jobs);
}

// ---------- audio ----------
function audioStep(file, outDir, meta, warnings) {
  if (!opts.audio) return { status: 'skipped' };
  if (!meta.hasAudio) return { status: 'no-audio-stream' };
  const r = run('ffmpeg', ['-hide_banner', '-i', file, '-vn', '-af', 'volumedetect', '-f', 'null', '-']);
  const m = (r.stderr || '').match(/mean_volume:\s*(-?[\d.]+)\s*dB/);
  const mean = m ? parseFloat(m[1]) : null;
  if (mean === null) { warnings.push('volumedetect gave no reading; treating audio as silent'); return { status: 'unknown' }; }
  if (mean < SILENCE_DB) return { status: 'silent', meanDb: mean };
  const wav = join(outDir, 'audio.wav');
  runOk('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav]);
  const py = process.platform === 'win32' ? join(SKILL_DIR, '.venv', 'Scripts', 'python.exe') : join(SKILL_DIR, '.venv', 'bin', 'python');
  if (!existsSync(py)) {
    warnings.push(`audio present (mean ${mean} dB) but whisper is not installed. One-time setup:\n` +
      `  uv venv "${join(SKILL_DIR, '.venv')}" && uv pip install --python "${join(SKILL_DIR, '.venv')}" faster-whisper`);
    return { status: 'speech-not-transcribed', meanDb: mean, wav };
  }
  const out = join(outDir, 'transcript.txt');
  console.error(`transcribing with faster-whisper (${opts.model}, cpu) ...`);
  const t = run(py, ['-I', join(SCRIPT_DIR, 'transcribe.py'), wav, '--out', out, '--model', opts.model]);
  if (t.status !== 0) { warnings.push(`transcription failed: ${(t.stderr || '').trim().split('\n').pop()}`); return { status: 'transcribe-failed', meanDb: mean, wav }; }
  return { status: 'transcribed', meanDb: mean, wav, transcript: out, info: (t.stdout || '').trim() };
}

// ---------- link source (yt-dlp, public and anonymous: never cookies) ----------
const VENV_BIN = join(SKILL_DIR, '.venv', process.platform === 'win32' ? 'Scripts' : 'bin');
const VENV_PY = join(VENV_BIN, process.platform === 'win32' ? 'python.exe' : 'python');
const YTDLP = join(VENV_BIN, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
const tail = (s, n = 6) => (s || '').trim().split('\n').slice(-n).join('\n');

function ytdlp(ytArgs) {
  if (!existsSync(YTDLP)) die(`yt-dlp is not installed for this skill. One-time setup:\n  uv pip install --python "${VENV_PY}" "yt-dlp[default]"`);
  const r = run(YTDLP, ['--ignore-config', '--no-playlist', '--js-runtimes', 'node', '--no-progress', ...ytArgs]);
  if (r.status !== 0) die(`yt-dlp exited ${r.status}:\n${tail(r.stderr)}\nIf a site keeps failing, update yt-dlp: uv pip install --python "${VENV_PY}" -U "yt-dlp[default]"`);
  return r;
}

function pickCaption(info) {
  const manual = info.subtitles.filter((k) => k !== 'live_chat');
  const base = (k) => k.toLowerCase().split(/[-_]/)[0];
  const prefs = [opts.lang, info.language, 'en', 'hy', 'ru'].filter(Boolean).map((l) => l.toLowerCase());
  for (const p of prefs) {
    const hit = manual.find((k) => k.toLowerCase() === p) || manual.find((k) => base(k) === p);
    if (hit) return { lang: hit, kind: 'captions' };
  }
  if (manual.length) return { lang: manual[0], kind: 'captions' };
  const auto = info.automatic;
  const orig = auto.find((k) => info.language && k === `${info.language}-orig`) || auto.find((k) => k.endsWith('-orig'));
  if (orig) return { lang: orig, kind: 'auto-captions' };
  if (info.language && auto.includes(info.language)) return { lang: info.language, kind: 'auto-captions' };
  return null;
}

function captionsToTranscript(file, out, caption) {
  const raw = readFileSync(file, 'utf8').replace(/\r/g, '');
  const toSec = (h, m, s, ms) => (h ? parseInt(h, 10) : 0) * 3600 + parseInt(m, 10) * 60 + parseInt(s, 10) + parseInt(ms, 10) / 1000;
  const ts = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${(t % 60).toFixed(2).padStart(5, '0')}`;
  const lines = [`# source=${caption.kind} lang=${caption.lang}`];
  const recent = [];
  for (const block of raw.split(/\n\n+/)) {
    const rows = block.split('\n');
    const at = rows.findIndex((l) => l.includes('-->'));
    if (at < 0) continue;
    const m = rows[at].match(/(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{3})/);
    if (!m) continue;
    const start = toSec(m[1], m[2], m[3], m[4]);
    const end = toSec(m[5], m[6], m[7], m[8]);
    const fresh = [];
    for (const row of rows.slice(at + 1)) {
      const text = row.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();
      if (!text || recent.includes(text)) continue;   // auto captions repeat the previous line in each cue
      recent.push(text); if (recent.length > 3) recent.shift();
      fresh.push(text);
    }
    if (fresh.length) lines.push(`[${ts(start)} - ${ts(end)}] ${fresh.join(' ')}`);
  }
  writeFileSync(out, lines.join('\n') + '\n', 'utf8');
  return lines.length - 1;
}

function fetchSource(url, outDir, warnings) {
  const srcDir = join(outDir, 'source');
  mkdirSync(srcDir, { recursive: true });
  const infoPath = join(srcDir, 'info.json');
  let info;
  if (existsSync(infoPath)) info = JSON.parse(readFileSync(infoPath, 'utf8'));
  else {
    console.error('reading link metadata ...');
    const full = JSON.parse(ytdlp(['-J', url]).stdout);
    info = { url, id: full.id, title: full.title ?? null, uploader: full.uploader || full.channel || null, duration: full.duration ?? null,
      extractor: full.extractor_key ?? null, language: full.language || null,
      subtitles: Object.keys(full.subtitles || {}), automatic: Object.keys(full.automatic_captions || {}) };
    writeFileSync(infoPath, JSON.stringify(info, null, 2));
  }
  if (!opts.captionsOnly && info.duration && info.duration > opts.maxDuration) {
    die(`the video is ${Math.round(info.duration / 60)} min, over --max-duration ${opts.maxDuration}s. Use --captions-only, or raise --max-duration.`);
  }
  const caption = pickCaption(info);
  const subArgs = caption ? [caption.kind === 'captions' ? '--write-subs' : '--write-auto-subs', '--sub-langs', caption.lang, '--sub-format', 'vtt/srt/best'] : [];
  const tmpl = join(srcDir, 'video.%(ext)s');
  const findFile = (re) => readdirSync(srcDir).filter((f) => re.test(f)).map((f) => join(srcDir, f))[0];
  const subRe = /^video\..+\.(vtt|srt)$/;
  let file = null;
  if (opts.captionsOnly) {
    if (caption && !findFile(subRe)) ytdlp(['--skip-download', ...subArgs, '-o', tmpl, url]);
    if (!caption) {
      file = findFile(/^audio\./);
      if (!file) { console.error('no captions; downloading audio for local transcription ...'); ytdlp(['-f', 'ba/b', '-o', join(srcDir, 'audio.%(ext)s'), url]); file = findFile(/^audio\./); }
    }
  } else {
    file = findFile(/^video\.(mp4|mkv|webm|mov)$/);
    if (!file) {
      console.error(`downloading (max ${opts.maxHeight}p) ...`);
      const h = opts.maxHeight;
      ytdlp(['-f', `bv*[height<=${h}]+ba/b[height<=${h}]/bv*+ba/b`, '--merge-output-format', 'mp4', ...subArgs, '-o', tmpl, url]);
      file = findFile(/^video\.(mp4|mkv|webm|mov)$/);
      if (!file) die('yt-dlp finished but no video file was found in source/');
    } else if (caption && !findFile(subRe)) ytdlp(['--skip-download', ...subArgs, '-o', tmpl, url]);
  }
  let transcript = null;
  const sub = caption && findFile(subRe);
  if (sub) {
    const out = join(outDir, 'transcript.txt');
    const n = captionsToTranscript(sub, out, caption);
    transcript = { status: caption.kind, lang: caption.lang, transcript: out, info: `${n} lines from ${caption.kind}` };
  } else if (caption) warnings.push(`captions (${caption.lang}) were listed but not downloaded; using local transcription`);
  return { info, file, transcript };
}

// ---------- main ----------
(async () => {
  const warnings = [];
  let src = null;
  if (sourceUrl) {
    const outDirEarly = resolve(opts.out);
    mkdirSync(outDirEarly, { recursive: true });
    src = fetchSource(sourceUrl, outDirEarly, warnings);
    const srcLine = `source     : ${src.info.title ?? '?'} | ${src.info.uploader ?? '?'} | ${src.info.duration ?? '?'}s | ${src.info.url}`;
    if (opts.captionsOnly) {
      const audio = src.transcript || (src.file ? audioStep(src.file, outDirEarly, { hasAudio: true }, warnings) : { status: 'no-captions' });
      const manifest = { video: sourceUrl, outDir: outDirEarly, run: 'captions-only', generatedAt: new Date().toISOString(), options: opts, source: src.info, frames: [], audio, warnings };
      writeFileSync(join(outDirEarly, 'manifest.json'), JSON.stringify(manifest, null, 2));
      console.log([srcLine, `transcript : ${audio.status}${audio.transcript ? ` -> ${audio.transcript}` : ''}`,
        ...warnings.map((w) => `warning: ${w}`)].join('\n'));
      return;
    }
    video = src.file;
    console.log(srcLine);
  }
  const outDir = resolve(opts.out || join(dirname(video), `${basename(video, extname(video))}.analysis`));
  mkdirSync(outDir, { recursive: true });
  const meta = probe(video);
  const subRun = !!(opts.range || opts.crop);

  let stamps;
  let framesDir;
  let runLabel;
  if (opts.range) {
    const [a, b] = opts.range;
    const step = 1 / opts.fps;
    stamps = [];
    for (let t = a; t <= b + 1e-6 && stamps.length < opts.maxFrames; t += step) stamps.push({ t: +t.toFixed(3), reason: 'range', score: 0 });
    runLabel = `range_${fmtTs(a)}-${fmtTs(b)}${opts.crop ? `_crop_${opts.crop.replace(/:/g, '-')}` : ''}`;
    framesDir = join(outDir, 'frames', runLabel);
    rmSync(framesDir, { recursive: true, force: true });
  } else {
    const frames = scenePass(video, outDir);
    if (meta.duration === null) {
      meta.duration = frames.length ? frames[frames.length - 1].t : 0;
      warnings.push(`container has no duration; using last decoded pts ${meta.duration}s`);
    }
    const clusters = clusterChanges(frames);
    stamps = pickTimestamps(clusters, meta.duration, opts.maxFrames);
    meta.decodedFrames = frames.length;
    meta.changeClusters = clusters.length;
    if (opts.crop) {
      runLabel = `crop_${opts.crop.replace(/:/g, '-')}`;
      framesDir = join(outDir, 'frames', runLabel);
      rmSync(framesDir, { recursive: true, force: true });
    } else {
      runLabel = 'full';
      framesDir = join(outDir, 'frames');
      if (!opts.keep) rmSync(framesDir, { recursive: true, force: true });
    }
  }

  const jobs = await extractAll(video, stamps, framesDir, opts.crop);
  const failed = jobs.filter((j) => j.error);
  if (failed.length) warnings.push(`${failed.length} frame(s) failed to extract: ${failed.map((f) => `${f.t}s (${f.error})`).join('; ')}`);
  const ok = jobs.filter((j) => !j.error);

  const audio = subRun ? { status: 'skipped' } : (src && src.transcript) ? src.transcript : audioStep(video, outDir, meta, warnings);

  const manifest = {
    video, outDir, run: runLabel, generatedAt: new Date().toISOString(), options: opts, meta, source: src ? src.info : null,
    frames: ok.map((j) => ({ t: +j.t.toFixed(2), ts: fmtTs(j.t), reason: j.reason, score: +(j.score || 0).toFixed(4), file: j.file })),
    audio, warnings,
  };
  const manifestPath = runLabel === 'full' ? join(outDir, 'manifest.json') : join(framesDir, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  const lines = [];
  lines.push(`video      : ${video}`);
  lines.push(`duration   : ${meta.duration?.toFixed(2)}s  ${meta.width}x${meta.height} @ ${meta.fps} fps  (${meta.codec})`);
  if (runLabel === 'full') lines.push(`changes    : ${meta.changeClusters} clusters over ${meta.decodedFrames} decoded frames`);
  lines.push(`frames     : ${ok.length} -> ${framesDir}`);
  lines.push(`audio      : ${audio.status}${audio.meanDb !== undefined ? ` (mean ${audio.meanDb} dB)` : ''}${audio.transcript ? ` -> ${audio.transcript}` : ''}`);
  lines.push(`manifest   : ${manifestPath}`);
  lines.push('');
  for (const f of manifest.frames) lines.push(`${f.ts}  ${f.reason.padEnd(13)} ${f.score ? `score=${f.score.toFixed(3)}` : '           '}  ${f.file}`);
  if (warnings.length) { lines.push(''); for (const w of warnings) lines.push(`warning: ${w}`); }
  console.log(lines.join('\n'));
})().catch((e) => die(e.stack || String(e)));
