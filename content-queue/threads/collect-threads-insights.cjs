#!/usr/bin/env node
"use strict";

/*
 * Read-only Threads post-insights collector.
 *
 * No external request is made unless --checkpoint-hours is supplied and the
 * requested 24h/72h checkpoint is both due and not already recorded. The only
 * permitted mutation is an atomic update of the selected local Threads job.
 * This module cannot publish, reply, send a DM, or change a profile.
 */

const fs = require("node:fs/promises");
const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const THREADS_JOBS_DIR = path.join(__dirname, "jobs");
const THREADS_API_BASE_URL = "https://graph.threads.net/v1.0";
const DEFAULT_SESSION_PATH = "C:\\Users\\earth\\.codex\\threads\\session.json";
const DEFAULT_LOCK_DIR = path.join(__dirname, ".insights-locks");
const DEFAULT_EXPERIMENT_PATH = path.join(__dirname, "threads-exposure-experiment.json");
const EXPOSURE_EXPERIMENT_ID = "threads-exposure-v1-20260830";
const INSIGHT_METRICS = Object.freeze(["views", "likes", "replies", "reposts", "quotes", "shares"]);
const CHECKPOINT_POLICY = Object.freeze({
  24: Object.freeze({ key: "24h", minimumPostAgeHours: 23 }),
  72: Object.freeze({ key: "72h", minimumPostAgeHours: 71 })
});

class ThreadsInsightsError extends Error {
  constructor(message, { operation = "post-insights readback", status = null } = {}) {
    super(message);
    this.name = "ThreadsInsightsError";
    this.operation = operation;
    this.status = status;
  }
}

function usage() {
  return [
    "Usage:",
    "  node content-queue/threads/collect-threads-insights.cjs --job content-queue/threads/jobs/<published-job>.json",
    "  node content-queue/threads/collect-threads-insights.cjs --job content-queue/threads/jobs/<published-job>.json --checkpoint-hours 24",
    "  node content-queue/threads/collect-threads-insights.cjs --job content-queue/threads/jobs/<published-job>.json --checkpoint-hours 72",
    "",
    "Without --checkpoint-hours this is a local dry run. A due 24h or 72h request performs one read-only official API call and records one local checkpoint."
  ].join("\n");
}

function parseArgs(args) {
  const result = { job: "", checkpointHours: null, help: false };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
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
    if (value === "--checkpoint-hours") {
      const rawHours = args[index + 1];
      if (!rawHours || rawHours.startsWith("--")) throw new Error("--checkpoint-hours requires 24 or 72.");
      const checkpointHours = Number(rawHours);
      if (!Object.prototype.hasOwnProperty.call(CHECKPOINT_POLICY, checkpointHours)) {
        throw new Error("--checkpoint-hours must be either 24 or 72.");
      }
      result.checkpointHours = checkpointHours;
      index += 1;
      continue;
    }
    throw new Error(`Unsupported option: ${value}`);
  }
  if (!result.help && !result.job) throw new Error("--job is required.");
  return result;
}

function redactSecrets(value) {
  return String(value || "")
    .replace(/Bearer\s+[^\s,;"']+/giu, "Bearer [redacted]")
    .replace(/(?:access[_-]?token|threadsAccessToken|authorization|token)\s*(?:=|:)\s*["']?[^\s,;&"']+["']?/giu, "[redacted]")
    .replace(/([?&]access_token=)[^&\s]+/giu, "$1[redacted]");
}

function safeErrorMessage(error) {
  return redactSecrets(error?.message || "Unknown Threads insights error.");
}

function isInside(parent, target) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function safeRelative(filePath, root = PROJECT_ROOT) {
  const relative = path.relative(root, filePath);
  return relative && !relative.startsWith("..") ? relative.split(path.sep).join("/") : path.basename(filePath);
}

function resolveJobPath(value, jobsDirectory = THREADS_JOBS_DIR) {
  const target = path.isAbsolute(value) ? path.resolve(value) : path.resolve(PROJECT_ROOT, value);
  if (!isInside(jobsDirectory, target) || path.extname(target).toLowerCase() !== ".json") {
    throw new Error("--job must point to a JSON job inside content-queue/threads/jobs.");
  }
  return target;
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

function validDate(value, label) {
  const normalized = String(value || "").replace(/([+-]\d{2})(\d{2})$/u, "$1:$2");
  const date = new Date(normalized);
  if (!Number.isFinite(date.getTime())) throw new Error(`${label} is missing or invalid.`);
  return date;
}

function nowDate(clock = () => new Date()) {
  const value = clock();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error("Threads insights clock is invalid.");
  return value;
}

function formatKst(date) {
  return new Date(date.getTime() + (9 * 60 * 60 * 1000)).toISOString().replace(/Z$/u, "+09:00");
}

function publishedPost(job) {
  if (job?.channel !== "threads") throw new Error("The selected job is not a Threads job.");
  if (job?.workflow?.status !== "published") throw new Error("Threads insights require an officially published job.");
  const mediaId = String(job?.published?.mediaId || job?.published?.verification?.id || "").trim();
  if (!mediaId) throw new Error("Published Threads job is missing a media ID.");
  const publishedAtValue = job?.published?.verification?.timestamp || job?.published?.publishedAt;
  const publishedAt = validDate(publishedAtValue, "Published Threads timestamp");
  return { mediaId, publishedAt, publishedAtValue: publishedAt.toISOString() };
}

function checkpointState(job, checkpointHours, observedAt) {
  const policy = CHECKPOINT_POLICY[checkpointHours];
  if (!policy) throw new Error("Checkpoint hours must be either 24 or 72.");
  const post = publishedPost(job);
  const postAgeHoursRaw = (observedAt.getTime() - post.publishedAt.getTime()) / (60 * 60 * 1000);
  const postAgeHours = Number(postAgeHoursRaw.toFixed(3));
  const recorded = job?.measurement?.threadsInsights?.checkpoints?.[policy.key] || null;
  return {
    checkpointHours,
    checkpointKey: policy.key,
    minimumPostAgeHours: policy.minimumPostAgeHours,
    postAgeHours,
    due: !recorded && postAgeHoursRaw >= policy.minimumPostAgeHours,
    alreadyRecorded: Boolean(recorded),
    recorded,
    post
  };
}

function sessionValues(value, { clock = () => new Date() } = {}) {
  const accessToken = String(value?.accessToken || value?.access_token || value?.threadsAccessToken || "").trim();
  const userId = String(value?.userId || value?.user_id || value?.threadsUserId || "").trim();
  if (!accessToken || !userId) {
    throw new Error("Threads session is missing a user ID or access token. Complete account setup outside this collector.");
  }
  const expiresAt = String(value?.expiresAt || "").trim();
  const expiresAtMs = Date.parse(expiresAt);
  if (!expiresAt || !Number.isFinite(expiresAtMs)) {
    throw new Error("Threads session is missing a valid token expiry timestamp.");
  }
  if (expiresAtMs <= nowDate(clock).getTime()) throw new Error("Threads session token has expired.");
  const scopes = Array.isArray(value?.scopes)
    ? value.scopes.map((scope) => String(scope || "").trim()).filter(Boolean)
    : [];
  const missingScopes = ["threads_basic", "threads_manage_insights"].filter((scope) => !scopes.includes(scope));
  if (missingScopes.length) throw new Error(`Threads session is missing required scopes: ${missingScopes.join(", ")}.`);
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
    throw new ThreadsInsightsError("Threads API post-insights readback returned unreadable JSON.");
  }
}

function createThreadsInsightsApi({ fetchImpl = globalThis.fetch, baseUrl = THREADS_API_BASE_URL, timeoutMs = 20000 } = {}) {
  if (typeof fetchImpl !== "function") throw new Error("A Fetch implementation is required for Threads insights.");
  return {
    async getPostInsights(session, mediaId) {
      const url = new URL(`${baseUrl.replace(/\/$/u, "")}/${encodeURIComponent(mediaId)}/insights`);
      url.searchParams.set("metric", INSIGHT_METRICS.join(","));
      const controller = typeof AbortController === "undefined" ? null : new AbortController();
      const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
      let response;
      try {
        response = await fetchImpl(url, {
          method: "GET",
          headers: { authorization: `Bearer ${session.accessToken}` },
          signal: controller?.signal
        });
      } catch {
        throw new ThreadsInsightsError("Threads API post-insights readback did not return a reliable response.");
      } finally {
        if (timeout) clearTimeout(timeout);
      }
      if (!response?.ok) {
        throw new ThreadsInsightsError(
          `Threads API post-insights readback was not accepted${response?.status ? ` (HTTP ${response.status})` : ""}.`,
          { status: response?.status || null }
        );
      }
      const payload = await responsePayload(response);
      if (!Array.isArray(payload?.data)) {
        throw new ThreadsInsightsError("Threads API post-insights readback returned no metric list.");
      }
      return payload.data;
    }
  };
}

function extractedMetricValue(entry) {
  const candidates = [
    entry?.total_value?.value,
    Array.isArray(entry?.values) && entry.values.length ? entry.values[entry.values.length - 1]?.value : undefined,
    entry?.value
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
  }
  return null;
}

function normalizedMetrics(insights) {
  const byName = new Map();
  for (const entry of Array.isArray(insights) ? insights : []) {
    const name = String(entry?.name || "").trim().toLowerCase();
    if (INSIGHT_METRICS.includes(name) && !byName.has(name)) byName.set(name, entry);
  }
  return Object.fromEntries(INSIGHT_METRICS.map((name) => {
    const entry = byName.get(name);
    const value = extractedMetricValue(entry);
    if (value === null) {
      return [name, {
        value: null,
        status: "unavailable",
        source: "official_graph_threads_post_insights",
        availabilityReason: entry ? "api_returned_null_or_non_numeric" : "metric_not_returned"
      }];
    }
    return [name, {
      value,
      status: "observed",
      source: "official_graph_threads_post_insights",
      availabilityReason: null
    }];
  }));
}

function checkpointRecord({ state, observedAt, metrics }) {
  return {
    checkpointHours: state.checkpointHours,
    status: "observed",
    source: "official_graph_threads_post_insights",
    observedAtUtc: observedAt.toISOString(),
    observedAtKst: formatKst(observedAt),
    postPublishedAt: state.post.publishedAtValue,
    postAgeHours: state.postAgeHours,
    dueMinimumPostAgeHours: state.minimumPostAgeHours,
    mediaId: state.post.mediaId,
    requestedMetrics: [...INSIGHT_METRICS],
    metrics,
    externalActions: {
      publishAttempted: false,
      replyAttempted: false,
      directMessageAttempted: false,
      profileChangeAttempted: false,
      instagramOrReelActionAttempted: false
    }
  };
}

function applyCheckpoint(job, state, record) {
  const currentMeasurement = job.measurement && typeof job.measurement === "object" ? job.measurement : {};
  const currentInsights = currentMeasurement.threadsInsights && typeof currentMeasurement.threadsInsights === "object"
    ? currentMeasurement.threadsInsights
    : {};
  const checkpoints = currentInsights.checkpoints && typeof currentInsights.checkpoints === "object"
    ? currentInsights.checkpoints
    : {};
  job.measurement = {
    ...currentMeasurement,
    metrics: {
      ...(currentMeasurement.metrics || {}),
      ...Object.fromEntries(Object.entries(record.metrics).map(([name, metric]) => [name, {
        ...metric,
        observedAtKst: record.observedAtKst,
        checkpointHours: state.checkpointHours
      }]))
    },
    threadsInsightsEvidenceStatus: Object.values(record.metrics).some((metric) => metric.status === "observed")
      ? "official_observation_available"
      : "unavailable",
    threadsInsights: {
      ...currentInsights,
      schemaVersion: 1,
      source: "official_graph_threads_post_insights",
      readOnlyApi: true,
      checkpointPolicy: {
        "24h": { targetHours: 24, minimumPostAgeHours: 23 },
        "72h": { targetHours: 72, minimumPostAgeHours: 71 }
      },
      checkpoints: {
        ...checkpoints,
        [state.checkpointKey]: record
      },
      latestCheckpoint: state.checkpointKey,
      latestObservedAtKst: record.observedAtKst,
      latestMetrics: record.metrics
    }
  };
  return job;
}

function officialExperimentCandidate(job) {
  if (job?.copy?.experiment?.id !== EXPOSURE_EXPERIMENT_ID) return null;
  const expressionId = String(job?.source?.expressionId || "").padStart(3, "0");
  if (expressionId === "036") return null;
  if (job?.channel !== "threads" || job?.workflow?.status !== "published") return null;
  const mediaId = String(job?.published?.mediaId || "").trim();
  const verification = job?.published?.verification;
  if (!mediaId
      || String(verification?.id || "") !== mediaId
      || verification?.review !== "passed"
      || verification?.mediaIdMatchCount !== 1
      || verification?.normalizedFullTextMatchCount !== 1
      || !verification?.permalink) {
    return null;
  }
  let publishedAt;
  try {
    publishedAt = validDate(verification.timestamp || job?.published?.publishedAt, "Published Threads timestamp");
  } catch {
    return null;
  }
  return {
    jobId: String(job?.id || "").trim(),
    expressionId,
    expression: String(job?.source?.expression || "").trim() || null,
    variant: String(job?.copy?.experiment?.variant || "scene_first_question"),
    mediaId,
    permalink: verification.permalink,
    publishedAt: publishedAt.toISOString(),
    sourceCarouselJobId: job?.source?.sourceCarouselJobId || null
  };
}

function cohortEntryId(entry) {
  if (typeof entry === "string") return entry;
  return String(entry?.jobId || entry?.id || entry?.threadsJobId || "").trim();
}

async function retiredExperimentCheckpointAccess(job, experimentPath = DEFAULT_EXPERIMENT_PATH) {
  if (job?.copy?.experiment?.id !== EXPOSURE_EXPERIMENT_ID) {
    return { restricted: false, enrolled: false };
  }
  const experiment = await readJson(experimentPath, "Threads exposure experiment");
  if (experiment?.id !== EXPOSURE_EXPERIMENT_ID) {
    throw new Error(`Threads exposure experiment ID must be ${EXPOSURE_EXPERIMENT_ID}.`);
  }
  const retired = /^retired(?:_|$)/iu.test(String(experiment?.status || ""));
  const restricted = retired
    || experiment?.newEnrollmentAllowed === false
    || experiment?.scope?.newEnrollmentAllowed === false;
  const cohortJobs = Array.isArray(experiment?.scope?.cohortJobs) ? experiment.scope.cohortJobs : [];
  const enrolled = cohortJobs.some((entry) => cohortEntryId(entry) === String(job?.id || ""));
  return { restricted, enrolled };
}

async function enrollPublishedExperimentJobs({
  jobsDirectory = THREADS_JOBS_DIR,
  experimentPath = DEFAULT_EXPERIMENT_PATH,
  lockDirectory = DEFAULT_LOCK_DIR,
  clock = () => new Date()
} = {}) {
  const enrollmentLock = path.join(lockDirectory, `${EXPOSURE_EXPERIMENT_ID}-enrollment.json`);
  try {
    await acquireLock(enrollmentLock, {
      experimentId: EXPOSURE_EXPERIMENT_ID,
      startedAtUtc: nowDate(clock).toISOString(),
      operation: "local_published_job_enrollment"
    });
  } catch (error) {
    if (/already being collected/iu.test(String(error?.message || ""))) {
      return { status: "enrollment_locked", enrolled: [], experimentWritten: false };
    }
    throw error;
  }
  try {
    const experiment = await readJson(experimentPath, "Threads exposure experiment");
    if (experiment?.id !== EXPOSURE_EXPERIMENT_ID) {
      throw new Error(`Threads exposure experiment ID must be ${EXPOSURE_EXPERIMENT_ID}.`);
    }
    const existingEntries = Array.isArray(experiment?.scope?.cohortJobs)
      ? experiment.scope.cohortJobs
      : [];
    const retired = /^retired(?:_|$)/iu.test(String(experiment?.status || ""));
    if (retired || experiment?.newEnrollmentAllowed === false || experiment?.scope?.newEnrollmentAllowed === false) {
      return {
        status: "retired_no_new_enrollment",
        enrolled: [],
        experimentWritten: false,
        cohortSize: existingEntries.length
      };
    }
    const maximumPosts = Math.min(3, Number(experiment?.scope?.maximumPosts) || 3);
    if (existingEntries.length >= maximumPosts) {
      return { status: "cohort_full", enrolled: [], experimentWritten: false, cohortSize: existingEntries.length };
    }
    let directoryEntries;
    try {
      directoryEntries = await fs.readdir(jobsDirectory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return { status: "jobs_unavailable", enrolled: [], experimentWritten: false };
      throw error;
    }
    const candidates = [];
    for (const entry of directoryEntries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      let job;
      try {
        job = await readJson(path.join(jobsDirectory, entry.name), "Threads experiment candidate");
      } catch {
        continue;
      }
      const candidate = officialExperimentCandidate(job);
      if (candidate?.jobId) candidates.push(candidate);
    }
    candidates.sort((left, right) => left.publishedAt.localeCompare(right.publishedAt) || left.jobId.localeCompare(right.jobId));
    const knownIds = new Set(existingEntries.map(cohortEntryId).filter(Boolean));
    const remaining = Math.max(0, maximumPosts - existingEntries.length);
    const observedAt = nowDate(clock);
    const additions = [];
    for (const candidate of candidates) {
      if (additions.length >= remaining) break;
      if (knownIds.has(candidate.jobId)) continue;
      knownIds.add(candidate.jobId);
      additions.push({
        ...candidate,
        experimentId: EXPOSURE_EXPERIMENT_ID,
        enrolledAtKst: formatKst(observedAt),
        eligibility: "official_publish_receipt_exactly_once",
        checkpoints: { "24h": "pending", "72h": "pending" }
      });
    }
    if (!additions.length) {
      return {
        status: existingEntries.length >= maximumPosts ? "cohort_full" : "no_new_eligible_jobs",
        enrolled: [],
        experimentWritten: false,
        cohortSize: existingEntries.length
      };
    }
    experiment.scope = {
      ...(experiment.scope || {}),
      cohortJobs: [...existingEntries, ...additions]
    };
    await writeJsonAtomic(experimentPath, experiment);
    return {
      status: "enrolled",
      enrolled: additions.map((entry) => entry.jobId),
      experimentWritten: true,
      cohortSize: existingEntries.length + additions.length
    };
  } finally {
    await releaseLock(enrollmentLock);
  }
}

function checkpointMetricsSummary(record) {
  const metrics = record?.metrics && typeof record.metrics === "object" ? record.metrics : {};
  return Object.fromEntries(INSIGHT_METRICS.map((name) => {
    const metric = metrics[name];
    if (metric?.status === "observed" && typeof metric.value === "number" && Number.isFinite(metric.value)) {
      return [name, { value: metric.value, status: "observed" }];
    }
    return [name, { value: null, status: "unavailable" }];
  }));
}

function isObservedCheckpoint(value) {
  return Boolean(value && typeof value === "object" && value.status === "observed");
}

async function synchronizeExperimentCheckpoint({
  job,
  checkpointHours,
  experimentPath = DEFAULT_EXPERIMENT_PATH,
  lockDirectory = DEFAULT_LOCK_DIR,
  clock = () => new Date()
} = {}) {
  const policy = CHECKPOINT_POLICY[checkpointHours];
  if (!policy) throw new Error("Checkpoint hours must be either 24 or 72.");
  if (job?.copy?.experiment?.id !== EXPOSURE_EXPERIMENT_ID
      || String(job?.source?.expressionId || "").padStart(3, "0") === "036") {
    return { status: "not_experiment_job", experimentWritten: false };
  }
  const jobCheckpoint = job?.measurement?.threadsInsights?.checkpoints?.[policy.key];
  if (!isObservedCheckpoint(jobCheckpoint)) {
    return { status: "job_checkpoint_not_observed", experimentWritten: false };
  }
  const synchronizationLock = path.join(lockDirectory, `${EXPOSURE_EXPERIMENT_ID}-enrollment.json`);
  try {
    await acquireLock(synchronizationLock, {
      experimentId: EXPOSURE_EXPERIMENT_ID,
      jobId: job?.id || null,
      checkpoint: policy.key,
      startedAtUtc: nowDate(clock).toISOString(),
      operation: "local_experiment_checkpoint_synchronization"
    });
  } catch (error) {
    if (/already being collected/iu.test(String(error?.message || ""))) {
      return { status: "experiment_locked", experimentWritten: false };
    }
    throw error;
  }
  try {
    const experiment = await readJson(experimentPath, "Threads exposure experiment");
    if (experiment?.id !== EXPOSURE_EXPERIMENT_ID) {
      throw new Error(`Threads exposure experiment ID must be ${EXPOSURE_EXPERIMENT_ID}.`);
    }
    const cohortJobs = Array.isArray(experiment?.scope?.cohortJobs) ? experiment.scope.cohortJobs : [];
    const index = cohortJobs.findIndex((entry) => cohortEntryId(entry) === String(job?.id || ""));
    if (index < 0) return { status: "job_not_enrolled", experimentWritten: false };
    const existingEntry = cohortJobs[index];
    if (!existingEntry || typeof existingEntry !== "object") {
      return { status: "cohort_entry_not_structured", experimentWritten: false };
    }
    const existingCheckpoint = existingEntry?.checkpoints?.[policy.key];
    let checkpointChanged = false;
    let nextEntry = existingEntry;
    if (!isObservedCheckpoint(existingCheckpoint)) {
      const metrics = checkpointMetricsSummary(jobCheckpoint);
      nextEntry = {
        ...existingEntry,
        checkpoints: {
          ...(existingEntry.checkpoints || {}),
          [policy.key]: {
            status: "observed",
            jobCheckpointReference: `measurement.threadsInsights.checkpoints.${policy.key}`,
            observedAtKst: jobCheckpoint.observedAtKst || null,
            postAgeHours: typeof jobCheckpoint.postAgeHours === "number" ? jobCheckpoint.postAgeHours : null,
            metrics
          }
        }
      };
      checkpointChanged = true;
    }
    const nextCohortJobs = checkpointChanged
      ? cohortJobs.map((entry, entryIndex) => entryIndex === index ? nextEntry : entry)
      : cohortJobs;
    const allThreeHave72h = nextCohortJobs.length === 3
      && nextCohortJobs.every((entry) => isObservedCheckpoint(entry?.checkpoints?.["72h"]));
    const statusChanged = allThreeHave72h && experiment.status === "active";
    if (!checkpointChanged && !statusChanged) {
      return {
        status: "already_synchronized",
        checkpoint: policy.key,
        experimentWritten: false,
        experimentStatus: experiment.status
      };
    }
    experiment.scope = {
      ...(experiment.scope || {}),
      cohortJobs: nextCohortJobs
    };
    if (statusChanged) {
      experiment.status = "awaiting_evaluation";
      experiment.awaitingEvaluationAtKst = formatKst(nowDate(clock));
      experiment.awaitingEvaluationReason = "Exactly three enrolled cohort jobs each have an observed 72h official Threads checkpoint.";
    }
    await writeJsonAtomic(experimentPath, experiment);
    return {
      status: statusChanged ? "synchronized_awaiting_evaluation" : "synchronized",
      checkpoint: policy.key,
      experimentWritten: true,
      experimentStatus: experiment.status
    };
  } finally {
    await releaseLock(synchronizationLock);
  }
}

function lockPathFor(lockDirectory, jobId, checkpointKey) {
  const safeId = String(jobId || "unknown").replace(/[^a-z0-9._-]/giu, "-");
  return path.join(lockDirectory, `${safeId}-${checkpointKey}.json`);
}

async function acquireLock(lockPath, details) {
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  let handle;
  try {
    handle = await fs.open(lockPath, "wx");
    await handle.writeFile(`${JSON.stringify(details, null, 2)}\n`, "utf8");
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error("Threads insights checkpoint is already being collected; no duplicate request was made.");
    throw error;
  } finally {
    await handle?.close();
  }
}

async function releaseLock(lockPath) {
  await fs.unlink(lockPath).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
}

async function collectCheckpoint({
  jobPath,
  checkpointHours,
  sessionPath = DEFAULT_SESSION_PATH,
  session: injectedSession,
  api: injectedApi,
  lockDirectory = DEFAULT_LOCK_DIR,
  jobsDirectory = THREADS_JOBS_DIR,
  experimentPath = DEFAULT_EXPERIMENT_PATH,
  clock = () => new Date()
}) {
  const initialObservedAt = nowDate(clock);
  const initialJob = await readJson(jobPath, "Threads job");
  const initialState = checkpointState(initialJob, checkpointHours, initialObservedAt);
  if (initialState.alreadyRecorded) {
    const experimentEnrollment = await enrollPublishedExperimentJobs({
      jobsDirectory,
      experimentPath,
      lockDirectory,
      clock: () => initialObservedAt
    });
    const experimentSynchronization = await synchronizeExperimentCheckpoint({
      job: initialJob,
      checkpointHours,
      experimentPath,
      lockDirectory,
      clock: () => initialObservedAt
    });
    return {
      status: "already_recorded",
      checkpoint: initialState.checkpointKey,
      checkpointHours,
      postAgeHours: initialState.postAgeHours,
      observedAtKst: initialState.recorded?.observedAtKst || null,
      wouldCallThreadsApi: false,
      jobWritten: false,
      experimentEnrollment,
      experimentSynchronization
    };
  }
  if (!initialState.due) {
    return {
      status: "not_due",
      checkpoint: initialState.checkpointKey,
      checkpointHours,
      minimumPostAgeHours: initialState.minimumPostAgeHours,
      postAgeHours: initialState.postAgeHours,
      wouldCallThreadsApi: false,
      sessionRead: false,
      jobWritten: false
    };
  }

  const initialExperimentAccess = await retiredExperimentCheckpointAccess(initialJob, experimentPath);
  if (initialExperimentAccess.restricted && !initialExperimentAccess.enrolled) {
    return {
      status: "retired_experiment_job_not_enrolled",
      checkpoint: initialState.checkpointKey,
      checkpointHours,
      postAgeHours: initialState.postAgeHours,
      wouldCallThreadsApi: false,
      sessionRead: false,
      jobWritten: false,
      experimentWritten: false
    };
  }

  const jobId = String(initialJob?.id || path.basename(jobPath, ".json"));
  const lockPath = lockPathFor(lockDirectory, jobId, initialState.checkpointKey);
  await acquireLock(lockPath, {
    jobId,
    checkpoint: initialState.checkpointKey,
    startedAtUtc: initialObservedAt.toISOString(),
    operation: "read_only_threads_post_insights"
  });
  try {
    const observedAt = nowDate(clock);
    const job = await readJson(jobPath, "Threads job");
    const state = checkpointState(job, checkpointHours, observedAt);
    if (state.alreadyRecorded) {
      const experimentEnrollment = await enrollPublishedExperimentJobs({
        jobsDirectory,
        experimentPath,
        lockDirectory,
        clock: () => observedAt
      });
      const experimentSynchronization = await synchronizeExperimentCheckpoint({
        job,
        checkpointHours,
        experimentPath,
        lockDirectory,
        clock: () => observedAt
      });
      return {
        status: "already_recorded",
        checkpoint: state.checkpointKey,
        checkpointHours,
        postAgeHours: state.postAgeHours,
        observedAtKst: state.recorded?.observedAtKst || null,
        wouldCallThreadsApi: false,
        jobWritten: false,
        experimentEnrollment,
        experimentSynchronization
      };
    }
    if (!state.due) {
      return {
        status: "not_due",
        checkpoint: state.checkpointKey,
        checkpointHours,
        minimumPostAgeHours: state.minimumPostAgeHours,
        postAgeHours: state.postAgeHours,
        wouldCallThreadsApi: false,
        sessionRead: false,
        jobWritten: false
      };
    }
    const currentExperimentAccess = await retiredExperimentCheckpointAccess(job, experimentPath);
    if (currentExperimentAccess.restricted && !currentExperimentAccess.enrolled) {
      return {
        status: "retired_experiment_job_not_enrolled",
        checkpoint: state.checkpointKey,
        checkpointHours,
        postAgeHours: state.postAgeHours,
        wouldCallThreadsApi: false,
        sessionRead: false,
        jobWritten: false,
        experimentWritten: false
      };
    }
    const experimentEnrollment = await enrollPublishedExperimentJobs({
      jobsDirectory,
      experimentPath,
      lockDirectory,
      clock: () => observedAt
    });
    const session = injectedSession
      ? sessionValues(injectedSession, { clock: () => observedAt })
      : await loadSession(sessionPath, { clock: () => observedAt });
    const api = injectedApi || createThreadsInsightsApi();
    const insights = await api.getPostInsights(session, state.post.mediaId);
    const metrics = normalizedMetrics(insights);
    const record = checkpointRecord({ state, observedAt, metrics });
    applyCheckpoint(job, state, record);
    await writeJsonAtomic(jobPath, job);
    const experimentSynchronization = await synchronizeExperimentCheckpoint({
      job,
      checkpointHours,
      experimentPath,
      lockDirectory,
      clock: () => observedAt
    });
    return {
      status: "recorded",
      checkpoint: state.checkpointKey,
      checkpointHours,
      observedAtKst: record.observedAtKst,
      postAgeHours: record.postAgeHours,
      metrics,
      officialApiReadOnly: true,
      sessionRead: true,
      wouldCallThreadsApi: true,
      jobWritten: true,
      experimentEnrollment,
      experimentSynchronization,
      externalActions: record.externalActions
    };
  } finally {
    await releaseLock(lockPath);
  }
}

async function runCli(args = process.argv.slice(2), dependencies = {}) {
  const options = parseArgs(args);
  if (options.help) return { help: true, text: usage() };
  const jobsDirectory = path.resolve(dependencies.jobsDirectory || THREADS_JOBS_DIR);
  const jobPath = resolveJobPath(options.job, jobsDirectory);
  const observedAt = nowDate(dependencies.clock || (() => new Date()));
  const job = await readJson(jobPath, "Threads job");
  const post = publishedPost(job);
  if (options.checkpointHours === null) {
    return {
      status: "dry_run",
      job: safeRelative(jobPath),
      mediaId: post.mediaId,
      observedAtKst: formatKst(observedAt),
      availableCheckpoints: Object.values(CHECKPOINT_POLICY).map((policy) => ({
        checkpoint: policy.key,
        minimumPostAgeHours: policy.minimumPostAgeHours
      })),
      wouldCallThreadsApi: false,
      sessionRead: false,
      jobWritten: false,
      publishReplyDmOrProfileActionAttempted: false
    };
  }
  return collectCheckpoint({
    jobPath,
    checkpointHours: options.checkpointHours,
    sessionPath: dependencies.sessionPath || DEFAULT_SESSION_PATH,
    session: dependencies.session,
    api: dependencies.api,
    lockDirectory: path.resolve(dependencies.lockDirectory || DEFAULT_LOCK_DIR),
    jobsDirectory,
    experimentPath: path.resolve(dependencies.experimentPath || DEFAULT_EXPERIMENT_PATH),
    clock: dependencies.clock || (() => new Date())
  });
}

async function main() {
  try {
    const result = await runCli();
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(safeErrorMessage(error));
    process.exitCode = 1;
  }
}

if (require.main === module) void main();

module.exports = {
  CHECKPOINT_POLICY,
  DEFAULT_EXPERIMENT_PATH,
  DEFAULT_LOCK_DIR,
  DEFAULT_SESSION_PATH,
  INSIGHT_METRICS,
  THREADS_API_BASE_URL,
  EXPOSURE_EXPERIMENT_ID,
  ThreadsInsightsError,
  applyCheckpoint,
  checkpointState,
  checkpointMetricsSummary,
  collectCheckpoint,
  createThreadsInsightsApi,
  enrollPublishedExperimentJobs,
  extractedMetricValue,
  formatKst,
  loadSession,
  normalizedMetrics,
  officialExperimentCandidate,
  parseArgs,
  publishedPost,
  redactSecrets,
  retiredExperimentCheckpointAccess,
  runCli,
  safeErrorMessage,
  sessionValues,
  synchronizeExperimentCheckpoint
};
