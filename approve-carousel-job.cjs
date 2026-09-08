const fs = require("node:fs/promises");
const path = require("node:path");

const root = __dirname;
const args = process.argv.slice(2);
const jobIndex = args.indexOf("--job");

function resolveFromRoot(value) {
  const resolved = path.resolve(root, value);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw new Error("Job paths must stay inside the carousel project folder.");
  return resolved;
}

(async () => {
  if (jobIndex < 0 || !args[jobIndex + 1]) throw new Error("Use --job jobs/<job-name>.json.");
  const jobPath = resolveFromRoot(args[jobIndex + 1]);
  const job = JSON.parse(await fs.readFile(jobPath, "utf8"));
  if (job.published?.mediaId || job.workflow?.status === "published") throw new Error("A published job cannot be approved again.");
  if (job.workflow?.status === "approved") throw new Error("This job is already approved.");
  job.workflow = { ...job.workflow, status: "approved", approvedAt: new Date().toISOString() };
  await fs.writeFile(jobPath, `${JSON.stringify(job, null, 2)}\n`);
  console.log(JSON.stringify({ approved: true, jobId: job.id, next: "Run the publish command to create the Instagram post." }, null, 2));
})().catch((error) => {
  console.error(JSON.stringify({ approved: false, error: error.message }, null, 2));
  process.exitCode = 1;
});
