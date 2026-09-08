const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const helpers = require("./prepare-threads-draft.cjs");
const {
  DEFAULT_THREADS_ANGLE,
  LEARNING_EXTENSION_CTA,
  LINK_PREVIEW_OBSERVATION,
  LINK_PREVIEW_POLICY,
  LINK_TARGET_OWNED_PRACTICE,
  LINK_TARGET_SOURCE_INSTAGRAM,
  RECOVERY_RESOLUTION,
  THREADS_RECOVERY_ACTION,
  THREADS_STRATEGY_VERSION,
  createThreadsDraft,
  extractHangulRuns,
  naturalEnglishMeaning,
  readRecoveryEvidenceSnapshot,
  resolveDraftAngle,
  runCli,
  validateThreadsJob
} = helpers;

const TEST_NOW = new Date("2026-09-04T06:00:00.000Z");
const TEST_CONTROL_PATH = helpers.DEFAULT_CONTROL_PATH;
const REQUIRED_RECEIPT_FIELDS = [
  "actionId",
  "idempotencyKey",
  "targetExpression",
  "sourcePostId",
  "instagram",
  "threads",
  "threadsLinkTargetType",
  "threadsLinkTarget",
  "threadsExternalLinkCount",
  "threadsExplicitLinkAttachmentRequested",
  "threadsPlatformPreviewState",
  "reelActionCount",
  "finalStatus",
  "evidencePath"
];

function publishedCarouselJob(overrides = {}) {
  const base = {
    schemaVersion: 2,
    id: "2026-09-04-expression-030-yeongeo-hal-su-isseoyo",
    source: {
      expressionId: "030",
      expression: "영어 할 수 있어요?",
      englishHint: "Do you speak English?",
      romanization: "yeongeo hal su isseoyo",
      scene: "asking a train-station information worker for language help"
    },
    instagram: {
      caption: "At a train station, learn the complete visual lesson for asking whether someone speaks English."
    },
    workflow: {
      status: "published",
      naturalKoreanReview: { review: "passed", evidence: "Read-aloud source evidence." },
      globalLearnerReview: { review: "passed", evidence: "English bridge source evidence." },
      distributionReview: { review: "passed", evidence: "Distribution source evidence." },
      postPublishVerification: {
        status: "passed",
        review: "passed",
        source: "official_instagram_graph_api_recent_media",
        mediaIdMatchCount: 1,
        normalizedFullCaptionMatchCount: 1,
        sameHangulExpressionMatchCount: 1,
        exactOnePublishedJobConfirmed: true,
        matchedMediaId: "instagram-media-030",
        permalink: "https://www.instagram.com/p/example/",
        mediaType: "CAROUSEL_ALBUM"
      }
    },
    published: {
      mediaId: "instagram-media-030",
      verification: {
        id: "instagram-media-030",
        media_type: "CAROUSEL_ALBUM",
        permalink: "https://www.instagram.com/p/example/"
      }
    }
  };
  return {
    ...base,
    ...overrides,
    source: { ...base.source, ...(overrides.source || {}) },
    instagram: { ...base.instagram, ...(overrides.instagram || {}) },
    workflow: { ...base.workflow, ...(overrides.workflow || {}) },
    published: {
      ...base.published,
      ...(overrides.published || {}),
      verification: { ...base.published.verification, ...(overrides.published?.verification || {}) }
    }
  };
}

function validControl(carouselJob, overrides = {}) {
  const base = {
    schemaVersion: "1.2",
    testId: "language-cafe-learning-pair-test",
    asOfDate: "2026-09-04",
    timezone: "Asia/Seoul",
    period: {
      day1: "2026-09-04",
      day14: "2026-09-17"
    },
    strategy: {
      primaryChannel: "instagram",
      primaryJob: "korean_expression_learning",
      threadsRole: "native_study_companion_with_source_link",
      threadsStrategyVersion: THREADS_STRATEGY_VERSION,
      instagramRequiredBeforeThreads: true,
      threadsExternalLinkRequired: true,
      threadsExternalLinkCount: 1,
      threadsLinkTargetType: LINK_TARGET_SOURCE_INSTAGRAM,
      threadsApprovedLinkTarget: null,
      threadsLinkTargetBinding: "derive_exactly_from_official_instagram_readback",
      threadsLinkPosition: "final_line",
      threadsExplicitLinkAttachmentAllowed: false,
      threadsPlatformPreviewState: "unavailable_platform_managed",
      threadsProductOrPriceCopyAllowed: false,
      threadsSalesCtaAllowed: false,
      threadsStudyCtaPrefix: LEARNING_EXTENSION_CTA
    },
    publishing: {
      status: "learning_ready",
      postDue: true,
      maxPosts: 3,
      publishedCount: 0,
      approvalRequired: false,
      approvalItems: []
    },
    revenue: {
      status: "blocked_checkout",
      checkoutGate: { status: "unverified" },
      landing: { status: "unverified" },
      utm: { status: "not_ready" }
    },
    handoff: {
      contractVersion: "1.2",
      consumerAction: "publish_one_learning_pair",
      actionId: "learning-pair-action-030",
      idempotencyKey: "learning-pair-idempotency-030",
      issuedAt: "2026-09-04T00:00:00+09:00",
      validUntil: "2099-01-01T00:00:00+09:00",
      requestedPostId: carouselJob.id,
      targetExpression: carouselJob.source.expression,
      threadsLinkTargetType: LINK_TARGET_SOURCE_INSTAGRAM,
      threadsLinkTarget: null,
      receiptPathPattern: "C:\\Users\\earth\\OneDrive\\Desktop\\codex\\instagram-card-test\\meaning-switch-series-v1\\operations\\revenue-experiment\\<testId>\\publisher-receipts\\<actionId>.json",
      mayCreateMedia: true,
      mayPublish: true,
      requiredReceiptFields: REQUIRED_RECEIPT_FIELDS
    }
  };
  return {
    ...base,
    ...overrides,
    strategy: { ...base.strategy, ...(overrides.strategy || {}) },
    publishing: { ...base.publishing, ...(overrides.publishing || {}) },
    revenue: { ...base.revenue, ...(overrides.revenue || {}) },
    handoff: { ...base.handoff, ...(overrides.handoff || {}) }
  };
}

function controlSnapshot(control, controlPath = TEST_CONTROL_PATH) {
  const raw = `${JSON.stringify(control, null, 2)}\n`;
  return {
    control,
    controlPath,
    controlSha256: helpers.sha256(raw),
    raw
  };
}

function createDraft({ carouselJob = publishedCarouselJob(), control, ...overrides } = {}) {
  const resolvedControl = control || validControl(carouselJob);
  return createThreadsDraft({
    carouselJob,
    carouselJobPath: path.join("jobs", "source.json"),
    controlSnapshot: controlSnapshot(resolvedControl),
    date: "2026-09-04",
    now: TEST_NOW,
    ...overrides
  });
}

async function temporaryJobsDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "language-cafe-threads-test-"));
}

function updatePostHash(job) {
  job.copy.primaryPostCharacterCount = helpers.countCharacters(job.copy.primaryPost);
  job.copy.normalizedPrimaryPostHash = helpers.sha256(helpers.normalizeText(job.copy.primaryPost));
}

async function newValidJob() {
  return createDraft();
}

async function recoveryInputs({ legacyCopyHash = "legacy-copy-hash", legacyControlBinding = {}, mutateEvidence } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "language-cafe-threads-recovery-"));
  const jobsDir = path.join(root, "content-queue", "threads", "jobs");
  const locksDir = path.join(root, "content-queue", "threads", ".publish-locks");
  const evidenceDir = path.join(root, "content-queue", "threads", "recovery-evidence");
  await Promise.all([
    fs.mkdir(jobsDir, { recursive: true }),
    fs.mkdir(locksDir, { recursive: true }),
    fs.mkdir(evidenceDir, { recursive: true })
  ]);
  const carouselJob = publishedCarouselJob();
  const legacyId = "2026-09-04-expression-030-threads-one-line-recall";
  const supersedingJobId = "2026-09-04-expression-030-threads-instagram-lesson-recall-v2";
  const legacyJobRelative = `content-queue/threads/jobs/${legacyId}.json`;
  const legacyLockRelative = `content-queue/threads/.publish-locks/${legacyId}.json`;
  const evidenceRelative = "content-queue/threads/recovery-evidence/expression-030-legacy-abandoned.json";
  const legacyJob = {
    id: legacyId,
    channel: "threads",
    source: {
      sourceCarouselJobId: carouselJob.id,
      expressionId: carouselJob.source.expressionId,
      expression: carouselJob.source.expression
    },
    copy: { normalizedPrimaryPostHash: legacyCopyHash },
    controlBinding: legacyControlBinding,
    workflow: { status: "blocked" },
    review: {
      publisher: {
        status: "ambiguous_result_manual_readback_required",
        containerId: "legacy-container-030",
        containerStatus: "FINISHED",
        normalizedFullTextMatchCount: 0,
        targetHangulMatchCount: 0,
        lockRetained: true
      }
    }
  };
  const legacyLock = {
    jobId: legacyId,
    stage: "publishing_text_container",
    containerId: "legacy-container-030",
    channel: "threads"
  };
  const legacyJobRaw = `${JSON.stringify(legacyJob, null, 2)}\n`;
  const legacyLockRaw = `${JSON.stringify(legacyLock, null, 2)}\n`;
  const legacyJobPath = path.join(root, ...legacyJobRelative.split("/"));
  const legacyLockPath = path.join(root, ...legacyLockRelative.split("/"));
  await Promise.all([
    fs.writeFile(legacyJobPath, legacyJobRaw),
    fs.writeFile(legacyLockPath, legacyLockRaw)
  ]);
  const evidence = {
    schemaVersion: 1,
    evidenceType: "threads_ambiguous_publish_recovery_preflight",
    createdAt: "2026-09-04T05:30:00.000Z",
    immutable: true,
    legacyJob: { id: legacyId, path: legacyJobRelative, sha256: helpers.sha256(legacyJobRaw) },
    legacyLock: { path: legacyLockRelative, sha256: helpers.sha256(legacyLockRaw) },
    source: {
      carouselJobId: carouselJob.id,
      expressionId: carouselJob.source.expressionId,
      expression: carouselJob.source.expression,
      instagramMediaId: carouselJob.workflow.postPublishVerification.matchedMediaId,
      instagramPermalink: carouselJob.workflow.postPublishVerification.permalink
    },
    legacyContainer: {
      id: legacyLock.containerId,
      status: "FINISHED",
      officialReadbackHttpStatus: 200,
      errorMessagePresent: false,
      checkedAt: "2026-09-04T05:30:00.000Z"
    },
    officialThreadsRecentReadback: {
      checkedAt: "2026-09-04T05:30:00.000Z",
      recentMediaChecked: 12,
      normalizedLegacyFullTextMatchCount: 0,
      targetHangulMatchCount: 0,
      exactNoPublicMatch: true
    },
    resolution: RECOVERY_RESOLUTION,
    supersedingJobId,
    retryOriginalContainerAllowed: false
  };
  if (mutateEvidence) mutateEvidence(evidence);
  const evidenceRaw = `${JSON.stringify(evidence, null, 2)}\n`;
  const evidencePath = path.join(root, ...evidenceRelative.split("/"));
  await fs.writeFile(evidencePath, evidenceRaw);
  const control = validControl(carouselJob, {
    publishing: { status: "active" },
    handoff: {
      consumerAction: THREADS_RECOVERY_ACTION,
      actionId: "recovery-action-030",
      idempotencyKey: "recovery-idempotency-030",
      mayCreateMedia: false,
      mayPublish: true,
      supersedesJobId: legacyId,
      recoveryEvidencePath: evidenceRelative,
      recoveryEvidenceSha256: helpers.sha256(evidenceRaw),
      requiredReceiptFields: [...REQUIRED_RECEIPT_FIELDS, "legacyRecovery"]
    }
  });
  const recoveryEvidenceSnapshot = await readRecoveryEvidenceSnapshot(control, { projectRoot: root });
  return {
    root,
    jobsDir,
    locksDir,
    carouselJob,
    control,
    recoveryEvidenceSnapshot,
    legacyJobPath,
    legacyLockPath,
    evidencePath,
    supersedingJobId
  };
}

function createRecoveryDraft(fixture) {
  return createDraft({
    carouselJob: fixture.carouselJob,
    control: fixture.control,
    recoveryEvidenceSnapshot: fixture.recoveryEvidenceSnapshot
  });
}

test("creates an Instagram-first, text-only study companion after official carousel readback", async () => {
  const source = publishedCarouselJob();
  assert.equal(validControl(source).strategy.threadsApprovedLinkTarget, null);
  const before = JSON.stringify(source);
  const job = createDraft({ carouselJob: source });
  const review = await validateThreadsJob(job, { jobsDir: await temporaryJobsDir(), now: TEST_NOW });

  assert.equal(JSON.stringify(source), before);
  assert.equal(job.schemaVersion, 5);
  assert.equal(job.strategyVersion, THREADS_STRATEGY_VERSION);
  assert.equal(job.channelStrategy.instagramRole, "canonical_full_korean_expression_lesson");
  assert.equal(job.channelStrategy.threadsRole, "distinct_text_only_native_study_companion");
  assert.equal(job.automation.pipeline, "threads-learning-pair-pipeline-v3");
  assert.equal(job.workflow.status, "approved");
  assert.equal(job.workflow.autoPublish, true);
  assert.equal(job.copy.externalLinkCount, 1);
  assert.equal(Object.hasOwn(job.copy, "linkPreviewUsed"), false);
  assert.equal(job.copy.explicitLinkAttachmentRequested, false);
  assert.equal(job.copy.linkPreviewPolicy, LINK_PREVIEW_POLICY);
  assert.equal(job.copy.platformPreviewState, LINK_PREVIEW_OBSERVATION);
  assert.equal(job.copy.learningExtensionCta, LEARNING_EXTENSION_CTA);
  assert.equal(job.copy.link.targetType, LINK_TARGET_SOURCE_INSTAGRAM);
  assert.equal(job.copy.link.publicUrl, source.workflow.postPublishVerification.permalink);
  assert.equal(job.copy.link.utm, null);
  assert.equal(job.copy.primaryPost.split(source.workflow.postPublishVerification.permalink).length - 1, 1);
  assert.equal(job.copy.primaryPost.endsWith(`${LEARNING_EXTENSION_CTA} ${source.workflow.postPublishVerification.permalink}`), true);
  assert.equal(job.controlBinding.testId, "language-cafe-learning-pair-test");
  assert.equal(job.controlBinding.actionId, "learning-pair-action-030");
  assert.equal(job.controlBinding.idempotencyKey, "learning-pair-idempotency-030");
  assert.equal(job.controlBinding.requestedPostId, source.id);
  assert.equal(job.controlBinding.targetExpression, source.source.expression);
  assert.equal(job.controlBinding.contractVersion, "1.2");
  assert.equal(job.controlBinding.strategyVersion, THREADS_STRATEGY_VERSION);
  assert.equal(job.controlBinding.linkTargetType, LINK_TARGET_SOURCE_INSTAGRAM);
  assert.equal(job.controlBinding.sourceLinkTarget, source.workflow.postPublishVerification.permalink);
  assert.match(job.controlBinding.controlSha256, /^[a-f0-9]{64}$/u);
  assert.deepEqual(job.measurement.metrics.linkClicks, { value: null, status: "unavailable" });
  assert.equal(job.review.qualityRubric.revenueContribution, 4);
  assert.match(job.review.qualityRubric.evidence, /indirect revenue contribution, not observed revenue/i);
  assert.equal(review.passed, true, review.errors.join(", "));
});

test("requires the paired Instagram carousel to be published and officially read back", () => {
  const source = publishedCarouselJob({ workflow: { status: "approved" } });
  assert.throws(
    () => createDraft({ carouselJob: source }),
    /source_carousel_not_published/
  );
});

test("rejects marker-only or non-official Instagram readback evidence", () => {
  const markerOnly = publishedCarouselJob({
    workflow: {
      postPublishVerification: {
        status: "passed",
        review: "passed",
        permalink: "https://www.instagram.com/p/example/"
      }
    }
  });
  assert.throws(
    () => createDraft({ carouselJob: markerOnly }),
    /source_post_publish_verification_not_passed/
  );

  const fakePermalink = publishedCarouselJob({
    workflow: {
      postPublishVerification: {
        ...publishedCarouselJob().workflow.postPublishVerification,
        permalink: "https://example.com/not-instagram"
      }
    }
  });
  assert.throws(
    () => createDraft({ carouselJob: fakePermalink }),
    /source_official_instagram_permalink_invalid/
  );
});

test("rejects official readback unless every exact-one field and published receipt cross-check matches", () => {
  const weakCount = publishedCarouselJob({
    workflow: {
      postPublishVerification: {
        ...publishedCarouselJob().workflow.postPublishVerification,
        sameHangulExpressionMatchCount: 2
      }
    }
  });
  assert.throws(() => createDraft({ carouselJob: weakCount }), /source_post_publish_verification_not_passed/);

  const mismatchedReceipt = publishedCarouselJob({ published: { mediaId: "different-media-id" } });
  assert.throws(() => createDraft({ carouselJob: mismatchedReceipt }), /source_official_media_id_mismatch/);
});

test("blocks Korean explanatory copy outside the exact target line", async () => {
  const job = await newValidJob();
  job.copy.primaryPost = job.copy.primaryPost.replace("It means:", "한국어 설명: It means:");
  updatePostHash(job);
  const review = await validateThreadsJob(job, { jobsDir: await temporaryJobsDir() });
  assert.equal(review.passed, false);
  assert.equal(review.errors.includes("unapproved_hangul_detected"), true);
  assert.equal(review.errors.includes("visible_hangul_line_must_be_exactly_one_target"), true);
});

test("blocks a local Threads job that repeats the same source expression", async () => {
  const jobsDir = await temporaryJobsDir();
  const existing = await newValidJob();
  await fs.writeFile(path.join(jobsDir, "existing.json"), `${JSON.stringify(existing, null, 2)}\n`);
  const candidate = await newValidJob();
  const review = await validateThreadsJob(candidate, { jobsDir });
  assert.equal(review.passed, false);
  assert.equal(review.errors.includes("local_threads_duplicate_detected"), true);
  assert.equal(review.duplicateMatches[0].reason, "duplicate_source_expression");
});

test("creates a Threads-only recovery draft and waives only its exact hash-bound legacy expression duplicate", async () => {
  const fixture = await recoveryInputs();
  const job = createRecoveryDraft(fixture);
  const review = await validateThreadsJob(job, {
    jobsDir: fixture.jobsDir,
    now: TEST_NOW,
    recoveryProjectRoot: fixture.root
  });

  assert.equal(review.passed, true, review.errors.join(", "));
  assert.equal(job.id, fixture.supersedingJobId);
  assert.equal(job.controlBinding.consumerAction, THREADS_RECOVERY_ACTION);
  assert.equal(job.recoveryBinding.supersedesJobId, "2026-09-04-expression-030-threads-one-line-recall");
  assert.equal(job.recoveryBinding.recoveryEvidencePath, fixture.control.handoff.recoveryEvidencePath);
  assert.equal(job.recoveryBinding.recoveryEvidenceSha256, fixture.control.handoff.recoveryEvidenceSha256);
  assert.match(job.recoveryBinding.legacyJobSha256, /^[a-f0-9]{64}$/u);
  assert.match(job.recoveryBinding.legacyLockSha256, /^[a-f0-9]{64}$/u);
  assert.equal(job.recoveryBinding.resolution, RECOVERY_RESOLUTION);
  assert.deepEqual(review.duplicateMatches, []);

  const notActive = {
    ...fixture.control,
    publishing: { ...fixture.control.publishing, status: "learning_ready" }
  };
  assert.throws(
    () => createDraft({
      carouselJob: fixture.carouselJob,
      control: notActive,
      recoveryEvidenceSnapshot: fixture.recoveryEvidenceSnapshot
    }),
    /control_publishing_not_due_or_ready/
  );
});

test("recovery evidence must prove immutable job and lock hashes, FINISHED, zero official matches, and abandonment", async () => {
  for (const [label, mutateEvidence, expected] of [
    ["container", (evidence) => { evidence.legacyContainer.status = "IN_PROGRESS"; }, /threads_recovery_legacy_container_not_safely_abandoned/],
    ["full text", (evidence) => { evidence.officialThreadsRecentReadback.normalizedLegacyFullTextMatchCount = 1; }, /threads_recovery_official_zero_match_evidence_missing/],
    ["Hangul", (evidence) => { evidence.officialThreadsRecentReadback.targetHangulMatchCount = 1; }, /threads_recovery_official_zero_match_evidence_missing/],
    ["resolution", (evidence) => { evidence.resolution = "retry_original"; }, /threads_recovery_resolution_not_abandoned/]
  ]) {
    const fixture = await recoveryInputs({ mutateEvidence });
    assert.throws(() => createRecoveryDraft(fixture), expected, label);
  }

  const tampered = await recoveryInputs();
  await fs.appendFile(tampered.legacyLockPath, " ");
  const job = createRecoveryDraft(tampered);
  const review = await validateThreadsJob(job, {
    jobsDir: tampered.jobsDir,
    now: TEST_NOW,
    recoveryProjectRoot: tampered.root
  });
  assert.equal(review.passed, false);
  assert.equal(review.errors.includes("threads_recovery_legacy_lock_hash_mismatch"), true);
});

test("recovery never waives a same-copy, action, or idempotency duplicate", async () => {
  const ordinary = createDraft();
  const cases = [
    { legacyCopyHash: ordinary.copy.normalizedPrimaryPostHash },
    { legacyControlBinding: { actionId: "recovery-action-030" } },
    { legacyControlBinding: { idempotencyKey: "recovery-idempotency-030" } }
  ];
  for (const options of cases) {
    const fixture = await recoveryInputs(options);
    const job = createRecoveryDraft(fixture);
    const review = await validateThreadsJob(job, {
      jobsDir: fixture.jobsDir,
      now: TEST_NOW,
      recoveryProjectRoot: fixture.root
    });
    assert.equal(review.passed, false);
    assert.equal(review.errors.includes("local_threads_duplicate_detected"), true);
  }
});

test("extracts only the expected Hangul runs from a dialogue line", () => {
  assert.deepEqual(extractHangulRuns("영어 할 수 있어요?"), ["영어", "할", "수", "있어요"]);
  assert.deepEqual(extractHangulRuns("English-only line"), []);
});

test("turns source-library glosses into natural global English", () => {
  assert.equal(naturalEnglishMeaning("Hello polite"), "Hello.");
  assert.equal(naturalEnglishMeaning("Check please"), "Could I have the check, please?");
  assert.equal(naturalEnglishMeaning("It is fun"), "It's fun.");
  assert.equal(naturalEnglishMeaning("Do you speak English?"), "Do you speak English?");
});

test("keeps exactly one target Hangul line and puts the exact source Instagram lesson link last", async () => {
  const job = await newValidJob();
  const visibleHangulLines = job.copy.primaryPost
    .split(/\r?\n/u)
    .filter((line) => extractHangulRuns(line).length > 0);
  assert.deepEqual(visibleHangulLines, [job.source.expression]);
  assert.equal(job.copy.primaryPost.split(LEARNING_EXTENSION_CTA).length - 1, 1);
  assert.equal(job.copy.primaryPost.endsWith(job.source.sourceCarouselPermalink), true);
  const review = await validateThreadsJob(job, { jobsDir: await temporaryJobsDir() });
  assert.equal(review.passed, true, review.errors.join(", "));
});

test("fails closed when the public Threads copy has zero or two links", async () => {
  const zero = await newValidJob();
  zero.copy.primaryPost = zero.copy.primaryPost.replace(` ${zero.source.sourceCarouselPermalink}`, "");
  updatePostHash(zero);
  let review = await validateThreadsJob(zero, { jobsDir: await temporaryJobsDir() });
  assert.equal(review.errors.includes("threads_external_link_count_must_be_one"), true);

  const two = await newValidJob();
  two.copy.primaryPost += `\n${two.source.sourceCarouselPermalink}`;
  updatePostHash(two);
  review = await validateThreadsJob(two, { jobsDir: await temporaryJobsDir() });
  assert.equal(review.errors.includes("threads_external_link_count_must_be_one"), true);
});

test("fails closed on a non-Instagram target, a bare second host, or HTTP", async () => {
  const nonInstagram = await newValidJob();
  nonInstagram.copy.primaryPost = nonInstagram.copy.primaryPost.replace(
    nonInstagram.source.sourceCarouselPermalink,
    "https://example.com/p/example/"
  );
  updatePostHash(nonInstagram);
  let review = await validateThreadsJob(nonInstagram, { jobsDir: await temporaryJobsDir() });
  assert.equal(review.errors.includes("threads_link_must_be_clean_instagram_carousel_permalink"), true);

  const bareSecondHost = await newValidJob();
  bareSecondHost.copy.primaryPost += "\nlanguagestudio.xyz";
  updatePostHash(bareSecondHost);
  review = await validateThreadsJob(bareSecondHost, { jobsDir: await temporaryJobsDir() });
  assert.equal(review.errors.includes("additional_or_bare_site_address_forbidden"), true);

  const insecure = await newValidJob();
  insecure.copy.primaryPost = insecure.copy.primaryPost.replace("https://www.instagram.com", "http://www.instagram.com");
  updatePostHash(insecure);
  review = await validateThreadsJob(insecure, { jobsDir: await temporaryJobsDir() });
  assert.equal(review.errors.includes("threads_link_must_use_https"), true);

  const trackedSource = await newValidJob();
  trackedSource.copy.primaryPost = trackedSource.copy.primaryPost.replace(
    trackedSource.source.sourceCarouselPermalink,
    `${trackedSource.source.sourceCarouselPermalink}?utm_source=threads&utm_medium=organic&utm_campaign=language_cafe&utm_content=030-instagram-lesson-recall-v2`
  );
  updatePostHash(trackedSource);
  review = await validateThreadsJob(trackedSource, { jobsDir: await temporaryJobsDir() });
  assert.equal(review.errors.includes("threads_source_instagram_link_must_not_have_utm"), true);
});

test("requires the learning CTA and exact official permalink on the final line", async () => {
  const job = await newValidJob();
  const finalLine = `${LEARNING_EXTENSION_CTA} ${job.source.sourceCarouselPermalink}`;
  job.copy.primaryPost = `${finalLine}\n\n${job.copy.primaryPost.slice(0, -(finalLine.length + 1))}`;
  updatePostHash(job);
  const review = await validateThreadsJob(job, { jobsDir: await temporaryJobsDir() });
  assert.equal(review.errors.includes("threads_learning_extension_cta_and_link_must_be_final_line"), true);
});

test("owned practice targets require HTTPS allowlisting, exact four UTMs, and verified Korean alignment", () => {
  const source = publishedCarouselJob();
  const ownedBase = {
    threadsLinkTargetType: LINK_TARGET_OWNED_PRACTICE,
    threadsApprovedLinkTarget: "https://languagestudio.uk/korean-practice"
  };
  assert.throws(
    () => createDraft({ carouselJob: source, control: validControl(source, { strategy: ownedBase }) }),
    /control_owned_practice_target_utm_mismatch/
  );

  const modifiedUtm = "https://languagestudio.uk/korean-practice?utm_source=threads&utm_medium=organic&utm_campaign=wrong&utm_content=030-instagram-lesson-recall-v2";
  assert.throws(
    () => createDraft({ carouselJob: source, control: validControl(source, { strategy: { ...ownedBase, threadsApprovedLinkTarget: modifiedUtm } }) }),
    /control_owned_practice_target_utm_mismatch/
  );

  const nonOwned = "https://example.com/korean-practice?utm_source=threads&utm_medium=organic&utm_campaign=language_cafe&utm_content=030-instagram-lesson-recall-v2";
  assert.throws(
    () => createDraft({ carouselJob: source, control: validControl(source, { strategy: { ...ownedBase, threadsApprovedLinkTarget: nonOwned } }) }),
    /control_owned_practice_target_not_allowlisted_https/
  );

  const exactUtmButUnverified = helpers.buildTrackedLearningUrl(
    "https://languagestudio.uk/korean-practice",
    source.source.expressionId
  );
  assert.throws(
    () => createDraft({ carouselJob: source, control: validControl(source, { strategy: { ...ownedBase, threadsApprovedLinkTarget: exactUtmButUnverified } }) }),
    /control_owned_practice_target_not_verified_for_korean_learning/
  );

  const verifiedLookingOwned = {
    ...ownedBase,
    threadsApprovedLinkTarget: exactUtmButUnverified,
    threadsOwnedPracticeLandingVerification: {
      status: "passed",
      koreanLearningAligned: true,
      officialReadbackStatus: "passed",
      approvedUrl: exactUtmButUnverified
    }
  };
  assert.throws(
    () => createDraft({ carouselJob: source, control: validControl(source, { strategy: verifiedLookingOwned }) }),
    /control_threads_link_target_type_must_be_source_instagram_permalink/
  );
});

test("does not claim preview absence and fails closed on an explicit attachment or invented platform state", async () => {
  const enabled = await newValidJob();
  assert.equal(Object.hasOwn(enabled.copy, "linkPreviewUsed"), false);
  enabled.copy.explicitLinkAttachmentRequested = true;
  let review = await validateThreadsJob(enabled, { jobsDir: await temporaryJobsDir() });
  assert.equal(review.errors.includes("threads_explicit_link_attachment_must_be_false_and_preview_platform_managed"), true);

  const claimed = await newValidJob();
  claimed.copy.platformPreviewState = "not_rendered";
  review = await validateThreadsJob(claimed, { jobsDir: await temporaryJobsDir() });
  assert.equal(review.errors.includes("threads_explicit_link_attachment_must_be_false_and_preview_platform_managed"), true);
});

test("fails closed on a mismatched strategy version", async () => {
  const job = await newValidJob();
  job.strategyVersion = "instagram-study-companion-v1";
  const review = await validateThreadsJob(job, { jobsDir: await temporaryJobsDir() });
  assert.equal(review.passed, false);
  assert.equal(review.errors.includes("threads_strategy_version_mismatch"), true);
});

test("blocks product, price, sales, and legacy site-traffic copy", async () => {
  for (const forbidden of [
    "Buy the Korean course.",
    "Our Korean course costs 6.99 USD.",
    "Explore our product.",
    "$6.99/mo",
    "Start a free trial.",
    "Join the membership.",
    "Continue with Language Cafe"
  ]) {
    const job = await newValidJob();
    job.copy.primaryPost += `\n\n${forbidden}`;
    updatePostHash(job);
    const review = await validateThreadsJob(job, { jobsDir: await temporaryJobsDir() });
    assert.equal(review.errors.includes("product_price_or_sales_copy_detected"), true, forbidden);
  }
});

test("allows benign educational copy that contains no commercial or URL-like language", async () => {
  const job = await newValidJob();
  job.copy.primaryPost = job.copy.primaryPost.replace(
    "Say it once for this situation.",
    "Practice the polite ending once for this situation."
  );
  updatePostHash(job);
  const review = await validateThreadsJob(job, { jobsDir: await temporaryJobsDir() });
  assert.equal(review.passed, true, review.errors.join(", "));

  for (const source of [
    publishedCarouselJob({
      source: {
        expression: "물론이죠",
        englishHint: "Of course.",
        scene: "politely agreeing with a friend"
      }
    }),
    publishedCarouselJob({
      source: {
        expression: "할인 중이에요",
        englishHint: "It's on sale.",
        scene: "explaining a store discount"
      }
    })
  ]) {
    const educationalJob = createDraft({ carouselJob: source });
    const educationalReview = await validateThreadsJob(educationalJob, { jobsDir: await temporaryJobsDir() });
    assert.equal(educationalReview.passed, true, educationalReview.errors.join(", "));
  }
});

test("requires a fresh, exact publish_one_learning_pair control and ignores blocked revenue fields", () => {
  const source = publishedCarouselJob();
  const revenueBlocked = validControl(source, {
    revenue: {
      status: "blocked_checkout",
      checkoutGate: { status: "unverified" },
      landing: { status: "unverified" },
      utm: { status: "not_ready" }
    }
  });
  assert.doesNotThrow(() => createDraft({ carouselJob: source, control: revenueBlocked }));

  const stopped = validControl(source, { handoff: { consumerAction: "stop" } });
  assert.throws(() => createDraft({ carouselJob: source, control: stopped }), /control_learning_pair_handoff_not_authorized/);

  const inventedPreviewState = validControl(source, { strategy: { threadsPlatformPreviewState: "not_rendered" } });
  assert.throws(() => createDraft({ carouselJob: source, control: inventedPreviewState }), /control_threads_safety_strategy_mismatch/);

  const prefilledHandoffLink = validControl(source, { handoff: { threadsLinkTarget: source.workflow.postPublishVerification.permalink } });
  assert.throws(() => createDraft({ carouselJob: source, control: prefilledHandoffLink }), /control_handoff_source_link_derivation_mismatch/);

  const mismatchedSource = validControl(source, { handoff: { requestedPostId: "another-job" } });
  assert.throws(() => createDraft({ carouselJob: source, control: mismatchedSource }), /control_requested_post_id_source_mismatch/);

  const expired = validControl(source, { handoff: { validUntil: "2026-09-04T14:00:00+09:00" } });
  assert.throws(() => createDraft({ carouselJob: source, control: expired }), /control_handoff_not_fresh/);

  const wrongTimezone = validControl(source, { timezone: "UTC" });
  assert.throws(() => createDraft({ carouselJob: source, control: wrongTimezone }), /control_kst_date_or_timezone_mismatch/);

  const staleAsOfDate = validControl(source, { asOfDate: "2026-09-03" });
  assert.throws(() => createDraft({ carouselJob: source, control: staleAsOfDate }), /control_kst_date_or_timezone_mismatch/);

  const outsidePeriod = validControl(source, { period: { day1: "2026-09-05", day14: "2026-09-17" } });
  assert.throws(() => createDraft({ carouselJob: source, control: outsidePeriod }), /control_outside_declared_period/);
});

test("rejects a non-canonical control path and CLI control redirection", async () => {
  const source = publishedCarouselJob();
  const control = validControl(source);
  assert.throws(
    () => createThreadsDraft({
      carouselJob: source,
      carouselJobPath: "jobs/source.json",
      controlSnapshot: controlSnapshot(control, path.resolve(os.tmpdir(), "fake-current-test.json")),
      date: "2026-09-04",
      now: TEST_NOW
    }),
    /control_snapshot_path_not_canonical/
  );
  await assert.rejects(
    () => runCli(["--control", path.resolve(os.tmpdir(), "fake-current-test.json")]),
    /--control is not supported/
  );
});

test("keeps a private recall question natural without engagement bait", async () => {
  const job = await newValidJob();
  job.copy.primaryPost = job.copy.primaryPost.replace(
    "Say it once for this situation.",
    "Say it once for this situation. Answer in the comments."
  );
  updatePostHash(job);
  const review = await validateThreadsJob(job, { jobsDir: await temporaryJobsDir() });
  assert.equal(review.passed, false);
  assert.equal(review.errors.includes("engagement_bait_detected"), true);
});

test("retires the legacy exposure experiment from every new draft", async () => {
  assert.equal(await resolveDraftAngle(), DEFAULT_THREADS_ANGLE);
  await assert.rejects(
    () => resolveDraftAngle({ requestedAngle: "scene-question-recall-v1" }),
    /retired or unsupported/
  );
  assert.throws(
    () => createThreadsDraft({
      carouselJob: publishedCarouselJob(),
      carouselJobPath: "jobs/source.json",
      controlSnapshot: controlSnapshot(validControl(publishedCarouselJob())),
      date: "2026-09-04",
      angle: "scene-question-recall-v1",
      now: TEST_NOW
    }),
    /requires angle instagram-lesson-recall-v2/
  );
});

test("refuses an attempted publish flag before any local or external action", async () => {
  await assert.rejects(
    () => runCli(["--publish"]),
    /publishing is intentionally unsupported/
  );
});
