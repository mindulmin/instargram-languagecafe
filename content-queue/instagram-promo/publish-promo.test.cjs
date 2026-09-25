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
  parseArgs,
  publishPromoJob,
  runCli,
  sha256,
  simulateInstagramTransportForTests,
  simulatePromoJobForTests,
  validateJob,
  verifyHostedImage,
  verifyIdentity,
  verifyPublishedMedia
} = require("./publish-promo.cjs");

const CAPTION = "At a Korean café, the barista asks, ‘For here or to go?’ Try saying 포장해 주세요 "
  + "when you want takeaway. If you can read Hangul, Language Cafe's free Korean café mission "
  + "lets you practice placing an order with English guidance. Log in to start; no card is needed. "
  + "Open the link in this profile, then choose the Korean café mission.";
const IMAGE_URL = "https://abc12345.language-cafe-instagram-assets.pages.dev/promo/lesson.jpg";
const MISSION_URL = "https://languagestudio.uk/missions/korean-cafe/";

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
    content: { caption: CAPTION, destinationUrl: MISSION_URL,
      image: { url: IMAGE_URL, sha256: sha256(bytes) } },
    editorialReview: {
      status: "approved",
      captionSha256: sha256(CAPTION),
      imageSha256: sha256(bytes),
      destinationUrl: MISSION_URL,
      offerClaimApproved: true,
      landingMatchApproved: true,
      profileCtaApproved: true,
      visualApproved: true,
      evidence: {
        homepage: { url: "https://languagestudio.uk/", linksToDestination: true, checkedAt: reviewedAt },
        mission: { url: MISSION_URL, checkedAt: reviewedAt,
          freePilotVerified: true, orderPracticeVerified: true,
          hangulReaderPrerequisiteVerified: true, loginRequiredVerified: true,
          noCardRequiredVerified: true },
        profile: { website: "https://languagestudio.uk/", username: "mindulmin", checkedAt: reviewedAt },
        approvedClaimIds: ["free_korean_cafe_ordering_pilot_after_login"]
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

test("public publish paths are blocked before any social write in local and cloud modes", async t => {
  const f = await fixture(t);
  const previousCloud = process.env.LANGUAGE_CAFE_CLOUD;
  const previousRunId = process.env.GITHUB_RUN_ID;
  try {
    for (const cloudMode of [undefined, "1"]) {
      if (cloudMode === undefined) delete process.env.LANGUAGE_CAFE_CLOUD;
      else process.env.LANGUAGE_CAFE_CLOUD = cloudMode;
      process.env.GITHUB_RUN_ID = "12345";
      let socialWrites = 0;
      const injected = {
        jobsDir: f.jobsDir, lockDir: f.lockDir, session: f.session,
        api: { createContainer() { socialWrites += 1; }, publishContainer() { socialWrites += 1; } },
        imageFetch() { socialWrites += 1; },
        cloudPermitVerifier: async () => ({ verified: true, jobId: f.job.id })
      };
      await assert.rejects(publishPromoJob({ jobPath: f.jobPath, ...injected }),
        /promo_publish_disabled_pending_trusted_remote_claim_and_intent/u);
      await assert.rejects(runCli(["--job", f.jobPath, "--publish"], injected),
        /promo_publish_disabled_pending_trusted_remote_claim_and_intent/u);
      assert.equal(socialWrites, 0);
    }
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
  await assert.rejects(runCli(["--job", f.jobPath], { jobsDir: f.jobsDir }), /promo_job_preflight_blocked/u);
  await assert.rejects(runCli(["--job", f.jobPath, "--publish"], { jobsDir: f.jobsDir }),
    /promo_publish_disabled_pending_trusted_remote_claim_and_intent/u);
  await assert.rejects(fs.stat(f.lockDir), { code: "ENOENT" });
});

test("public URL rejects alternate port and normalized traversal paths", async t => {
  const f = await fixture(t);
  for (const url of [
    "https://abc12345.language-cafe-instagram-assets.pages.dev:8443/promo/lesson.jpg",
    "https://abc12345.language-cafe-instagram-assets.pages.dev/promo/../lesson.jpg",
    "https://abc12345.language-cafe-instagram-assets.pages.dev/promo/%2e%2e/lesson.jpg",
    "https://abc12345.language-cafe-instagram-assets.pages.dev/promo//lesson.jpg",
    "https://main.language-cafe-instagram-assets.pages.dev/promo/lesson.jpg",
    "https://feature-cards.language-cafe-instagram-assets.pages.dev/promo/lesson.jpg"
  ]) {
    f.job.content.image.url = url;
    assert.ok(validateJob(f.job).includes("promo_image_url_must_use_immutable_project_https_jpeg"), url);
  }
});

test("old English-conversation claim is blocked despite an otherwise approved Korean café offer", async t => {
  const f = await fixture(t);
  assert.deepEqual(validateJob(f.job), []);
  const retired = `${CAPTION} Start a free five-minute AI English conversation after login.`;
  f.job.content.caption = retired;
  f.job.editorialReview.captionSha256 = sha256(retired);
  assert.ok(validateJob(f.job).includes("caption_retired_or_unverified_offer_claim"));
  f.job.editorialReview.evidence.approvedClaimIds = ["free_five_minute_ai_english_conversation_after_login"];
  assert.ok(validateJob(f.job).includes("editorial_review_claims_mismatch"));
});

test("promo approval requires English Korean-café copy, the exact mission destination and fresh three-surface evidence", async t => {
  const f = await fixture(t);
  assert.deepEqual(validateJob(f.job), []);
  const korean = "랭귀지 카페에서 무료 한국어 카페 주문 연습을 시작하세요. Language Cafe profile link.";
  f.job.content.caption = korean;
  f.job.editorialReview.captionSha256 = sha256(korean);
  assert.ok(validateJob(f.job).includes("caption_english_language_required"));
  assert.ok(validateJob(f.job).includes("caption_korean_cafe_pilot_action_missing"));
  f.job.content.caption = CAPTION;
  f.job.editorialReview.captionSha256 = sha256(CAPTION);
  f.job.content.destinationUrl = "https://languagestudio.uk/";
  assert.ok(validateJob(f.job).includes("destination_url_invalid"));
  assert.ok(validateJob(f.job).includes("editorial_review_destination_binding_mismatch"));
  f.job.content.destinationUrl = MISSION_URL;
  f.job.editorialReview.evidence.homepage.linksToDestination = false;
  assert.ok(validateJob(f.job).includes("editorial_review_evidence_missing_or_stale"));
  f.job.editorialReview.evidence.homepage.linksToDestination = true;
  f.job.editorialReview.evidence.mission.url = "https://languagestudio.uk/membership/";
  assert.ok(validateJob(f.job).includes("editorial_review_evidence_missing_or_stale"));
  f.job.editorialReview.evidence.mission.url = MISSION_URL;
  f.job.editorialReview.evidence.mission.freePilotVerified = false;
  assert.ok(validateJob(f.job).includes("editorial_review_evidence_missing_or_stale"));
  f.job.editorialReview.evidence.mission.freePilotVerified = true;
  f.job.editorialReview.evidence.mission.checkedAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  assert.ok(validateJob(f.job).includes("editorial_review_evidence_missing_or_stale"));
});

test("published promotion requires account, page, image and exact official readback", async t => {
  const f = await fixture(t);
  const sim = await simulatePromoJobForTests({ job: f.job, imageBytes: f.bytes, attempts: 2 });
  const result = sim.outcomes[0].result;
  assert.equal(result.status, "published_verified");
  assert.equal(result.permalink, "https://www.instagram.com/p/Promo123/");
  const { calls } = sim;
  assert.equal(calls.createContainer, 1);
  assert.equal(calls.publishContainer, 1);
  assert.equal(calls.listMedia, 2);
  const saved = sim.savedJob;
  assert.equal(saved.workflow.status, "published");
  assert.equal(saved.workflow.postPublishVerification.normalizedCaptionMatchCount, 1);
  const lock = sim.lock;
  assert.equal(lock.stage, "published_verified");
  assert.equal(lock.containerCreateAttempts, 1);
  assert.equal(lock.publishAttempts, 1);
  assert.match(sim.outcomes[1].error, /job_already_published/u);
  assert.equal(calls.createContainer, 1);
});

test("official duplicate keeps a durable lock and never creates a container", async t => {
  const f = await fixture(t);
  const sim = await simulatePromoJobForTests({ job: f.job, imageBytes: f.bytes,
    behavior: { duplicate: true } });
  assert.match(sim.outcomes[0].error, /promo_duplicate_official_caption/u);
  const { calls, lock } = sim;
  assert.equal(lock.stage, "blocked_manual_reconciliation_required");
  assert.equal(lock.containerCreateAttempts, 0);
  assert.equal(calls.createContainer, 0);
  assert.equal(calls.publishContainer, 0);
});

test("wrong linked Page or profile destination blocks before image and publishing", async t => {
  const f = await fixture(t);
  const sim = await simulatePromoJobForTests({ job: f.job, imageBytes: f.bytes,
    behavior: { pageAccountId: "999999" } });
  assert.match(sim.outcomes[0].error, /promo_page_account_link_not_verified/u);
  const { calls } = sim;
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
  const different = await sharp({ create: { width: 1080, height: 1350,
    channels: 3, background: "#ff0000" } }).jpeg().toBuffer();
  const sim = await simulatePromoJobForTests({ job: f.job, imageBytes: different });
  assert.match(sim.outcomes[0].error, /promo_image_sha256_mismatch/u);
  const { calls, lock } = sim;
  assert.equal(calls.createContainer, 0);
  assert.equal(calls.publishContainer, 0);
  assert.equal(lock.stage, "blocked_manual_reconciliation_required");
});

test("ambiguous publish result is attempted once and blocks every repeat", async t => {
  const f = await fixture(t);
  const sim = await simulatePromoJobForTests({ job: f.job, imageBytes: f.bytes,
    behavior: { failPublish: true }, attempts: 2 });
  assert.match(sim.outcomes[0].error, /promo_unexpected_error/u);
  const { calls, lock } = sim;
  assert.equal(calls.createContainer, 1);
  assert.equal(calls.publishContainer, 1);
  assert.equal(lock.containerCreateAttempts, 1);
  assert.equal(lock.publishAttempts, 1);
  assert.ok(!JSON.stringify(lock).includes("hermetic-test-token"));
  assert.match(sim.outcomes[1].error, /promo_publish_lock_exists/u);
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
  const { containerId, mediaId, requests } = await simulateInstagramTransportForTests({ imageUrl: IMAGE_URL, caption: CAPTION });
  assert.equal(containerId, "111");
  assert.equal(mediaId, "222");
  assert.equal(requests[0].pathname, "/v23.0/123456/media");
  assert.equal(requests[0].imageUrl, IMAGE_URL);
  assert.equal(requests[0].caption, CAPTION);
  assert.equal(requests[1].pathname, "/v23.0/123456/media_publish");
  assert.equal(requests[1].creationId, "111");
  assert.equal(requests.length, 2);
});

test("public image is checked against the approved digest and dimensions", async t => {
  const f = await fixture(t);
  const result = await verifyHostedImage(f.job.content.image, f.imageFetch);
  assert.equal(result.sha256, sha256(f.bytes));
  assert.equal(result.width, 1080);
  assert.equal(result.height, 1350);
});
