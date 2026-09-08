const path = require("node:path");
const fs = require("node:fs/promises");

const statePath = path.join(__dirname, "status-memory.json");
const args = process.argv.slice(2);

function option(name) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : "";
}

(async () => {
  const status = option("status");
  const tried = option("tried");
  const result = option("result");
  const reason = option("reason");

  if (!status || !tried || !result || !reason) {
    throw new Error("Use --status, --tried, --result, and --reason so every experiment has a clear outcome.");
  }

  const state = JSON.parse(await fs.readFile(statePath, "utf8"));
  const at = new Date().toISOString();
  state.updatedAt = at;
  state.attempts = Array.isArray(state.attempts) ? state.attempts : [];
  state.attempts.push({ id: `attempt-${Date.now()}`, at, status, tried, result, reason });
  await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
  console.log(JSON.stringify({ recorded: true, status, tried }, null, 2));
})();
