const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', () => {
  let cmd;
  try {
    cmd = JSON.parse(Buffer.concat(chunks).toString('utf8'))?.tool_input?.command;
  } catch {
    return;
  }
  if (typeof cmd !== 'string' || cmd.trim() === '') return;

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } },
    }) + '\n',
  );
});
