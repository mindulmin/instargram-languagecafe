"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const sharp = require("sharp");
const {
  APP_ID,
  assertCloudV3Permit,
  createInstagramApi,
  parseArgs,
  publishPromoJob,
  runCli,
  sha256,
  validateJob,
  verifyHostedImage,
  verifyIdentity,
  verifyPublishedMedia
} = require("./publish-promo.cjs");

const CAPTION = "카페에서 영어 주문이 막힐 때, 랭귀지 카페에서 로그인 후 5분 무료 AI 영어 대화를 해보세요. "
  + "프로필 링크에서 ‘여행 영어’ 메뉴를 열어 시작할 수 있어요.";
const IMAGE_URL = "https://abc12345.language-cafe-instagram-assets.pages.dev/promo/lesson.jpg";

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "promo-publisher-test-"));
  t.after(async () => {
    if (path.resolve(root).startsWith(`${path.resolve(os.tmpdir())}${path.sep}`)
        && path.basename(root).startsWith("promo-publisher-test-")) {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
  const jobsDir = path.join(root, "jobs");
  const lockDir = path.join(root, "locks");
  await fs.mkdir(jobsDir, { recursive: true });
  const bytes = await sharp({ create: { width: 1080, height: 1350,
    channels: 3, background: "#eeeeee" } }).jpeg().toBuffer();
  const reviewedAt = new Date().toISOString();
  const job = {
    schemaVersion: 1,
    id: "promo-2026-09-25-1",
    channel: "instagram",
    strategyVersion: "channel-split-v3",
    workflow: { status: "approved" },
    content: { caption: CAPTION, image: { url: IMAGE_URL, sha256: sha256(bytes) } },
    editorialReview: {
      status: "approved",
      captionSha256: sha256(CAPTION),
      imageSha256: sha256(bytes),
      offerClaimApproved: true,
      landingMatchApproved: true,
      profileCtaApproved: true,
      visualApproved: true,
      evidence: {
        homepage: { url: "https://languagestudio.uk/", checkedAt: reviewedAt },
        profile: { website: "https://languagestudio.uk/", username: "mindulmin", checkedAt: reviewedAt },
        approvedClaimIds: ["free_five_minute_ai_english_conversation_after_login"]
      }
    }
  };
  const jobPath = path.join(jobsDir, `${job.id}.json`);
  await fs.writeFile(jobPath, JSON.stringify(job), "utf8");
  const imageFetch = async () => new Response(bytes, { headers: { "content-type": "image/jpeg" } });
  const session = { accessToken: "test-secret-must-never-appear", graphVersion: "v23.0", accountId: "123456",
    selectedAccount: { accountId: "123456", pageId: "987654", username: "mindulmin" } };
  return { root, jobsDir, lockDir, bytes, job, jobPath, imageFetch, session };
}

function mockApi({ duplicate = false, pageAccountId = "123456", website = "https://languagestudio.uk/",
  failPublish = false } = {}) {
  const calls = { getApp: 0, getProfile: 0, getPage: 0, getPermissions: 0,
    listMedia: 0, createContainer: 0, publishContainer: 0, getMedia: 0 };
  const post = { id: "222", caption: CAPTION, media_type: "IMAGE",
    permalink: "https://www.instagram.com/p/Promo123/", timestamp: "2026-09-25T00:00:00+0000" };
  const api = {
    async getApp() { calls.getApp += 1; return { id: APP_ID }; },
    async getProfile() { calls.getProfile += 1; return { id: "123456", username: "mindulmin", website }; },
    async getPage() { calls.getPage += 1; return { id: "987654", instagram_business_account: { id: pageAccountId } }; },
    async getPermissions() {
      calls.getPermissions += 1;
      return { data: ["instagram_basic", "instagram_content_publish", "pages_show_list", "pages_read_engagement"]
        .map(permission => ({ permission, status: "granted" })) };
    },
    async listMedia() { calls.listMedia += 1; return duplicate || calls.listMedia > 1 ? [post] : []; },
    async createContainer() { calls.createContainer += 1; return "111"; },
    async publishContainer() {
      calls.publishContainer += 1;
      if (failPublish) throw Error("network failed token=test-secret-must-never-appear");
      return "222";
    },
    async getMedia() { calls.getMedia += 1; return post; }
  };
  return { api, calls, post };
}

test("dry-run validates the approved job without session, network or lock", async t => {
  const f = await fixture(t);
  let touched = false;
  const result = await runCli(["--job", f.jobPath], {
    jobsDir: f.jobsDir, lockDir: f.lockDir,
    api: { getApp() { touched = true; throw Error("should not run"); } },
    imageFetch() { touched = true; throw Error("should not run"); }
  });
  assert.equal(result.status, "dry_run");
  assert.equal(result.sessionRead, false);
  assert.equal(result.apiCalls, 0);
  assert.equal(touched, false);
  await assert.rejects(fs.stat(f.lockDir), { code: "ENOENT" });
  assert.throws(() => parseArgs(["--job", f.jobPath, "--dry-run", "--publish"]), /promo_conflicting_modes/u);
});

test("cloud publishing cannot start without a trusted v3 remote claim permit", async t => {
  const f = await fixture(t);
  const previousCloud = process.env.LANGUAGE_CAFE_CLOUD;
  const previousRunId = process.env.GITHUB_RUN_ID;
  process.env.LANGUAGE_CAFE_CLOUD = "1";
  process.env.GITHUB_RUN_ID = "12345";
  try {
    const { api, calls } = mockApi();
    await assert.rejects(publishPromoJob({ jobPath: f.jobPath, jobsDir: f.jobsDir,
      lockDir: f.lockDir, session: f.session, api, imageFetch: f.imageFetch }),
    /promo_cloud_v3_permit_verifier_missing/u);
    assert.equal(calls.getApp, 0);
    assert.equal(calls.createContainer, 0);
    await assert.rejects(fs.stat(f.lockDir), { code: "ENOENT" });
    await assert.rejects(assertCloudV3Permit(f.job, sha256(JSON.stringify(f.job)),
      async () => ({ verified: true, strategyVersion: "instagram-study-companion-link-v2" })),
    /promo_cloud_v3_permit_unverified/u);
  } finally {
    if (previousCloud === undefined) delete process.env.LANGUAGE_CAFE_CLOUD;
    else process.env.LANGUAGE_CAFE_CLOUD = previousCloud;
    if (previousRunId === undefined) delete process.env.GITHUB_RUN_ID;
    else process.env.GITHUB_RUN_ID = previousRunId;
  }
});

test("preflight rejects unapproved, misleading or misplaced promotional content", async t => {
  const f = await fixture(t);
  const bad = structuredClone(f.job);
  bad.workflow.status = "draft";
  bad.content.caption = "랭귀지 카페는 영어 실력을 보장합니다. 평생 무료입니다. 프로필 링크를 보세요.";
  bad.content.image.url = "https://language-cafe-instagram-assets.pages.dev/photo.jpg";
  assert.ok(validateJob(bad).includes("job_not_approved"));
  assert.ok(validateJob(bad).includes("caption_unverified_commercial_claim"));
  assert.ok(validateJob(bad).includes("editorial_review_content_binding_mismatch"));
  assert.ok(validateJob(bad).includes("promo_image_url_must_use_immutable_project_https_jpeg"));
  await fs.writeFile(f.jobPath, JSON.stringify(bad));
  await assert.rejects(runCli(["--job", f.jobPath, "--publish"], { jobsDir: f.jobsDir }), /promo_job_preflight_blocked/u);
  await assert.rejects(fs.stat(f.lockDir), { code: "ENOENT" });
});

test("public URL rejects alternate port and normalized traversal paths", async t => {
  const f = await fixture(t);
  for (const url of [
    "https://abc12345.language-cafe-instagram-assets.pages.dev:8443/promo/lesson.jpg",
    "https://abc12345.language-cafe-instagram-assets.pages.dev/promo/../lesson.jpg",
    "https://abc12345.language-cafe-instagram-assets.pages.dev/promo/%2e%2e/lesson.jpg",
    "https://abc12345.language-cafe-instagram-assets.pages.dev/promo//lesson.jpg"
  ]) {
    f.job.content.image.url = url;
    assert.ok(validateJob(f.job).includes("promo_image_url_must_use_immutable_project_https_jpeg"), url);
  }
});

test("Korean save-and-review angle is allowed when its exact copy and claim are approved", async t => {
  const f = await fixture(t);
  const caption = "영어 대화 중 기억하고 싶은 문장을 저장해 두고 나중에 복습해 보세요. 랭귀지 카페는 프로필 링크에서 열 수 있어요.";
  f.job.content.caption = caption;
  f.job.editorialReview.captionSha256 = sha256(caption);
  f.job.editorialReview.evidence.approvedClaimIds = ["save_and_review_sentence"];
  assert.deepEqual(validateJob(f.job), []);
  f.job.editorialReview.evidence.approvedClaimIds = ["free_five_minute_ai_english_conversation_after_login"];
  assert.ok(validateJob(f.job).includes("editorial_review_claims_mismatch"));
});

test("published promotion requires account, page, image and exact official readback", async t => {
  const f = await fixture(t);
  const { api, calls } = mockApi();
  const result = await publishPromoJob({ jobPath: f.jobPath, jobsDir: f.jobsDir,
    lockDir: f.lockDir, session: f.session, api, imageFetch: f.imageFetch });
  assert.equal(result.status, "published_verified");
  assert.equal(result.permalink, "https://www.instagram.com/p/Promo123/");
  assert.equal(calls.createContainer, 1);
  assert.equal(calls.publishContainer, 1);
  assert.equal(calls.listMedia, 2);
  const saved = JSON.parse(await fs.readFile(f.jobPath, "utf8"));
  assert.equal(saved.workflow.status, "published");
  assert.equal(saved.workflow.postPublishVerification.normalizedCaptionMatchCount, 1);
  const lock = JSON.parse(await fs.readFile(path.join(f.lockDir, `${f.job.id}.json`), "utf8"));
  assert.equal(lock.stage, "published_verified");
  assert.equal(lock.containerCreateAttempts, 1);
  assert.equal(lock.publishAttempts, 1);
  await assert.rejects(publishPromoJob({ jobPath: f.jobPath, jobsDir: f.jobsDir,
    lockDir: f.lockDir, session: f.session, api, imageFetch: f.imageFetch }), /job_already_published/u);
  assert.equal(calls.createContainer, 1);
});

test("official duplicate keeps a durable lock and never creates a container", async t => {
  const f = await fixture(t);
  const { api, calls } = mockApi({ duplicate: true });
  await assert.rejects(publishPromoJob({ jobPath: f.jobPath, jobsDir: f.jobsDir,
    lockDir: f.lockDir, session: f.session, api, imageFetch: f.imageFetch }), /promo_duplicate_official_caption/u);
  const lock = JSON.parse(await fs.readFile(path.join(f.lockDir, `${f.job.id}.json`), "utf8"));
  assert.equal(lock.stage, "blocked_manual_reconciliation_required");
  assert.equal(lock.containerCreateAttempts, 0);
  assert.equal(calls.createContainer, 0);
  assert.equal(calls.publishContainer, 0);
});

test("wrong linked Page or profile destination blocks before image and publishing", async t => {
  const f = await fixture(t);
  const { api, calls } = mockApi({ pageAccountId: "999999" });
  let imageReads = 0;
  await assert.rejects(publishPromoJob({ jobPath: f.jobPath, jobsDir: f.jobsDir,
    lockDir: f.lockDir, session: f.session, api,
    imageFetch: async () => { imageReads += 1; return f.imageFetch(); } }), /promo_page_account_link_not_verified/u);
  assert.equal(imageReads, 0);
  assert.equal(calls.createContainer, 0);
  assert.equal(calls.listMedia, 0);
  assert.throws(() => verifyIdentity({ app: { id: APP_ID },
    profile: { id: "123456", username: "mindulmin", website: "https://other.example/" },
    page: { id: "987654", instagram_business_account: { id: "123456" } },
    permissions: { data: ["instagram_basic", "instagram_content_publish", "pages_show_list", "pages_read_engagement"]
      .map(permission => ({ permission, status: "granted" })) },
    session: { accountId: "123456", pageId: "987654" } }), /promo_profile_link_not_verified/u);
});

test("changed image bytes prevent the first create attempt", async t => {
  const f = await fixture(t);
  const { api, calls } = mockApi();
  const different = await sharp({ create: { width: 1080, height: 1350,
    channels: 3, background: "#ff0000" } }).jpeg().toBuffer();
  await assert.rejects(publishPromoJob({ jobPath: f.jobPath, jobsDir: f.jobsDir,
    lockDir: f.lockDir, session: f.session, api,
    imageFetch: async () => new Response(different, { headers: { "content-type": "image/jpeg" } }) }),
  /promo_image_sha256_mismatch/u);
  assert.equal(calls.createContainer, 0);
  assert.equal(calls.publishContainer, 0);
  const lock = JSON.parse(await fs.readFile(path.join(f.lockDir, `${f.job.id}.json`), "utf8"));
  assert.equal(lock.stage, "blocked_manual_reconciliation_required");
});

test("ambiguous publish result is attempted once and blocks every repeat", async t => {
  const f = await fixture(t);
  const { api, calls } = mockApi({ failPublish: true });
  await assert.rejects(publishPromoJob({ jobPath: f.jobPath, jobsDir: f.jobsDir,
    lockDir: f.lockDir, session: f.session, api, imageFetch: f.imageFetch }), /promo_unexpected_error/u);
  assert.equal(calls.createContainer, 1);
  assert.equal(calls.publishContainer, 1);
  const lock = JSON.parse(await fs.readFile(path.join(f.lockDir, `${f.job.id}.json`), "utf8"));
  assert.equal(lock.containerCreateAttempts, 1);
  assert.equal(lock.publishAttempts, 1);
  assert.ok(!JSON.stringify(lock).includes("test-secret-must-never-appear"));
  await assert.rejects(publishPromoJob({ jobPath: f.jobPath, jobsDir: f.jobsDir,
    lockDir: f.lockDir, session: f.session, api, imageFetch: f.imageFetch }), /promo_publish_lock_exists/u);
  assert.equal(calls.publishContainer, 1);
});

test("readback needs one matching IMAGE with an official permalink", () => {
  const post = { id: "222", caption: CAPTION, media_type: "IMAGE",
    permalink: "https://www.instagram.com/p/Promo123/" };
  assert.ok(verifyPublishedMedia({ mediaId: "222", item: post, recent: [post], caption: CAPTION }));
  assert.equal(verifyPublishedMedia({ mediaId: "222", item: post, recent: [post, { ...post, id: "333" }], caption: CAPTION }), null);
  assert.equal(verifyPublishedMedia({ mediaId: "222", item: { ...post, media_type: "CAROUSEL_ALBUM" }, recent: [post], caption: CAPTION }), null);
  assert.equal(verifyPublishedMedia({ mediaId: "222", item: { ...post, permalink: "https://example.com/p/Promo123/" }, recent: [post], caption: CAPTION }), null);
});

test("official Graph transport sends one image container and one publish request", async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ pathname: url.pathname, method: options.method,
      body: options.body ? new URLSearchParams(options.body) : null });
    return new Response(JSON.stringify({ id: requests.length === 1 ? "111" : "222" }),
      { headers: { "content-type": "application/json" } });
  };
  const api = createInstagramApi({ fetchImpl });
  const session = { accountId: "123456", accessToken: "secret", graphVersion: "v23.0" };
  assert.equal(await api.createContainer(session, { imageUrl: IMAGE_URL, caption: CAPTION }), "111");
  assert.equal(await api.publishContainer(session, "111"), "222");
  assert.equal(requests[0].pathname, "/v23.0/123456/media");
  assert.equal(requests[0].body.get("image_url"), IMAGE_URL);
  assert.equal(requests[0].body.get("caption"), CAPTION);
  assert.equal(requests[1].pathname, "/v23.0/123456/media_publish");
  assert.equal(requests[1].body.get("creation_id"), "111");
  assert.equal(requests.length, 2);
});

test("public image is checked against the approved digest and dimensions", async t => {
  const f = await fixture(t);
  const result = await verifyHostedImage(f.job.content.image, f.imageFetch);
  assert.equal(result.sha256, sha256(f.bytes));
  assert.equal(result.width, 1080);
  assert.equal(result.height, 1350);
});
