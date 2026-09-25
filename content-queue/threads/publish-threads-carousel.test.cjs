"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  __testOnly, contentSha256, createThreadsApi, exactReadback, publishJob: publicPublishJob,
  runCli: publicRunCli, validateJob
} = require("./publish-threads-carousel.cjs");
assert.ok(__testOnly, "Synthetic publisher tests require the Node test runner.");
const { publishJob, runCli } = __testOnly;

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const HASH = crypto.createHash("sha256").update(JPEG).digest("hex");
const DEPLOYMENT = "1234abcd.language-cafe-instagram-assets.pages.dev";
const SITE = "https://languagestudio.uk/missions/korean-cafe/?utm_source=threads&utm_medium=organic&utm_campaign=language_cafe&utm_content=expression-050";

function job(overrides = {}) {
  const content = overrides.content || {
    koreanExpression: "재미있어요",
    englishExplanation: "It is fun.",
    text: `At a board-game café, say 재미있어요. It is fun. Swipe through the scene, meaning, and a quick recall card.\nTry the free Korean café-ordering pilot at Language Cafe → ${SITE}`,
    siteUrl: SITE,
    images: [1, 2].map((n) => ({ url: `https://${DEPLOYMENT}/expression-050-abcd1234/card-0${n}.jpg`, sha256: HASH,
      altText: `Reviewed learner card ${n}: Korean expression and English meaning.` }))
  };
  return {
    schemaVersion: 1,
    id: "expression-050-threads-carousel",
    channel: "threads",
    strategyVersion: "channel-split-v3",
    workflow: { status: "approved" },
    content,
    review: {
      status: "passed",
      contentSha256: contentSha256(content),
      koreanExpressionAccuracy: { status: "passed", evidence: "Checked the polite Korean expression 재미있어요 in the board-game scene." },
      englishExplanation: { status: "passed", evidence: "The English line It is fun. matches the learner-facing Korean meaning." },
      mobileLegibility: { status: "passed", evidence: "Both cards were checked at phone width with readable Korean and English text.", checkedImageCount: content.images.length },
      siteOfferAccuracy: { status: "passed", evidence: "The final link invites the free Korean café-ordering pilot without promising practice of this exact card expression.",
        url: "https://languagestudio.uk/missions/korean-cafe/", checkedAt: new Date().toISOString() }
    },
    ...overrides
  };
}

function response(bytes = JPEG) {
  return {
    ok: true, status: 200,
    headers: { get: (key) => ({ "content-type": "image/jpeg", "content-length": String(bytes.length) })[key] || null },
    body: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } })
  };
}

function session() {
  return { userId: "123456", username: "mindulmin", accessToken: "never-print-this-token", expiresAt: "2099-01-01T00:00:00.000Z", scopes: ["threads_basic", "threads_content_publish"] };
}

async function fixture(t, value = job()) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "threads-carousel-test-"));
  t.after(async () => {
    if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith("threads-carousel-test-")) throw new Error("Unsafe test cleanup target.");
    await fs.rm(root, { recursive: true, force: true });
  });
  const jobsDirectory = path.join(root, "jobs");
  const lockDirectory = path.join(root, "locks");
  await fs.mkdir(jobsDirectory);
  const jobPath = path.join(jobsDirectory, `${value.id}.json`);
  await fs.writeFile(jobPath, `${JSON.stringify(value, null, 2)}\n`);
  return { root, jobsDirectory, lockDirectory, jobPath };
}

function fakeApi(initial = []) {
  const state = { posts: initial, identityCalls: 0, imageCalls: [], carouselCalls: [], publishCalls: 0, statusCalls: [] };
  return {
    state,
    async getIdentity() { state.identityCalls += 1; return { id: "123456", username: "mindulmin" }; },
    async listRecentPosts() { return state.posts; },
    async createImageContainer(_session, image) { state.imageCalls.push(image.url); return String(1000 + state.imageCalls.length); },
    async getContainerStatus(_session, id) { state.statusCalls.push(id); return { id, status: "FINISHED" }; },
    async createCarouselContainer(_session, children, text) { state.carouselCalls.push({ children, text }); return "2000"; },
    async publishContainer() {
      state.publishCalls += 1;
      state.posts = [{ id: "3000", text: job().content.text, media_type: "CAROUSEL", permalink: "https://www.threads.com/@mindulmin/post/abc",
        children: { data: job().content.images.map((image, index) => ({ id: String(4001 + index), alt_text: image.altText })) } }];
      return "3000";
    },
    async getPost() { return state.posts[0]; }
  };
}

function deps(f, api, other = {}) {
  return { jobsDirectory: f.jobsDirectory, lockDirectory: f.lockDirectory, api,
    session: session(), imageFetch: async () => response(), sleep: async () => {}, ...other };
}

test("public CLI and exported publishJob stay blocked in local and cloud modes with zero social writes", async (t) => {
  const f = await fixture(t);
  const previous = process.env.LANGUAGE_CAFE_CLOUD;
  try {
    for (const cloudMode of ["0", "1"]) {
      process.env.LANGUAGE_CAFE_CLOUD = cloudMode;
      const api = fakeApi();
      let imageFetches = 0;
      const dependencies = deps(f, api, { imageFetch: async () => { imageFetches += 1; return response(); } });
      await assert.rejects(() => publicRunCli(["--job", f.jobPath, "--publish"], dependencies), /live publishing is disabled/);
      await assert.rejects(() => publicPublishJob(f.jobPath, dependencies), /live publishing is disabled/);
      assert.equal(imageFetches, 0);
      assert.equal(api.state.identityCalls, 0);
      assert.equal(api.state.imageCalls.length, 0);
      assert.equal(api.state.carouselCalls.length, 0);
      assert.equal(api.state.publishCalls, 0);
      await assert.rejects(() => fs.stat(f.lockDirectory), { code: "ENOENT" });
    }
  } finally {
    if (previous === undefined) delete process.env.LANGUAGE_CAFE_CLOUD;
    else process.env.LANGUAGE_CAFE_CLOUD = previous;
  }
});

test("exported publishJob cannot accept an arbitrary job path", async (t) => {
  const f = await fixture(t);
  await assert.rejects(() => publicPublishJob(path.join(f.root, "outside.json"), deps(f, fakeApi())), /inside content-queue\/threads\/jobs/);
});

test("synthetic test seam rejects non-test credentials before network or a lock", async (t) => {
  const f = await fixture(t);
  const api = fakeApi();
  await assert.rejects(() => publishJob(f.jobPath, deps(f, api, { session: { ...session(), accessToken: "not-the-synthetic-token" } })), /limited to synthetic tests/);
  assert.equal(api.state.identityCalls, 0);
  assert.equal(api.state.imageCalls.length, 0);
  await assert.rejects(() => fs.stat(f.lockDirectory), { code: "ENOENT" });
});

test("new strategy validation requires one final site link and immutable hashed images", () => {
  const valid = job();
  assert.equal(validateJob(valid).images.length, 2);
  assert.throws(() => validateJob({ ...valid, strategyVersion: "instagram-study-companion-link-v2" }), /channel-split-v3/);
  assert.throws(() => validateJob(job({ content: { ...valid.content, text: `${valid.content.text}\nhttps://example.org/` } })), /exactly one URL|end with/);
  assert.throws(() => validateJob(job({ content: { ...valid.content, siteUrl: "https://evil.example/?utm_source=threads" } })), /Korean mission URL/);
  assert.throws(() => validateJob(job({ content: { ...valid.content, siteUrl: "https://languagestudio.uk/" } })), /Korean mission URL/);
  assert.throws(() => validateJob(job({ content: { ...valid.content, images: valid.content.images.map((x) => ({ ...x, url: x.url.replace("1234abcd.", "") })) } })), /immutable/);
  assert.throws(() => validateJob(job({ content: { ...valid.content, images: valid.content.images.map((x) => ({ ...x, sha256: "a" })) } })), /SHA-256/);
  assert.throws(() => validateJob(job({ content: { ...valid.content, images: [valid.content.images[0]] } })), /2 to 8/);
  assert.throws(() => validateJob(job({ content: { ...valid.content, images: valid.content.images.map((x) => ({ url: x.url, sha256: x.sha256 })) } })), /unique nonempty altText/);
  assert.throws(() => validateJob(job({ content: { ...valid.content, images: valid.content.images.map((x) => ({ ...x, altText: "same text" })) } })), /unique nonempty altText/);
});

test("editorial approval binds the exact Korean-expression lesson, English explanation, image hashes, and review gates", () => {
  const valid = job();
  assert.equal(validateJob(valid).id, valid.id);
  assert.throws(() => validateJob({ ...valid, review: undefined }), /Editorial approval/);
  assert.throws(() => validateJob({ ...valid, content: { ...valid.content, text: valid.content.text.replace("board-game", "tabletop") } }), /content SHA-256/);
  assert.throws(() => validateJob({ ...valid, content: { ...valid.content,
    images: [{ ...valid.content.images[0], sha256: "a".repeat(64) }, valid.content.images[1]] } }), /content SHA-256/);
  assert.throws(() => validateJob({ ...valid, review: { ...valid.review, koreanExpressionAccuracy: { status: "pending", evidence: "This is not an approved expression review." } } }), /koreanExpressionAccuracy/);
  assert.throws(() => validateJob({ ...valid, review: { ...valid.review, siteOfferAccuracy: { status: "pending", evidence: "The destination claim has not been checked against the current homepage." } } }), /siteOfferAccuracy/);
  assert.throws(() => validateJob({ ...valid, review: { ...valid.review, siteOfferAccuracy: { ...valid.review.siteOfferAccuracy, checkedAt: "2026-01-01T00:00:00.000Z" } } }), /fresh matching landing-page/);
  assert.throws(() => validateJob({ ...valid, review: { ...valid.review, mobileLegibility: { ...valid.review.mobileLegibility, checkedImageCount: 1 } } }), /every approved carousel image/);
  assert.throws(() => validateJob(job({ content: { ...valid.content, koreanExpression: "English only" } })), /Korean expression/);
  assert.throws(() => validateJob(job({ content: { ...valid.content, englishExplanation: "Korean only" } })), /English explanation/);
});

test("direct publishJob call cannot bypass the cloud strategy permit", async (t) => {
  const f = await fixture(t);
  const previous = process.env.LANGUAGE_CAFE_CLOUD;
  const previousRunId = process.env.GITHUB_RUN_ID;
  process.env.LANGUAGE_CAFE_CLOUD = "1";
  process.env.GITHUB_RUN_ID = "123456789";
  try {
    await assert.rejects(() => publishJob(f.jobPath, deps(f, fakeApi())), /permit verifier is unavailable/);
  } finally {
    if (previous === undefined) delete process.env.LANGUAGE_CAFE_CLOUD;
    else process.env.LANGUAGE_CAFE_CLOUD = previous;
    if (previousRunId === undefined) delete process.env.GITHUB_RUN_ID;
    else process.env.GITHUB_RUN_ID = previousRunId;
  }
  await assert.rejects(() => fs.stat(f.lockDirectory), { code: "ENOENT" });
});

test("cloud permit verifier must bind raw job hash, action, run and durable remote claim", async (t) => {
  const f = await fixture(t);
  const previous = process.env.LANGUAGE_CAFE_CLOUD;
  const previousRunId = process.env.GITHUB_RUN_ID;
  process.env.LANGUAGE_CAFE_CLOUD = "1";
  process.env.GITHUB_RUN_ID = "123456789";
  const permit = (expected) => ({ ...expected, verified: true, actionId: "v3-threads-action-1",
    remoteClaimSha256: "a".repeat(64), issuedAt: "2026-09-25T00:00:00Z", validUntil: "2026-09-25T00:10:00Z" });
  const clock = () => new Date("2026-09-25T00:05:00Z");
  try {
    await assert.rejects(() => publishJob(f.jobPath, deps(f, fakeApi(), { clock,
      cloudPermitVerifier: (expected) => ({ ...permit(expected), jobSha256: "b".repeat(64) }) })), /does not match/);
    await assert.rejects(() => publishJob(f.jobPath, deps(f, fakeApi(), { clock,
      cloudPermitVerifier: (expected) => ({ ...permit(expected), channel: "instagram" }) })), /does not match/);
    await assert.rejects(() => publishJob(f.jobPath, deps(f, fakeApi(), { clock,
      cloudPermitVerifier: (expected) => ({ ...permit(expected), validUntil: "2026-09-25T00:04:00Z" }) })), /does not match/);
    await assert.rejects(() => fs.stat(f.lockDirectory), { code: "ENOENT" });
    const result = await publishJob(f.jobPath, deps(f, fakeApi(), { clock, cloudPermitVerifier: permit }));
    assert.equal(result.status, "published");
    const lock = JSON.parse(await fs.readFile(path.join(f.lockDirectory, `${job().id}.json`), "utf8"));
    assert.equal(lock.cloudPermit.runId, "123456789");
    assert.equal(lock.cloudPermit.remoteClaimSha256, "a".repeat(64));
  } finally {
    if (previous === undefined) delete process.env.LANGUAGE_CAFE_CLOUD;
    else process.env.LANGUAGE_CAFE_CLOUD = previous;
    if (previousRunId === undefined) delete process.env.GITHUB_RUN_ID;
    else process.env.GITHUB_RUN_ID = previousRunId;
  }
});

test("default dry-run never loads a session, checks images, or calls Threads", async (t) => {
  const f = await fixture(t);
  const result = await runCli(["--job", f.jobPath], { jobsDirectory: f.jobsDirectory,
    sessionPath: path.join(f.root, "missing-session.json"), imageFetch: async () => { throw new Error("image fetch called"); },
    api: { listRecentPosts: async () => { throw new Error("Threads API called"); } } });
  assert.equal(result.status, "dry_run");
  assert.equal(result.wouldCallThreadsApi, false);
  await assert.rejects(() => fs.stat(f.lockDirectory), { code: "ENOENT" });
});

test("official Threads API adapter sends ordered IMAGE children, CAROUSEL parent, and one publish request", async () => {
  const calls = [];
  const api = createThreadsApi({ fetchImpl: async (url, options) => {
    const form = new URLSearchParams(options.body || "");
    calls.push({ url: String(url), method: options.method, form });
    return { ok: true, status: 200, async text() { return JSON.stringify({ id: String(1000 + calls.length) }); } };
  } });
  const user = session();
  await api.getIdentity(user);
  const first = await api.createImageContainer(user, { url: `https://${DEPLOYMENT}/lesson/card-01.jpg`, altText: "Reviewed Korean lesson card one" });
  const second = await api.createImageContainer(user, { url: `https://${DEPLOYMENT}/lesson/card-02.jpg` });
  const carousel = await api.createCarouselContainer(user, [first, second], job().content.text);
  await api.publishContainer(user, carousel);
  assert.equal(calls.length, 5);
  assert.ok(calls[0].url.includes("/me?fields=id%2Cusername"));
  assert.deepEqual([...calls[1].form.keys()].sort(), ["access_token", "alt_text", "image_url", "is_carousel_item", "media_type"]);
  assert.equal(calls[1].form.get("media_type"), "IMAGE");
  assert.equal(calls[1].form.get("alt_text"), "Reviewed Korean lesson card one");
  assert.equal(calls[1].form.get("is_carousel_item"), "true");
  assert.equal(calls[2].form.has("alt_text"), false);
  assert.equal(calls[3].form.get("media_type"), "CAROUSEL");
  assert.equal(calls[3].form.get("children"), `${first},${second}`);
  assert.equal(calls[3].form.get("text"), job().content.text);
  assert.equal(calls[4].form.get("creation_id"), carousel);
  assert.ok(calls[4].url.endsWith("/123456/threads_publish"));
});

test("publish verifies public bytes, creates exactly one carousel, and retains a durable verified lock", async (t) => {
  const f = await fixture(t);
  const api = fakeApi();
  const result = await runCli(["--job", f.jobPath, "--publish"], deps(f, api));
  const saved = JSON.parse(await fs.readFile(f.jobPath, "utf8"));
  const lock = JSON.parse(await fs.readFile(path.join(f.lockDirectory, `${saved.id}.json`), "utf8"));
  assert.equal(result.status, "published");
  assert.equal(api.state.imageCalls.length, 2);
  assert.deepEqual(api.state.carouselCalls[0].children, ["1001", "1002"]);
  assert.equal(api.state.publishCalls, 1);
  assert.equal(saved.workflow.status, "published");
  assert.equal(saved.published.verification.mediaIdMatchCount, 1);
  assert.equal(saved.published.verification.normalizedFullTextMatchCount, 1);
  assert.equal(saved.published.verification.mediaType, "CAROUSEL");
  assert.equal(saved.published.verification.imageOrderVerified, true);
  assert.equal(saved.published.verification.imageOrderBasis, "alt_text");
  assert.equal(saved.published.verification.childrenObserved, 2);
  assert.deepEqual(saved.published.verification.childMediaIdsObserved, ["4001", "4002"]);
  assert.equal(lock.status, "published_verified");
  assert.equal(lock.publishCallCount, 1);
  await assert.rejects(() => runCli(["--job", f.jobPath, "--publish"], deps(f, api)), /approved and unpublished/);
});

test("public image SHA mismatch prevents any Threads API call and lock", async (t) => {
  const f = await fixture(t);
  const api = fakeApi();
  await assert.rejects(() => runCli(["--job", f.jobPath, "--publish"], deps(f, api, { imageFetch: async () => response(Buffer.from([0xff, 0xd8, 1, 0xff, 0xd9])) })), /SHA-256/);
  assert.equal(api.state.imageCalls.length, 0);
  await assert.rejects(() => fs.stat(f.lockDirectory), { code: "ENOENT" });
});

test("streamed image size is bounded even when Content-Length is absent", async (t) => {
  const f = await fixture(t);
  const api = fakeApi();
  const oversized = Buffer.alloc(12 * 1024 * 1024 + 1, 0xff);
  await assert.rejects(() => runCli(["--job", f.jobPath, "--publish"], deps(f, api, {
    imageFetch: async () => ({ ok: true, status: 200,
      headers: { get: (key) => key === "content-type" ? "image/jpeg" : null },
      body: new ReadableStream({ start(controller) { controller.enqueue(oversized); controller.close(); } }) })
  })), /exceeds the size limit/);
  assert.equal(api.state.imageCalls.length, 0);
  await assert.rejects(() => fs.stat(f.lockDirectory), { code: "ENOENT" });
});

test("official duplicate stops before media creation and leaves a lock", async (t) => {
  const f = await fixture(t);
  const api = fakeApi([{ id: "42", text: job().content.text, media_type: "CAROUSEL" }]);
  const result = await runCli(["--job", f.jobPath, "--publish"], deps(f, api));
  assert.equal(result.status, "blocked_duplicate");
  assert.equal(api.state.imageCalls.length, 0);
  const lock = JSON.parse(await fs.readFile(path.join(f.lockDirectory, `${job().id}.json`), "utf8"));
  assert.equal(lock.status, "blocked_duplicate");
});

test("session and official Threads identity must both resolve to mindulmin before image creation", async (t) => {
  const f = await fixture(t);
  const api = fakeApi();
  await assert.rejects(() => runCli(["--job", f.jobPath, "--publish"], deps(f, api,
    { session: { ...session(), username: "other-account" } })), /session is missing|publishing access/);
  assert.equal(api.state.identityCalls, 0);
  assert.equal(api.state.imageCalls.length, 0);
  api.getIdentity = async () => ({ id: "123456", username: "another-account" });
  const result = await runCli(["--job", f.jobPath, "--publish"], deps(f, api));
  assert.equal(result.status, "blocked_ambiguous");
  assert.equal(api.state.imageCalls.length, 0);
  assert.equal(api.state.publishCalls, 0);
  const lock = JSON.parse(await fs.readFile(path.join(f.lockDirectory, `${job().id}.json`), "utf8"));
  assert.equal(lock.status, "blocked_ambiguous");
});

test("the durable lock is already on disk before the first Threads API request", async (t) => {
  const f = await fixture(t);
  const api = fakeApi();
  api.getIdentity = async () => {
    const lock = JSON.parse(await fs.readFile(path.join(f.lockDirectory, `${job().id}.json`), "utf8"));
    assert.equal(lock.status, "locked_before_api");
    assert.equal(lock.publishCallCount, 0);
    return { id: "123456", username: "mindulmin" };
  };
  api.listRecentPosts = async () => {
    return [{ id: "42", text: job().content.text, media_type: "CAROUSEL" }];
  };
  const result = await runCli(["--job", f.jobPath, "--publish"], deps(f, api));
  assert.equal(result.status, "blocked_duplicate");
});

test("ambiguous publish response is never retried and retains the pre-API lock", async (t) => {
  const f = await fixture(t);
  const api = fakeApi();
  api.publishContainer = async () => { api.state.publishCalls += 1; throw new Error("network lost after POST"); };
  const result = await runCli(["--job", f.jobPath, "--publish"], deps(f, api));
  const lock = JSON.parse(await fs.readFile(path.join(f.lockDirectory, `${job().id}.json`), "utf8"));
  assert.equal(result.status, "blocked_ambiguous");
  assert.equal(api.state.publishCalls, 1);
  assert.equal(lock.status, "blocked_ambiguous");
  assert.equal(lock.publishCallCount, 1);
  await assert.rejects(() => runCli(["--job", f.jobPath, "--publish"], deps(f, api)), /existing durable publish lock/);
});

test("missing carousel media type blocks success and records unavailable", async (t) => {
  const f = await fixture(t);
  const api = fakeApi();
  api.getPost = async () => ({ id: "3000", text: job().content.text, permalink: "https://www.threads.com/@mindulmin/post/abc" });
  const result = await runCli(["--job", f.jobPath, "--publish"], deps(f, api));
  const lock = JSON.parse(await fs.readFile(path.join(f.lockDirectory, `${job().id}.json`), "utf8"));
  assert.equal(result.status, "blocked_readback");
  assert.equal(lock.readback.mediaType, "unavailable");
  assert.equal(lock.readback.imageOrderVerified, false);
  assert.equal(lock.readback.passed, false);
});

test("exact readback rejects a second full-text match", async () => {
  const text = job().content.text;
  const item = { id: "3000", text, media_type: "CAROUSEL", permalink: "https://www.threads.com/@mindulmin/post/abc",
    children: { data: job().content.images.map((image, index) => ({ id: String(4001 + index), alt_text: image.altText })) } };
  const api = { getPost: async () => item, listRecentPosts: async () => [item, { ...item, id: "3001" }] };
  const check = await exactReadback(api, session(), "3000", text, job().content.images, ["1001", "1002"]);
  assert.equal(check.passed, false);
  assert.equal(check.normalizedFullTextMatchCount, 2);
});

test("exact readback rejects an observed carousel child-count mismatch", async () => {
  const text = job().content.text;
  const item = { id: "3000", text, media_type: "CAROUSEL", permalink: "https://www.threads.com/@mindulmin/post/abc", children: { data: [{ id: "one" }] } };
  const api = { getPost: async () => item, listRecentPosts: async () => [item] };
  const check = await exactReadback(api, session(), "3000", text, job().content.images, ["1001", "1002"]);
  assert.equal(check.passed, false);
  assert.equal(check.childrenObserved, 1);
});

test("published carousel with child IDs but no ordered image evidence remains unresolved", async (t) => {
  const f = await fixture(t);
  const api = fakeApi();
  api.getPost = async () => ({ id: "3000", text: job().content.text, media_type: "CAROUSEL",
    permalink: "https://www.threads.com/@mindulmin/post/abc", children: { data: [{ id: "4001" }, { id: "4002" }] } });
  const result = await runCli(["--job", f.jobPath, "--publish"], deps(f, api));
  const lock = JSON.parse(await fs.readFile(path.join(f.lockDirectory, `${job().id}.json`), "utf8"));
  assert.equal(result.status, "blocked_readback");
  assert.equal(api.state.publishCalls, 1);
  assert.equal(lock.readback.imageOrderVerified, false);
  assert.equal(lock.readback.imageOrderBasis, "image_order_unverified");
  assert.equal(lock.readback.childDetailStatus, "unavailable");
  assert.equal(lock.status, "blocked_readback");
});

test("IDs-only carousel children are verified by ordered official child-detail alt text", async (t) => {
  const f = await fixture(t);
  const api = fakeApi();
  const imageById = new Map(job().content.images.map((image, index) => [String(4001 + index), image]));
  const childReads = [];
  api.getPost = async () => ({ id: "3000", text: job().content.text, media_type: "CAROUSEL",
    permalink: "https://www.threads.com/@mindulmin/post/abc", children: { data: [{ id: "4001" }, { id: "4002" }] } });
  api.getChildMedia = async (_session, id) => {
    childReads.push(id);
    return { id, alt_text: imageById.get(id).altText, media_url: `https://cdn.example.test/${id}.jpg` };
  };
  const result = await runCli(["--job", f.jobPath, "--publish"], deps(f, api));
  assert.equal(result.status, "published");
  assert.deepEqual(childReads, ["4001", "4002"]);
  assert.equal(result.verification.imageOrderVerified, true);
  assert.equal(result.verification.imageOrderBasis, "alt_text");
  assert.equal(result.verification.childDetailStatus, "read");
});

test("unavailable or mismatched child-detail GET blocks confirmation without republishing", async (t) => {
  const f = await fixture(t);
  const api = fakeApi();
  api.getPost = async () => ({ id: "3000", text: job().content.text, media_type: "CAROUSEL",
    permalink: "https://www.threads.com/@mindulmin/post/abc", children: { data: [{ id: "4001" }, { id: "4002" }] } });
  api.getChildMedia = async () => { throw new Error("read only endpoint unavailable"); };
  const result = await runCli(["--job", f.jobPath, "--publish"], deps(f, api));
  const lock = JSON.parse(await fs.readFile(path.join(f.lockDirectory, `${job().id}.json`), "utf8"));
  assert.equal(result.status, "blocked_readback");
  assert.equal(lock.readback.childDetailStatus, "unavailable");
  assert.equal(lock.publishCallCount, 1);
  await assert.rejects(() => runCli(["--job", f.jobPath, "--publish"], deps(f, api)), /existing durable publish lock/);
});

test("child-detail GET identity mismatch cannot supply ordered-image proof", async () => {
  const images = job().content.images;
  const item = { id: "3000", text: job().content.text, media_type: "CAROUSEL",
    permalink: "https://www.threads.com/@mindulmin/post/abc", children: { data: [{ id: "4001" }, { id: "4002" }] } };
  const api = { getPost: async () => item, listRecentPosts: async () => [item],
    getChildMedia: async (_session, id) => ({ id: id === "4001" ? "wrong" : id, alt_text: images[Number(id) - 4001].altText }) };
  const check = await exactReadback(api, session(), "3000", job().content.text, images, ["1001", "1002"]);
  assert.equal(check.passed, false);
  assert.equal(check.childDetailStatus, "id_mismatch");
  assert.equal(check.imageOrderVerified, false);
});

test("returned creation IDs must agree with the created child order even when alt text matches", async () => {
  const images = job().content.images;
  const item = { id: "3000", text: job().content.text, media_type: "CAROUSEL",
    permalink: "https://www.threads.com/@mindulmin/post/abc", children: { data: [
      { id: "4001", creation_id: "1002", alt_text: images[0].altText },
      { id: "4002", creation_id: "1001", alt_text: images[1].altText }
    ] } };
  const api = { getPost: async () => item, listRecentPosts: async () => [item] };
  const check = await exactReadback(api, session(), "3000", job().content.text, images, ["1001", "1002"]);
  assert.equal(check.passed, false);
  assert.equal(check.imageOrderVerified, false);
});

test("official child-detail adapter requests only read-only identity and media fields", async () => {
  const requests = [];
  const api = createThreadsApi({ fetchImpl: async (url, options) => {
    requests.push({ url: String(url), method: options.method });
    return { ok: true, status: 200, async text() { return JSON.stringify({ id: "4001", media_type: "IMAGE", alt_text: "Card one" }); } };
  } });
  const detail = await api.getChildMedia(session(), "4001");
  assert.equal(detail.id, "4001");
  assert.equal(detail.media_type, "IMAGE");
  assert.equal(requests[0].method, "GET");
  assert.ok(requests[0].url.includes("/4001?fields=id%2Cmedia_type%2Cmedia_url%2Calt_text"));
});

test("published child order mismatch does not claim fully verified publication", async (t) => {
  const f = await fixture(t);
  const api = fakeApi();
  const images = job().content.images;
  api.getPost = async () => ({ id: "3000", text: job().content.text, media_type: "CAROUSEL",
    permalink: "https://www.threads.com/@mindulmin/post/abc", children: { data: [
      { id: "4002", alt_text: images[1].altText }, { id: "4001", alt_text: images[0].altText }
    ] } });
  const result = await runCli(["--job", f.jobPath, "--publish"], deps(f, api));
  const lock = JSON.parse(await fs.readFile(path.join(f.lockDirectory, `${job().id}.json`), "utf8"));
  assert.equal(result.status, "blocked_readback");
  assert.equal(lock.readback.imageOrderVerified, false);
  assert.equal(lock.readback.passed, false);
});
