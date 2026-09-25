#!/usr/bin/env node
"use strict";

// The only v3 social-write orchestrator. Each social request is preceded by an
// independently read-back cloud-state intent. Uncertain outcomes retain the
// channel lock; this file has no retry or reconciliation path.
const crypto = require("node:crypto");
const childProcess = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const { V3RemoteState } = require("./channel-split-v3-remote.cjs");
const state = require("./channel-split-v3-state.cjs");
const selector = require("./channel-split-v3-controller.cjs");
const instagram = require("../content-queue/instagram-promo/publish-promo.cjs");
const threads = require("../content-queue/threads/publish-threads-carousel.cjs");
const fallback = require("./channel-split-v3-fallback.cjs");

const ROOT = path.resolve(__dirname, "..");
const POLICY = path.join(__dirname, "control", "channel-split-v3-policy.json");
const GRANT_DIR = path.join(__dirname, "control", "channel-split-v3-grants");
const HOME = "https://languagestudio.uk/";
const MISSION = "https://languagestudio.uk/missions/korean-cafe/";
const JOB_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{2,119}$/u;
const HEX = /^[a-f0-9]{64}$/u;
const MAX_ASSET_BYTES = 12 * 1024 * 1024;
const TEST_AUTHORITY = process.env.NODE_TEST_CONTEXT === "child-v8"
  && /\.test\.cjs$/u.test(require.main?.filename || "") ? Symbol("v3 hermetic runner") : null;

function fail(code) { throw new Error(`v3_publish_${code}`); }
function assertSyntheticTransport(channel, dependencies) {
  if (dependencies.session?.accessToken !== "synthetic"
    || (channel === "instagram" ? dependencies.session?.accountId : dependencies.session?.userId) !== "123456789"
    || ["GITHUB_TOKEN", "INSTAGRAM_SESSION_JSON", "THREADS_SESSION_JSON", "INSTAGRAM_ACCESS_TOKEN",
      "THREADS_ACCESS_TOKEN"].some(key => process.env[key])) fail("synthetic_transport_only");
}
function hash(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }
function nowIso(clock) { return clock().toISOString(); }
function approvalPath(jobId) { return path.join(GRANT_DIR, `${jobId}.json`); }
function jobPath(channel, jobId) {
  if (!["instagram", "threads"].includes(channel) || !JOB_ID.test(jobId || "")) fail("job_identity_invalid");
  return path.join(ROOT, "content-queue", channel === "instagram" ? "instagram-promo" : "threads", "jobs", `${jobId}.json`);
}
function relativeJobPath(channel, jobId) {
  return `content-queue/${channel === "instagram" ? "instagram-promo" : "threads"}/jobs/${jobId}.json`;
}
function assertSourceControlled(channel, jobId, env) {
  // Checkout integrity is not a signature or proof of reviewer identity. It
  // only prevents a runtime-generated, untracked grant/job from becoming an
  // authority. The trusted main-branch review process remains a prerequisite.
  const files = [relativeJobPath(channel, jobId),
    `cloud/control/channel-split-v3-grants/${jobId}.json`,
    "cloud/control/channel-split-v3-policy.json"];
  try {
    const git = (...args) => childProcess.execFileSync("git", args,
      { cwd: ROOT, encoding: "utf8", timeout: 10000, windowsHide: true }).trim();
    if (!/github\.com[:/]mindulmin\/instargram-languagecafe(?:\.git)?$/iu.test(git("remote", "get-url", "origin"))) {
      fail("wrong_source_repository");
    }
    const head = git("rev-parse", "HEAD");
    if (env.GITHUB_SHA && head !== env.GITHUB_SHA) fail("checkout_commit_mismatch");
    for (const file of files) git("ls-files", "--error-unmatch", "--", file);
    if (git("status", "--porcelain", "--untracked-files=all", "--", ...files)) fail("source_files_dirty");
    return head;
  } catch (error) {
    if (/^v3_publish_/u.test(error?.message || "")) throw error;
    fail("source_checkout_unverified");
  }
}
function parseJson(bytes, code) {
  try { return JSON.parse(Buffer.from(bytes).toString("utf8")); }
  catch { fail(code); }
}
function assetsFor(job) {
  return job.channel === "instagram" ? [job.content.image] : job.content.images;
}
function copyFor(job) { return job.channel === "instagram" ? job.content.caption : job.content.text; }
function grantAssets(job) {
  return assetsFor(job).map(asset => ({ url: asset.url, sha256: asset.sha256,
    ...(job.channel === "threads" ? { altText: asset.altText } : {}) }));
}
function validateGrant({ job, jobBytes, grant, now }) {
  const copy = copyFor(job);
  const expectedAssets = grantAssets(job);
  const reviewedAt = Date.parse(grant?.review?.reviewedAt);
  const offerAt = Date.parse(grant?.siteOffer?.checkedAt);
  if (grant?.schemaVersion !== 1 || grant?.strategyVersion !== "channel-split-v3"
    || grant?.channel !== job.channel || grant?.jobId !== job.id
    || grant?.jobSha256 !== hash(jobBytes) || grant?.copySha256 !== hash(Buffer.from(copy, "utf8"))
    || JSON.stringify(grant?.assets) !== JSON.stringify(expectedAssets)
    || grant?.review?.status !== "passed"
    || grant?.review?.reviewer !== "independent_editorial_controller_v1"
    || !["accuracy", "completeness", "practicality", "revenueAlignment"].every(key => grant.review[key] === "passed")
    || typeof grant.review.evidence !== "string" || grant.review.evidence.trim().length < 40
    || !Number.isFinite(reviewedAt) || reviewedAt > now.getTime()
    || now.getTime() - reviewedAt > 14 * 24 * 60 * 60 * 1000
    || grant?.siteOffer?.homepageUrl !== HOME || grant?.siteOffer?.missionUrl !== MISSION
    || grant?.siteOffer?.homepageLinksMission !== true || grant?.siteOffer?.missionFreePilot !== true
    || !Number.isFinite(offerAt) || offerAt > now.getTime()
    || now.getTime() - offerAt > 24 * 60 * 60 * 1000) fail("independent_review_grant_invalid_or_stale");
  // No embedded approved flag, editorialReview object, or callback can stand
  // in for this separately stored, final-byte-bound record.
  return { jobSha256: grant.jobSha256, grantSha256: hash(Buffer.from(JSON.stringify(grant))) };
}
async function readCanonical({ channel, jobId, io = fs, clock = () => new Date(), requireEnabled = true }) {
  const [jobBytes, grantBytes, policyBytes] = await Promise.all([
    io.readFile(jobPath(channel, jobId)), io.readFile(approvalPath(jobId)), io.readFile(POLICY)
  ]);
  const job = parseJson(jobBytes, "job_json_invalid");
  const grant = parseJson(grantBytes, "grant_json_invalid");
  const policy = parseJson(policyBytes, "policy_json_invalid");
  if (job.id !== jobId || job.channel !== channel || job.strategyVersion !== "channel-split-v3") fail("job_changed");
  if (policy.schemaVersion !== 1 || policy.strategyVersion !== "channel-split-v3"
    || typeof policy.enabled !== "boolean") fail("policy_invalid");
  if (requireEnabled && policy.enabled !== true) fail("policy_disabled");
  if (channel === "instagram") {
    const errors = instagram.validateJob(job, { now: clock() });
    if (errors.length) fail("instagram_preflight_blocked");
  } else threads.validateJob(job);
  const grantEvidence = validateGrant({ job, jobBytes, grant, now: clock() });
  return { job, jobBytes, grantEvidence: { ...grantEvidence, grantSha256: hash(grantBytes) }, policy };
}
async function readPolicy(io = fs) {
  const policy = parseJson(await io.readFile(POLICY), "policy_json_invalid");
  if (policy?.schemaVersion !== 1 || policy?.strategyVersion !== "channel-split-v3"
    || typeof policy.enabled !== "boolean") fail("policy_invalid");
  return policy;
}
async function readQueue(channel, io = fs) {
  const dir = path.dirname(jobPath(channel, "queue-placeholder"));
  const names = await io.readdir(dir);
  if (!Array.isArray(names)) fail("queue_unavailable");
  const jobs = [];
  for (const name of names.filter(item => item.endsWith(".json")).sort()) {
    const id = name.slice(0, -5);
    if (!JOB_ID.test(id)) fail("queue_filename_invalid");
    const job = parseJson(await io.readFile(jobPath(channel, id)), "queue_job_json_invalid");
    if (job?.strategyVersion !== "channel-split-v3") continue;
    if (job.id !== id || job.channel !== channel) fail("queue_job_identity_invalid");
    jobs.push(job);
  }
  return jobs;
}
async function getHtml(url, fetchImpl) {
  const response = await fetchImpl(url, { method: "GET", redirect: "error", signal: AbortSignal.timeout(20000) });
  if (!response?.ok || response.url && response.url !== url) fail("site_offer_unavailable");
  const html = await response.text();
  if (html.length > 2_000_000 || !html) fail("site_offer_unavailable");
  const content = html.replace(/<!--[^]*?-->/gu, " ")
    .replace(/<(script|style|template)\b[^>]*>[^]*?<\/\1>/giu, " ");
  return { html: content, text: content.replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ") };
}
function homepageHasMissionLink(html) {
  const anchors = html.matchAll(/<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>/giu);
  for (const [, , href] of anchors) {
    try { if (new URL(href, HOME).href === MISSION) return true; }
    catch { /* Invalid links are not an authorization. */ }
  }
  return false;
}
async function verifyCurrentOffer(fetchImpl) {
  const [home, mission] = await Promise.all([getHtml(HOME, fetchImpl), getHtml(MISSION, fetchImpl)]);
  if (!homepageHasMissionLink(home.html)
    || !/free Korean caf(?:é|e) pilot/iu.test(home.text)
    || !/beginners who read Hangul/iu.test(home.text)
    || !/Log in to start; no card required/iu.test(home.text)
    || !/Free Korean mission/iu.test(home.text)
    || !/free Korean caf(?:é|e).*pilot|free pilot/iu.test(mission.text)
    || !/English guidance for beginners who read Hangul/iu.test(mission.text)
    || !/Log in to start; no card required/iu.test(mission.text)) fail("site_offer_changed");
  return { homepageUrl: HOME, missionUrl: MISSION, checkedAt: new Date().toISOString() };
}
async function fetchAssetBytes(image, fetchImpl) {
  const response = await fetchImpl(image.url, { method: "GET", redirect: "error", signal: AbortSignal.timeout(20000) });
  if (!response?.ok || response.url && response.url !== image.url) fail("asset_unavailable");
  const length = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(length) && length > MAX_ASSET_BYTES) fail("asset_oversize");
  if (!response.body?.getReader) fail("asset_unreadable");
  const reader = response.body.getReader();
  const parts = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_ASSET_BYTES) fail("asset_oversize");
      parts.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = Buffer.concat(parts, size);
  if (!bytes.length || bytes.length > MAX_ASSET_BYTES || hash(bytes) !== image.sha256) fail("asset_bytes_changed");
  return { url: image.url, bytes };
}
async function verifyAssets(job, fetchImpl) {
  const assets = assetsFor(job);
  if (job.channel === "instagram") await instagram.verifyHostedImage(assets[0], fetchImpl);
  else await threads.verifyImages(assets, { fetchImpl });
  return Promise.all(assets.map(image => fetchAssetBytes(image, fetchImpl)));
}
function sanitizeHistory(channel, media, accountId, checkedAt) {
  if (!Array.isArray(media)) fail("official_history_incomplete");
  const copyKey = channel === "instagram" ? "caption" : "text";
  return { source: channel === "instagram" ? "official_instagram_graph_api_recent_media" : "official_threads_graph_api_recent_media",
    complete: true, accountId, checkedAt,
    media: media.map(item => ({ id: String(item.id || ""),
      [copyKey]: item[copyKey] == null ? "" : item[copyKey],
      mediaType: item.media_type, permalink: item.permalink, timestamp: item.timestamp })) };
}
function selectorLedger(ledger) {
  const v3 = state.checkedLedger(ledger);
  return { schemaVersion: 1, lock: ledger.lock, locks: v3.locks,
    actions: [...ledger.actions, ...v3.actions],
    receipts: [...(Array.isArray(ledger.receipts) ? ledger.receipts : []), ...v3.receipts] };
}
async function readIdentityAndHistory({ channel, session, api, clock }) {
  if (channel === "instagram") {
    const [app, profile, page, permissions, media] = await Promise.all([
      api.getApp(session), api.getProfile(session), api.getPage(session), api.getPermissions(session), api.listMedia(session)
    ]);
    instagram.verifyIdentity({ app, profile, page, permissions, session });
    return sanitizeHistory(channel, media, session.accountId, nowIso(clock));
  }
  const identity = await api.getIdentity(session);
  if (String(identity?.id || "") !== session.userId || identity?.username !== "mindulmin") fail("threads_account_mismatch");
  return sanitizeHistory(channel, await api.listRecentPosts(session), session.userId, nowIso(clock));
}
async function readCloudRuns({ fetchImpl, token, scheduledAt }) {
  if (typeof token !== "string" || !token) fail("cloud_run_read_credential_missing");
  const date = scheduledAt.slice(0, 10);
  const all = [];
  let total = null;
  for (let page = 1; page <= 10; page += 1) {
    const url = new URL("https://api.github.com/repos/mindulmin/instargram-languagecafe/actions/workflows/channel-split-v3-publisher.yml/runs");
    for (const [key, value] of Object.entries({ branch: "main", per_page: "100", created: date, page: String(page) })) {
      url.searchParams.set(key, value);
    }
    let response;
    try {
      response = await fetchImpl(url, { method: "GET", redirect: "error",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28" }, signal: AbortSignal.timeout(20000) });
    } catch { fail("cloud_run_history_unavailable"); }
    if (!response?.ok) fail("cloud_run_history_unavailable");
    let payload;
    try { payload = await response.json(); } catch { fail("cloud_run_history_unavailable"); }
    if (!Number.isInteger(payload?.total_count) || payload.total_count < 0 || payload.total_count > 1000
      || !Array.isArray(payload.workflow_runs) || payload.workflow_runs.length > 100) {
      fail("cloud_run_history_incomplete");
    }
    if (total === null) total = payload.total_count;
    else if (total !== payload.total_count) fail("cloud_run_history_changed");
    if (payload.workflow_runs.some(run => !run || typeof run !== "object"
      || !Number.isFinite(Date.parse(run.created_at)) || run.head_branch !== "main"
      || !["queued", "in_progress", "completed", "requested", "waiting", "pending"].includes(run.status)
      || !(run.conclusion === null || typeof run.conclusion === "string"))) {
      fail("cloud_run_history_invalid");
    }
    all.push(...payload.workflow_runs);
    if (all.length >= total) break;
    if (!payload.workflow_runs.length) fail("cloud_run_history_incomplete");
  }
  if (all.length !== total) fail("cloud_run_history_incomplete");
  return all.map(run => ({ createdAt: run.created_at, branch: run.head_branch,
    workflow: "channel-split-v3", status: run.status, conclusion: run.conclusion }));
}
async function verifyCurrentMain({ fetchImpl, token, checkoutSha }) {
  if (!/^[a-f0-9]{40}$/u.test(checkoutSha || "")) fail("local_source_commit_unverified");
  let mainResponse;
  try {
    mainResponse = await fetchImpl("https://api.github.com/repos/mindulmin/instargram-languagecafe/git/ref/heads/main",
      { method: "GET", redirect: "error", headers: { Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      signal: AbortSignal.timeout(20000) });
  } catch { fail("local_source_commit_unverified"); }
  if (!mainResponse?.ok) fail("local_source_commit_unverified");
  let mainRef;
  try { mainRef = await mainResponse.json(); } catch { fail("local_source_commit_unverified"); }
  if (mainRef?.ref !== "refs/heads/main" || mainRef?.object?.type !== "commit"
    || mainRef.object.sha !== checkoutSha) fail("local_source_commit_not_main");
}
async function verifyLocalTakeover({ env, fetchImpl, clock, initial, jobId, checkoutSha }) {
  const runId = env.LANGUAGE_CAFE_LOCAL_RUN_ID;
  if (env.LANGUAGE_CAFE_LOCAL_FALLBACK !== "1" || !/^[0-9]+$/u.test(runId || "")
    || env.GITHUB_RUN_ID) fail("local_fallback_identity_invalid");
  await verifyCurrentMain({ fetchImpl, token: env.GITHUB_TOKEN, checkoutSha });
  const scheduledAt = `${clock().toISOString().slice(0, 10)}T00:00:00.000Z`;
  const cloudRuns = await readCloudRuns({ fetchImpl, token: env.GITHUB_TOKEN, scheduledAt });
  const v3 = state.checkedLedger(initial.ledger);
  const unresolvedRemoteAction = Object.values(v3.locks).some(lock => lock !== null);
  const decision = fallback.decideLocalFallback({ now: nowIso(clock), scheduledAt, cloudRuns,
    remoteReachable: true, unresolvedRemoteAction, selectedJobId: jobId });
  if (!decision.eligible) fail(`local_fallback_${decision.reason}`);
  return runId;
}
async function verifyCloudRun({ env, fetchImpl, checkoutSha }) {
  if (env.GITHUB_ACTIONS !== "true" || env.GITHUB_REPOSITORY !== "mindulmin/instargram-languagecafe"
    || env.GITHUB_REF !== "refs/heads/main" || env.GITHUB_SHA !== checkoutSha
    || !/^[0-9]+$/u.test(env.GITHUB_RUN_ID || "") || !env.GITHUB_TOKEN) fail("cloud_runner_identity_invalid");
  let response;
  try {
    response = await fetchImpl(`https://api.github.com/repos/mindulmin/instargram-languagecafe/actions/runs/${env.GITHUB_RUN_ID}`,
      { method: "GET", redirect: "error", headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      signal: AbortSignal.timeout(20000) });
  } catch { fail("cloud_runner_readback_unavailable"); }
  if (!response?.ok) fail("cloud_runner_readback_unavailable");
  let run;
  try { run = await response.json(); } catch { fail("cloud_runner_readback_unavailable"); }
  if (String(run?.id) !== env.GITHUB_RUN_ID || run?.head_sha !== checkoutSha || run?.head_branch !== "main"
    || run?.repository?.full_name !== env.GITHUB_REPOSITORY
    || !/^\.github\/workflows\/channel-split-v3-publisher\.yml(?:@(?:refs\/heads\/)?main)?$/u.test(run?.path || "")
    || !["schedule", "workflow_dispatch"].includes(run?.event)
    || !["queued", "in_progress"].includes(run?.status)) fail("cloud_runner_readback_mismatch");
  return env.GITHUB_RUN_ID;
}
function selection({ channel, jobs, policy, ledger, history, clock }) {
  const unavailable = { source: "unavailable", complete: false, media: [], checkedAt: nowIso(clock) };
  const decision = selector.decide({ policy, jobs, ledger: selectorLedger(ledger),
    instagramHistory: channel === "instagram" ? history : unavailable,
    threadsHistory: channel === "threads" ? history : unavailable, now: nowIso(clock) });
  return decision.channels[channel];
}
function selectExact({ channel, job, policy, ledger, history, clock }) {
  const chosen = selection({ channel, jobs: [job], policy, ledger, history, clock });
  if (chosen.status !== "selected" || chosen.selectedJobId !== job.id) {
    fail(`selection_${chosen.reason || "blocked"}`);
  }
}
function sessionFor(channel, env, clock) {
  let raw;
  try { raw = JSON.parse(env[channel === "instagram" ? "INSTAGRAM_SESSION_JSON" : "THREADS_SESSION_JSON"] || ""); }
  catch { fail("session_unavailable"); }
  return channel === "instagram" ? instagram.sessionValues(raw) : threads.sessionValues(raw, clock);
}
function apiFor(channel, fetchImpl) {
  return channel === "instagram" ? instagram.createInstagramApi({ fetchImpl }) : threads.createThreadsApi({ fetchImpl });
}
async function readbackAfterPublish({ channel, api, session, mediaId, copy, childIds = [], assets = [], clock }) {
  const [post, history] = await Promise.all([
    channel === "instagram" ? api.getMedia(session, mediaId) : api.getPost(session, mediaId),
    channel === "instagram" ? api.listMedia(session) : api.listRecentPosts(session)
  ]);
  const accountId = channel === "instagram" ? session.accountId : session.userId;
  const readback = sanitizeHistory(channel, history, accountId, nowIso(clock));
  if (String(post?.id || "") !== mediaId || post?.[channel === "instagram" ? "caption" : "text"] !== copy) {
    fail("published_media_readback_mismatch");
  }
  const matched = readback.media.filter(item => item.id === mediaId);
  if (matched.length !== 1) fail("published_media_not_exactly_one");
  if (matched[0].mediaType !== post.media_type || matched[0].permalink !== post.permalink
    || matched[0].timestamp !== post.timestamp) fail("published_media_surfaces_disagree");
  if (channel === "threads") {
    const children = post?.children?.data;
    if (!Array.isArray(children) || children.length !== assets.length) fail("threads_children_unavailable");
    const detailed = await Promise.all(children.map(child => api.getChildMedia(session, String(child.id))));
    readback.media = readback.media.map(item => item.id !== mediaId ? item : {
      ...item, childrenEvidenceSource: "official_threads_graph_api_parent_children", childrenComplete: true,
      children: detailed.map((child, index) => ({ id: String(child?.id || ""), mediaType: child?.media_type,
        mediaUrl: child?.media_url, altText: child?.alt_text,
        ...(children[index]?.creation_id ? { creationId: String(children[index].creation_id) } : {}) }))
    });
  }
  return { ...readback, expectedCopy: copy };
}
async function transition(remote, kind, expectedSha, args) {
  return remote[kind]({ expectedSha, ...args });
}
async function recheckBeforeApi({ channel, jobId, initialHash, initialGrantHash, io, clock, fetchImpl, job, verifyMain }) {
  if (verifyMain) await verifyMain();
  const current = await readCanonical({ channel, jobId, io, clock });
  if (hash(current.jobBytes) !== initialHash || current.grantEvidence.grantSha256 !== initialGrantHash) {
    fail("job_or_grant_changed");
  }
  await verifyCurrentOffer(fetchImpl);
  return verifyAssets(job, fetchImpl);
}
async function runAuto(input, dependencies, authority) {
  const { channel, publish } = input;
  const testMode = dependencies.testMode === true;
  if (testMode && (!TEST_AUTHORITY || authority !== TEST_AUTHORITY)) fail("synthetic_authority_denied");
  const io = testMode ? dependencies.io : fs;
  const clock = testMode ? dependencies.clock : () => new Date();
  const fetchImpl = testMode ? dependencies.fetchImpl : globalThis.fetch;
  const env = testMode ? dependencies.env : process.env;
  const policy = await readPolicy(io);
  if (publish && !policy.enabled) return { status: "blocked_policy_disabled", channel, selectedJobId: null,
    wouldCallSocialApi: false };
  const jobs = await readQueue(channel, io);
  const approved = jobs.filter(job => job.workflow?.status === "approved");
  if (!publish) {
    for (const job of approved) await readCanonical({ channel, jobId: job.id, io, clock, requireEnabled: false });
    return { status: "dry_run", channel, selectedJobId: null, approvedJobIds: approved.map(job => job.id),
      policyEnabled: policy.enabled, wouldCallSocialApi: false };
  }
  if (!approved.length) return { status: "not_due", reason: "no_approved_job", channel,
    selectedJobId: null, wouldCallSocialApi: false };
  if (testMode) assertSyntheticTransport(channel, dependencies);
  const session = testMode ? dependencies.session : sessionFor(channel, env, clock);
  const api = testMode ? dependencies.api : apiFor(channel, fetchImpl);
  const remote = testMode ? dependencies.remote : new V3RemoteState({ token: env.GITHUB_TOKEN,
    stateKey: env.LANGUAGE_CAFE_STATE_KEY });
  const initial = await remote.readVerified();
  const history = await readIdentityAndHistory({ channel, session, api, clock });
  const chosen = selection({ channel, jobs, policy, ledger: initial.ledger, history, clock });
  if (chosen.status !== "selected") {
    if (["no_approved_job", "minimum_gap_not_met", "rolling_14d_cap"].includes(chosen.reason)) {
      return { status: "not_due", reason: chosen.reason, channel, selectedJobId: null,
        nextEligibleAt: chosen.nextEligibleAt || null, wouldCallSocialApi: false };
    }
    fail(`selection_${chosen.reason || "blocked"}`);
  }
  await readCanonical({ channel, jobId: chosen.selectedJobId, io, clock });
  return runTrusted({ channel, jobId: chosen.selectedJobId, publish: true }, dependencies, authority);
}
async function runTrusted(input, dependencies = {}, authority) {
  if (dependencies.testMode && (!TEST_AUTHORITY || authority !== TEST_AUTHORITY)) fail("synthetic_authority_denied");
  const { channel, jobId, publish } = input;
  if (publish && !dependencies.testMode && require.main !== module) fail("cli_only_live_entry");
  if (jobId === "auto") return runAuto(input, dependencies, authority);
  const io = dependencies.testMode ? dependencies.io : fs;
  const clock = dependencies.testMode ? dependencies.clock : () => new Date();
  const fetchImpl = dependencies.testMode ? dependencies.fetchImpl : globalThis.fetch;
  const env = dependencies.testMode ? dependencies.env : process.env;
  const prepared = await readCanonical({ channel, jobId, io, clock, requireEnabled: publish });
  if (!publish) return { status: "dry_run", channel, jobId, wouldCallSocialApi: false,
    policyEnabled: prepared.policy.enabled, jobSha256: hash(prepared.jobBytes), grantSha256: prepared.grantEvidence.grantSha256 };
  if (dependencies.testMode) assertSyntheticTransport(channel, dependencies);
  const checkoutSha = dependencies.testMode ? null : assertSourceControlled(channel, jobId, env);
  await verifyCurrentOffer(fetchImpl);
  let verifiedAssets = await verifyAssets(prepared.job, fetchImpl);
  const session = dependencies.testMode ? dependencies.session : sessionFor(channel, env, clock);
  const api = dependencies.testMode ? dependencies.api : apiFor(channel, fetchImpl);
  const remote = dependencies.testMode ? dependencies.remote : new V3RemoteState({ token: env.GITHUB_TOKEN,
    stateKey: env.LANGUAGE_CAFE_STATE_KEY });
  const initial = await remote.readVerified();
  const history = await readIdentityAndHistory({ channel, session, api, clock });
  selectExact({ channel, job: prepared.job, policy: prepared.policy, ledger: initial.ledger, history, clock });
  // Re-read all local authority and hosted bytes after official history, before
  // the durable claim. A changed source cannot inherit a prior review.
  const verifyMain = dependencies.testMode ? null
    : () => verifyCurrentMain({ fetchImpl, token: env.GITHUB_TOKEN, checkoutSha });
  verifiedAssets = await recheckBeforeApi({ channel, jobId, initialHash: hash(prepared.jobBytes),
    initialGrantHash: prepared.grantEvidence.grantSha256, io, clock, fetchImpl, job: prepared.job, verifyMain });
  const accountId = channel === "instagram" ? session.accountId : session.userId;
  const localMode = env.LANGUAGE_CAFE_LOCAL_FALLBACK === "1";
  const runId = String(localMode ? await verifyLocalTakeover({ env, fetchImpl, clock, initial, jobId, checkoutSha })
    : dependencies.testMode ? dependencies.runId : await verifyCloudRun({ env, fetchImpl, checkoutSha }));
  const runAttempt = String(dependencies.testMode ? dependencies.runAttempt : env.GITHUB_RUN_ATTEMPT || "1");
  if (!/^[0-9]+$/u.test(runId) || !/^[1-9][0-9]*$/u.test(runAttempt)) fail("run_identity_missing");
  const actionId = `v3:${localMode ? "local:" : ""}${channel}:${jobId}:${runId}`;
  const issuedAt = nowIso(clock);
  const validUntil = new Date(clock().getTime() + 25 * 60 * 1000).toISOString();
  const claimed = await remote.claimJob({ expectedSha: initial.sha, confirmedAt: nowIso(clock),
    jobBytes: prepared.jobBytes, jobPath: relativeJobPath(channel, jobId), verifiedAssets,
    selectedJobId: jobId, runId, runAttempt, actionId, accountId, issuedAt, validUntil,
    grantSha256: prepared.grantEvidence.grantSha256, reviewer: "independent_editorial_controller_v1" });
  let sha = claimed.sha;
  const permit = claimed.permit;
  const common = () => ({ permit, jobBytes: prepared.jobBytes, verifiedAssets,
    grantSha256: prepared.grantEvidence.grantSha256, reviewer: "independent_editorial_controller_v1", at: nowIso(clock) });
  const beforeApi = async () => {
    verifiedAssets = await recheckBeforeApi({ channel, jobId, initialHash: hash(prepared.jobBytes),
      initialGrantHash: prepared.grantEvidence.grantSha256, io, clock, fetchImpl, job: prepared.job, verifyMain });
  };
  let containerId, mediaId, childIds = [];
  if (channel === "instagram") {
    const intent = await transition(remote, "beginCreate", sha, common()); sha = intent.sha;
    await beforeApi();
    containerId = await api.createContainer(session, { imageUrl: prepared.job.content.image.url, caption: copyFor(prepared.job) });
    const recorded = await transition(remote, "recordContainer", sha, { permit, containerId, at: nowIso(clock) }); sha = recorded.sha;
  } else {
    for (let index = 0; index < assetsFor(prepared.job).length; index += 1) {
      const intent = await transition(remote, "beginThreadsChildCreate", sha, { ...common(), childIndex: index }); sha = intent.sha;
      await beforeApi();
      const childId = await api.createImageContainer(session, assetsFor(prepared.job)[index]);
      const recorded = await transition(remote, "recordThreadsChildContainer", sha,
        { permit, childIndex: index, containerId: childId, at: nowIso(clock) }); sha = recorded.sha;
      childIds.push(childId);
    }
    // Read-only readiness polls can run together. Waiting eight children in
    // series could outlive the 25-minute claim without a publishing attempt.
    await Promise.all(childIds.map(childId => threads.waitReady(api, session, childId)));
    const intent = await transition(remote, "beginThreadsCarouselCreate", sha, common()); sha = intent.sha;
    await beforeApi();
    containerId = await api.createCarouselContainer(session, childIds, copyFor(prepared.job));
    const recorded = await transition(remote, "recordThreadsCarouselContainer", sha,
      { permit, containerId, at: nowIso(clock) }); sha = recorded.sha;
    await threads.waitReady(api, session, containerId);
  }
  const publishIntent = await transition(remote, "beginPublish", sha, common()); sha = publishIntent.sha;
  await beforeApi();
  mediaId = await api.publishContainer(session, containerId);
  const readback = await readbackAfterPublish({ channel, api, session, mediaId,
    copy: copyFor(prepared.job), childIds, assets: assetsFor(prepared.job), clock });
  const complete = await transition(remote, "completeVerified", sha, { ...common(), readback, expectedMediaId: mediaId });
  return { status: "published_verified", channel, jobId, mediaId,
    permalink: complete.receipt.permalink, receipt: complete.receipt, remoteStateSha: complete.sha };
}
function parseArgs(args) {
  const out = { channel: null, jobId: null, publish: false, mode: "preview" };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--mode" && args[index + 1]) out.mode = args[++index];
    else if (arg === "--channel" && args[index + 1]) out.channel = args[++index];
    else if (arg === "--job-id" && args[index + 1]) out.jobId = args[++index];
    else fail("arguments_invalid");
  }
  if (!["instagram", "threads"].includes(out.channel) || (out.jobId !== "auto" && !JOB_ID.test(out.jobId || ""))
    || !["preview", "publish"].includes(out.mode)) fail("arguments_invalid");
  out.publish = out.mode === "publish";
  return out;
}
async function runCli(args = process.argv.slice(2)) { return runTrusted(parseArgs(args)); }
if (require.main === module) {
  runCli().then(value => console.log(JSON.stringify(value)))
    .catch(error => { console.error(/^(?:v3_publish|v3_remote|v3_state|promo)_[a-z0-9_]+$/u.test(error?.message || "")
      ? error.message : "v3_publish_blocked_or_ambiguous_manual_readback_required"); process.exitCode = 1; });
}

module.exports = { approvalPath, jobPath, parseArgs, runCli };
if (TEST_AUTHORITY) module.exports.__testOnly = {
  run: (input, dependencies) => runTrusted(input, { ...dependencies, testMode: true }, TEST_AUTHORITY),
  validateGrant, verifyCurrentOffer, sanitizeHistory, selectExact, readCloudRuns, verifyLocalTakeover,
  verifyCloudRun, verifyCurrentMain
};
