#!/usr/bin/env node
// The sync tool moved. A session that started before the rename still calls this path, so it hands over to the new place.
process.env.CLAUDE_SETUP_LEGACY_ENTRY = '1';
try {
  await import('../../claude-manners/sync/sync.mjs');
} catch (e) {
  if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e;
  process.stdout.write(`${JSON.stringify({ ok: false, error: 'The sync tool moved to tools/claude-manners/sync and is missing there. Open the clone and say: Follow START.md' })}\n`);
  process.exitCode = 1;
}
