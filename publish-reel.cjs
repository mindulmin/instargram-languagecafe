const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const root = __dirname;
const args = process.argv.slice(2);

function option(name, fallback = "") {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

function resolveFromRoot(value) {
  const resolved = path.resolve(root, value);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw new Error("Job paths must stay inside the Reel project folder.");
  return resolved;
}

async function readJson(filePath) { return JSON.parse(await fs.readFile(filePath, "utf8")); }
async function writeJson(filePath, value) { await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`); }

function safeLockName(value) {
  const safe = String(value || "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!safe) throw new Error("A safe Reel job id is required for the publish lock.");
  return safe;
}

async function acquirePublishLock(jobId) {
  const lockDir = path.join(root, "tmp", "reel-publish-locks");
  await fs.mkdir(lockDir, { recursive: true });
  const lockPath = path.join(lockDir, `${safeLockName(jobId)}.json`);
  let handle;
  try {
    handle = await fs.open(lockPath, "wx");
  } catch (error) {
    if (error.code === "EEXIST") throw new Error("A Reel publish lock already exists. Inspect the job and recent Instagram media before any retry.");
    throw error;
  }
  await handle.writeFile(`${JSON.stringify({ jobId, createdAt: new Date().toISOString(), status: "publishing" }, null, 2)}\n`);
  await handle.close();
  return lockPath;
}

function captionFor(job) {
  const tags = job.instagram.hashtags.map((tag) => tag.startsWith("#") ? tag : `#${tag}`);
  return [job.instagram.caption.trim(), tags.join(" ")].filter(Boolean).join("\n\n");
}

async function recordAttempt(status, tried, result, reason, extra = {}) {
  const statePath = path.join(root, "status-memory.json");
  const state = await readJson(statePath);
  const at = new Date().toISOString();
  state.updatedAt = at;
  state.attempts = Array.isArray(state.attempts) ? state.attempts : [];
  state.attempts.push({ id: `attempt-${Date.now()}`, at, status, tried, result, reason, ...extra });
  await writeJson(statePath, state);
}

async function catboxUpload(videoPath) {
  const contents = await fs.readFile(videoPath);
  const body = new FormData();
  body.append("reqtype", "fileupload");
  body.append("fileToUpload", new Blob([contents], { type: "video/mp4" }), path.basename(videoPath));
  const response = await fetch("https://catbox.moe/user/api.php", { method: "POST", body });
  const url = (await response.text()).trim();
  if (!response.ok || !/^https:\/\/files\.catbox\.moe\/[a-z0-9]+\.mp4$/i.test(url)) throw new Error("Public Reel video hosting failed; Instagram was not contacted.");
  return url;
}

async function verifiedVideoUrl(job, videoPath) {
  const configuredUrl = job.instagram?.videoUrl;
  if (!configuredUrl) return catboxUpload(videoPath);
  const parsed = new URL(configuredUrl);
  if (parsed.protocol !== "https:") throw new Error("The configured Reel video URL must use HTTPS.");
  const response = await fetch(configuredUrl, { method: "GET", cache: "no-store" });
  const contentType = response.headers.get("content-type") || "";
  if (!response.ok || !contentType.toLowerCase().includes("video/mp4")) {
    throw new Error(`Configured Reel video URL verification failed: HTTP ${response.status}, content type '${contentType || "missing"}'.`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const actualHash = crypto.createHash("sha256").update(bytes).digest("hex");
  if (job.videoSha256 && actualHash !== String(job.videoSha256).toLowerCase()) {
    throw new Error("Configured Reel video URL hash did not match the approved local video.");
  }
  const localBytes = await fs.readFile(videoPath);
  if (bytes.length !== localBytes.length) throw new Error("Configured Reel video URL size did not match the approved local video.");
  return configuredUrl;
}

async function graphPost(config, pathPart, params) {
  const response = await fetch(`https://graph.facebook.com/${config.graphVersion}/${config.accountId}/${pathPart}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ...params, access_token: config.accessToken }) });
  const payload = await response.json();
  if (!response.ok || payload.error) throw new Error(payload.error?.message || "Instagram Graph API request failed.");
  return payload;
}

async function graphGet(config, objectId, fields) {
  const params = new URLSearchParams({ fields, access_token: config.accessToken });
  const response = await fetch(`https://graph.facebook.com/${config.graphVersion}/${objectId}?${params}`);
  const payload = await response.json();
  if (!response.ok || payload.error) throw new Error(payload.error?.message || "Unable to verify Instagram Reel status.");
  return payload;
}

async function waitForFinished(config, creationId) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const status = await graphGet(config, creationId, "status_code");
    if (status.status_code === "FINISHED") return;
    if (status.status_code === "ERROR" || status.status_code === "EXPIRED") throw new Error(`Instagram Reel status: ${status.status_code}`);
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error("Instagram Reel processing did not finish in time.");
}

let activeJob;
let activeLockPath;
(async () => {
  if (!args.includes("--publish")) throw new Error("Reel publishing requires an explicit --publish argument.");
  const jobPath = resolveFromRoot(option("job"));
  if (!option("job")) throw new Error("Use --job jobs/<reel-job>.json.");
  const job = await readJson(jobPath);
  activeJob = job;
  const videoPath = resolveFromRoot(job.video);
  if (job.workflow?.status !== "approved") throw new Error(`Job status is '${job.workflow?.status || "missing"}', not approved.`);
  if (job.published?.mediaId) throw new Error("This Reel job was already published and is blocked from duplicate posting.");
  if (!Array.isArray(job.instagram?.hashtags) || job.instagram.hashtags.length > 30) throw new Error("A Reel must include 30 or fewer hashtags.");
  const caption = captionFor(job);
  if (caption.length > 2200) throw new Error("Instagram captions must be 2,200 characters or fewer.");
  await fs.access(videoPath);
  const sessionPath = path.join(process.env.USERPROFILE || "C:\\Users\\earth", ".codex", "instagram", "session.json");
  const config = await readJson(sessionPath);
  if (!config.accessToken || !config.accountId || !config.graphVersion) throw new Error("The saved Instagram connection is incomplete.");
  activeLockPath = await acquirePublishLock(job.id);
  const videoUrl = await verifiedVideoUrl(job, videoPath);
  const mediaParams = { media_type: "REELS", video_url: videoUrl, caption, share_to_feed: job.instagram.shareToFeed === false ? "false" : "true" };
  if (job.instagram.location?.applied === true && job.instagram.location.locationId) {
    mediaParams.location_id = String(job.instagram.location.locationId);
  }
  const container = await graphPost(config, "media", mediaParams);
  await waitForFinished(config, container.id);
  const published = await graphPost(config, "media_publish", { creation_id: container.id });
  const verification = await graphGet(config, published.id, "id,permalink,media_type,timestamp");
  const at = new Date().toISOString();
  job.workflow.status = "published";
  job.workflow.publishedAt = at;
  job.published = { mediaId: published.id, reelContainerId: container.id, videoUrl, verification, publishedAt: at };
  await writeJson(jobPath, job);
  await recordAttempt("published", `Instagram Reel: ${job.id}`, `Published Reel media ${published.id}`, "The reviewed Reel received explicit one-time user approval and was verified after publishing.", { jobId: job.id, permalink: verification.permalink });
  await fs.rm(activeLockPath, { force: true });
  activeLockPath = undefined;
  console.log(JSON.stringify({ published: true, jobId: job.id, mediaId: published.id, permalink: verification.permalink, locationApplied: Boolean(job.instagram.location?.applied && job.instagram.location.locationId) }, null, 2));
})().catch(async (error) => {
  if (activeJob) await recordAttempt("blocked", `Automated Instagram Reel: ${activeJob.id}`, "Stopped before publication", error.message, { jobId: activeJob.id }).catch(() => undefined);
  console.error(JSON.stringify({ published: false, error: error.message }, null, 2));
  process.exitCode = 1;
});
