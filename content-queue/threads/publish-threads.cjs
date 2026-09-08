#!/usr/bin/env node
"use strict";

/*
 * Fail-closed Threads TEXT publisher. This module intentionally does not
 * perform OAuth, create credentials, publish replies/DMs, or touch Instagram.
 * A real request happens only when this file receives --publish.
 */

const fs = require("node:fs/promises");
const path = require("node:path");
const {
  THREADS_STRATEGY_VERSION,
  THREADS_JOBS_DIR,
  extractHangulRuns,
  normalizeText,
  readControlSnapshot,
  sourceEligibilityErrors,
  validateControlSnapshotForJob,
  validateThreadsJob
} = require("./prepare-threads-draft.cjs");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const THREADS_API_BASE_URL = "https://graph.threads.net/v1.0";
const DEFAULT_SESSION_PATH = "C:\\Users\\earth\\.codex\\threads\\session.json";
const DEFAULT_LOCK_DIR = path.join(__dirname, ".publish-locks");
const RECENT_FIELDS = "id,text,permalink,timestamp,media_type";

class ThreadsApiError extends Error {
  constructor(message, { operation, status = null, ambiguous = false } = {}) {
    super(message);
    this.name = "ThreadsApiError";
    this.operation = operation || "unknown";
    this.status = status;
    this.ambiguous = ambiguous;
  }
}

function usage() {
  return [
    "Usage:",
    "  node content-queue/threads/publish-threads.cjs --job content-queue/threads/jobs/<approved-job>.json [--dry-run]",
    "  node content-queue/threads/publish-threads.cjs --job content-queue/threads/jobs/<approved-job>.json --publish",
    "",
    "Default mode is dry-run. --publish is the sole route that may call graph.threads.net."
  ].join("\n");
}

function parseArgs(args) {
  const result = { job: "", publish: false, dryRun: false, help: false };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--publish") {
      result.publish = true;
      continue;
    }
    if (value === "--dry-run") {
      result.dryRun = true;
      continue;
    }
    if (value === "--help" || value === "-h") {
      result.help = true;
      continue;
    }
    if (value === "--job") {
      const job = args[index + 1];
      if (!job || job.startsWith("--")) throw new Error("--job requires a Threads job path.");
      result.job = job;
      index += 1;
      continue;
    }
    throw new Error(`Unsupported option: ${value}`);
  }
  if (!result.help && !result.job) throw new Error("--job is required.");
  if (result.publish && result.dryRun) throw new Error("Use either --publish or --dry-run, not both.");
  return result;
}

function isInside(parent, target) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function safeRelative(filePath, root = PROJECT_ROOT) {
  const relative = path.relative(root, filePath);
  return relative && !relative.startsWith("..") ? relative.split(path.sep).join("/") : path.basename(filePath);
}

function redactSecrets(value) {
  return String(value || "")
    .replace(/(?:access_token|token|authorization)\s*(?:=|:)\s*[^\s&"']+/giu, "[redacted]")
    .replace(/Bearer\s+[^\s]+/giu, "Bearer [redacted]");
}

function safeErrorMessage(error) {
  return redactSecrets(error?.message || "Unknown Threads publishing error.");
}

function compactHangul(value) {
  return extractHangulRuns(value).join("").normalize("NFC");
}

function nowIso(clock = () => new Date()) {
  return clock().toISOString();
}

async function readJson(filePath, label) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read ${label}: ${safeErrorMessage(error)}`);
  }
}

async function writeJsonAtomic(filePath, value) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  try {
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.unlink(tempPath).catch(() => {});
    throw error;
  }
}

function resolveJobPath(value, jobsDirectory) {
  const target = path.isAbsolute(value) ? path.resolve(value) : path.resolve(PROJECT_ROOT, value);
  if (!isInside(jobsDirectory, target) || path.extname(target).toLowerCase() !== ".json") {
    throw new Error("--job must point to a JSON job inside content-queue/threads/jobs.");
  }
  return target;
}

function ensureMetricsUnavailable(job) {
  const metrics = job?.measurement?.metrics;
  if (!metrics || typeof metrics !== "object") throw new Error("Threads job is missing measurement.metrics.");
  for (const [name, metric] of Object.entries(metrics)) {
    if (!metric || metric.status !== "unavailable" || metric.value !== null) {
      throw new Error(`Threads publisher requires ${name} to remain unavailable before a verified measurement readback.`);
    }
  }
}

async function validatePublishableJob(job, { jobsDirectory, jobPath, now = new Date(), recoveryProjectRoot = PROJECT_ROOT } = {}) {
  const review = await validateThreadsJob(job, {
    jobsDir: jobsDirectory || THREADS_JOBS_DIR,
    ignoredPath: jobPath,
    now,
    recoveryProjectRoot
  });
  const errors = [...review.errors];
  if (job?.workflow?.status !== "approved") errors.push("workflow_not_approved");
  if (job?.workflow?.autoPublish !== true) errors.push("workflow_auto_publish_not_enabled");
  if (job?.workflow?.manualPostDecisionRequired !== false) errors.push("manual_post_decision_not_waived_by_standing_authorization");
  if (job?.workflow?.standingDirectPostAuthorization !== true) errors.push("standing_direct_post_authorization_missing");
  if (Object.prototype.hasOwnProperty.call(job || {}, "published") && job.published) errors.push("job_already_published");
  try {
    ensureMetricsUnavailable(job);
  } catch (error) {
    errors.push("metrics_must_remain_unavailable");
  }
  return { passed: errors.length === 0, errors, draftReview: review };
}

async function readAndValidateBoundControl(job, {
  clock = () => new Date(),
  controlSnapshotLoader = readControlSnapshot
} = {}) {
  const controlPath = String(job?.controlBinding?.controlPath || "").trim();
  if (!controlPath) throw new Error("Threads control preflight blocked: control_binding_controlPath_missing.");
  const snapshot = await controlSnapshotLoader(controlPath);
  const review = validateControlSnapshotForJob(job, snapshot, { now: clock() });
  if (!review.passed) {
    throw new Error(`Threads control preflight blocked: ${review.errors.join(", ")}.`);
  }
  return snapshot;
}

async function readAndValidateSourceCarousel(job, { sourceCarouselLoader, sourceCarouselRoot = path.join(PROJECT_ROOT, "jobs") } = {}) {
  const sourceValue = String(job?.source?.sourceCarouselJob || "").trim();
  if (!sourceValue) throw new Error("Threads Instagram-source preflight blocked: source_carousel_job_path_missing.");
  const sourcePath = path.isAbsolute(sourceValue) ? path.resolve(sourceValue) : path.resolve(PROJECT_ROOT, sourceValue);
  const jobsRoot = path.resolve(sourceCarouselRoot);
  if (!sourceCarouselLoader && (!isInside(jobsRoot, sourcePath) || path.extname(sourcePath).toLowerCase() !== ".json")) {
    throw new Error("Threads Instagram-source preflight blocked: source_carousel_job_path_outside_jobs.");
  }
  const carouselJob = sourceCarouselLoader
    ? await sourceCarouselLoader(sourcePath)
    : await readJson(sourcePath, "paired Instagram carousel job");
  const errors = sourceEligibilityErrors(carouselJob);
  if (String(carouselJob?.id || "") !== String(job?.source?.sourceCarouselJobId || "")) {
    errors.push("source_carousel_job_id_changed");
  }
  if (String(carouselJob?.source?.expression || "") !== String(job?.source?.expression || "")) {
    errors.push("source_carousel_expression_changed");
  }
  if (String(carouselJob?.workflow?.postPublishVerification?.matchedMediaId || "")
      !== String(job?.source?.sourceCarouselMediaId || "")) {
    errors.push("source_carousel_media_id_changed_or_not_bound");
  }
  const currentPermalink = String(carouselJob?.workflow?.postPublishVerification?.permalink || "").trim();
  if (!currentPermalink
      || currentPermalink !== String(job?.source?.sourceCarouselPermalink || "").trim()
      || currentPermalink !== String(job?.controlBinding?.sourceLinkTarget || "").trim()
      || currentPermalink !== String(job?.copy?.link?.publicUrl || "").trim()) {
    errors.push("source_carousel_permalink_changed_or_not_bound");
  }
  if (errors.length) {
    throw new Error(`Threads Instagram-source preflight blocked: ${[...new Set(errors)].join(", ")}.`);
  }
  return carouselJob;
}

function sessionValues(value, { clock = () => new Date() } = {}) {
  const accessToken = String(value?.accessToken || value?.access_token || value?.threadsAccessToken || "").trim();
  const userId = String(value?.userId || value?.user_id || value?.threadsUserId || "").trim();
  if (!accessToken || !userId) {
    throw new Error("Threads session is missing a user ID or access token. Complete account setup outside this publisher.");
  }
  const expiresAt = String(value?.expiresAt || "").trim();
  const expiresAtMs = Date.parse(expiresAt);
  if (!expiresAt || !Number.isFinite(expiresAtMs)) {
    throw new Error("Threads session is missing a valid token expiry timestamp. Regenerate and verify the Threads token before publishing.");
  }
  const now = clock();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new Error("Threads publisher clock is invalid.");
  }
  if (expiresAtMs <= now.getTime()) {
    throw new Error("Threads session token has expired. Regenerate and verify the Threads token before publishing.");
  }
  const scopes = Array.isArray(value?.scopes)
    ? value.scopes.map((scope) => String(scope || "").trim()).filter(Boolean)
    : [];
  const missingScopes = ["threads_basic", "threads_content_publish"].filter((scope) => !scopes.includes(scope));
  if (missingScopes.length) {
    throw new Error(`Threads session is missing required scopes: ${missingScopes.join(", ")}.`);
  }
  return { accessToken, userId, expiresAt, scopes };
}

async function loadSession(sessionPath = DEFAULT_SESSION_PATH, options = {}) {
  return sessionValues(await readJson(sessionPath, "Threads session"), options);
}

async function responsePayload(response) {
  const body = typeof response?.text === "function" ? await response.text() : "";
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    return { raw: body };
  }
}

function isAmbiguousStatus(status) {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function isAmbiguousError(error) {
  return Boolean(error?.ambiguous)
    || /\b(?:timeout|timed out|network|connection|abort(?:ed)?)\b/iu.test(String(error?.message || ""));
}

function createThreadsApi({ fetchImpl = globalThis.fetch, baseUrl = THREADS_API_BASE_URL, timeoutMs = 20000 } = {}) {
  if (typeof fetchImpl !== "function") throw new Error("A Fetch implementation is required for real Threads API publishing.");

  async function request({ method, pathname, operation, query, form }) {
    const url = new URL(`${baseUrl.replace(/\/$/u, "")}${pathname}`);
    for (const [key, value] of Object.entries(query || {})) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    const controller = typeof AbortController === "undefined" ? null : new AbortController();
    const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    let response;
    try {
      response = await fetchImpl(url, {
        method,
        headers: form ? { "content-type": "application/x-www-form-urlencoded" } : undefined,
        body: form ? new URLSearchParams(Object.entries(form).map(([key, value]) => [key, String(value)])).toString() : undefined,
        signal: controller?.signal
      });
    } catch {
      throw new ThreadsApiError(`Threads API ${operation} did not return a reliable response.`, { operation, ambiguous: true });
    } finally {
      if (timeout) clearTimeout(timeout);
    }
    const payload = await responsePayload(response);
    if (!response?.ok) {
      const message = `Threads API ${operation} was not accepted${response?.status ? ` (HTTP ${response.status})` : ""}.`;
      throw new ThreadsApiError(message, { operation, status: response?.status || null, ambiguous: isAmbiguousStatus(response?.status || 0) });
    }
    if (!payload || typeof payload !== "object") {
      throw new ThreadsApiError(`Threads API ${operation} returned an unreadable response.`, { operation, ambiguous: true });
    }
    return payload;
  }

  return {
    async listRecentPosts(session) {
      const payload = await request({
        method: "GET",
        pathname: `/${encodeURIComponent(session.userId)}/threads`,
        operation: "recent-post readback",
        query: { fields: RECENT_FIELDS, limit: "100", access_token: session.accessToken }
      });
      if (!Array.isArray(payload.data)) {
        throw new ThreadsApiError("Threads API recent-post readback returned no media list.", { operation: "recent-post readback", ambiguous: true });
      }
      return payload.data;
    },
    async createTextContainer(session, text) {
      const payload = await request({
        method: "POST",
        pathname: `/${encodeURIComponent(session.userId)}/threads`,
        operation: "TEXT container creation",
        form: { media_type: "TEXT", text, access_token: session.accessToken }
      });
      if (!payload.id) throw new ThreadsApiError("Threads API TEXT container response had no creation ID.", { operation: "TEXT container creation", ambiguous: true });
      return String(payload.id);
    },
    async publishContainer(session, creationId) {
      const payload = await request({
        method: "POST",
        pathname: `/${encodeURIComponent(session.userId)}/threads_publish`,
        operation: "TEXT container publish",
        form: { creation_id: creationId, access_token: session.accessToken }
      });
      if (!payload.id) throw new ThreadsApiError("Threads API publish response had no media ID.", { operation: "TEXT container publish", ambiguous: true });
      return String(payload.id);
    },
    async getPost(session, mediaId) {
      return request({
        method: "GET",
        pathname: `/${encodeURIComponent(mediaId)}`,
        operation: "published-post readback",
        query: { fields: RECENT_FIELDS, access_token: session.accessToken }
      });
    }
  };
}

function findDuplicates(posts, { primaryPost, expression }) {
  const fullText = normalizeText(primaryPost);
  const targetHangul = compactHangul(expression);
  return (Array.isArray(posts) ? posts : []).map((post) => {
    const text = String(post?.text || "");
    const fullTextMatch = normalizeText(text) === fullText;
    const targetHangulMatch = Boolean(targetHangul && compactHangul(text).includes(targetHangul));
    return { post, fullTextMatch, targetHangulMatch };
  }).filter((match) => match.fullTextMatch || match.targetHangulMatch);
}

function lockPathFor(lockDirectory, jobId) {
  const safeId = String(jobId || "unknown").replace(/[^a-z0-9._-]/giu, "-");
  return path.join(lockDirectory, `${safeId}.json`);
}

async function acquireLock(lockPath, details) {
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  let handle;
  try {
    handle = await fs.open(lockPath, "wx");
    await handle.writeFile(`${JSON.stringify(details, null, 2)}\n`, "utf8");
  } catch (error) {
    if (error.code === "EEXIST") throw new Error("Threads publish blocked: an unresolved per-job publish lock already exists.");
    throw error;
  } finally {
    await handle?.close();
  }
}

async function updateLock(lockPath, details) {
  await fs.writeFile(lockPath, `${JSON.stringify(details, null, 2)}\n`, "utf8");
}

async function releaseLock(lockPath) {
  await fs.unlink(lockPath).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
}

function publisherReview({ status, at, reason, duplicateMatches, readback, error, operationalReviewRequired = false }) {
  return {
    status,
    reviewedAt: at,
    reason,
    duplicateMatches: (duplicateMatches || []).map((match) => ({
      mediaId: match.post?.id || null,
      fullTextMatch: Boolean(match.fullTextMatch),
      targetHangulMatch: Boolean(match.targetHangulMatch),
      permalink: match.post?.permalink || null
    })),
    readback: readback || null,
    error: error ? safeErrorMessage(error) : null,
    manualPostApprovalRequired: false,
    operationalRecoveryReviewRequired: Boolean(operationalReviewRequired),
    repliesOrDmsAttempted: false,
    profileChangesAttempted: false,
    instagramOrReelActionAttempted: false
  };
}

async function blockJob({ jobPath, job, clock, status, reason, duplicateMatches, readback, error, commandRun }) {
  const at = nowIso(clock);
  const operationalReviewRequired = /(?:ambiguous|failed|readback)/iu.test(String(status || ""));
  job.workflow = {
    ...job.workflow,
    status: "blocked",
    autoPublish: false,
    manualPostDecisionRequired: false,
    operationalRecoveryReviewRequired: operationalReviewRequired,
    postToThreadsCommandRun: Boolean(commandRun)
  };
  job.automation = {
    ...job.automation,
    postToThreadsAttempted: Boolean(commandRun),
    postToThreadsCommandRun: Boolean(commandRun),
    blockedAt: at
  };
  job.review = {
    ...job.review,
    status: "blocked",
    publisher: publisherReview({ status, at, reason, duplicateMatches, readback, error, operationalReviewRequired })
  };
  await writeJsonAtomic(jobPath, job);
}

async function exactReadback({ api, session, mediaId, primaryPost }) {
  const [post, recent] = await Promise.all([
    api.getPost(session, mediaId),
    api.listRecentPosts(session)
  ]);
  const normalized = normalizeText(primaryPost);
  const mediaIdMatches = recent.filter((item) => String(item?.id || "") === String(mediaId));
  const fullTextMatches = recent.filter((item) => normalizeText(item?.text || "") === normalized);
  const exact = String(post?.id || "") === String(mediaId)
    && normalizeText(post?.text || "") === normalized
    && Boolean(post?.permalink)
    && mediaIdMatches.length === 1
    && fullTextMatches.length === 1;
  return {
    passed: exact,
    mediaId,
    mediaIdMatchCount: mediaIdMatches.length,
    normalizedFullTextMatchCount: fullTextMatches.length,
    permalink: post?.permalink || null,
    timestamp: post?.timestamp || null,
    textMatches: normalizeText(post?.text || "") === normalized
  };
}

async function finalizePublished({ jobPath, job, clock, containerId, readback, recoveredFromAmbiguousResponse = false }) {
  const at = nowIso(clock);
  job.workflow = {
    ...job.workflow,
    status: "published",
    autoPublish: false,
    manualPostDecisionRequired: false,
    postToThreadsCommandRun: true
  };
  job.automation = {
    ...job.automation,
    postToThreadsAttempted: true,
    postToThreadsCommandRun: true,
    publishedAt: at
  };
  job.published = {
    mediaId: readback.mediaId,
    containerId: containerId || null,
    threadsStrategyVersion: THREADS_STRATEGY_VERSION,
    threadsLinkTargetType: job.copy.link.targetType,
    threadsLinkTarget: job.copy.link.publicUrl,
    threadsExternalLinkCount: 1,
    threadsExplicitLinkAttachmentRequested: false,
    threadsPlatformPreviewState: job.copy.platformPreviewState,
    ...(job.recoveryBinding ? {
      legacyRecovery: {
        supersedesJobId: job.recoveryBinding.supersedesJobId,
        recoveryEvidencePath: job.recoveryBinding.recoveryEvidencePath,
        recoveryEvidenceSha256: job.recoveryBinding.recoveryEvidenceSha256,
        legacyContainerId: job.recoveryBinding.legacyContainerId,
        resolution: job.recoveryBinding.resolution,
        originalContainerPublishRetried: false
      }
    } : {}),
    verification: {
      id: readback.mediaId,
      permalink: readback.permalink,
      timestamp: readback.timestamp,
      mediaIdMatchCount: readback.mediaIdMatchCount,
      normalizedFullTextMatchCount: readback.normalizedFullTextMatchCount,
      threadsStrategyVersion: THREADS_STRATEGY_VERSION,
      threadsLinkTargetType: job.copy.link.targetType,
      threadsLinkTarget: job.copy.link.publicUrl,
      threadsExternalLinkCount: 1,
      threadsExplicitLinkAttachmentRequested: false,
      threadsPlatformPreviewState: job.copy.platformPreviewState,
      review: "passed"
    },
    recoveredFromAmbiguousResponse,
    publishedAt: at
  };
  job.review = {
    ...job.review,
    status: "published_exactly_once",
    publisher: publisherReview({
      status: "passed",
      at,
      reason: "Official Threads media-id and normalized-full-text readback each matched exactly once.",
      readback
    })
  };
  await writeJsonAtomic(jobPath, job);
}

async function attemptAmbiguousRecovery({ api, session, job, jobPath, clock, phase, containerId, error }) {
  let recent;
  try {
    recent = await api.listRecentPosts(session);
  } catch (readbackError) {
    await blockJob({
      jobPath,
      job,
      clock,
      status: "ambiguous_result_readback_unavailable",
      reason: `The ${phase} response was ambiguous and the required official recent-media inspection also failed. No retry was attempted.`,
      error: readbackError,
      commandRun: true
    });
    return { recovered: false, keepLock: true };
  }

  const matches = findDuplicates(recent, { primaryPost: job.copy.primaryPost, expression: job.source.expression });
  const exactFullText = matches.filter((match) => match.fullTextMatch);
  if ((phase === "TEXT container publish" || phase === "post-publish readback") && exactFullText.length === 1) {
    try {
      const readback = await exactReadback({ api, session, mediaId: String(exactFullText[0].post.id), primaryPost: job.copy.primaryPost });
      if (readback.passed) {
        await finalizePublished({ jobPath, job, clock, containerId, readback, recoveredFromAmbiguousResponse: true });
        return { recovered: true, keepLock: false, readback };
      }
    } catch {
      // The blocked record below retains the lock for human official readback.
    }
  }
  await blockJob({
    jobPath,
    job,
    clock,
    status: "ambiguous_result_manual_readback_required",
    reason: `The ${phase} response was ambiguous. Official recent Threads media was inspected once; no retry was attempted.`,
    duplicateMatches: matches,
    error,
    commandRun: true
  });
  return { recovered: false, keepLock: true };
}

async function publishThreadsJob({
  jobPath,
  jobsDirectory,
  lockDirectory,
  sessionPath,
  session: injectedSession,
  api: injectedApi,
  clock = () => new Date(),
  controlSnapshotLoader,
  sourceCarouselLoader,
  sourceCarouselRoot,
  recoveryProjectRoot = PROJECT_ROOT
}) {
  const job = await readJson(jobPath, "Threads job");
  const validation = await validatePublishableJob(job, { jobsDirectory, jobPath, now: clock(), recoveryProjectRoot });
  if (!validation.passed) {
    throw new Error(`Threads publish preflight blocked: ${validation.errors.join(", ")}.`);
  }
  await readAndValidateBoundControl(job, { clock, controlSnapshotLoader });
  await readAndValidateSourceCarousel(job, { sourceCarouselLoader, sourceCarouselRoot });
  const session = injectedSession ? sessionValues(injectedSession, { clock }) : await loadSession(sessionPath, { clock });
  const api = injectedApi || createThreadsApi();
  const lockPath = lockPathFor(lockDirectory, job.id);
  await acquireLock(lockPath, { jobId: job.id, startedAt: nowIso(clock), stage: "locked_for_official_duplicate_check", channel: "threads" });
  let keepLock = false;
  let containerId = null;
  try {
    const currentJob = await readJson(jobPath, "Threads job");
    const currentValidation = await validatePublishableJob(currentJob, { jobsDirectory, jobPath, now: clock(), recoveryProjectRoot });
    if (!currentValidation.passed) throw new Error(`Threads publish preflight blocked after lock: ${currentValidation.errors.join(", ")}.`);
    await readAndValidateBoundControl(currentJob, { clock, controlSnapshotLoader });
    await readAndValidateSourceCarousel(currentJob, { sourceCarouselLoader, sourceCarouselRoot });
    const recent = await api.listRecentPosts(session);
    const duplicateMatches = findDuplicates(recent, { primaryPost: currentJob.copy.primaryPost, expression: currentJob.source.expression });
    if (duplicateMatches.length) {
      await blockJob({ jobPath, job: currentJob, clock, status: "duplicate_official_threads_media", reason: "Official recent Threads media contains the same normalized full text or target Hangul expression; no container was created.", duplicateMatches, commandRun: false });
      return { status: "blocked_duplicate", job: currentJob, lockRetained: false };
    }

    await updateLock(lockPath, { jobId: currentJob.id, startedAt: nowIso(clock), stage: "creating_text_container", channel: "threads" });
    try {
      containerId = await api.createTextContainer(session, currentJob.copy.primaryPost);
    } catch (error) {
      if (isAmbiguousError(error)) {
        const recovery = await attemptAmbiguousRecovery({ api, session, job: currentJob, jobPath, clock, phase: "TEXT container creation", containerId: null, error });
        keepLock = recovery.keepLock;
        return { status: recovery.recovered ? "published_recovered" : "blocked_ambiguous", lockRetained: keepLock };
      }
      await blockJob({ jobPath, job: currentJob, clock, status: "text_container_creation_failed", reason: "TEXT container creation failed without a retry.", error, commandRun: true });
      keepLock = true;
      return { status: "blocked_creation_failed", lockRetained: true };
    }

    await updateLock(lockPath, { jobId: currentJob.id, startedAt: nowIso(clock), stage: "publishing_text_container", containerId, channel: "threads" });
    let mediaId;
    try {
      mediaId = await api.publishContainer(session, containerId);
    } catch (error) {
      if (isAmbiguousError(error)) {
        const recovery = await attemptAmbiguousRecovery({ api, session, job: currentJob, jobPath, clock, phase: "TEXT container publish", containerId, error });
        keepLock = recovery.keepLock;
        return { status: recovery.recovered ? "published_recovered" : "blocked_ambiguous", lockRetained: keepLock };
      }
      await blockJob({ jobPath, job: currentJob, clock, status: "text_container_publish_failed", reason: "TEXT container publish failed without a retry.", error, commandRun: true });
      keepLock = true;
      return { status: "blocked_publish_failed", lockRetained: true };
    }

    await updateLock(lockPath, { jobId: currentJob.id, startedAt: nowIso(clock), stage: "official_post_publish_readback", containerId, mediaId, channel: "threads" });
    let readback;
    try {
      readback = await exactReadback({ api, session, mediaId, primaryPost: currentJob.copy.primaryPost });
    } catch (error) {
      const recovery = await attemptAmbiguousRecovery({ api, session, job: currentJob, jobPath, clock, phase: "post-publish readback", containerId, error });
      keepLock = recovery.keepLock;
      return { status: recovery.recovered ? "published_recovered" : "blocked_ambiguous", lockRetained: keepLock };
    }
    if (!readback.passed) {
      await blockJob({ jobPath, job: currentJob, clock, status: "post_publish_readback_not_exactly_once", reason: "Official post-readback did not produce exactly one media-id and normalized-full-text match.", readback, commandRun: true });
      keepLock = true;
      return { status: "blocked_readback", lockRetained: true };
    }
    await finalizePublished({ jobPath, job: currentJob, clock, containerId, readback });
    return { status: "published", mediaId, permalink: readback.permalink, lockRetained: false };
  } finally {
    if (!keepLock) await releaseLock(lockPath);
  }
}

async function runCli(args = process.argv.slice(2), dependencies = {}) {
  const options = parseArgs(args);
  if (options.help) return { help: true, text: usage() };
  const jobsDirectory = path.resolve(dependencies.jobsDirectory || THREADS_JOBS_DIR);
  const jobPath = resolveJobPath(options.job, jobsDirectory);
  const job = await readJson(jobPath, "Threads job");
  const validation = await validatePublishableJob(job, {
    jobsDirectory,
    jobPath,
    now: dependencies.clock ? dependencies.clock() : new Date(),
    recoveryProjectRoot: dependencies.recoveryProjectRoot || PROJECT_ROOT
  });
  if (!validation.passed) throw new Error(`Threads publish preflight blocked: ${validation.errors.join(", ")}.`);
  if (!options.publish) {
    return {
      status: "dry_run",
      job: safeRelative(jobPath),
      wouldCallThreadsApi: false,
      sessionRead: false,
      officialDuplicateCheck: "not_run_without_explicit_publish",
      postToThreadsCommandRun: false
    };
  }
  return publishThreadsJob({
    jobPath,
    jobsDirectory,
    lockDirectory: path.resolve(dependencies.lockDirectory || DEFAULT_LOCK_DIR),
    sessionPath: dependencies.sessionPath || DEFAULT_SESSION_PATH,
    session: dependencies.session,
    api: dependencies.api,
    clock: dependencies.clock,
    controlSnapshotLoader: dependencies.controlSnapshotLoader,
    sourceCarouselLoader: dependencies.sourceCarouselLoader,
    sourceCarouselRoot: dependencies.sourceCarouselRoot || path.join(path.resolve(jobsDirectory, "..", "..", ".."), "jobs"),
    recoveryProjectRoot: dependencies.recoveryProjectRoot || PROJECT_ROOT
  });
}

async function main() {
  try {
    if (process.env.LANGUAGE_CAFE_CLOUD === "1" && process.argv.includes("--publish")) {
      const options = parseArgs(process.argv.slice(2));
      const job = await readJson(path.resolve(PROJECT_ROOT, options.job), "Threads cloud job");
      require("../../cloud/gates.cjs").assertPermit(PROJECT_ROOT, job, "threads");
    }
    const result = await runCli();
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(safeErrorMessage(error));
    process.exitCode = 1;
  }
}

if (require.main === module) void main();

module.exports = {
  DEFAULT_LOCK_DIR,
  DEFAULT_SESSION_PATH,
  THREADS_API_BASE_URL,
  ThreadsApiError,
  acquireLock,
  compactHangul,
  createThreadsApi,
  exactReadback,
  findDuplicates,
  loadSession,
  lockPathFor,
  parseArgs,
  publishThreadsJob,
  readAndValidateBoundControl,
  readAndValidateSourceCarousel,
  runCli,
  safeErrorMessage,
  sessionValues,
  validatePublishableJob
};
