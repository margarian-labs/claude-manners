#!/usr/bin/env node
// Single Node.js process for all Telegram hook processing.
// Usage: echo "$INPUT" | node telegram-process.js <mode>
// Modes: stop, notify, question
// Outputs: ready-to-send HTML message for Telegram

const fs = require('fs');
const mode = process.argv[2];
if (!mode) process.exit(0);

let d = '';
process.stdin.on('data', c => d += c);
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(d);
    const msg = processHook(mode, input);
    if (msg) process.stdout.write(msg);
  } catch (e) {}
});

// ── Remote control link lookup ──────────────────────────────────────────────
function getRemoteLink(sessionId) {
  if (!sessionId) return '';
  const dirs = [process.env.HOME + '/.claude/sessions', process.env.HOME + '/.claude-personal/sessions'];
  for (const dir of dirs) {
    try {
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.json')) continue;
        try {
          const s = JSON.parse(fs.readFileSync(dir + '/' + f, 'utf8'));
          if (s.sessionId === sessionId && s.bridgeSessionId) {
            return 'https://claude.ai/code/' + s.bridgeSessionId;
          }
        } catch (e) {}
      }
    } catch (e) {}
  }
  return '';
}

// ── Recursive JSON field lookup ──────────────────────────────────────────────
function find(o, k) {
  if (o === null || typeof o !== 'object') return undefined;
  if (k in o) return o[k];
  for (const v of Object.values(o)) {
    const r = find(v, k);
    if (r !== undefined) return r;
  }
}

// ── HTML escape ──────────────────────────────────────────────────────────────
function escape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Truncation (operates on raw markdown, before HTML conversion) ────────────
function firstLastSummary(full) {
  if (full.length <= 4000) return full;

  // First sentence: up to first sentence-ending punctuation or 120 chars
  const firstMatch = full.match(/^.*?[.!?:]/);
  const first = firstMatch ? firstMatch[0].slice(0, 120) : full.slice(0, 120);

  // Last sentence: text after last sentence-ending punctuation
  const lastMatch = full.match(/[.!?]\s+([^.!?]*)$/);
  let last;
  if (lastMatch) {
    last = lastMatch[1];
  } else {
    // Take last 80 chars, cut at word boundary
    last = full.slice(-80).replace(/^\S*\s/, '');
  }

  return first + '\n\n**[ ... message truncated ... ]**\n\n' + last;
}

// ── Markdown to Telegram HTML ────────────────────────────────────────────────
function mdToHtml(input) {
  // Convert a markdown table to Telegram HTML
  function convertTable(raw) {
    const lines = raw.trim().split('\n').filter(l => l.trim());
    const rows = lines
      .filter(l => !/^\s*\|[-| :]+\|\s*$/.test(l))
      .map(l => l.replace(/^\||\|$/g, '').split('|').map(c => c.trim()));
    if (rows.length === 0) return escape(raw);
    const cols = rows[0].length;

    if (cols <= 2) {
      // Strip inline backticks so width calc matches rendered width
      const clean = rows.map(r => r.map(c => c.replace(/`([^`]*)`/g, '$1')));
      const widths = Array.from({ length: cols }, (_, i) =>
        Math.max(...clean.map(r => (r[i] || '').length))
      );
      const formatted = clean.map((r, ri) => {
        const cells = Array.from({ length: cols }, (_, i) => (r[i] || '').padEnd(widths[i]));
        const line = cells.join('  ');
        return ri === 0 ? line + '\n' + widths.map(w => '-'.repeat(w)).join('  ') : line;
      }).join('\n');
      return '<pre>' + escape(formatted) + '</pre>';
    }

    // Card style for wide tables: first col bold, rest as labeled fields
    const headers = rows[0];
    return rows.slice(1).map(r => {
      const title = '<b>' + escape(r[0] || '') + '</b>';
      const fields = headers.slice(1).map((h, i) =>
        '  <i>' + escape(h) + ':</i> ' + escape(r[i + 1] || '')
      ).join('\n');
      return title + (fields ? '\n' + fields : '');
    }).join('\n\n');
  }

  // Split out fenced code blocks
  const parts = [];
  const cbRe = /```(\w*)\n?([\s\S]*?)```/g;
  let last = 0, m;
  while ((m = cbRe.exec(input)) !== null) {
    if (m.index > last) parts.push({ t: 'text', s: input.slice(last, m.index) });
    parts.push({ t: 'code', s: m[2] });
    last = m.index + m[0].length;
  }
  if (last < input.length) parts.push({ t: 'text', s: input.slice(last) });

  // Further split text parts on markdown tables
  const parts2 = [];
  const tblRe = /^(\|.+\|\n?)+/mg;
  for (const p of parts) {
    if (p.t !== 'text') { parts2.push(p); continue; }
    let tLast = 0, tm;
    tblRe.lastIndex = 0;
    while ((tm = tblRe.exec(p.s)) !== null) {
      if (tm.index > tLast) parts2.push({ t: 'text', s: p.s.slice(tLast, tm.index) });
      parts2.push({ t: 'table', s: tm[0] });
      tLast = tm.index + tm[0].length;
    }
    if (tLast < p.s.length) parts2.push({ t: 'text', s: p.s.slice(tLast) });
  }

  return parts2.map(p => {
    if (p.t === 'code') return '<pre><code>' + escape(p.s.trim()) + '</code></pre>';
    if (p.t === 'table') return convertTable(p.s);
    let s = escape(p.s);
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/\*\*(.+?)\*\*/gs, '<b>$1</b>');
    s = s.replace(/__(.+?)__/gs, '<b>$1</b>');
    s = s.replace(/\*(.+?)\*/gs, '<i>$1</i>');
    s = s.replace(/(?<![a-zA-Z0-9])_(.+?)_(?![a-zA-Z0-9])/gs, '<i>$1</i>');
    s = s.replace(/^#{1,6} (.+)$/mg, '<b>$1</b>');
    return s;
  }).join('');
}

// ── Hook processors ──────────────────────────────────────────────────────────
function processHook(mode, input) {
  const sessionId = find(input, 'session_id') || '';
  const remoteLink = getRemoteLink(sessionId);
  const machineTag = process.env.MACHINE_NAME ? ' [' + process.env.MACHINE_NAME + ']' : '';

  if (mode === 'stop') {
    let rawMsg = find(input, 'last_assistant_message') || '';

    // Skip messages that are just plugin/hook JSON (e.g. should_continue blobs).
    // The JSON may be raw or wrapped in a markdown code fence.
    let jsonCandidate = rawMsg.trim();
    const fenceMatch = jsonCandidate.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
    if (fenceMatch) jsonCandidate = fenceMatch[1].trim();
    if (jsonCandidate.startsWith('{') && jsonCandidate.endsWith('}')) {
      try {
        const parsed = JSON.parse(jsonCandidate);
        if ('should_continue' in parsed || 'reasoning' in parsed) return '';
      } catch (e) {}
    }

    // Strip permission-denied preambles that get concatenated when Claude
    // retries after a tool permission grant (the user only cares about the
    // final answer, not the "I was denied" part).
    rawMsg = rawMsg.replace(
      /^[\s\S]*?(?:permission was denied|could you allow|need permission to use|allow (?:one of )?these? tools?)[\s\S]*?(?:retry\??)\s*/i,
      ''
    ).trimStart();
    const truncated = firstLastSummary(rawMsg);
    const summary = mdToHtml(truncated);

    let msg = '&#9989;<i>' + machineTag + ' Claude Responded</i>';

    if (remoteLink) msg += '\n<a href="' + remoteLink + '">Open session</a>';
    if (summary) msg += '\n\n' + summary;
    return msg;
  }

  if (mode === 'notify') {
    const message = escape(find(input, 'message') || '');

    let msg = '&#9203;<i>' + machineTag + ' Claude needs your attention</i>';

    if (remoteLink) msg += '\n<a href="' + remoteLink + '">Open session</a>';
    if (message) msg += '\n\n' + message;
    return msg;
  }

  if (mode === 'question') {
    const toolInput = input.tool_input || input;
    const questions = toolInput.questions || [];
    const lines = [];
    for (const q of questions) {
      lines.push('<b>' + escape(q.question) + '</b>');
      if (Array.isArray(q.options)) {
        q.options.forEach((o, i) => {
          lines.push('  ' + (i + 1) + '. ' + escape(o.label) +
            (o.description ? ' \u2014 <i>' + escape(o.description) + '</i>' : ''));
        });
      }
    }
    const questionsBlock = lines.join('\n');

    let msg = '&#10067;<i>' + machineTag + ' Claude has a question</i>';

    if (remoteLink) msg += '\n<a href="' + remoteLink + '">Open session</a>';
    if (questionsBlock) msg += '\n\n' + questionsBlock;
    return msg;
  }
}
