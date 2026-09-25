#!/usr/bin/env node
"use strict";

// Standalone channel-split-v3 publisher. The legacy TEXT publisher is unchanged.
// No external write is possible without an explicit --publish and an approved job.
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const JOBS_DIR = path.join(__dirname, "jobs");
const LOCK_DIR = path.join(__dirname, ".carousel-publish-locks");
const SESSION_PATH = "C:\\Users\\earth\\.codex\\threads\\session.json";
const API_BASE = "https://graph.threads.net/v1.0";
const STRATEGY = "channel-split-v3";
const FIELDS = "id,text,media_type,permalink,timestamp,children";
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_PAGES = 20;
const IMAGE_HOST = /^[a-f0-9]{8,}\.language-cafe-instagram-assets\.pages\.dev$/u;

class ImageVerificationError extends Error {}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function contentSha256(content) {
  function sorted(value) {
    if (Array.isArray(value)) return value.map(sorted);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted(value[key])]));
    }
    return value;
  }
  return sha256(Buffer.from(JSON.stringify(sorted(content)), "utf8"));
}

function normalizeText(value) {
  return String(value || "").normalize("NFC").replace(/\s+/gu, " ").trim().toLocaleLowerCase("en-US");
}

function inside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function parseArgs(args) {
  const result = { job: null, publish: false };
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--publish") {
      result.publish = true;
    } else if (args[i] === "--job" && args[i + 1] && !args[i + 1].startsWith("--")) {
      result.job = args[++i];
    } else {
      throw new Error("Use --job <approved Threads carousel job> [--publish].");
    }
  }
  if (!result.job) throw new Error("--job is required.");
  return result;
}

function resolveJobPath(value, jobsDir = JOBS_DIR) {
  const target = path.resolve(path.isAbsolute(value) ? value : path.join(PROJECT_ROOT, value));
  if (!inside(jobsDir, target) || path.extname(target).toLowerCase() !== ".json") {
    throw new Error("The carousel job must be a JSON file inside content-queue/threads/jobs.");
  }
  return target;
}

function siteUrl(value) {
  if (typeof value !== "string") throw new Error("content.siteUrl is required.");
  let url;
  try { url = new URL(value); } catch { throw new Error("content.siteUrl must be an HTTPS Language Cafe URL."); }
  if (url.protocol !== "https:" || url.hostname !== "languagestudio.uk" || url.username || url.password || url.port || url.hash || url.href !== value) {
    throw new Error("content.siteUrl must be a canonical HTTPS languagestudio.uk URL.");
  }
  const entries = [...url.searchParams.entries()];
  if (entries.length) {
    const expected = { utm_source: "threads", utm_medium: "organic", utm_campaign: "language_cafe" };
    const keys = entries.map(([key]) => key);
    if (keys.length < 3 || keys.length > 4 || new Set(keys).size !== keys.length ||
        Object.entries(expected).some(([key, item]) => url.searchParams.get(key) !== item) ||
        keys.some((key) => !Object.hasOwn(expected, key) && key !== "utm_content") ||
        (url.searchParams.has("utm_content") && !/^[a-z0-9][a-z0-9_-]{0,79}$/u.test(url.searchParams.get("utm_content")))) {
      throw new Error("content.siteUrl has unapproved tracking parameters.");
    }
  }
  return value;
}

function imageUrl(value) {
  if (typeof value !== "string") throw new Error("Each carousel image needs a public URL.");
  let url;
  try { url = new URL(value); } catch { throw new Error("Carousel image URL is invalid."); }
  if (url.protocol !== "https:" || !IMAGE_HOST.test(url.hostname) || url.username || url.password || url.port ||
      url.search || url.hash || url.href !== value || !/^\/[a-z0-9._/-]+\.(?:jpe?g|png)$/iu.test(url.pathname) || url.pathname.includes("..")) {
    throw new Error("Carousel images require versioned immutable Cloudflare Pages deployment URLs.");
  }
  return value;
}

function validateJob(job) {
  if (!job || job.schemaVersion !== 1 || job.channel !== "threads" || job.strategyVersion !== STRATEGY) {
    throw new Error("Only approved channel-split-v3 Threads carousel jobs are supported.");
  }
  if (!/^[a-z0-9][a-z0-9._-]{2,119}$/iu.test(job.id || "")) throw new Error("Invalid Threads carousel job id.");
  if (job.workflow?.status !== "approved" || job.published) throw new Error("Threads carousel job is not approved and unpublished.");
  const content = job.content;
  if (!content || typeof content.text !== "string" || !content.text.trim() || Array.from(content.text).length > 500) {
    throw new Error("Threads learner-facing text is required and must fit the 500-character limit.");
  }
  const expression = String(content.koreanExpression || "").trim();
  const explanation = String(content.englishExplanation || "").trim();
  if (expression.length < 2 || expression.length > 100 || !/[가-힣]/u.test(expression) ||
      !normalizeText(content.text).includes(normalizeText(expression))) {
    throw new Error("The approved Korean expression must appear in the learner-facing Threads text.");
  }
  if (explanation.length < 5 || explanation.length > 200 || !/[a-z]/iu.test(explanation) ||
      !normalizeText(content.text).includes(normalizeText(explanation))) {
    throw new Error("The approved English explanation must appear in the learner-facing Threads text.");
  }
  const target = siteUrl(content.siteUrl);
  const text = content.text;
  const finalLine = text.trimEnd().split(/\r?\n/u).at(-1).trim();
  if (!finalLine.endsWith(target) || finalLine === target || !/[a-z]/iu.test(finalLine.slice(0, -target.length))) {
    throw new Error("Threads text must end with a learner-facing Language Cafe site-link line.");
  }
  const urls = text.match(/https?:\/\/[^\s<>]+/giu) || [];
  if (urls.length !== 1 || urls[0] !== target || text.split(target).length !== 2) {
    throw new Error("Threads text must contain exactly one URL: content.siteUrl at the end.");
  }
  const preceding = text.slice(0, text.lastIndexOf(target));
  if (/\b(?:www\.)?(?:[a-z0-9-]+\.)+[a-z]{2,}\b/iu.test(preceding) || /(?:https?|ftp):|\/\//iu.test(preceding)) {
    throw new Error("Threads text contains another website or URL.");
  }
  if (!Array.isArray(content.images) || content.images.length < 2 || content.images.length > 8) {
    throw new Error("This Threads card-news strategy requires 2 to 8 images.");
  }
  const seen = new Set();
  const altTexts = new Set();
  const hosts = new Set();
  for (const item of content.images) {
    if (!item || typeof item !== "object") throw new Error("Each carousel image must be an object.");
    const publicUrl = imageUrl(item.url);
    if (!/^[a-f0-9]{64}$/u.test(item.sha256 || "")) throw new Error("Each carousel image needs a lowercase SHA-256 digest.");
    if (seen.has(publicUrl)) throw new Error("Carousel image URLs must be unique.");
    if (typeof item.altText !== "string" || !item.altText.trim() || Array.from(item.altText).length > 1000 ||
        altTexts.has(item.altText.trim())) throw new Error("Each carousel image needs unique nonempty altText.");
    seen.add(publicUrl);
    altTexts.add(item.altText.trim());
    hosts.add(new URL(publicUrl).hostname);
  }
  if (hosts.size !== 1) throw new Error("All carousel images must come from one immutable deployment.");
  const review = job.review;
  if (review?.status !== "passed" || review.contentSha256 !== contentSha256(content)) {
    throw new Error("Editorial approval must be bound to the exact Threads text and image content SHA-256.");
  }
  for (const name of ["koreanExpressionAccuracy", "englishExplanation", "mobileLegibility", "siteOfferAccuracy"]) {
    const gate = review[name];
    if (gate?.status !== "passed" || typeof gate.evidence !== "string" || gate.evidence.trim().length < 20) {
      throw new Error(`Threads carousel requires passed ${name} review with concrete evidence.`);
    }
  }
  if (review.mobileLegibility.checkedImageCount !== content.images.length) {
    throw new Error("Mobile legibility review must cover every approved carousel image.");
  }
  return { id: job.id, text, siteUrl: target, images: content.images };
}

function sessionValues(value, clock = () => new Date()) {
  const userId = String(value?.userId || value?.user_id || value?.threadsUserId || "").trim();
  const username = String(value?.username || "").trim();
  const accessToken = String(value?.accessToken || value?.access_token || value?.threadsAccessToken || "").trim();
  const expiresAt = Date.parse(String(value?.expiresAt || ""));
  const scopes = Array.isArray(value?.scopes) ? value.scopes : [];
  if (!/^[0-9]+$/u.test(userId) || username !== "mindulmin" || !accessToken || !Number.isFinite(expiresAt) || expiresAt <= clock().getTime() ||
      !["threads_basic", "threads_content_publish"].every((scope) => scopes.includes(scope))) {
    throw new Error("Threads session is missing, expired, or lacks publishing access.");
  }
  return { userId, username, accessToken };
}

async function assertCloudV3Permit(job, jobSha256, verifier, { cloudMode = process.env.LANGUAGE_CAFE_CLOUD === "1", clock = () => new Date() } = {}) {
  if (!cloudMode) return null;
  const runId = process.env.GITHUB_RUN_ID;
  if (typeof verifier !== "function" || !/^[0-9]+$/u.test(String(runId || ""))) {
    throw new Error("Threads cloud v3 permit verifier is unavailable.");
  }
  const expected = { schemaVersion: 1, strategyVersion: STRATEGY, channel: "threads", action: "publish_one_threads_carousel",
    jobId: job.id, jobSha256, runId };
  let permit;
  try { permit = await verifier(expected); }
  catch { throw new Error("Threads cloud v3 permit could not be verified."); }
  const now = clock().getTime();
  const issued = Date.parse(permit?.issuedAt);
  const expires = Date.parse(permit?.validUntil);
  if (permit?.verified !== true || Object.entries(expected).some(([key, value]) => permit?.[key] !== value) ||
      !/^[a-f0-9]{64}$/u.test(String(permit?.remoteClaimSha256 || "")) ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{2,180}$/u.test(String(permit?.actionId || "")) ||
      !Number.isFinite(issued) || !Number.isFinite(expires) || issued > now || expires < now ||
      issued > expires || expires - issued > 30 * 60 * 1000) {
    throw new Error("Threads cloud v3 permit does not match the durable remote claim.");
  }
  return { actionId: permit.actionId, remoteClaimSha256: permit.remoteClaimSha256, runId };
}

async function readJob(filePath, io = fs) {
  const bytes = await io.readFile(filePath);
  let job;
  try { job = JSON.parse(bytes.toString("utf8")); } catch { throw new Error("Threads carousel job JSON is unreadable."); }
  return { bytes, job, data: validateJob(job) };
}

async function verifyImages(images, { fetchImpl = globalThis.fetch, timeoutMs = 20000 } = {}) {
  if (typeof fetchImpl !== "function") throw new Error("Image fetch is unavailable.");
  const verified = [];
  for (const image of images) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(image.url, { method: "GET", redirect: "error", signal: controller.signal });
      if (!response?.ok) throw new ImageVerificationError("The public carousel image did not return HTTP 200.");
      const announced = Number(response.headers?.get?.("content-length"));
      if (announced > MAX_IMAGE_BYTES) throw new ImageVerificationError("A carousel image exceeds the size limit.");
      if (!response.body?.getReader) throw new ImageVerificationError("A public carousel image has no readable body.");
      const reader = response.body.getReader();
      const chunks = [];
      let byteCount = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = Buffer.from(value);
          byteCount += chunk.length;
          if (byteCount > MAX_IMAGE_BYTES) {
            await reader.cancel().catch(() => {});
            throw new ImageVerificationError("A carousel image exceeds the size limit.");
          }
          chunks.push(chunk);
        }
      } finally {
        reader.releaseLock();
      }
      const bytes = Buffer.concat(chunks, byteCount);
      if (!bytes.length) throw new ImageVerificationError("A carousel image has invalid byte length.");
      const isJpeg = bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9;
      const isPng = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
      const extension = path.extname(new URL(image.url).pathname).toLowerCase();
      const contentType = String(response.headers?.get?.("content-type") || "").split(";")[0].trim().toLowerCase();
      if (!((isJpeg && [".jpg", ".jpeg"].includes(extension) && contentType === "image/jpeg") ||
            (isPng && extension === ".png" && contentType === "image/png"))) {
        throw new ImageVerificationError("A carousel image is not the declared JPEG or PNG type.");
      }
      if (sha256(bytes) !== image.sha256) throw new ImageVerificationError("A public carousel image SHA-256 differs from the approved job.");
      verified.push({ url: image.url, sha256: image.sha256, bytes: bytes.length });
    } catch (error) {
      throw error instanceof ImageVerificationError ? error : new ImageVerificationError("Public carousel image verification failed.");
    } finally {
      clearTimeout(timer);
    }
  }
  return verified;
}

function createThreadsApi({ fetchImpl = globalThis.fetch, baseUrl = API_BASE, timeoutMs = 20000 } = {}) {
  if (typeof fetchImpl !== "function") throw new Error("Threads API fetch is unavailable.");
  async function request(method, pathname, operation, session, params) {
    const url = new URL(`${baseUrl}${pathname}`);
    const values = { ...params, access_token: session.accessToken };
    const form = method === "POST" ? new URLSearchParams(values) : null;
    if (!form) for (const [key, value] of Object.entries(values)) url.searchParams.set(key, String(value));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, { method, redirect: "error", headers: form ? { "content-type": "application/x-www-form-urlencoded" } : undefined, body: form?.toString(), signal: controller.signal });
      if (!response?.ok) throw new Error(`Threads ${operation} failed with HTTP ${response?.status || "unknown"}.`);
      let payload;
      try { payload = JSON.parse(await response.text()); } catch { throw new Error(`Threads ${operation} returned unreadable JSON.`); }
      if (!payload || typeof payload !== "object") throw new Error(`Threads ${operation} returned no object.`);
      return payload;
    } catch (error) {
      // Never carry response bodies, URLs, or tokens into an error or lock.
      if (String(error?.message || "").startsWith("Threads ")) throw error;
      throw new Error(`Threads ${operation} has an uncertain result.`);
    } finally {
      clearTimeout(timer);
    }
  }
  const userPath = (session) => `/${encodeURIComponent(session.userId)}`;
  const creationId = (payload, operation) => {
    if (!/^[0-9]+$/u.test(String(payload?.id || ""))) throw new Error(`Threads ${operation} returned no valid ID.`);
    return String(payload.id);
  };
  return {
    async getIdentity(session) {
      return request("GET", "/me", "account-identity readback", session, { fields: "id,username" });
    },
    async listRecentPosts(session) {
      const posts = [];
      let after;
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const payload = await request("GET", `${userPath(session)}/threads`, "recent-media readback", session, { fields: FIELDS, limit: "100", ...(after ? { after } : {}) });
        if (!Array.isArray(payload.data)) throw new Error("Threads recent-media readback returned no list.");
        posts.push(...payload.data);
        if (!payload.paging?.next) return posts;
        const next = payload.paging?.cursors?.after;
        if (!next || next === after) throw new Error("Threads recent-media pagination was incomplete.");
        after = next;
      }
      throw new Error("Threads recent-media history exceeded the verified page limit.");
    },
    async createImageContainer(session, image) {
      const payload = await request("POST", `${userPath(session)}/threads`, "IMAGE container creation", session,
        { media_type: "IMAGE", image_url: image.url, is_carousel_item: "true", ...(image.altText ? { alt_text: image.altText } : {}) });
      return creationId(payload, "IMAGE container creation");
    },
    async getContainerStatus(session, id) {
      return request("GET", `/${encodeURIComponent(id)}`, "container-status readback", session, { fields: "id,status,error_message" });
    },
    async createCarouselContainer(session, childIds, text) {
      const payload = await request("POST", `${userPath(session)}/threads`, "CAROUSEL container creation", session,
        { media_type: "CAROUSEL", children: childIds.join(","), text });
      return creationId(payload, "CAROUSEL container creation");
    },
    async publishContainer(session, id) {
      const payload = await request("POST", `${userPath(session)}/threads_publish`, "CAROUSEL publish", session, { creation_id: id });
      return creationId(payload, "CAROUSEL publish");
    },
    async getPost(session, id) {
      return request("GET", `/${encodeURIComponent(id)}`, "published-media readback", session, { fields: FIELDS });
    },
    async getChildMedia(session, id) {
      return request("GET", `/${encodeURIComponent(id)}`, "published-child readback", session,
        { fields: "id,media_url,alt_text" });
    }
  };
}

async function acquireLock(lockPath, value, io = fs) {
  await io.mkdir(path.dirname(lockPath), { recursive: true });
  let handle;
  try {
    handle = await io.open(lockPath, "wx");
    await handle.writeFile(`${JSON.stringify(value)}\n`, "utf8");
    await handle.sync();
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error("Threads carousel has an existing durable publish lock.");
    throw error;
  } finally {
    await handle?.close();
  }
}

async function writeAtomic(filePath, value, io = fs) {
  const temp = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  const handle = await io.open(temp, "wx");
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try { await io.rename(temp, filePath); } catch (error) { await io.unlink(temp).catch(() => {}); throw error; }
}

async function waitReady(api, session, id, { sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (attempt) await sleep(60000);
    const result = await api.getContainerStatus(session, id);
    if (String(result?.id || "") !== String(id)) throw new Error("Threads container-status ID mismatch.");
    if (result.status === "FINISHED" || result.status === "PUBLISHED") return;
    if (result.status === "ERROR" || result.status === "EXPIRED" || result.status !== "IN_PROGRESS") {
      throw new Error("Threads container did not become publishable.");
    }
  }
  throw new Error("Threads container was not ready after five status checks.");
}

function verifyObservedImageOrder(children, expectedImages, childContainerIds) {
  if (!Array.isArray(children) || !Array.isArray(expectedImages) || children.length !== expectedImages.length) {
    return { verified: false, basis: "children_unavailable_or_count_mismatch" };
  }
  const approvedUrls = new Set(expectedImages.map((image) => image.url));
  const checks = children.map((child, index) => {
    const expected = expectedImages[index];
    // A published child media ID is not necessarily its pre-publish container ID.
    // Compare IDs only when the API explicitly identifies a creation/container ID.
    if (child?.creation_id && String(child.creation_id) !== String(childContainerIds?.[index])) return null;
    if (child?.alt_text && child.alt_text !== expected.altText) return null;
    if (child?.media_url && approvedUrls.has(child.media_url) && child.media_url !== expected.url) return null;
    if (child?.creation_id && String(child.creation_id) === String(childContainerIds?.[index])) return "creation_id";
    if (child?.alt_text && expected.altText && child.alt_text === expected.altText) return "alt_text";
    if (child?.media_url && child.media_url === expected.url) return "media_url";
    return null;
  });
  return { verified: checks.every(Boolean), basis: checks.every(Boolean) ? [...new Set(checks)].join("+") : "image_order_unverified" };
}

async function exactReadback(api, session, mediaId, text, expectedImages = [], childContainerIds = []) {
  const [post, recent] = await Promise.all([api.getPost(session, mediaId), api.listRecentPosts(session)]);
  const matchedIds = recent.filter((item) => String(item?.id || "") === String(mediaId));
  const matchedText = recent.filter((item) => normalizeText(item?.text) === normalizeText(text));
  const mediaType = post?.media_type || null;
  let children = Array.isArray(post?.children?.data) ? post.children.data : null;
  let childDetailStatus = "not_needed";
  if (children && children.length === expectedImages.length &&
      children.some((child) => child?.id && !child.creation_id && !child.media_url && !child.alt_text)) {
    if (typeof api.getChildMedia !== "function") childDetailStatus = "unavailable";
    else {
      try {
        const details = await Promise.all(children.map((child) => api.getChildMedia(session, String(child.id))));
        if (details.some((detail, index) => String(detail?.id || "") !== String(children[index]?.id || ""))) {
          childDetailStatus = "id_mismatch";
        } else {
          children = children.map((child, index) => ({ ...child, ...details[index] }));
          childDetailStatus = "read";
        }
      } catch { childDetailStatus = "unavailable"; }
    }
  }
  const order = verifyObservedImageOrder(children, expectedImages, childContainerIds);
  const passed = String(post?.id || "") === String(mediaId) && normalizeText(post?.text) === normalizeText(text) &&
    mediaType === "CAROUSEL" && order.verified &&
    matchedIds.length === 1 && matchedText.length === 1 &&
    matchedIds[0]?.media_type === "CAROUSEL" && Boolean(post?.permalink);
  return { passed, mediaId: String(mediaId), permalink: post?.permalink || null,
    mediaType: mediaType || "unavailable", childrenObserved: children?.length ?? "unavailable",
    childMediaIdsObserved: children?.map((child) => String(child?.id || "")) ?? [],
    imageOrderVerified: order.verified, imageOrderBasis: order.basis, childDetailStatus,
    mediaIdMatchCount: matchedIds.length, normalizedFullTextMatchCount: matchedText.length,
    timestamp: post?.timestamp || null };
}

async function publishJob(jobPath, dependencies = {}) {
  const io = dependencies.fs || fs;
  const first = await readJob(jobPath, io);
  const cloudPermit = await assertCloudV3Permit(first.job, sha256(first.bytes), dependencies.cloudPermitVerifier,
    { cloudMode: process.env.LANGUAGE_CAFE_CLOUD === "1" || dependencies.cloudMode === true, clock: dependencies.clock });
  const verifiedImages = await verifyImages(first.data.images, { fetchImpl: dependencies.imageFetch, timeoutMs: dependencies.timeoutMs });
  let session;
  if (dependencies.session) session = sessionValues(dependencies.session, dependencies.clock);
  else {
    let value;
    try { value = JSON.parse(process.env.THREADS_SESSION_JSON || await io.readFile(dependencies.sessionPath || SESSION_PATH, "utf8")); }
    catch { throw new Error("Threads session cannot be read."); }
    session = sessionValues(value, dependencies.clock);
  }
  const api = dependencies.api || createThreadsApi({ fetchImpl: dependencies.apiFetch, timeoutMs: dependencies.timeoutMs });
  const lockPath = path.join(path.resolve(dependencies.lockDirectory || LOCK_DIR), `${first.data.id}.json`);
  const lockedAt = new Date().toISOString();
  const lock = { schemaVersion: 1, channel: "threads", strategyVersion: STRATEGY, jobId: first.data.id,
    jobSha256: sha256(first.bytes), startedAt: lockedAt, status: "locked_before_api", verifiedImageSha256: verifiedImages.map((item) => item.sha256),
    cloudPermit: cloudPermit || null, childIds: [], carouselContainerId: null, publishCallCount: 0, mediaId: null };
  await acquireLock(lockPath, lock, io);
  const saveLock = async (status, more = {}) => { Object.assign(lock, { status, ...more, updatedAt: new Date().toISOString() }); await writeAtomic(lockPath, lock, io); };
  try {
    const current = await readJob(jobPath, io);
    if (sha256(current.bytes) !== lock.jobSha256) throw new Error("Threads carousel job changed after locking.");
    const identity = await api.getIdentity(session);
    if (String(identity?.id || "") !== session.userId || String(identity?.username || "") !== session.username) {
      throw new Error("Threads official identity does not match the approved account.");
    }
    const recent = await api.listRecentPosts(session);
    if (recent.some((post) => normalizeText(post?.text) === normalizeText(current.data.text))) {
      await saveLock("blocked_duplicate");
      return { status: "blocked_duplicate", lockRetained: true };
    }
    for (const image of current.data.images) {
      await saveLock("creating_image_container", { nextImageIndex: lock.childIds.length });
      const id = await api.createImageContainer(session, image);
      lock.childIds.push(id);
      await saveLock("image_container_created", { nextImageIndex: lock.childIds.length });
    }
    for (const id of lock.childIds) await waitReady(api, session, id, { sleep: dependencies.sleep });
    await saveLock("creating_carousel_container");
    const carouselId = await api.createCarouselContainer(session, lock.childIds, current.data.text);
    await saveLock("carousel_container_created", { carouselContainerId: carouselId });
    await waitReady(api, session, carouselId, { sleep: dependencies.sleep });
    await saveLock("publishing_carousel", { publishCallCount: 1 });
    const mediaId = await api.publishContainer(session, carouselId);
    await saveLock("published_awaiting_readback", { mediaId });
    const readback = await exactReadback(api, session, mediaId, current.data.text, current.data.images, lock.childIds);
    if (!readback.passed) {
      await saveLock("blocked_readback", { readback });
      return { status: "blocked_readback", lockRetained: true, mediaId };
    }
    await saveLock("verified_before_job_receipt", { readback });
    current.job.workflow = { ...current.job.workflow, status: "published" };
    current.job.published = { channel: "threads", strategyVersion: STRATEGY, mediaId, carouselContainerId: carouselId,
      childContainerIds: [...lock.childIds], imageSha256: verifiedImages.map((item) => item.sha256),
      verification: readback, publishedAt: new Date().toISOString() };
    await writeAtomic(jobPath, current.job, io);
    await saveLock("published_verified", { readback });
    return { status: "published", mediaId, permalink: readback.permalink, lockRetained: true, verification: readback };
  } catch (error) {
    try { await saveLock("blocked_ambiguous", { failureStage: lock.status }); } catch { /* Original durable lock remains. */ }
    return { status: "blocked_ambiguous", lockRetained: true, reason: "The attempt stopped. Inspect official Threads media and the retained per-job lock before any new attempt." };
  }
}

async function runCli(args = process.argv.slice(2), dependencies = {}) {
  const options = parseArgs(args);
  const jobPath = resolveJobPath(options.job, dependencies.jobsDirectory || JOBS_DIR);
  const { job, data } = await readJob(jobPath, dependencies.fs || fs);
  if (!options.publish) return { status: "dry_run", jobId: data.id, imageCount: data.images.length, siteUrl: data.siteUrl, wouldCallThreadsApi: false };
  return publishJob(jobPath, dependencies);
}

async function main() {
  try { console.log(JSON.stringify(await runCli(), null, 2)); }
  catch (error) { console.error(String(error?.message || "Threads carousel publisher failed.")); process.exitCode = 1; }
}
if (require.main === module) void main();

module.exports = { API_BASE, FIELDS, STRATEGY, acquireLock, assertCloudV3Permit, contentSha256, createThreadsApi, exactReadback, imageUrl,
  parseArgs, publishJob, resolveJobPath, runCli, sessionValues, siteUrl, validateJob, verifyImages, waitReady };
