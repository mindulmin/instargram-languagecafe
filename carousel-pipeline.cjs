const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const { DEFAULT_PROJECT_NAME, deployCardsToCloudflarePages } = require("./public-image-hosting.cjs");
const { validateIdentityLock, verifyCanonicalReference } = require("./character-identity-lock.cjs");
const {
  acquirePublishLock,
  containsLanguageHeading,
  findDuplicateRecentMedia,
  findExpressionDuplicateRecentMedia,
  lockPathFor,
  releasePublishLock,
  updatePublishLock
} = require("./publish-safety.cjs");

const root = __dirname;
const args = process.argv.slice(2);
const isPublish = args.includes("--publish");

function option(name, fallback = "") {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

function resolveFromRoot(value) {
  const resolved = path.resolve(root, value);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("Job paths must stay inside the carousel project folder.");
  }
  return resolved;
}

function relativeFromRoot(filePath) {
  return path.relative(root, filePath).replace(/\\/g, "/");
}

function runNode(script, scriptArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...scriptArgs], { cwd: root, stdio: "inherit" });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`${script} failed with exit code ${code}.`)));
  });
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

class GraphApiRequestError extends Error {
  constructor(message, details) {
    super(message);
    this.name = "GraphApiRequestError";
    this.details = details;
  }
}

function serializePublishError(error) {
  return {
    name: error?.name || "Error",
    message: error?.message || "Unknown publishing error.",
    graph: error instanceof GraphApiRequestError ? error.details : undefined
  };
}

async function recordAttempt(statePath, status, tried, result, reason, extra = {}) {
  const state = await readJson(statePath);
  const at = new Date().toISOString();
  state.updatedAt = at;
  state.attempts = Array.isArray(state.attempts) ? state.attempts : [];
  state.attempts.push({ id: `attempt-${Date.now()}`, at, status, tried, result, reason, ...extra });
  await writeJson(statePath, state);
}

function validateJob(job) {
  const missing = [];
  if (!job.id) missing.push("id");
  if (!job.content?.html) missing.push("content.html");
  if (!job.content?.copySpec) missing.push("content.copySpec");
  if (!job.content?.exportsDir) missing.push("content.exportsDir");
  if (!job.instagram?.caption) missing.push("instagram.caption");
  if (!Array.isArray(job.instagram?.hashtags)) missing.push("instagram.hashtags");
  if (!Array.isArray(job.instagram?.captionLanguages)) missing.push("instagram.captionLanguages");
  if (!job.workflow?.status) missing.push("workflow.status");
  if (!job.workflow?.distributionReview) missing.push("workflow.distributionReview");
  if (!job.workflow?.characterReview) missing.push("workflow.characterReview");
  if (!job.workflow?.naturalKoreanReview) missing.push("workflow.naturalKoreanReview");
  if (!job.workflow?.globalLearnerReview) missing.push("workflow.globalLearnerReview");
  if (!job.workflow?.brandCreditReview) missing.push("workflow.brandCreditReview");
  if (!job.workflow?.visualDesignReview) missing.push("workflow.visualDesignReview");
  if (missing.length) throw new Error(`Job is missing: ${missing.join(", ")}`);
  const review = job.workflow.distributionReview;
  if (review.originalityConfirmed !== true) throw new Error("Distribution review failed: original content confirmation is required.");
  if (review.thirdPartyWatermarkDetected !== false) throw new Error("Distribution review failed: third-party watermark status must be false.");
  if (review.engagementBaitDetected !== false) throw new Error("Distribution review failed: engagement-bait status must be false.");
  if (review.guidelineReview !== "passed") throw new Error("Distribution review failed: guideline review must pass.");
  if (review.firstSlideHookConfirmed !== true) throw new Error("Distribution review failed: the first-slide hook must be confirmed.");
  const character = job.workflow.characterReview;
  if (character.meaningMapped !== true) throw new Error("Character review failed: map the expression meaning to a visible emotion first.");
  if (character.customAssetConfirmed !== true) throw new Error("Character review failed: an expression-specific mascot asset is required.");
  if (character.facialExpressionMatchConfirmed !== true) throw new Error("Character review failed: the mascot facial expression does not match the phrase.");
  if (character.poseMatchConfirmed !== true) throw new Error("Character review failed: the mascot pose does not match the phrase.");
  if (character.sceneMatchConfirmed !== true) throw new Error("Character review failed: the mascot scene does not match the speaking situation.");
  if (character.review !== "passed") throw new Error("Character review failed: final visual review must pass.");
  if (typeof character.asset !== "string" || !character.asset.trim()) throw new Error("Character review failed: record the expression-specific asset path.");
  if (typeof character.evidence !== "string" || character.evidence.trim().length < 30) throw new Error("Character review failed: record concrete face, pose, and scene evidence.");
  validateIdentityLock(job);
  const korean = job.workflow.naturalKoreanReview;
  if (korean.translationeseDetected !== false) throw new Error("Korean review failed: translationese must be absent.");
  if (korean.everydaySpeechConfirmed !== true) throw new Error("Korean review failed: confirm the copy is used in everyday speech.");
  if (korean.oneSecondMeaningConfirmed !== true) throw new Error("Korean review failed: the meaning must be clear on first read.");
  if (korean.readAloudConfirmed !== true) throw new Error("Korean review failed: read every Korean line aloud.");
  if (korean.review !== "passed") throw new Error("Korean review failed: final natural-language review must pass.");
  if (typeof korean.evidence !== "string" || korean.evidence.trim().length < 30) throw new Error("Korean review failed: record concrete evidence for the natural-language decision.");
  const globalLearner = job.workflow.globalLearnerReview;
  if (globalLearner.hangulFirstConfirmed !== true) throw new Error("Global learner review failed: Hangul must be the lesson core.");
  if (globalLearner.englishBridgeConfirmed !== true) throw new Error("Global learner review failed: concise natural English context and meaning support are required.");
  if (globalLearner.instructionLanguageConfirmed !== true) throw new Error("Global learner review failed: visible explanations, rules, prompts, and CTA guidance must be natural English.");
  if (globalLearner.nonDialogueKoreanDetected !== false) throw new Error("Global learner review failed: Hangul outside actual dialogue, target phrases, and pronunciation practice is not allowed.");
  if (globalLearner.romanizationLimited !== true) throw new Error("Global learner review failed: romanization must remain pronunciation support rather than replace Hangul.");
  if (globalLearner.pronunciationGuidanceConfirmed !== true) throw new Error("Global learner review failed: pronunciation guidance must be accurate and usable.");
  if (globalLearner.review !== "passed") throw new Error("Global learner review failed: final global-learner review must pass.");
  if (typeof globalLearner.evidence !== "string" || globalLearner.evidence.trim().length < 30) throw new Error("Global learner review failed: record concrete Hangul, English, and pronunciation evidence.");
  const brandCredit = job.workflow.brandCreditReview;
  if (brandCredit.studioMindulminCreditConfirmed !== true) throw new Error("Brand credit review failed: Studio mindulmin credit must be confirmed on every card.");
  if (brandCredit.position !== "bottom_right") throw new Error("Brand credit review failed: the Studio mindulmin credit must be in the bottom-right corner.");
  if (brandCredit.review !== "passed") throw new Error("Brand credit review failed: final credit review must pass.");
  if (typeof brandCredit.evidence !== "string" || brandCredit.evidence.trim().length < 30) throw new Error("Brand credit review failed: record concrete eight-card evidence.");
  const visual = job.workflow.visualDesignReview;
  if (visual.system !== "speaking-cards-v2") throw new Error("Visual design review failed: use the speaking-cards-v2 system.");
  if (visual.verticalFrameUsedConfirmed !== true) throw new Error("Visual design review failed: use the 9:16 frame as a meaningful speaking scene.");
  if (visual.firstSlideSceneConfirmed !== true) throw new Error("Visual design review failed: the first slide must show a real speaking scene.");
  if (visual.compositionVarietyConfirmed !== true) throw new Error("Visual design review failed: confirm varied compositions across all eight cards.");
  if (visual.flatTemplateDetected !== false) throw new Error("Visual design review failed: a flat template must be redesigned before publishing.");
  if (!Array.isArray(visual.meaningfulVisualCuesPerCard) || visual.meaningfulVisualCuesPerCard.length !== 8 || visual.meaningfulVisualCuesPerCard.some((count) => !Number.isInteger(count) || count < 2)) {
    throw new Error("Visual design review failed: record at least two meaning-bearing visual cues for each card.");
  }
  if (visual.review !== "passed") throw new Error("Visual design review failed: final V2 review must pass.");
  if (typeof visual.evidence !== "string" || visual.evidence.trim().length < 60) throw new Error("Visual design review failed: record concrete scene, layout, and cue evidence.");
  const captionLanguages = job.instagram.captionLanguages;
  if (!captionLanguages.includes("ko") || !captionLanguages.includes("en")) {
    throw new Error('Instagram caption review failed: captionLanguages must include both "ko" and "en".');
  }
  if (containsLanguageHeading(job.instagram.caption)) {
    throw new Error('Instagram caption review failed: remove language headings such as "[한국어]" and "[English]" from the public caption.');
  }
  if (job.instagram.hashtags.length > 30) throw new Error("Instagram allows at most 30 hashtags.");
  const caption = formatCaption(job);
  if (caption.length > 2200) throw new Error("Instagram captions must be 2,200 characters or fewer.");
}

function formatCaption(job) {
  const tags = job.instagram.hashtags.map((tag) => tag.startsWith("#") ? tag : `#${tag}`);
  return [job.instagram.caption.trim(), tags.join(" ")].filter(Boolean).join("\n\n");
}

async function readPngSize(filePath) {
  const buffer = await fs.readFile(filePath);
  if (buffer.length < 24 || buffer.toString("ascii", 1, 4) !== "PNG") throw new Error(`${relativeFromRoot(filePath)} is not a PNG image.`);
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function listCards(exportsDir) {
  const entries = await fs.readdir(exportsDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && /^card-\d{2}\.png$/i.test(entry.name))
    .map((entry) => path.join(exportsDir, entry.name))
    .sort((left, right) => left.localeCompare(right));
  if (files.length !== 8) throw new Error(`Exactly 8 card images are required; found ${files.length}.`);
  const sizes = await Promise.all(files.map(readPngSize));
  const invalid = sizes.find((size) => size.width !== 1080 || size.height !== 1350);
  if (invalid) throw new Error("Every card must be 1080 x 1350 pixels.");
  return files;
}

async function listVerticalMasters(exportsDir) {
  const verticalDir = path.join(exportsDir, "vertical-9x16");
  const entries = await fs.readdir(verticalDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && /^card-\d{2}\.png$/i.test(entry.name))
    .map((entry) => path.join(verticalDir, entry.name))
    .sort((left, right) => left.localeCompare(right));
  if (files.length !== 8) throw new Error(`Exactly 8 vertical 9:16 master images are required; found ${files.length}.`);
  const sizes = await Promise.all(files.map(readPngSize));
  const invalid = sizes.find((size) => size.width !== 1080 || size.height !== 1920);
  if (invalid) throw new Error("Every vertical master must be 1080 x 1920 pixels.");
  return files;
}

async function loadValidatedJob(jobPath) {
  const job = await readJson(jobPath);
  validateJob(job);
  if (Number(job.schemaVersion || 1) >= 2) await verifyCanonicalReference(root);
  const content = {
    html: resolveFromRoot(job.content.html),
    copySpec: resolveFromRoot(job.content.copySpec),
    exportsDir: resolveFromRoot(job.content.exportsDir)
  };
  return { job, content };
}

async function preflight(job, content) {
  const sourceHtml = await fs.readFile(content.html, "utf8");
  const creditCount = (sourceHtml.match(/Studio mindulmin/g) || []).length;
  if (creditCount !== 8) throw new Error(`Brand credit validation failed: expected Studio mindulmin exactly 8 times, found ${creditCount}.`);
  await runNode("export-cards.cjs", ["--html", relativeFromRoot(content.html), "--out", relativeFromRoot(content.exportsDir)]);
  await runNode("review-copy.cjs", ["--html", relativeFromRoot(content.html), "--spec", relativeFromRoot(content.copySpec), "--report", relativeFromRoot(path.join(content.exportsDir, "copy-review-report.json"))]);
  await runNode("review-rendered-language-split.cjs", [
    "--html", relativeFromRoot(content.html),
    "--spec", relativeFromRoot(content.copySpec),
    "--exports", relativeFromRoot(content.exportsDir),
    "--report", relativeFromRoot(path.join(content.exportsDir, "rendered-language-split-review.json"))
  ]);

  const [render, copy, renderedLanguage] = await Promise.all([
    readJson(path.join(content.exportsDir, "render-report.json")),
    readJson(path.join(content.exportsDir, "copy-review-report.json")),
    readJson(path.join(content.exportsDir, "rendered-language-split-review.json"))
  ]);
  if (render.cards !== 8 || render.metrics.some((metric) => metric.width !== 1080 || metric.height !== 1350 || metric.overflowCount > 0)) {
    throw new Error("Visual validation failed: card count, size, or overflow needs attention.");
  }
  if (render.verticalCards !== 8 || render.verticalMetrics?.some((metric) => metric.width !== 1080 || metric.height !== 1920 || metric.overflowCount > 0)) {
    throw new Error("Vertical master validation failed: eight 1080 x 1920 cards with a clean centered safe area are required.");
  }
  if (copy.status !== "passed") throw new Error("Copy validation failed: correct the Korean conversation or global English-bridge copy before publishing.");
  if (renderedLanguage.review !== "passed" || renderedLanguage.instructionLanguageConfirmed !== true || renderedLanguage.nonDialogueKoreanDetected !== false) {
    throw new Error("Rendered language split failed: every visible explanation must be English and all visible Hangul must stay inside the per-card allowlist.");
  }
  const cards = await listCards(content.exportsDir);
  const verticalMasters = await listVerticalMasters(content.exportsDir);
  return { cards, verticalMasters, captionLength: formatCaption(job).length };
}

async function graphRequest(config, pathPart, method, params = {}, context = {}) {
  const form = new URLSearchParams({ ...params, access_token: config.accessToken });
  const response = await fetch(`https://graph.facebook.com/${config.graphVersion}/${config.accountId}/${pathPart}`, {
    method,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: method === "GET" ? undefined : form
  });
  const payload = await response.json();
  if (!response.ok || payload.error) {
    const apiError = payload.error || {};
    throw new GraphApiRequestError(apiError.message || "Instagram Graph API request failed.", {
      httpStatus: response.status,
      path: pathPart,
      method,
      operation: context.operation || pathPart,
      stage: context.stage || null,
      childIndex: Number.isInteger(context.childIndex) ? context.childIndex : null,
      mediaUrl: context.mediaUrl || params.image_url || params.video_url || null,
      code: apiError.code ?? null,
      errorSubcode: apiError.error_subcode ?? null,
      type: apiError.type ?? null,
      errorUserTitle: apiError.error_user_title ?? null,
      errorUserMessage: apiError.error_user_msg ?? null,
      fbtraceId: apiError.fbtrace_id ?? null
    });
  }
  return payload;
}

async function graphGet(config, objectId, fields) {
  const params = new URLSearchParams({ fields, access_token: config.accessToken });
  const response = await fetch(`https://graph.facebook.com/${config.graphVersion}/${objectId}?${params}`);
  const payload = await response.json();
  if (!response.ok || payload.error) throw new Error(payload.error?.message || "Unable to verify the Instagram post.");
  return payload;
}

async function listRecentMedia(config, limit = 25) {
  const params = new URLSearchParams({
    fields: "id,caption,media_type,permalink,timestamp",
    limit: String(limit),
    access_token: config.accessToken
  });
  const response = await fetch(`https://graph.facebook.com/${config.graphVersion}/${config.accountId}/media?${params}`);
  const payload = await response.json();
  if (!response.ok || payload.error) throw new Error(payload.error?.message || "Unable to check recent Instagram media for duplicates.");
  return Array.isArray(payload.data) ? payload.data : [];
}

async function waitForFinished(config, creationId) {
  for (let attempt = 0; attempt < 18; attempt += 1) {
    const status = await graphGet(config, creationId, "status_code");
    if (status.status_code === "FINISHED") return;
    if (status.status_code === "ERROR" || status.status_code === "EXPIRED") throw new Error(`Instagram media status: ${status.status_code}`);
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error("Instagram media processing did not finish in time.");
}

async function publish(job, cards, exportsDir, onStage = async () => undefined) {
  if (job.published?.mediaId) throw new Error("This job was already published and is blocked from duplicate posting.");
  if (job.workflow?.carouselMusicReview?.requested === true) {
    throw new Error("This carousel requests Instagram-library music. Attach the selected track in the Instagram app before sharing; Graph API auto-publishing is blocked.");
  }
  const isApproved = job.workflow.status === "approved";
  const isAutoPublish = job.workflow.autoPublish === true;
  if (!isApproved && !isAutoPublish) {
    throw new Error(`Job status is '${job.workflow.status}'. This carousel needs approval or workflow.autoPublish=true before publishing.`);
  }

  const sessionPath = path.join(process.env.USERPROFILE || "C:\\Users\\earth", ".codex", "instagram", "session.json");
  const config = await readJson(sessionPath);
  if (!config.accessToken || !config.accountId || !config.graphVersion) throw new Error("The saved Instagram connection is incomplete.");

  await onStage("checking_recent_media");
  const recentMedia = await listRecentMedia(config);
  const duplicate = findDuplicateRecentMedia(recentMedia, formatCaption(job));
  if (duplicate) {
    throw new Error(`Duplicate publish blocked: an identical carousel already exists at ${duplicate.permalink || duplicate.id}.`);
  }
  const expressionDuplicate = findExpressionDuplicateRecentMedia(recentMedia, job.source?.expression);
  if (expressionDuplicate) {
    throw new Error(`Duplicate publish blocked: the target Hangul expression already appears in a recent carousel at ${expressionDuplicate.permalink || expressionDuplicate.id}.`);
  }

  let hostingReport;
  try {
    await onStage("hosting_cards");
    hostingReport = await deployCardsToCloudflarePages({ jobId: job.id, cards });
    await writeJson(path.join(exportsDir, "public-image-hosting-report.json"), hostingReport);
  } catch (error) {
    await writeJson(path.join(exportsDir, "public-image-hosting-report.json"), {
      status: "failed",
      provider: "cloudflare_pages",
      projectName: process.env.CLOUDFLARE_PAGES_PROJECT || DEFAULT_PROJECT_NAME,
      checkedAt: new Date().toISOString(),
      instagramContainerCreated: false,
      reason: error.message
    });
    throw new Error(`${error.message} No Instagram container was created.`);
  }
  const imageUrls = hostingReport.imageUrls;

  const childIds = [];
  await onStage("creating_instagram_children");
  for (let index = 0; index < imageUrls.length; index += 1) {
    const child = await graphRequest(config, "media", "POST", {
      image_url: imageUrls[index],
      is_carousel_item: "true"
    }, {
      operation: "create_carousel_image_child",
      stage: "creating_instagram_children",
      childIndex: index + 1,
      mediaUrl: imageUrls[index]
    });
    await waitForFinished(config, child.id);
    childIds.push(child.id);
  }

  await onStage("creating_instagram_parent");
  const parent = await graphRequest(config, "media", "POST", {
    media_type: "CAROUSEL",
    children: childIds.join(","),
    caption: formatCaption(job)
  }, {
    operation: "create_carousel_parent",
    stage: "creating_instagram_parent"
  });
  await waitForFinished(config, parent.id);
  await onStage("publishing_instagram_parent");
  const published = await graphRequest(config, "media_publish", "POST", { creation_id: parent.id }, {
    operation: "publish_carousel_parent",
    stage: "publishing_instagram_parent"
  });
  await onStage("verifying_published_media");
  const verification = await graphGet(config, published.id, "id,permalink,media_type,timestamp");
  return {
    mediaId: published.id,
    carouselContainerId: parent.id,
    childIds,
    verification,
    publicImageHosting: {
      provider: hostingReport.provider,
      projectName: hostingReport.projectName,
      deploymentUrl: hostingReport.deploymentUrl,
      publicBaseUrl: hostingReport.publicBaseUrl,
      contentHash: hostingReport.contentHash,
      verifiedCount: hostingReport.verifiedCount
    }
  };
}

let activeJob;
let activePublishLock;
let activePublishStage;
let activeExportsDir;

async function main() {
  const jobArg = option("job");
  if (!jobArg) throw new Error("Use --job jobs/<job-name>.json.");
  const jobPath = resolveFromRoot(jobArg);
  const { job, content } = await loadValidatedJob(jobPath);
  if (isPublish && process.env.LANGUAGE_CAFE_CLOUD === "1") require("./cloud/gates.cjs").assertPermit(root, job, "instagram");
  activeJob = job;
  activeExportsDir = content.exportsDir;
  const preflightResult = await preflight(job, content);
  const result = {
    jobId: job.id,
    workflowStatus: job.workflow.status,
    cards: preflightResult.cards.length,
    verticalMasterCards: preflightResult.verticalMasters.length,
    captionLength: preflightResult.captionLength,
    readyToPublish: (job.workflow.status === "approved" || job.workflow.autoPublish === true) && !job.published?.mediaId
  };

  if (!isPublish) {
    console.log(JSON.stringify({ mode: "preflight", ...result }, null, 2));
    return;
  }

  if (job.published?.mediaId) throw new Error("This job was already published and is blocked from duplicate posting.");
  const lockPath = lockPathFor(root, job.id);
  const lockState = {
    jobId: job.id,
    jobPath: relativeFromRoot(jobPath),
    startedAt: new Date().toISOString(),
    processId: process.pid,
    stage: "starting"
  };
  activePublishLock = await acquirePublishLock(lockPath, lockState);
  activePublishStage = lockState.stage;

  try {
    if (process.env.LANGUAGE_CAFE_CLOUD === "1") require("./cloud/gates.cjs").assertPermit(root, job, "instagram");
    const published = await publish(job, preflightResult.cards, content.exportsDir, async (stage) => {
      activePublishStage = stage;
      lockState.stage = stage;
      lockState.updatedAt = new Date().toISOString();
      await updatePublishLock(lockPath, lockState);
    });
    const at = new Date().toISOString();
    job.workflow.status = "published";
    job.workflow.publishedAt = at;
    job.published = { ...published, publishedAt: at };
    await writeJson(jobPath, job);
    await recordAttempt(path.join(root, "status-memory.json"), "published", `Automated Instagram carousel: ${job.id}`, `Published carousel media ${published.mediaId}`, "All visual, copy, recent-media duplicate, and single-process lock gates passed; Instagram verification returned a permalink.", { jobId: job.id, permalink: published.verification.permalink });
    await releasePublishLock(lockPath);
    activePublishLock = undefined;
    console.log(JSON.stringify({ mode: "published", ...result, duplicateCheck: "passed", publishLock: "released", published }, null, 2));
  } catch (error) {
    if (activeExportsDir) {
      await writeJson(path.join(activeExportsDir, "instagram-graph-error.json"), {
        checkedAt: new Date().toISOString(),
        jobId: activeJob?.id || null,
        stage: activePublishStage || null,
        error: serializePublishError(error)
      }).catch(() => undefined);
    }
    const safeToRelease = ["starting", "checking_recent_media", "hosting_cards"].includes(activePublishStage);
    if (safeToRelease) {
      await releasePublishLock(lockPath);
      activePublishLock = undefined;
    } else {
      lockState.stage = "needs_recent_media_verification";
      lockState.failedAt = new Date().toISOString();
      lockState.reason = error.message;
      await updatePublishLock(lockPath, lockState);
    }
    throw error;
  }
}

if (require.main === module) main().catch((error) => {
  const failure = { ok: false, error: error.message };
  const recordFailure = activeJob
    ? recordAttempt(
      path.join(root, "status-memory.json"),
      "blocked",
      `Carousel automation: ${activeJob.id}`,
      "Stopped before publication",
      error.message,
      { jobId: activeJob.id }
    ).catch(() => undefined)
    : Promise.resolve();
  recordFailure.then(() => {
    console.error(JSON.stringify(failure, null, 2));
    process.exitCode = 1;
  });
});

module.exports = { GraphApiRequestError, graphRequest, serializePublishError, formatCaption };
