const fs = require("fs");

let id = "";
try {
  id = JSON.parse(fs.readFileSync(0, "utf8") || "{}").session_id || "";
} catch {}

if (id) process.stdout.write(JSON.stringify({ systemMessage: `Session ID: ${id}` }));
