const fs = require("node:fs/promises");
const path = require("node:path");
const { deployCardsToCloudflarePages } = require("./public-image-hosting.cjs");

const root = __dirname;
const args = process.argv.slice(2);

function option(name) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function resolveFromRoot(value) {
  const resolved = path.resolve(root, value);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("Paths must stay inside the carousel project folder.");
  }
  return resolved;
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

(async () => {
  const jobArg = option("job");
  if (!jobArg) throw new Error("Use --job jobs/<job-name>.json.");
  const job = JSON.parse(await fs.readFile(resolveFromRoot(jobArg), "utf8"));
  const exportsDir = resolveFromRoot(job.content.exportsDir);
  const cards = Array.from({ length: 8 }, (_, index) => path.join(exportsDir, `card-${String(index + 1).padStart(2, "0")}.png`));
  for (const card of cards) await fs.access(card);
  const reportPath = path.join(exportsDir, "public-image-hosting-report.json");
  try {
    const report = await deployCardsToCloudflarePages({ jobId: job.id, cards });
    await writeJson(reportPath, report);
    console.log(JSON.stringify({
      deployed: true,
      jobId: job.id,
      provider: report.provider,
      deploymentUrl: report.deploymentUrl,
      verifiedCount: report.verifiedCount,
      report: path.relative(root, reportPath).replace(/\\/g, "/")
    }, null, 2));
  } catch (error) {
    const report = {
      status: "failed",
      provider: "cloudflare_pages",
      checkedAt: new Date().toISOString(),
      instagramContainerCreated: false,
      reason: error.message
    };
    await writeJson(reportPath, report);
    throw error;
  }
})().catch((error) => {
  console.error(JSON.stringify({ deployed: false, error: error.message }, null, 2));
  process.exitCode = 1;
});
