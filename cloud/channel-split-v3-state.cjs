"use strict";

// Pure state transitions for a future trusted cloud publisher. The caller must
// commit and independently read back every returned ledger before acting on an
// intent. This module has no filesystem, credential, network, or publish access.
const crypto = require("node:crypto");

const STRATEGY = "channel-split-v3";
const CHANNELS = ["instagram", "threads"];
const HEX = /^[a-f0-9]{64}$/u;
const GIT_SHA = /^[a-f0-9]{40,64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{2,119}$/u;
const ACTION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,180}$/u;
const ACCOUNT_ID = /^[0-9]{5,30}$/u;
const REVIEWER = "independent_editorial_controller_v1";
const MAX_PERMIT_MS = 30 * 60 * 1000;
const READBACK_MAX_AGE_MS = 5 * 60 * 1000;
const CLOCK_SKEW_MS = 30 * 1000;

function fail(code) { throw new Error(`v3_state_${code}`); }
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function assertJson(value, seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (typeof value !== "object" || seen.has(value)) fail("non_json_input");
  seen.add(value);
  if (!Array.isArray(value) && !isRecord(value)) fail("non_json_input");
  for (const [key, item] of Object.entries(value)) {
    if (["__proto__", "constructor", "prototype"].includes(key)) fail("unsafe_json_key");
    assertJson(item, seen);
  }
  seen.delete(value);
}
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function sha(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function digest(value) { assertJson(value); return sha(stable(value)); }
function clone(value) { assertJson(value); return JSON.parse(JSON.stringify(value)); }
function dateMs(value) {
  if (typeof value !== "string" || !/(?:Z|[+-]\d\d:?\d\d)$/iu.test(value)) return NaN;
  return Date.parse(value);
}
function time(value) {
  const ms = dateMs(value);
  if (!Number.isFinite(ms)) fail("time_invalid");
  return ms;
}
function assertSha(value, label = "remote_sha_invalid") { if (!GIT_SHA.test(value || "")) fail(label); }
function initialV3() {
  return { schemaVersion: 1, strategyVersion: STRATEGY,
    locks: { instagram: null, threads: null }, actions: [], receipts: [], audit: [] };
}
function stateDigest(v3) { return digest({ locks: v3.locks, actions: v3.actions, receipts: v3.receipts }); }
function auditHash(entry) {
  const { hash, ...unsigned } = entry;
  return digest(unsigned);
}
function numericId(value) { return typeof value === "string" && /^[0-9]+$/u.test(value); }
function validInstagramLock(lock) {
  if (!Number.isInteger(lock.createAttempts) || !Number.isInteger(lock.publishAttempts)
    || lock.createAttempts < 0 || lock.createAttempts > 1 || lock.publishAttempts < 0 || lock.publishAttempts > 1
    || !["claimed", "create_attempted", "container_created", "publish_attempted", "ambiguous"].includes(lock.stage)
    || (lock.containerId !== null && !numericId(lock.containerId))) return false;
  if (lock.stage === "claimed") return lock.createAttempts === 0 && lock.publishAttempts === 0 && lock.containerId === null;
  if (lock.stage === "create_attempted") return lock.createAttempts === 1 && lock.publishAttempts === 0 && lock.containerId === null;
  if (lock.stage === "container_created") return lock.createAttempts === 1 && lock.publishAttempts === 0 && numericId(lock.containerId);
  if (lock.stage === "publish_attempted") return lock.createAttempts === 1 && lock.publishAttempts === 1 && numericId(lock.containerId);
  return lock.createAttempts === 1 && ((lock.ambiguousFrom === "create_attempted"
    && lock.publishAttempts === 0 && lock.containerId === null)
    || (lock.ambiguousFrom === "publish_attempted" && lock.publishAttempts === 1 && numericId(lock.containerId)));
}
function validThreadsLock(lock, cardCount) {
  const childIds = lock.childContainerIds;
  if (!Array.isArray(childIds) || childIds.length > cardCount || !childIds.every(numericId)
    || new Set(childIds).size !== childIds.length
    || !Number.isInteger(lock.createAttempts) || lock.createAttempts < 0 || lock.createAttempts > cardCount + 1
    || !Number.isInteger(lock.publishAttempts) || lock.publishAttempts < 0 || lock.publishAttempts > 1
    || (lock.containerId !== null && (!numericId(lock.containerId) || childIds.includes(lock.containerId)))) return false;
  const stage = lock.stage === "ambiguous" ? lock.ambiguousFrom : lock.stage;
  if (lock.stage === "ambiguous" && !["child_create_attempted", "parent_create_attempted", "publish_attempted"].includes(stage)) return false;
  if (lock.stage !== "ambiguous" && lock.ambiguousFrom !== undefined) return false;
  if (stage === "claimed") return childIds.length === 0 && lock.createAttempts === 0
    && lock.publishAttempts === 0 && lock.containerId === null && lock.pendingChildIndex === undefined;
  if (stage === "child_create_attempted") return Number.isInteger(lock.pendingChildIndex)
    && lock.pendingChildIndex === childIds.length && childIds.length < cardCount
    && lock.createAttempts === childIds.length + 1 && lock.publishAttempts === 0 && lock.containerId === null;
  if (stage === "child_container_created") return childIds.length > 0 && lock.createAttempts === childIds.length
    && lock.publishAttempts === 0 && lock.containerId === null && lock.pendingChildIndex === undefined;
  if (stage === "parent_create_attempted") return childIds.length === cardCount
    && lock.createAttempts === cardCount + 1 && lock.publishAttempts === 0
    && lock.containerId === null && lock.pendingChildIndex === undefined;
  if (stage === "container_created") return childIds.length === cardCount
    && lock.createAttempts === cardCount + 1 && lock.publishAttempts === 0
    && numericId(lock.containerId) && lock.pendingChildIndex === undefined;
  if (stage === "publish_attempted") return childIds.length === cardCount
    && lock.createAttempts === cardCount + 1 && lock.publishAttempts === 1
    && numericId(lock.containerId) && lock.pendingChildIndex === undefined;
  return false;
}
function validateV3(v3) {
  if (!isRecord(v3) || v3.schemaVersion !== 1 || v3.strategyVersion !== STRATEGY
    || !isRecord(v3.locks) || !CHANNELS.every(channel => Object.hasOwn(v3.locks, channel))
    || Object.keys(v3.locks).length !== 2 || !Array.isArray(v3.actions)
    || !Array.isArray(v3.receipts) || !Array.isArray(v3.audit)) fail("schema_invalid");
  const actionIds = new Set(), jobIds = new Set(), mediaIds = { instagram: new Set(), threads: new Set() };
  for (const action of v3.actions) {
    if (!isRecord(action) || !ACTION_ID.test(action.actionId || "") || !CHANNELS.includes(action.channel)
      || action.schemaVersion !== 1 || action.strategyVersion !== STRATEGY
      || action.action !== (action.channel === "instagram" ? "publish_one_instagram_promo" : "publish_one_threads_carousel")
      || !ID.test(action.jobId || "")
      || action.jobPath !== `content-queue/${action.channel === "instagram" ? "instagram-promo" : "threads"}/jobs/${action.jobId}.json`
      || !ACCOUNT_ID.test(action.accountId || "") || !/^[0-9]+$/u.test(action.runId || "")
      || !/^[1-9][0-9]*$/u.test(action.runAttempt || "") || !GIT_SHA.test(action.originStateSha || "")
      || !Number.isFinite(dateMs(action.issuedAt)) || !Number.isFinite(dateMs(action.validUntil))
      || dateMs(action.validUntil) < dateMs(action.issuedAt)
      || dateMs(action.validUntil) - dateMs(action.issuedAt) > MAX_PERMIT_MS
      || !HEX.test(action.jobSha256 || "")
      || !HEX.test(action.grantSha256 || "") || action.reviewer !== REVIEWER
      || !HEX.test(action.contentSha256 || "") || !HEX.test(action.claimHash || "")
      || !HEX.test(action.copySha256 || "")
      || !Array.isArray(action.assets) || action.assets.length < (action.channel === "instagram" ? 1 : 2)
      || action.assets.length > (action.channel === "instagram" ? 1 : 8) || !action.assets.every(asset => isRecord(asset)
        && typeof asset.url === "string" && asset.url.startsWith("https://") && HEX.test(asset.sha256 || "")
        && (action.channel === "instagram" || (typeof asset.altText === "string" && asset.altText.trim() === asset.altText
          && asset.altText.length > 0 && Array.from(asset.altText).length <= 1000)))
      || (action.channel === "threads" && new Set(action.assets.map(asset => asset.altText)).size !== action.assets.length)) fail("action_invalid");
    const { claimHash, ...unsigned } = action;
    if (digest(unsigned) !== claimHash || actionIds.has(action.actionId) || jobIds.has(action.jobId)) fail("action_tampered_or_replayed");
    actionIds.add(action.actionId); jobIds.add(action.jobId);
  }
  for (const channel of CHANNELS) {
    const lock = v3.locks[channel];
    if (lock === null) continue;
    const action = v3.actions.find(item => item.actionId === lock?.actionId);
    if (!isRecord(lock) || !action || action.channel !== channel || lock.claimHash !== action.claimHash
      || !(channel === "instagram" ? validInstagramLock(lock) : validThreadsLock(lock, action.assets.length))) {
      fail("lock_invalid_or_tampered");
    }
  }
  for (const receipt of v3.receipts) {
    const action = v3.actions.find(item => item.actionId === receipt?.actionId);
    if (!isRecord(receipt) || !action || receipt.strategyVersion !== STRATEGY
      || receipt.channel !== action.channel || receipt.jobId !== action.jobId
      || receipt.grantSha256 !== action.grantSha256 || receipt.reviewer !== action.reviewer
      || receipt.claimHash !== action.claimHash || receipt.status !== "published_verified"
      || !/^[0-9]+$/u.test(receipt.mediaId || "") || typeof receipt.permalink !== "string"
      || mediaIds[receipt.channel].has(receipt.mediaId)) fail("receipt_invalid_or_duplicate");
    mediaIds[receipt.channel].add(receipt.mediaId);
  }
  for (const action of v3.actions) {
    const locked = v3.locks[action.channel]?.actionId === action.actionId;
    const completed = v3.receipts.some(receipt => receipt.actionId === action.actionId);
    if (locked === completed) fail("action_missing_or_double_terminal_state");
  }
  let previousHash = null;
  for (let index = 0; index < v3.audit.length; index += 1) {
    const entry = v3.audit[index];
    if (!isRecord(entry) || entry.sequence !== index + 1 || entry.previousHash !== previousHash
      || !HEX.test(entry.stateHash || "") || entry.hash !== auditHash(entry)) fail("audit_tampered");
    previousHash = entry.hash;
  }
  if (v3.audit.length === 0) {
    if (v3.actions.length || v3.receipts.length || CHANNELS.some(channel => v3.locks[channel] !== null)) fail("audit_missing");
  } else if (v3.audit.at(-1).stateHash !== stateDigest(v3)) fail("audit_state_mismatch");
  return v3;
}
function checkedLedger(ledger, { requireGlobalClear = true } = {}) {
  assertJson(ledger);
  if (!isRecord(ledger) || (ledger.version !== 1 && ledger.schemaVersion !== 1)
    || !Array.isArray(ledger.actions) || !Object.hasOwn(ledger, "lock")) fail("v2_ledger_invalid");
  if (requireGlobalClear && ledger.lock !== null) fail("v2_global_lock_unresolved");
  return validateV3(ledger.channelSplitV3 === undefined ? initialV3() : ledger.channelSplitV3);
}
function appendAudit(v3, event, at) {
  time(at);
  const previousHash = v3.audit.at(-1)?.hash || null;
  const entry = { sequence: v3.audit.length + 1, previousHash, at, ...event, stateHash: stateDigest(v3) };
  entry.hash = auditHash(entry);
  v3.audit.push(entry);
  validateV3(v3);
}
function withV3(ledger, update) {
  const next = clone(ledger);
  next.channelSplitV3 = next.channelSplitV3 || initialV3();
  update(next.channelSplitV3);
  validateV3(next.channelSplitV3);
  return next;
}
function jobFromBytes(jobBytes) {
  if (!(Buffer.isBuffer(jobBytes) || typeof jobBytes === "string")) fail("job_bytes_required");
  const bytes = Buffer.isBuffer(jobBytes) ? jobBytes : Buffer.from(jobBytes, "utf8");
  if (!bytes.length || bytes.length > 1024 * 1024) fail("job_bytes_invalid");
  let job;
  try { job = JSON.parse(bytes.toString("utf8")); } catch { fail("job_json_invalid"); }
  assertJson(job);
  if (!isRecord(job) || job.schemaVersion !== 1 || job.strategyVersion !== STRATEGY
    || !CHANNELS.includes(job.channel) || !ID.test(job.id || "")
    || job.workflow?.status !== "approved" || job.published || job.workflow?.postPublishVerification
    || !isRecord(job.content) || typeof (job.channel === "instagram" ? job.content.caption : job.content.text) !== "string"
    || !(job.channel === "instagram" ? job.content.caption : job.content.text).trim()) fail("job_not_approved_or_invalid");
  return { bytes, job };
}
function jobAssetList(job) {
  const images = job.channel === "instagram" ? [job.content.image] : job.content.images;
  if (!Array.isArray(images) || images.length < (job.channel === "instagram" ? 1 : 2)
    || images.length > (job.channel === "instagram" ? 1 : 8)
    || !images.every(item => isRecord(item) && typeof item.url === "string" && item.url.startsWith("https://")
      && HEX.test(item.sha256 || "") && (job.channel === "instagram"
        || (typeof item.altText === "string" && item.altText.trim() === item.altText
          && item.altText.length > 0 && Array.from(item.altText).length <= 1000)))
    || new Set(images.map(item => item.url)).size !== images.length
    || (job.channel === "threads" && new Set(images.map(item => item.altText)).size !== images.length)) fail("job_assets_invalid");
  return images;
}
function verifiedAssetBinding(job, verifiedAssets) {
  const expected = jobAssetList(job);
  if (!Array.isArray(verifiedAssets) || verifiedAssets.length !== expected.length) fail("raw_asset_count_mismatch");
  return expected.map((asset, index) => {
    const actual = verifiedAssets[index];
    if (!isRecord(actual) || actual.url !== asset.url || !Buffer.isBuffer(actual.bytes)
      || !actual.bytes.length || sha(actual.bytes) !== asset.sha256) fail("raw_asset_hash_mismatch");
    return { url: asset.url, sha256: asset.sha256, ...(job.channel === "threads" ? { altText: asset.altText } : {}) };
  });
}
function canonicalJobPath(job, jobPath) {
  const folder = job.channel === "instagram" ? "instagram-promo" : "threads";
  if (jobPath !== `content-queue/${folder}/jobs/${job.id}.json`) fail("canonical_job_path_mismatch");
  return jobPath;
}
function assertRemote(expectedRemoteStateSha, observedRemoteStateSha) {
  assertSha(expectedRemoteStateSha);
  assertSha(observedRemoteStateSha);
  if (expectedRemoteStateSha !== observedRemoteStateSha) fail("remote_state_changed");
}
function assertNoHistoricalReplay(ledger, jobId, actionId) {
  for (const item of [...ledger.actions, ...(Array.isArray(ledger.receipts) ? ledger.receipts : [])]) {
    if (!isRecord(item)) fail("v2_action_invalid");
    if ([item.jobId, item.id, item.actionId, item.idempotencyKey, item.requestedPostId].includes(jobId)
      || [item.actionId, item.idempotencyKey].includes(actionId)) fail("historical_replay");
  }
}

function claimJob({ ledger, expectedRemoteStateSha, observedRemoteStateSha, jobBytes, jobPath, verifiedAssets,
  selectedJobId, runId, runAttempt, actionId, accountId, issuedAt, validUntil, grantSha256, reviewer }) {
  const v3 = checkedLedger(ledger);
  assertRemote(expectedRemoteStateSha, observedRemoteStateSha);
  const { bytes, job } = jobFromBytes(jobBytes);
  if (selectedJobId !== job.id) fail("candidate_selection_mismatch");
  canonicalJobPath(job, jobPath);
  const assets = verifiedAssetBinding(job, verifiedAssets);
  if (!/^[0-9]+$/u.test(runId || "") || !/^[1-9][0-9]*$/u.test(String(runAttempt || ""))
    || !ACTION_ID.test(actionId || "") || !ACCOUNT_ID.test(accountId || "")
    || !HEX.test(grantSha256 || "") || reviewer !== REVIEWER) fail("claim_identity_invalid");
  const issued = time(issuedAt), expires = time(validUntil);
  if (expires < issued || expires - issued > MAX_PERMIT_MS) fail("claim_window_invalid");
  if (v3.locks[job.channel] !== null) fail("channel_lock_unresolved");
  if (v3.actions.some(item => item.jobId === job.id || item.actionId === actionId)
    || v3.receipts.some(item => item.jobId === job.id || item.actionId === actionId)) fail("v3_replay");
  assertNoHistoricalReplay(ledger, job.id, actionId);
  const action = { schemaVersion: 1, strategyVersion: STRATEGY, channel: job.channel,
    action: job.channel === "instagram" ? "publish_one_instagram_promo" : "publish_one_threads_carousel",
    actionId, jobId: job.id, jobPath, jobSha256: sha(bytes), contentSha256: digest(job.content),
    grantSha256, reviewer,
    copySha256: sha(Buffer.from(job.channel === "instagram" ? job.content.caption : job.content.text, "utf8")), assets,
    accountId, runId, runAttempt: String(runAttempt), issuedAt, validUntil,
    originStateSha: observedRemoteStateSha };
  action.claimHash = digest(action);
  const next = withV3(ledger, state => {
    state.actions.push(action);
    state.locks[job.channel] = { actionId, claimHash: action.claimHash, stage: "claimed",
      createAttempts: 0, publishAttempts: 0, containerId: null,
      ...(job.channel === "threads" ? { childContainerIds: [] } : {}) };
    appendAudit(state, { kind: "claim", channel: job.channel, actionId, claimHash: action.claimHash }, issuedAt);
  });
  return { ledger: next, claim: clone(action) };
}

function confirmRemoteClaim({ ledger, claimHash, expectedClaimStateSha, observedClaimStateSha, at }) {
  const v3 = checkedLedger(ledger);
  assertRemote(expectedClaimStateSha, observedClaimStateSha);
  const action = v3.actions.find(item => item.claimHash === claimHash);
  if (!action || action.originStateSha === observedClaimStateSha || v3.locks[action.channel]?.stage !== "claimed"
    || v3.locks[action.channel].actionId !== action.actionId || v3.audit.at(-1)?.kind !== "claim"
    || v3.audit.at(-1)?.claimHash !== claimHash) fail("remote_claim_not_verified");
  const now = time(at);
  if (now < time(action.issuedAt) - CLOCK_SKEW_MS || now > time(action.validUntil)) fail("claim_expired");
  return { schemaVersion: 1, strategyVersion: STRATEGY, channel: action.channel, action: action.action,
    actionId: action.actionId, jobId: action.jobId, jobPath: action.jobPath, jobSha256: action.jobSha256,
    contentSha256: action.contentSha256, grantSha256: action.grantSha256, reviewer: action.reviewer,
    accountId: action.accountId, runId: action.runId,
    runAttempt: action.runAttempt, claimHash, issuedAt: action.issuedAt, validUntil: action.validUntil,
    remoteClaimCommitSha: observedClaimStateSha, remoteClaimSha256: sha(observedClaimStateSha) };
}
function authorized(ledger, permit, at, requireActive = true) {
  const v3 = checkedLedger(ledger);
  const action = v3.actions.find(item => item.actionId === permit?.actionId);
  if (!action || permit?.schemaVersion !== 1 || permit?.strategyVersion !== STRATEGY
    || !GIT_SHA.test(permit?.remoteClaimCommitSha || "")
    || permit?.remoteClaimSha256 !== sha(permit.remoteClaimCommitSha)
    || action.originStateSha === permit.remoteClaimCommitSha
    || !["channel", "action", "jobId", "jobPath", "jobSha256", "contentSha256", "grantSha256", "reviewer", "accountId", "runId", "runAttempt",
      "claimHash", "issuedAt", "validUntil"].every(key => permit[key] === action[key])
    || v3.locks[action.channel]?.actionId !== action.actionId
    || v3.locks[action.channel]?.claimHash !== action.claimHash) fail("permit_or_claim_mismatch");
  const now = time(at);
  if (requireActive && (now < time(action.issuedAt) - CLOCK_SKEW_MS || now > time(action.validUntil))) fail("permit_expired");
  return { v3, action, lock: v3.locks[action.channel] };
}
function rebindJob(action, jobBytes, verifiedAssets) {
  const { bytes, job } = jobFromBytes(jobBytes);
  canonicalJobPath(job, action.jobPath);
  if (job.id !== action.jobId || job.channel !== action.channel || sha(bytes) !== action.jobSha256
    || digest(job.content) !== action.contentSha256
    || stable(verifiedAssetBinding(job, verifiedAssets)) !== stable(action.assets)) fail("job_or_asset_changed_after_claim");
}
function beginCreate({ ledger, permit, expectedRemoteStateSha, observedRemoteStateSha, jobBytes, verifiedAssets, at }) {
  const { action, lock } = authorized(ledger, permit, at);
  assertRemote(expectedRemoteStateSha, observedRemoteStateSha);
  if (action.channel !== "instagram" || observedRemoteStateSha !== permit.remoteClaimCommitSha || lock.stage !== "claimed"
    || lock.createAttempts !== 0) fail("create_attempt_not_available");
  rebindJob(action, jobBytes, verifiedAssets);
  const next = withV3(ledger, state => {
    state.locks[action.channel] = { ...lock, stage: "create_attempted", createAttempts: 1 };
    appendAudit(state, { kind: "create_attempt_intent", channel: action.channel, actionId: action.actionId }, at);
  });
  return { ledger: next, intent: { actionId: action.actionId, channel: action.channel,
    jobId: action.jobId, jobSha256: action.jobSha256, createAttempt: 1, mustCommitAndReadBackBeforeApi: true } };
}
function recordContainer({ ledger, permit, expectedRemoteStateSha, observedRemoteStateSha, containerId, at }) {
  const { action, lock } = authorized(ledger, permit, at, false);
  assertRemote(expectedRemoteStateSha, observedRemoteStateSha);
  if (action.channel !== "instagram" || observedRemoteStateSha === permit.remoteClaimCommitSha
    || lock.stage !== "create_attempted" || !numericId(containerId)) fail("container_receipt_invalid");
  return withV3(ledger, state => {
    state.locks[action.channel] = { ...lock, stage: "container_created", containerId };
    appendAudit(state, { kind: "container_recorded", channel: action.channel,
      actionId: action.actionId, containerId }, at);
  });
}
function beginThreadsChildCreate({ ledger, permit, expectedRemoteStateSha, observedRemoteStateSha,
  jobBytes, verifiedAssets, childIndex, at }) {
  const { action, lock } = authorized(ledger, permit, at);
  assertRemote(expectedRemoteStateSha, observedRemoteStateSha);
  if (action.channel !== "threads" || !Number.isInteger(childIndex) || childIndex !== lock.childContainerIds?.length
    || childIndex >= action.assets.length || lock.createAttempts !== childIndex
    || !(childIndex === 0 ? (lock.stage === "claimed" && observedRemoteStateSha === permit.remoteClaimCommitSha)
      : (lock.stage === "child_container_created" && observedRemoteStateSha !== permit.remoteClaimCommitSha))) {
    fail("threads_child_attempt_not_available");
  }
  rebindJob(action, jobBytes, verifiedAssets);
  const asset = action.assets[childIndex];
  const next = withV3(ledger, state => {
    state.locks.threads = { ...lock, stage: "child_create_attempted", pendingChildIndex: childIndex,
      createAttempts: childIndex + 1 };
    appendAudit(state, { kind: "threads_child_create_intent", channel: "threads", actionId: action.actionId,
      childIndex, assetSha256: asset.sha256 }, at);
  });
  return { ledger: next, intent: { actionId: action.actionId, channel: "threads", jobId: action.jobId,
    childIndex, imageUrl: asset.url, imageSha256: asset.sha256, altText: asset.altText,
    createAttempt: 1, mustCommitAndReadBackBeforeApi: true } };
}
function recordThreadsChildContainer({ ledger, permit, expectedRemoteStateSha, observedRemoteStateSha,
  childIndex, containerId, at }) {
  const { action, lock } = authorized(ledger, permit, at, false);
  assertRemote(expectedRemoteStateSha, observedRemoteStateSha);
  if (action.channel !== "threads" || observedRemoteStateSha === permit.remoteClaimCommitSha
    || lock.stage !== "child_create_attempted" || childIndex !== lock.pendingChildIndex
    || !numericId(containerId) || lock.childContainerIds.includes(containerId)) fail("threads_child_receipt_invalid");
  return withV3(ledger, state => {
    const { pendingChildIndex, ...previous } = lock;
    state.locks.threads = { ...previous, stage: "child_container_created",
      childContainerIds: [...lock.childContainerIds, containerId] };
    appendAudit(state, { kind: "threads_child_container_recorded", channel: "threads",
      actionId: action.actionId, childIndex, containerId }, at);
  });
}
function beginThreadsCarouselCreate({ ledger, permit, expectedRemoteStateSha, observedRemoteStateSha,
  jobBytes, verifiedAssets, at }) {
  const { action, lock } = authorized(ledger, permit, at);
  assertRemote(expectedRemoteStateSha, observedRemoteStateSha);
  if (action.channel !== "threads" || observedRemoteStateSha === permit.remoteClaimCommitSha
    || lock.stage !== "child_container_created" || lock.childContainerIds.length !== action.assets.length
    || lock.createAttempts !== action.assets.length) fail("threads_carousel_attempt_not_available");
  rebindJob(action, jobBytes, verifiedAssets);
  const next = withV3(ledger, state => {
    state.locks.threads = { ...lock, stage: "parent_create_attempted", createAttempts: action.assets.length + 1 };
    appendAudit(state, { kind: "threads_carousel_create_intent", channel: "threads",
      actionId: action.actionId, orderedChildContainerIds: [...lock.childContainerIds] }, at);
  });
  return { ledger: next, intent: { actionId: action.actionId, channel: "threads", jobId: action.jobId,
    orderedChildContainerIds: [...lock.childContainerIds], copySha256: action.copySha256,
    createAttempt: 1, mustCommitAndReadBackBeforeApi: true } };
}
function recordThreadsCarouselContainer({ ledger, permit, expectedRemoteStateSha, observedRemoteStateSha,
  containerId, at }) {
  const { action, lock } = authorized(ledger, permit, at, false);
  assertRemote(expectedRemoteStateSha, observedRemoteStateSha);
  if (action.channel !== "threads" || observedRemoteStateSha === permit.remoteClaimCommitSha
    || lock.stage !== "parent_create_attempted" || !numericId(containerId)
    || lock.childContainerIds.includes(containerId)) fail("threads_carousel_receipt_invalid");
  return withV3(ledger, state => {
    state.locks.threads = { ...lock, stage: "container_created", containerId };
    appendAudit(state, { kind: "threads_carousel_container_recorded", channel: "threads",
      actionId: action.actionId, containerId, orderedChildContainerIds: [...lock.childContainerIds] }, at);
  });
}
function beginPublish({ ledger, permit, expectedRemoteStateSha, observedRemoteStateSha, jobBytes, verifiedAssets, at }) {
  const { action, lock } = authorized(ledger, permit, at);
  assertRemote(expectedRemoteStateSha, observedRemoteStateSha);
  if (observedRemoteStateSha === permit.remoteClaimCommitSha || lock.stage !== "container_created"
    || lock.createAttempts !== (action.channel === "instagram" ? 1 : action.assets.length + 1)
    || lock.publishAttempts !== 0 || !lock.containerId) fail("publish_attempt_not_available");
  rebindJob(action, jobBytes, verifiedAssets);
  const next = withV3(ledger, state => {
    state.locks[action.channel] = { ...lock, stage: "publish_attempted", publishAttempts: 1 };
    appendAudit(state, { kind: "publish_attempt_intent", channel: action.channel,
      actionId: action.actionId, containerId: lock.containerId }, at);
  });
  return { ledger: next, intent: { actionId: action.actionId, channel: action.channel,
    jobId: action.jobId, containerId: lock.containerId,
    ...(action.channel === "threads" ? { orderedChildContainerIds: [...lock.childContainerIds] } : {}),
    publishAttempt: 1, mustCommitAndReadBackBeforeApi: true } };
}
function markAmbiguous({ ledger, permit, expectedRemoteStateSha, observedRemoteStateSha, stage, at }) {
  const { action, lock } = authorized(ledger, permit, at, false);
  assertRemote(expectedRemoteStateSha, observedRemoteStateSha);
  if (!(action.channel === "instagram" ? ["create_attempted", "publish_attempted"]
    : ["child_create_attempted", "parent_create_attempted", "publish_attempted"]).includes(lock.stage)
    || stage !== lock.stage || observedRemoteStateSha === permit.remoteClaimCommitSha) fail("ambiguous_transition_invalid");
  return withV3(ledger, state => {
    state.locks[action.channel] = { ...lock, stage: "ambiguous", ambiguousFrom: stage };
    appendAudit(state, { kind: "ambiguous_result_lock_retained", channel: action.channel,
      actionId: action.actionId, from: stage }, at);
  });
}
function officialPermalink(channel, value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.search && !url.hash && !url.username && !url.password
      && (channel === "instagram" ? url.hostname === "www.instagram.com" && /^\/p\/[A-Za-z0-9_-]+\/?$/u.test(url.pathname)
        : ["www.threads.com", "www.threads.net"].includes(url.hostname)
          && /^\/@mindulmin\/post\/[A-Za-z0-9_-]+\/?$/u.test(url.pathname));
  } catch { return false; }
}
function officialMediaUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && Boolean(url.hostname);
  } catch { return false; }
}
function verifiedThreadsChildren(action, lock, media) {
  // Meta may transcode uploaded files and assign published child IDs different
  // from creation IDs. The official parent->children order, distinct published
  // IDs, media type, URL and the unique reviewed alt text provide the identity
  // evidence; source bytes were already bound before each create attempt.
  if (media.childrenEvidenceSource !== "official_threads_graph_api_parent_children"
    || media.childrenComplete !== true || !Array.isArray(media.children)
    || media.children.length !== action.assets.length || lock.childContainerIds.length !== action.assets.length) return false;
  const ids = new Set(), urls = new Set();
  return media.children.every((child, index) => {
    if (!isRecord(child) || !numericId(child.id) || ids.has(child.id)
      || child.mediaType !== "IMAGE" || !officialMediaUrl(child.mediaUrl) || urls.has(child.mediaUrl)
      || child.altText !== action.assets[index].altText
      || (child.creationId !== undefined && child.creationId !== lock.childContainerIds[index])) return false;
    ids.add(child.id); urls.add(child.mediaUrl);
    return true;
  });
}
function validateOfficialReadback(action, lock, readback, expectedMediaId, at) {
  const now = time(at);
  const checked = dateMs(readback?.checkedAt);
  const source = action.channel === "instagram" ? "official_instagram_graph_api_recent_media" : "official_threads_graph_api_recent_media";
  if (!isRecord(readback) || readback.source !== source || readback.complete !== true
    || readback.accountId !== action.accountId || !Array.isArray(readback.media)
    || !Number.isFinite(checked) || checked > now + CLOCK_SKEW_MS
    || now - checked > READBACK_MAX_AGE_MS) fail("official_readback_unavailable");
  const copyKey = action.channel === "instagram" ? "caption" : "text";
  const matchingCopy = readback.media.filter(item => item?.[copyKey] === readback.expectedCopy);
  if (typeof readback.expectedCopy !== "string" || !readback.expectedCopy.trim()
    || sha(Buffer.from(readback.expectedCopy, "utf8")) !== action.copySha256) fail("readback_copy_binding_missing");
  if (matchingCopy.length !== 1) fail("official_copy_not_exactly_one");
  const media = matchingCopy[0];
  if (!numericId(media.id) || (expectedMediaId && media.id !== expectedMediaId)
    || readback.media.filter(item => item?.id === media.id).length !== 1
    || !officialPermalink(action.channel, media.permalink)
    || !(action.channel === "instagram" ? media.mediaType === "IMAGE"
      : ["CAROUSEL", "CAROUSEL_ALBUM"].includes(media.mediaType))
    || (action.channel === "threads" && !verifiedThreadsChildren(action, lock, media))
    || !Number.isFinite(dateMs(media.timestamp)) || dateMs(media.timestamp) < time(action.issuedAt) - CLOCK_SKEW_MS
    || dateMs(media.timestamp) > now + CLOCK_SKEW_MS) fail("official_media_verification_failed");
  return media;
}
function completeVerified({ ledger, permit, expectedRemoteStateSha, observedRemoteStateSha,
  jobBytes, verifiedAssets, readback, expectedMediaId = null, at }) {
  const { action, lock } = authorized(ledger, permit, at, false);
  assertRemote(expectedRemoteStateSha, observedRemoteStateSha);
  if (observedRemoteStateSha === permit.remoteClaimCommitSha || lock.publishAttempts !== 1
    || !["publish_attempted", "ambiguous"].includes(lock.stage)
    || (lock.stage === "ambiguous" && lock.ambiguousFrom !== "publish_attempted")) fail("verified_transition_not_available");
  rebindJob(action, jobBytes, verifiedAssets);
  const media = validateOfficialReadback(action, lock, readback, expectedMediaId, at);
  const receipt = { status: "published_verified", strategyVersion: STRATEGY,
    channel: action.channel, actionId: action.actionId,
    jobId: action.jobId, claimHash: action.claimHash, grantSha256: action.grantSha256,
    reviewer: action.reviewer, remoteClaimCommitSha: permit.remoteClaimCommitSha,
    mediaId: media.id, permalink: media.permalink, publishedAt: media.timestamp,
    mediaType: media.mediaType, sourceAssetSha256: action.assets.map(asset => asset.sha256),
    ...(action.channel === "threads" ? { childContainerIds: [...lock.childContainerIds],
      publishedChildMediaIds: media.children.map(child => child.id),
      childOrderEvidence: "official_parent_children_order_and_reviewed_unique_alt_text" } : {}),
    checkedAt: readback.checkedAt, officialSource: readback.source,
    officialReadbackSha256: digest(readback), verifiedAt: at };
  const next = withV3(ledger, state => {
    state.locks[action.channel] = null;
    state.receipts.push(receipt);
    appendAudit(state, { kind: "published_verified", channel: action.channel,
      actionId: action.actionId, mediaId: media.id, readbackSha256: receipt.officialReadbackSha256 }, at);
  });
  return { ledger: next, receipt: clone(receipt) };
}

module.exports = { STRATEGY, CHANNELS, checkedLedger, claimJob, confirmRemoteClaim,
  beginCreate, recordContainer, beginThreadsChildCreate, recordThreadsChildContainer,
  beginThreadsCarouselCreate, recordThreadsCarouselContainer, beginPublish, markAmbiguous, completeVerified };
