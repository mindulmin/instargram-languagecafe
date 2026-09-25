#!/usr/bin/env node
"use strict";

// A separate, fail-closed IMAGE publisher for approved Language Cafe promotions.
// The historical Korean lesson carousel pipeline never calls this module.

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const JOBS_DIR = path.join(__dirname, "jobs");
const LOCK_DIR = path.join(__dirname, ".publish-locks");
const STRATEGY_VERSION = "channel-split-v3";
const APP_ID = "2109337976465317";
const ACCOUNT_USERNAME = "mindulmin";
const SITE_HOST = "languagestudio.uk";
const HOME_URL = "https://languagestudio.uk/";
const MISSION_URL = "https://languagestudio.uk/missions/korean-cafe/";
const HOSTED_IMAGE_HOST = /^[a-f0-9]{8,64}\.language-cafe-instagram-assets\.pages\.dev$/u;
const MAX_IMAGE_BYTES = 8_000_000;
const MEDIA_FIELDS = "id,caption,media_type,permalink,timestamp";
const CLAIM_KOREAN_CAFE_PILOT = "free_korean_cafe_ordering_pilot_after_login";
const REVIEW_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalizeCaption(value) {
  return String(value || "").normalize("NFC").replace(/\s+/gu, " ").trim().toLowerCase();
}

function isInside(parent, target) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function resolveJobPath(value, jobsDir = JOBS_DIR) {
  const target = path.isAbsolute(value) ? path.resolve(value) : path.resolve(PROJECT_ROOT, value);
  if (!isInside(jobsDir, target) || path.extname(target).toLowerCase() !== ".json") {
    throw Error("promo_job_path_invalid");
  }
  return target;
}

function hostedImageUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw Error("promo_image_url_invalid"); }
  const parts = url.pathname.split("/").slice(1);
  if (url.protocol !== "https:" || !HOSTED_IMAGE_HOST.test(url.hostname)
      || url.port || url.username || url.password || url.search || url.hash
      || String(value) !== url.href || !parts.length
      || parts.some(part => !/^[A-Za-z0-9._-]+$/u.test(part) || part === "." || part === "..")
      || !/\.jpe?g$/iu.test(url.pathname)) {
    throw Error("promo_image_url_must_use_immutable_project_https_jpeg");
  }
  return url;
}

function captionErrors(value) {
  const caption = String(value || "");
  const errors = [];
  if (!caption.trim() || [...caption].length > 2200) errors.push("caption_length_invalid");
  if ((caption.match(/#[\p{L}\p{N}_]+/gu) || []).length > 30) errors.push("caption_hashtag_limit_exceeded");
  if (/https?:\/\/|www\.|languagestudio\.uk/iu.test(caption)) errors.push("caption_must_use_profile_link_cta");
  if (!/\bLanguage Cafe\b/iu.test(caption)) errors.push("caption_product_name_missing");
  if (!/(?:link in (?:my |the |this )?(?:profile|bio)|profile link)/iu.test(caption)) {
    errors.push("caption_profile_link_cta_missing");
  }
  const englishWords = caption.match(/\b[A-Za-z]+(?:['’-][A-Za-z]+)*\b/gu) || [];
  const latinLetters = (caption.match(/[A-Za-z]/gu) || []).length;
  const hangulSyllables = (caption.match(/[가-힣]/gu) || []).length;
  if (englishWords.length < 20 || latinLetters < hangulSyllables * 2) {
    errors.push("caption_english_language_required");
  }
  if (!/\bfree\b/iu.test(caption) || !/\bKorean\s+caf(?:e|é)(?=[\s.,!?:;—–-]|$)/iu.test(caption)
      || !/\b(?:order|ordering)\b/iu.test(caption)
      || !/\b(?:try|practice|start)\b/iu.test(caption)
      || !/\b(?:pilot|mission)\b/iu.test(caption)
      || !/\b(?:read|know|recognize)\s+Hangul\b/iu.test(caption)) {
    errors.push("caption_korean_cafe_pilot_action_missing");
  }
  if (/(?:\b(?:5|five)[ -]min(?:ute)?s?\b|5\s*분|\bAI\s+English\b|\bEnglish\s+(?:AI\s+)?(?:conversation|speaking)\b|\bsave\s+(?:and\s+)?review\s+(?:your\s+)?sentences?\b)/iu.test(caption)) {
    errors.push("caption_retired_or_unverified_offer_claim");
  }
  if (/\b(?:guaranteed|fluent in|unlimited|discount|subscription|checkout|buy now|purchase now|free forever)\b/iu.test(caption)
      || /(?:\$|£|€|₩)\s*\d/u.test(caption)
      || /(?:무제한|보장|평생\s*무료|단기간\s*완성|할인|구독|결제|구매|가격)/u.test(caption)) {
    errors.push("caption_unverified_commercial_claim");
  }
  return errors;
}

function isFreshEvidence(value, now) {
  const checkedAt = Date.parse(value);
  return Number.isFinite(checkedAt) && checkedAt <= now.getTime()
    && now.getTime() - checkedAt < REVIEW_MAX_AGE_MS;
}

function editorialReviewErrors(job, now = new Date()) {
  const review = job?.editorialReview;
  const errors = [];
  if (review?.status !== "approved" || review?.offerClaimApproved !== true
      || review?.landingMatchApproved !== true || review?.profileCtaApproved !== true
      || review?.visualApproved !== true) errors.push("editorial_review_approval_missing");
  if (review?.captionSha256 !== sha256(String(job?.content?.caption || ""))
      || review?.imageSha256 !== String(job?.content?.image?.sha256 || "")) {
    errors.push("editorial_review_content_binding_mismatch");
  }
  if (review?.destinationUrl !== MISSION_URL
      || review?.destinationUrl !== job?.content?.destinationUrl) {
    errors.push("editorial_review_destination_binding_mismatch");
  }
  if (review?.evidence?.homepage?.url !== HOME_URL
      || review?.evidence?.homepage?.linksToDestination !== true
      || review?.evidence?.mission?.url !== MISSION_URL
      || review?.evidence?.mission?.freePilotVerified !== true
      || review?.evidence?.mission?.orderPracticeVerified !== true
      || review?.evidence?.mission?.hangulReaderPrerequisiteVerified !== true
      || review?.evidence?.mission?.loginRequiredVerified !== true
      || review?.evidence?.mission?.noCardRequiredVerified !== true
      || review?.evidence?.profile?.website !== HOME_URL
      || review?.evidence?.profile?.username !== ACCOUNT_USERNAME
      || !isFreshEvidence(review?.evidence?.homepage?.checkedAt, now)
      || !isFreshEvidence(review?.evidence?.mission?.checkedAt, now)
      || !isFreshEvidence(review?.evidence?.profile?.checkedAt, now)) {
    errors.push("editorial_review_evidence_missing_or_stale");
  }
  const approved = review?.evidence?.approvedClaimIds;
  if (!Array.isArray(approved) || approved.length !== 1 || approved[0] !== CLAIM_KOREAN_CAFE_PILOT) {
    errors.push("editorial_review_claims_mismatch");
  }
  return errors;
}

function validateJob(job, { now = new Date() } = {}) {
  const errors = [];
  if (job?.schemaVersion !== 1) errors.push("schema_version_invalid");
  if (!/^[a-z0-9][a-z0-9._-]{2,79}$/u.test(String(job?.id || ""))) errors.push("job_id_invalid");
  if (job?.channel !== "instagram" || job?.strategyVersion !== STRATEGY_VERSION) errors.push("strategy_invalid");
  if (job?.workflow?.status !== "approved") errors.push("job_not_approved");
  if (job?.published || job?.workflow?.postPublishVerification) errors.push("job_already_published");
  if (job?.content?.destinationUrl !== MISSION_URL) errors.push("destination_url_invalid");
  errors.push(...captionErrors(job?.content?.caption));
  errors.push(...editorialReviewErrors(job, now));
  try { hostedImageUrl(job?.content?.image?.url); } catch (error) { errors.push(error.message); }
  if (!/^[a-f0-9]{64}$/u.test(String(job?.content?.image?.sha256 || ""))) errors.push("image_sha256_invalid");
  return [...new Set(errors)];
}

function sessionValues(value) {
  const s = typeof value === "string" ? JSON.parse(value) : value;
  const accountId = String(s?.accountId || "");
  const pageId = String(s?.selectedAccount?.pageId || "");
  const selectedId = String(s?.selectedAccount?.accountId || "");
  if (!s?.accessToken || !/^v\d+\.\d+$/u.test(String(s?.graphVersion || ""))
      || !/^\d+$/u.test(accountId) || !/^\d+$/u.test(pageId)
      || selectedId !== accountId
      || String(s?.selectedAccount?.username || "").toLowerCase() !== ACCOUNT_USERNAME) {
    throw Error("promo_instagram_session_invalid_or_wrong_account");
  }
  return { accessToken: s.accessToken, graphVersion: s.graphVersion, accountId, pageId };
}

async function readJob(jobPath) {
  const raw = await fs.readFile(jobPath, "utf8");
  return { job: JSON.parse(raw), hash: sha256(raw) };
}

async function writeJsonAtomic(filePath, value) {
  const temp = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const handle = await fs.open(temp, "wx");
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally { await handle.close(); }
  try { await fs.rename(temp, filePath); }
  catch (error) { await fs.unlink(temp).catch(() => {}); throw error; }
}

async function acquireLock(lockPath, value) {
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  let handle;
  try {
    handle = await fs.open(lockPath, "wx");
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } catch (error) {
    if (error.code === "EEXIST") throw Error("promo_publish_lock_exists_manual_reconciliation_required");
    throw error;
  } finally { await handle?.close(); }
}

async function updateLock(lockPath, value) {
  await writeJsonAtomic(lockPath, value);
}

function isOfficialPermalink(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "www.instagram.com"
      && /^\/p\/[A-Za-z0-9_-]+\/?$/u.test(url.pathname)
      && !url.search && !url.hash;
  } catch { return false; }
}

function isExpectedProfileWebsite(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === SITE_HOST
      && url.pathname === "/" && !url.search && !url.hash;
  } catch { return false; }
}

function verifyIdentity({ app, profile, page, permissions, session }) {
  if (String(app?.id || "") !== APP_ID) throw Error("promo_wrong_meta_app");
  if (String(profile?.id || "") !== session.accountId
      || String(profile?.username || "").toLowerCase() !== ACCOUNT_USERNAME) throw Error("promo_wrong_instagram_account");
  if (!isExpectedProfileWebsite(profile?.website)) throw Error("promo_profile_link_not_verified");
  if (String(page?.id || "") !== session.pageId
      || String(page?.instagram_business_account?.id || "") !== session.accountId) throw Error("promo_page_account_link_not_verified");
  if (!Array.isArray(permissions?.data)) throw Error("promo_permissions_unavailable");
  const granted = new Set(permissions.data.filter(item => item.status === "granted").map(item => item.permission));
  for (const required of ["instagram_basic", "instagram_content_publish", "pages_show_list", "pages_read_engagement"]) {
    if (!granted.has(required)) throw Error(`promo_permission_missing_${required}`);
  }
}

async function readLimitedBytes(response, maxBytes = MAX_IMAGE_BYTES) {
  const expectedLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(expectedLength) && expectedLength > maxBytes) throw Error("promo_image_too_large");
  if (!response.body?.getReader) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maxBytes) throw Error("promo_image_too_large");
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > maxBytes) throw Error("promo_image_too_large");
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks, length);
}

async function verifyHostedImage(image, fetchImpl = globalThis.fetch) {
  const url = hostedImageUrl(image.url);
  let response;
  try {
    response = await fetchImpl(url, { redirect: "error", signal: AbortSignal.timeout(20000) });
  } catch { throw Error("promo_image_fetch_unavailable"); }
  if (!response?.ok || !/^image\/jpeg(?:\s*;|$)/iu.test(response.headers?.get?.("content-type") || "")) {
    throw Error("promo_image_public_jpeg_unavailable");
  }
  const bytes = await readLimitedBytes(response);
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff
      || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) {
    throw Error("promo_image_jpeg_bytes_invalid");
  }
  const actualHash = sha256(bytes);
  if (actualHash !== image.sha256) throw Error("promo_image_sha256_mismatch");
  let metadata;
  try {
    metadata = await sharp(bytes, { failOn: "error" }).metadata();
    await sharp(bytes, { failOn: "error" }).raw().toBuffer();
  } catch { throw Error("promo_image_jpeg_decode_failed"); }
  const ratio = metadata.width / metadata.height;
  if (metadata.format !== "jpeg" || metadata.width < 320 || metadata.width > 1440
      || ratio < 0.8 || ratio > 1.91) throw Error("promo_image_dimensions_invalid");
  return { bytes: bytes.length, sha256: actualHash, width: metadata.width, height: metadata.height };
}

// Transport construction is intentionally private. The public publisher below
// cannot reach it until a trusted remote claim/intent runner is implemented.
function createInstagramApi({ fetchImpl, timeoutMs = 20000 } = {}) {
  if (typeof fetchImpl !== "function") throw Error("promo_fetch_unavailable");

  async function request(session, method, object, { query = {}, form = null } = {}) {
    const url = new URL(`https://graph.facebook.com/${session.graphVersion}/${object}`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
    if (!form) url.searchParams.set("access_token", session.accessToken);
    let response;
    try {
      response = await fetchImpl(url, {
        method,
        headers: form ? { "content-type": "application/x-www-form-urlencoded" } : undefined,
        body: form ? new URLSearchParams({ ...form, access_token: session.accessToken }).toString() : undefined,
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch { throw Error("promo_graph_response_ambiguous"); }
    let payload;
    try { payload = await response.json(); }
    catch { throw Error("promo_graph_response_unreadable"); }
    if (!response.ok || payload?.error) {
      throw Error(`promo_graph_http_${Number(response.status) || 0}_code_${Number(payload?.error?.code) || 0}`);
    }
    if (!payload || typeof payload !== "object") throw Error("promo_graph_response_unreadable");
    return payload;
  }

  return {
    getApp: s => request(s, "GET", "app", { query: { fields: "id,name" } }),
    getProfile: s => request(s, "GET", s.accountId, { query: { fields: "id,username,website" } }),
    getPage: s => request(s, "GET", s.pageId, { query: { fields: "id,instagram_business_account" } }),
    getPermissions: s => request(s, "GET", "me/permissions"),
    async listMedia(s) {
      const media = [];
      let after;
      for (let page = 0; page < 10; page += 1) {
        const payload = await request(s, "GET", `${s.accountId}/media`, {
          query: { fields: MEDIA_FIELDS, limit: 100, ...(after ? { after } : {}) }
        });
        if (!Array.isArray(payload.data)) throw Error("promo_official_media_list_unavailable");
        media.push(...payload.data);
        if (!payload.paging?.next) return media;
        const nextAfter = payload.paging?.cursors?.after;
        if (!nextAfter || nextAfter === after) throw Error("promo_official_media_paging_invalid");
        after = nextAfter;
      }
      throw Error("promo_official_media_history_incomplete");
    },
    async createContainer(s, { imageUrl, caption }) {
      const payload = await request(s, "POST", `${s.accountId}/media`, {
        form: { image_url: imageUrl, caption }
      });
      if (!/^\d+$/u.test(String(payload.id || ""))) throw Error("promo_container_response_ambiguous");
      return String(payload.id);
    },
    async publishContainer(s, containerId) {
      const payload = await request(s, "POST", `${s.accountId}/media_publish`, {
        form: { creation_id: containerId }
      });
      if (!/^\d+$/u.test(String(payload.id || ""))) throw Error("promo_publish_response_ambiguous");
      return String(payload.id);
    },
    getMedia: (s, mediaId) => request(s, "GET", mediaId, { query: { fields: MEDIA_FIELDS } })
  };
}

function duplicateMedia(media, caption) {
  const expected = normalizeCaption(caption);
  return media.filter(item => normalizeCaption(item?.caption) === expected);
}

function verifyPublishedMedia({ mediaId, item, recent, caption }) {
  const idMatches = recent.filter(value => String(value?.id || "") === mediaId);
  const captionMatches = duplicateMedia(recent, caption);
  return String(item?.id || "") === mediaId
    && item?.media_type === "IMAGE"
    && normalizeCaption(item?.caption) === normalizeCaption(caption)
    && isOfficialPermalink(item?.permalink)
    && idMatches.length === 1 && captionMatches.length === 1
    ? { mediaId, permalink: item.permalink, timestamp: item.timestamp || null,
        mediaIdMatchCount: 1, normalizedCaptionMatchCount: 1, mediaType: "IMAGE" }
    : null;
}

async function assertCloudV3Permit(job, jobSha256, verifier, now = new Date()) {
  if (process.env.LANGUAGE_CAFE_CLOUD !== "1") return;
  if (typeof verifier !== "function" || !/^\d+$/u.test(process.env.GITHUB_RUN_ID || "")) {
    throw Error("promo_cloud_v3_permit_verifier_missing");
  }
  let permit;
  try {
    permit = await verifier({ jobId: job.id, jobSha256, strategyVersion: STRATEGY_VERSION,
      channel: "instagram", runId: process.env.GITHUB_RUN_ID });
  } catch { throw Error("promo_cloud_v3_permit_unverified"); }
  if (permit?.verified !== true || permit?.schemaVersion !== 1
      || permit?.strategyVersion !== STRATEGY_VERSION || permit?.channel !== "instagram"
      || permit?.action !== "publish_one_instagram_promo" || permit?.jobId !== job.id
      || permit?.jobSha256 !== jobSha256 || permit?.runId !== process.env.GITHUB_RUN_ID
      || !/^[a-f0-9]{64}$/u.test(String(permit?.remoteClaimSha256 || ""))
      || !Number.isFinite(Date.parse(permit?.issuedAt))
      || !Number.isFinite(Date.parse(permit?.validUntil))
      || Date.parse(permit.issuedAt) > now.getTime()
      || Date.parse(permit.validUntil) < now.getTime()
      || Date.parse(permit.issuedAt) > Date.parse(permit.validUntil)) {
    throw Error("promo_cloud_v3_permit_unverified");
  }
}

async function publishPromoJobInternalForTests({ jobPath, jobsDir, lockDir,
  session: injectedSession, api: injectedApi, imageFetch, clock = () => new Date() } = {}) {
  if (!injectedSession || !injectedApi || typeof imageFetch !== "function") {
    throw Error("promo_test_transport_required");
  }
  const resolved = resolveJobPath(jobPath, jobsDir);
  const initial = await readJob(resolved);
  const errors = validateJob(initial.job, { now: clock() });
  if (errors.length) throw Error(`promo_job_preflight_blocked_${errors.join("_")}`);
  const session = sessionValues(injectedSession);
  const api = injectedApi;
  const lockPath = path.join(lockDir, `${initial.job.id}.json`);
  const lock = { jobId: initial.job.id, jobSha256: initial.hash, channel: "instagram",
    strategyVersion: STRATEGY_VERSION, stage: "locked_before_api", startedAt: clock().toISOString(),
    containerCreateAttempts: 0, publishAttempts: 0 };
  await acquireLock(lockPath, lock);

  try {
    const current = await readJob(resolved);
    if (current.hash !== initial.hash || validateJob(current.job, { now: clock() }).length) throw Error("promo_job_changed_after_lock");
    const [app, profile, page, permissions] = await Promise.all([
      api.getApp(session), api.getProfile(session), api.getPage(session), api.getPermissions(session)
    ]);
    verifyIdentity({ app, profile, page, permissions, session });
    const before = await api.listMedia(session);
    if (!Array.isArray(before)) throw Error("promo_official_media_list_unavailable");
    if (duplicateMedia(before, current.job.content.caption).length) throw Error("promo_duplicate_official_caption");
    const imageEvidence = await verifyHostedImage(current.job.content.image, imageFetch);
    Object.assign(lock, { stage: "creating_image_container", imageSha256: imageEvidence.sha256, containerCreateAttempts: 1 });
    await updateLock(lockPath, lock);
    const containerId = await api.createContainer(session, {
      imageUrl: current.job.content.image.url, caption: current.job.content.caption
    });
    if (!/^\d+$/u.test(String(containerId || ""))) throw Error("promo_container_response_ambiguous");
    Object.assign(lock, { stage: "publishing_image_container", containerId, publishAttempts: 1 });
    await updateLock(lockPath, lock);
    const mediaId = await api.publishContainer(session, containerId);
    if (!/^\d+$/u.test(String(mediaId || ""))) throw Error("promo_publish_response_ambiguous");
    Object.assign(lock, { stage: "official_post_publish_readback", mediaId });
    await updateLock(lockPath, lock);
    const item = await api.getMedia(session, mediaId);
    const after = await api.listMedia(session);
    if (!Array.isArray(after)) throw Error("promo_official_media_list_unavailable");
    const verified = verifyPublishedMedia({ mediaId, item, recent: after, caption: current.job.content.caption });
    if (!verified) throw Error("promo_official_readback_not_exactly_once");
    if ((await readJob(resolved)).hash !== initial.hash) throw Error("promo_job_changed_during_publish_manual_reconciliation_required");
    const verifiedAt = clock().toISOString();
    current.job.workflow = { ...current.job.workflow, status: "published",
      postPublishVerification: { status: "passed", source: "official_instagram_graph_api_recent_media",
        verifiedAt, ...verified } };
    current.job.published = { containerId, ...verified, publishedAt: verifiedAt };
    await writeJsonAtomic(resolved, current.job);
    Object.assign(lock, { stage: "published_verified", verifiedAt, permalink: verified.permalink });
    await updateLock(lockPath, lock);
    return { status: "published_verified", jobId: current.job.id,
      mediaId, permalink: verified.permalink, lockRetained: true };
  } catch (error) {
    Object.assign(lock, { stage: "blocked_manual_reconciliation_required",
      blockedAt: clock().toISOString(), reason: /^promo_[a-z0-9_]+$/u.test(error.message)
        ? error.message : "promo_unexpected_error" });
    await updateLock(lockPath, lock).catch(() => {});
    throw Error(lock.reason);
  }
}

// Fail closed even if a caller supplies a forged approved job, injected API,
// CLOUD flag or permit verifier. A future trusted runner must bind an external
// editorial approval, remote claim and durable create/publish intent before
// replacing this gate. Local job JSON is not an authority to post.
async function publishPromoJob() {
  throw Error("promo_publish_disabled_pending_trusted_remote_claim_and_intent");
}

// A hermetic seam keeps the exact-once flow under test without accepting any
// caller-provided session, API or fetch implementation. It never touches Meta.
async function simulatePromoJobForTests({ job, imageBytes, behavior = {}, attempts = 1 } = {}) {
  if (!job || !Buffer.isBuffer(imageBytes) || attempts < 1 || attempts > 2) {
    throw Error("promo_test_fixture_invalid");
  }
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "promo-publisher-sim-"));
  const jobsDir = path.join(tempRoot, "jobs");
  const lockDir = path.join(tempRoot, "locks");
  const jobPath = path.join(jobsDir, `${job.id}.json`);
  const calls = { getApp: 0, getProfile: 0, getPage: 0, getPermissions: 0,
    listMedia: 0, createContainer: 0, publishContainer: 0, getMedia: 0 };
  const post = { id: "222", caption: job.content.caption, media_type: "IMAGE",
    permalink: "https://www.instagram.com/p/Promo123/", timestamp: "2026-09-25T00:00:00+0000" };
  const api = {
    async getApp() { calls.getApp += 1; return { id: APP_ID }; },
    async getProfile() { calls.getProfile += 1; return { id: "123456", username: ACCOUNT_USERNAME,
      website: behavior.website || HOME_URL }; },
    async getPage() { calls.getPage += 1; return { id: "987654",
      instagram_business_account: { id: behavior.pageAccountId || "123456" } }; },
    async getPermissions() { calls.getPermissions += 1;
      return { data: ["instagram_basic", "instagram_content_publish", "pages_show_list", "pages_read_engagement"]
        .map(permission => ({ permission, status: "granted" })) }; },
    async listMedia() { calls.listMedia += 1;
      return behavior.duplicate || calls.listMedia > 1 ? [post] : []; },
    async createContainer() { calls.createContainer += 1; return "111"; },
    async publishContainer() { calls.publishContainer += 1;
      if (behavior.failPublish) throw Error("simulated ambiguous response");
      return "222"; },
    async getMedia() { calls.getMedia += 1; return post; }
  };
  const session = { accessToken: "hermetic-test-token", graphVersion: "v23.0", accountId: "123456",
    selectedAccount: { accountId: "123456", pageId: "987654", username: ACCOUNT_USERNAME } };
  try {
    await fs.mkdir(jobsDir);
    await fs.writeFile(jobPath, JSON.stringify(job), "utf8");
    const outcomes = [];
    for (let i = 0; i < attempts; i += 1) {
      try {
        const result = await publishPromoJobInternalForTests({ jobPath, jobsDir, lockDir,
          session, api, imageFetch: async () => new Response(imageBytes,
            { headers: { "content-type": "image/jpeg" } }) });
        outcomes.push({ result });
      } catch (error) { outcomes.push({ error: error.message }); }
    }
    const savedJob = JSON.parse(await fs.readFile(jobPath, "utf8"));
    const lock = await fs.readFile(path.join(lockDir, `${job.id}.json`), "utf8")
      .then(JSON.parse, () => null);
    return { outcomes, calls, savedJob, lock };
  } finally {
    const temp = path.resolve(os.tmpdir());
    if (path.resolve(tempRoot).startsWith(`${temp}${path.sep}`)
        && path.basename(tempRoot).startsWith("promo-publisher-sim-")) {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  }
}

async function simulateInstagramTransportForTests({ imageUrl, caption } = {}) {
  const requests = [];
  const fetchImpl = async (url, options) => {
    const form = options.body ? new URLSearchParams(options.body) : null;
    requests.push({ pathname: url.pathname, method: options.method,
      imageUrl: form?.get("image_url") || null, caption: form?.get("caption") || null,
      creationId: form?.get("creation_id") || null });
    return new Response(JSON.stringify({ id: requests.length === 1 ? "111" : "222" }),
      { headers: { "content-type": "application/json" } });
  };
  const api = createInstagramApi({ fetchImpl });
  const session = { accountId: "123456", accessToken: "hermetic-test-token", graphVersion: "v23.0" };
  const containerId = await api.createContainer(session, { imageUrl, caption });
  const mediaId = await api.publishContainer(session, containerId);
  return { containerId, mediaId, requests };
}

function parseArgs(argv) {
  const options = { job: null, publish: false, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--publish") options.publish = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--job") options.job = argv[++i];
    else throw Error("promo_option_unsupported");
  }
  if (options.publish && options.dryRun) throw Error("promo_conflicting_modes");
  if (!options.job || options.job.startsWith("--")) throw Error("promo_job_required");
  return options;
}

async function runCli(argv = process.argv.slice(2), dependencies = {}) {
  const options = parseArgs(argv);
  if (options.publish) return publishPromoJob();
  const jobPath = resolveJobPath(options.job, dependencies.jobsDir || JOBS_DIR);
  const { job } = await readJob(jobPath);
  const errors = validateJob(job, { now: dependencies.clock ? dependencies.clock() : new Date() });
  if (errors.length) throw Error(`promo_job_preflight_blocked_${errors.join("_")}`);
  return { status: "dry_run", jobId: job.id, strategyVersion: STRATEGY_VERSION,
    wouldPublish: false, sessionRead: false, apiCalls: 0 };
}

if (require.main === module) {
  runCli().then(value => console.log(JSON.stringify(value)))
    .catch(error => { console.error(/^promo_[a-z0-9_]+$/u.test(error.message)
      ? error.message : "promo_publish_failed_without_secret_details"); process.exitCode = 1; });
}

module.exports = { APP_ID, STRATEGY_VERSION, acquireLock, assertCloudV3Permit, captionErrors,
  duplicateMedia, hostedImageUrl, isExpectedProfileWebsite, normalizeCaption, parseArgs,
  publishPromoJob, readLimitedBytes, resolveJobPath, runCli, sessionValues, sha256,
  simulateInstagramTransportForTests, simulatePromoJobForTests,
  validateJob, verifyHostedImage, verifyIdentity, verifyPublishedMedia };
