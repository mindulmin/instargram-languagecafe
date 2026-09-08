const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  DEFAULT_CONTROL_PATH,
  LEARNING_EXTENSION_CTA,
  LINK_TARGET_SOURCE_INSTAGRAM,
  RECOVERY_RESOLUTION,
  THREADS_RECOVERY_ACTION,
  THREADS_STRATEGY_VERSION,
  createThreadsDraft,
  readRecoveryEvidenceSnapshot,
  sha256
} = require("./prepare-threads-draft.cjs");
const {
  ThreadsApiError,
  createThreadsApi,
  lockPathFor,
  runCli,
  safeErrorMessage
} = require("./publish-threads.cjs");

function publishedCarouselJob() {
  return {
    id: "carousel-030",
    source: {
      expressionId: "030",
      expression: "영어 할 수 있어요?",
      englishHint: "Do you speak English?",
      scene: "asking a train-station information worker for language help"
    },
    instagram: { caption: "A deliberately different Instagram carousel caption." },
    workflow: {
      status: "published",
      naturalKoreanReview: { review: "passed" },
      globalLearnerReview: { review: "passed" },
      distributionReview: { review: "passed" },
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
}

function validControl(carouselJob) {
  return {
    schemaVersion: "1.2",
    testId: "language-cafe-learning-pair-publisher-test",
    asOfDate: "2026-08-25",
    timezone: "Asia/Seoul",
    period: {
      day1: "2026-08-25",
      day14: "2026-09-07"
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
      actionId: "publisher-action-030",
      idempotencyKey: "publisher-idempotency-030",
      issuedAt: "2026-01-01T00:00:00+09:00",
      validUntil: "2027-01-01T00:00:00+09:00",
      requestedPostId: carouselJob.id,
      targetExpression: carouselJob.source.expression,
      threadsLinkTargetType: LINK_TARGET_SOURCE_INSTAGRAM,
      threadsLinkTarget: null,
      receiptPathPattern: "C:\\Users\\earth\\OneDrive\\Desktop\\codex\\instagram-card-test\\meaning-switch-series-v1\\operations\\revenue-experiment\\<testId>\\publisher-receipts\\<actionId>.json",
      mayCreateMedia: true,
      mayPublish: true,
      requiredReceiptFields: [
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
      ]
    }
  };
}

async function setupJob({ angle, recovery = false } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "language-cafe-threads-publish-"));
  const jobsDirectory = path.join(root, "content-queue", "threads", "jobs");
  const lockDirectory = path.join(root, "content-queue", "threads", ".publish-locks");
  const sourceCarouselRoot = path.join(root, "jobs");
  const sourceCarouselPath = path.join(sourceCarouselRoot, "carousel.json");
  const controlPath = DEFAULT_CONTROL_PATH;
  const controlFixturePath = path.join(root, "current-test.fixture.json");
  await fs.mkdir(jobsDirectory, { recursive: true });
  await fs.mkdir(sourceCarouselRoot, { recursive: true });
  const carouselJob = publishedCarouselJob();
  const control = validControl(carouselJob);
  let recoveryEvidenceSnapshot = null;
  let legacyJobPath = null;
  let legacyLockPath = null;
  let evidencePath = null;
  if (recovery) {
    const legacyId = "legacy-threads-030";
    const legacyJobRelative = `content-queue/threads/jobs/${legacyId}.json`;
    const legacyLockRelative = `content-queue/threads/.publish-locks/${legacyId}.json`;
    const evidenceRelative = "content-queue/threads/recovery-evidence/legacy-threads-030-abandoned.json";
    legacyJobPath = path.join(root, ...legacyJobRelative.split("/"));
    legacyLockPath = path.join(root, ...legacyLockRelative.split("/"));
    evidencePath = path.join(root, ...evidenceRelative.split("/"));
    await Promise.all([
      fs.mkdir(path.dirname(evidencePath), { recursive: true }),
      fs.mkdir(path.dirname(legacyLockPath), { recursive: true })
    ]);
    const legacyJob = {
      id: legacyId,
      channel: "threads",
      source: {
        sourceCarouselJobId: carouselJob.id,
        expressionId: carouselJob.source.expressionId,
        expression: carouselJob.source.expression
      },
      copy: { normalizedPrimaryPostHash: "different-legacy-copy" },
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
    await Promise.all([
      fs.writeFile(legacyJobPath, legacyJobRaw),
      fs.writeFile(legacyLockPath, legacyLockRaw)
    ]);
    const evidence = {
      schemaVersion: 1,
      evidenceType: "threads_ambiguous_publish_recovery_preflight",
      createdAt: "2026-08-25T00:00:00.000Z",
      immutable: true,
      legacyJob: { id: legacyId, path: legacyJobRelative, sha256: sha256(legacyJobRaw) },
      legacyLock: { path: legacyLockRelative, sha256: sha256(legacyLockRaw) },
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
        checkedAt: "2026-08-25T00:00:00.000Z"
      },
      officialThreadsRecentReadback: {
        checkedAt: "2026-08-25T00:00:00.000Z",
        recentMediaChecked: 10,
        normalizedLegacyFullTextMatchCount: 0,
        targetHangulMatchCount: 0,
        exactNoPublicMatch: true
      },
      resolution: RECOVERY_RESOLUTION,
      supersedingJobId: "2026-08-25-expression-030-threads-instagram-lesson-recall-v2",
      retryOriginalContainerAllowed: false
    };
    const evidenceRaw = `${JSON.stringify(evidence, null, 2)}\n`;
    await fs.writeFile(evidencePath, evidenceRaw);
    Object.assign(control.handoff, {
      consumerAction: THREADS_RECOVERY_ACTION,
      mayCreateMedia: false,
      mayPublish: true,
      supersedesJobId: legacyId,
      recoveryEvidencePath: evidenceRelative,
      recoveryEvidenceSha256: sha256(evidenceRaw),
      requiredReceiptFields: [...control.handoff.requiredReceiptFields, "legacyRecovery"]
    });
    control.publishing.status = "active";
    recoveryEvidenceSnapshot = await readRecoveryEvidenceSnapshot(control, { projectRoot: root });
  }
  const controlRaw = `${JSON.stringify(control, null, 2)}\n`;
  await fs.writeFile(sourceCarouselPath, `${JSON.stringify(carouselJob, null, 2)}\n`);
  await fs.writeFile(controlFixturePath, controlRaw);
  const job = createThreadsDraft({
    carouselJob,
    carouselJobPath: sourceCarouselPath,
    controlSnapshot: {
      control,
      controlPath,
      controlSha256: sha256(controlRaw),
      raw: controlRaw
    },
    recoveryEvidenceSnapshot,
    date: "2026-08-25",
    now: new Date("2026-08-25T00:00:00.000Z"),
    ...(angle ? { angle } : {})
  });
  const jobPath = path.join(jobsDirectory, "approved.json");
  await fs.writeFile(jobPath, `${JSON.stringify(job, null, 2)}\n`);
  return {
    root,
    jobsDirectory,
    lockDirectory,
    sourceCarouselRoot,
    sourceCarouselPath,
    controlPath,
    controlFixturePath,
    control,
    jobPath,
    job,
    legacyJobPath,
    legacyLockPath,
    evidencePath
  };
}

function fixtureDependencies(fixture, overrides = {}) {
  return {
    jobsDirectory: fixture.jobsDirectory,
    lockDirectory: fixture.lockDirectory,
    clock: () => new Date("2026-08-25T00:00:00.000Z"),
    controlSnapshotLoader: async (requestedPath) => {
      assert.equal(requestedPath, DEFAULT_CONTROL_PATH);
      const raw = await fs.readFile(fixture.controlFixturePath, "utf8");
      return {
        control: JSON.parse(raw),
        controlPath: DEFAULT_CONTROL_PATH,
        controlSha256: sha256(raw),
        raw
      };
    },
    sourceCarouselLoader: async () => JSON.parse(await fs.readFile(fixture.sourceCarouselPath, "utf8")),
    recoveryProjectRoot: fixture.root,
    ...overrides
  };
}

function successfulApi() {
  const state = { createCalls: 0, publishCalls: 0, recentCalls: 0, getCalls: 0, text: "", posts: [] };
  return {
    state,
    async listRecentPosts() {
      state.recentCalls += 1;
      return state.posts;
    },
    async createTextContainer(_session, text) {
      state.createCalls += 1;
      state.text = text;
      return "container-1";
    },
    async publishContainer() {
      state.publishCalls += 1;
      state.posts = [{ id: "media-1", text: state.text, permalink: "https://www.threads.net/@mindulmin/post/media-1", timestamp: "2026-08-25T00:00:00+0000", media_type: "TEXT" }];
      return "media-1";
    },
    async getPost() {
      state.getCalls += 1;
      return state.posts[0];
    }
  };
}

function validSession(overrides = {}) {
  return {
    userId: "user-1",
    accessToken: "secret-token",
    expiresAt: "2027-01-01T00:00:00.000Z",
    scopes: ["threads_basic", "threads_content_publish"],
    ...overrides
  };
}

test("TEXT container payload sends only text media and never requests an explicit link attachment", async () => {
  let body;
  const api = createThreadsApi({
    fetchImpl: async (_url, options) => {
      body = new URLSearchParams(options.body);
      return {
        ok: true,
        status: 200,
        async text() { return JSON.stringify({ id: "container-1" }); }
      };
    }
  });
  const post = `${LEARNING_EXTENSION_CTA} https://www.instagram.com/p/example/`;

  assert.equal(await api.createTextContainer(validSession(), post), "container-1");
  assert.equal(body.get("media_type"), "TEXT");
  assert.equal(body.get("text"), post);
  assert.deepEqual([...body.keys()].sort(), ["access_token", "media_type", "text"]);
  assert.equal(body.has("link_attachment"), false);
  assert.equal(body.has("link_preview"), false);
});

test("publisher defaults to dry-run and never reads a session or calls the API", async () => {
  const fixture = await setupJob();
  const api = successfulApi();
  const before = await fs.readFile(fixture.jobPath, "utf8");
  const result = await runCli(["--job", fixture.jobPath], {
    jobsDirectory: fixture.jobsDirectory,
    lockDirectory: fixture.lockDirectory,
    api,
    session: validSession()
  });

  assert.equal(result.status, "dry_run");
  assert.equal(result.wouldCallThreadsApi, false);
  assert.equal(api.state.createCalls, 0);
  assert.equal(api.state.publishCalls, 0);
  assert.equal(await fs.readFile(fixture.jobPath, "utf8"), before);
});

test("publishes exactly once only after official duplicate and post-readback checks", async () => {
  const fixture = await setupJob();
  const api = successfulApi();
  const result = await runCli(["--job", fixture.jobPath, "--publish"], fixtureDependencies(fixture, {
    api,
    session: validSession()
  }));
  const saved = JSON.parse(await fs.readFile(fixture.jobPath, "utf8"));

  assert.equal(result.status, "published");
  assert.equal(api.state.createCalls, 1);
  assert.equal(api.state.publishCalls, 1);
  assert.equal(saved.published.mediaId, "media-1");
  assert.equal(saved.published.verification.mediaIdMatchCount, 1);
  assert.equal(saved.published.verification.normalizedFullTextMatchCount, 1);
  assert.equal(saved.workflow.status, "published");
  assert.equal(saved.workflow.autoPublish, false);
  assert.equal(saved.measurement.metrics.linkClicks.status, "unavailable");
  assert.equal(saved.measurement.metrics.linkClicks.value, null);
  await assert.rejects(() => fs.stat(lockPathFor(fixture.lockDirectory, saved.id)), { code: "ENOENT" });
});

test("publishes the Instagram study companion with exactly one bound source permalink through the unchanged exact-once path", async () => {
  const fixture = await setupJob();
  const api = successfulApi();
  const result = await runCli(["--job", fixture.jobPath, "--publish"], fixtureDependencies(fixture, {
    api,
    session: validSession()
  }));
  const saved = JSON.parse(await fs.readFile(fixture.jobPath, "utf8"));

  assert.equal(result.status, "published");
  assert.equal(api.state.createCalls, 1);
  assert.equal(api.state.publishCalls, 1);
  assert.equal(api.state.text.endsWith(`${LEARNING_EXTENSION_CTA} ${fixture.job.source.sourceCarouselPermalink}`), true);
  assert.equal(api.state.text.split("https://").length - 1, 1);
  assert.equal(saved.strategyVersion, THREADS_STRATEGY_VERSION);
  assert.equal(saved.copy.externalLinkCount, 1);
  assert.equal(Object.hasOwn(saved.copy, "linkPreviewUsed"), false);
  assert.equal(saved.copy.explicitLinkAttachmentRequested, false);
  assert.equal(saved.published.threadsLinkTargetType, LINK_TARGET_SOURCE_INSTAGRAM);
  assert.equal(saved.published.threadsLinkTarget, fixture.job.source.sourceCarouselPermalink);
  assert.equal(saved.published.threadsExternalLinkCount, 1);
  assert.equal(saved.published.threadsExplicitLinkAttachmentRequested, false);
  assert.equal(saved.published.threadsPlatformPreviewState, "unavailable_platform_managed");
  assert.equal(Object.hasOwn(saved.published, "threadsLinkPreviewUsed"), false);
  assert.equal(saved.published.verification.threadsExternalLinkCount, 1);
  assert.equal(saved.published.verification.threadsExplicitLinkAttachmentRequested, false);
  assert.equal(saved.published.verification.normalizedFullTextMatchCount, 1);
  await assert.rejects(() => fs.stat(lockPathFor(fixture.lockDirectory, saved.id)), { code: "ENOENT" });
});

test("publishes one new Threads companion for an existing Instagram only with immutable recovery evidence", async () => {
  const fixture = await setupJob({ recovery: true });
  const api = successfulApi();
  const result = await runCli(["--job", fixture.jobPath, "--publish"], fixtureDependencies(fixture, {
    api,
    session: validSession()
  }));
  const saved = JSON.parse(await fs.readFile(fixture.jobPath, "utf8"));

  assert.equal(result.status, "published");
  assert.equal(saved.controlBinding.consumerAction, THREADS_RECOVERY_ACTION);
  assert.equal(saved.recoveryBinding.supersedesJobId, "legacy-threads-030");
  assert.equal(saved.recoveryBinding.resolution, RECOVERY_RESOLUTION);
  assert.equal(saved.published.legacyRecovery.supersedesJobId, "legacy-threads-030");
  assert.equal(saved.published.legacyRecovery.originalContainerPublishRetried, false);
  assert.equal(api.state.recentCalls >= 2, true);
  assert.equal(api.state.createCalls, 1);
  assert.equal(api.state.publishCalls, 1);
  assert.equal(await fs.stat(fixture.legacyLockPath).then(() => true), true);
});

test("recovery evidence is re-read and re-hashed before and after the new job lock", async () => {
  const beforeLock = await setupJob({ recovery: true });
  const beforeApi = successfulApi();
  await fs.appendFile(beforeLock.evidencePath, " ");
  await assert.rejects(
    () => runCli(["--job", beforeLock.jobPath, "--publish"], fixtureDependencies(beforeLock, { api: beforeApi, session: validSession() })),
    /threads_recovery_evidence_sha256_mismatch/
  );
  assert.equal(beforeApi.state.recentCalls, 0);
  assert.equal(beforeApi.state.createCalls, 0);
  await assert.rejects(() => fs.stat(lockPathFor(beforeLock.lockDirectory, beforeLock.job.id)), { code: "ENOENT" });

  const afterLock = await setupJob({ recovery: true });
  const afterApi = successfulApi();
  let controlReads = 0;
  const baseDependencies = fixtureDependencies(afterLock, { api: afterApi, session: validSession() });
  const originalControlLoader = baseDependencies.controlSnapshotLoader;
  baseDependencies.controlSnapshotLoader = async (requestedPath) => {
    controlReads += 1;
    const snapshot = await originalControlLoader(requestedPath);
    if (controlReads === 1) await fs.appendFile(afterLock.legacyLockPath, " ");
    return snapshot;
  };
  await assert.rejects(
    () => runCli(["--job", afterLock.jobPath, "--publish"], baseDependencies),
    /threads_recovery_legacy_lock_hash_mismatch/
  );
  assert.equal(controlReads, 1);
  assert.equal(afterApi.state.recentCalls, 0);
  assert.equal(afterApi.state.createCalls, 0);
  await assert.rejects(() => fs.stat(lockPathFor(afterLock.lockDirectory, afterLock.job.id)), { code: "ENOENT" });
  assert.equal(await fs.stat(afterLock.legacyLockPath).then(() => true), true);
});

test("Threads-only recovery still blocks an official full-text or Hangul duplicate", async () => {
  const fixture = await setupJob({ recovery: true });
  const api = successfulApi();
  api.state.posts = [{
    id: "existing-030",
    text: `Already public\n${fixture.job.source.expression}`,
    permalink: "https://www.threads.net/@mindulmin/post/existing-030"
  }];
  const result = await runCli(["--job", fixture.jobPath, "--publish"], fixtureDependencies(fixture, {
    api,
    session: validSession()
  }));

  assert.equal(result.status, "blocked_duplicate");
  assert.equal(api.state.recentCalls, 1);
  assert.equal(api.state.createCalls, 0);
  assert.equal(api.state.publishCalls, 0);
});

test("blocks a stopped or changed learning-pair handoff before session, API, or lock", async () => {
  const fixture = await setupJob();
  const api = successfulApi();
  const stoppedControl = {
    ...fixture.control,
    handoff: { ...fixture.control.handoff, consumerAction: "stop", mayPublish: false }
  };
  await fs.writeFile(fixture.controlFixturePath, `${JSON.stringify(stoppedControl, null, 2)}\n`);

  await assert.rejects(
    () => runCli(["--job", fixture.jobPath, "--publish"], fixtureDependencies(fixture, { api })),
    /Threads control preflight blocked:.*control_learning_pair_handoff_not_authorized/
  );
  assert.equal(api.state.recentCalls, 0);
  assert.equal(api.state.createCalls, 0);
  assert.equal(api.state.publishCalls, 0);
  await assert.rejects(() => fs.stat(lockPathFor(fixture.lockDirectory, fixture.job.id)), { code: "ENOENT" });
});

test("publisher rejects a job-bound alternate control path before loader, session, API, or lock", async () => {
  const fixture = await setupJob();
  const api = successfulApi();
  const redirectedJob = JSON.parse(await fs.readFile(fixture.jobPath, "utf8"));
  redirectedJob.controlBinding.controlPath = path.join(fixture.root, "fake-current-test.json");
  await fs.writeFile(fixture.jobPath, `${JSON.stringify(redirectedJob, null, 2)}\n`, "utf8");
  let controlLoaderCalls = 0;

  await assert.rejects(
    () => runCli(["--job", fixture.jobPath, "--publish"], fixtureDependencies(fixture, {
      api,
      sessionPath: path.join(fixture.root, "missing-session.json"),
      controlSnapshotLoader: async () => {
        controlLoaderCalls += 1;
        throw new Error("alternate control loader must never run");
      }
    })),
    /control_binding_path_not_canonical/
  );
  assert.equal(controlLoaderCalls, 0);
  assert.equal(api.state.recentCalls, 0);
  assert.equal(api.state.createCalls, 0);
  assert.equal(api.state.publishCalls, 0);
  await assert.rejects(() => fs.stat(lockPathFor(fixture.lockDirectory, fixture.job.id)), { code: "ENOENT" });
});

test("blocks a control byte change on SHA-256 mismatch before session, API, or lock", async () => {
  const fixture = await setupJob();
  const api = successfulApi();
  const unchangedControlWithDifferentBytes = `${JSON.stringify(fixture.control)}\n`;
  await fs.writeFile(fixture.controlFixturePath, unchangedControlWithDifferentBytes);

  await assert.rejects(
    () => runCli(["--job", fixture.jobPath, "--publish"], fixtureDependencies(fixture, { api })),
    /control_sha256_mismatch/
  );
  assert.equal(api.state.recentCalls, 0);
  assert.equal(api.state.createCalls, 0);
  assert.equal(api.state.publishCalls, 0);
  await assert.rejects(() => fs.stat(lockPathFor(fixture.lockDirectory, fixture.job.id)), { code: "ENOENT" });
});

test("re-reads and rejects weakened Instagram source evidence before session, API, or lock", async () => {
  const fixture = await setupJob();
  const api = successfulApi();
  const weakened = publishedCarouselJob();
  weakened.workflow.postPublishVerification = {
    status: "passed",
    review: "passed",
    permalink: "https://www.instagram.com/p/example/"
  };
  await fs.writeFile(fixture.sourceCarouselPath, `${JSON.stringify(weakened, null, 2)}\n`);

  await assert.rejects(
    () => runCli(["--job", fixture.jobPath, "--publish"], fixtureDependencies(fixture, { api })),
    /Threads Instagram-source preflight blocked:.*source_post_publish_verification_not_passed/
  );
  assert.equal(api.state.recentCalls, 0);
  assert.equal(api.state.createCalls, 0);
  assert.equal(api.state.publishCalls, 0);
  await assert.rejects(() => fs.stat(lockPathFor(fixture.lockDirectory, fixture.job.id)), { code: "ENOENT" });
});

test("re-reads and rejects a changed official source permalink before session, API, or lock", async () => {
  const fixture = await setupJob();
  const api = successfulApi();
  const changed = publishedCarouselJob();
  const changedPermalink = "https://www.instagram.com/p/different-carousel/";
  changed.workflow.postPublishVerification.permalink = changedPermalink;
  changed.published.verification.permalink = changedPermalink;
  await fs.writeFile(fixture.sourceCarouselPath, `${JSON.stringify(changed, null, 2)}\n`);

  await assert.rejects(
    () => runCli(["--job", fixture.jobPath, "--publish"], fixtureDependencies(fixture, { api })),
    /source_carousel_permalink_changed_or_not_bound/
  );
  assert.equal(api.state.recentCalls, 0);
  assert.equal(api.state.createCalls, 0);
  assert.equal(api.state.publishCalls, 0);
  await assert.rejects(() => fs.stat(lockPathFor(fixture.lockDirectory, fixture.job.id)), { code: "ENOENT" });
});

test("re-reads and rejects a changed official Instagram media ID before session, API, or lock", async () => {
  const fixture = await setupJob();
  const api = successfulApi();
  const changed = publishedCarouselJob();
  changed.workflow.postPublishVerification.matchedMediaId = "instagram-media-replaced";
  changed.published.mediaId = "instagram-media-replaced";
  changed.published.verification.id = "instagram-media-replaced";
  await fs.writeFile(fixture.sourceCarouselPath, `${JSON.stringify(changed, null, 2)}\n`);

  await assert.rejects(
    () => runCli(["--job", fixture.jobPath, "--publish"], fixtureDependencies(fixture, { api })),
    /source_carousel_media_id_changed_or_not_bound/
  );
  assert.equal(api.state.recentCalls, 0);
  assert.equal(api.state.createCalls, 0);
  assert.equal(api.state.publishCalls, 0);
  await assert.rejects(() => fs.stat(lockPathFor(fixture.lockDirectory, fixture.job.id)), { code: "ENOENT" });
});

test("blocks before container creation when official recent Threads media has the target Hangul", async () => {
  const fixture = await setupJob();
  const api = successfulApi();
  api.state.posts = [{ id: "old-1", text: "Different text\n영어 할 수 있어요?", permalink: "https://www.threads.net/@mindulmin/post/old-1" }];
  const result = await runCli(["--job", fixture.jobPath, "--publish"], fixtureDependencies(fixture, {
    api,
    session: validSession()
  }));
  const saved = JSON.parse(await fs.readFile(fixture.jobPath, "utf8"));

  assert.equal(result.status, "blocked_duplicate");
  assert.equal(api.state.createCalls, 0);
  assert.equal(api.state.publishCalls, 0);
  assert.equal(saved.workflow.status, "blocked");
  assert.equal(saved.workflow.manualPostDecisionRequired, false);
  assert.equal(saved.workflow.operationalRecoveryReviewRequired, false);
  assert.equal(saved.published, undefined);
});

test("does not retry an ambiguous publish response and retains the lock for human readback", async () => {
  const fixture = await setupJob();
  const api = successfulApi();
  api.publishContainer = async () => {
    api.state.publishCalls += 1;
    throw new ThreadsApiError("timed out", { ambiguous: true, operation: "TEXT container publish" });
  };
  const result = await runCli(["--job", fixture.jobPath, "--publish"], fixtureDependencies(fixture, {
    api,
    session: validSession()
  }));
  const saved = JSON.parse(await fs.readFile(fixture.jobPath, "utf8"));

  assert.equal(result.status, "blocked_ambiguous");
  assert.equal(api.state.createCalls, 1);
  assert.equal(api.state.publishCalls, 1);
  assert.equal(saved.workflow.status, "blocked");
  assert.equal(saved.workflow.manualPostDecisionRequired, false);
  assert.equal(saved.workflow.operationalRecoveryReviewRequired, true);
  assert.equal(saved.published, undefined);
  assert.equal(await fs.stat(lockPathFor(fixture.lockDirectory, saved.id)).then(() => true), true);
});

test("recovers an ambiguous publish response only from one exact official post", async () => {
  const fixture = await setupJob();
  const api = successfulApi();
  api.publishContainer = async () => {
    api.state.publishCalls += 1;
    api.state.posts = [{ id: "media-recovered", text: api.state.text, permalink: "https://www.threads.net/@mindulmin/post/media-recovered", timestamp: "2026-08-25T00:00:00+0000", media_type: "TEXT" }];
    throw new ThreadsApiError("timed out", { ambiguous: true, operation: "TEXT container publish" });
  };
  const result = await runCli(["--job", fixture.jobPath, "--publish"], fixtureDependencies(fixture, {
    api,
    session: validSession()
  }));
  const saved = JSON.parse(await fs.readFile(fixture.jobPath, "utf8"));

  assert.equal(result.status, "published_recovered");
  assert.equal(api.state.createCalls, 1);
  assert.equal(api.state.publishCalls, 1);
  assert.equal(saved.published.mediaId, "media-recovered");
  assert.equal(saved.published.recoveredFromAmbiguousResponse, true);
  await assert.rejects(() => fs.stat(lockPathFor(fixture.lockDirectory, saved.id)), { code: "ENOENT" });
});

test("redacts session secrets from publisher-visible error messages", () => {
  assert.equal(safeErrorMessage(new Error("access_token=secret-token Bearer top-secret")), "[redacted] Bearer [redacted]");
  assert.equal(safeErrorMessage(new Error("standing_direct_post_authorization_missing")), "standing_direct_post_authorization_missing");
});

test("rejects an expired session before lock creation or any API call", async () => {
  const fixture = await setupJob();
  const api = successfulApi();
  const before = await fs.readFile(fixture.jobPath, "utf8");

  await assert.rejects(() => runCli(["--job", fixture.jobPath, "--publish"], fixtureDependencies(fixture, {
    api,
    session: validSession({ expiresAt: "2026-08-24T23:59:59.000Z" })
  })), /token has expired/);

  assert.equal(api.state.recentCalls, 0);
  assert.equal(api.state.createCalls, 0);
  assert.equal(api.state.publishCalls, 0);
  assert.equal(await fs.readFile(fixture.jobPath, "utf8"), before);
  await assert.rejects(() => fs.stat(lockPathFor(fixture.lockDirectory, fixture.job.id)), { code: "ENOENT" });
});

test("rejects a session without publish scope before lock creation or any API call", async () => {
  const fixture = await setupJob();
  const api = successfulApi();
  const before = await fs.readFile(fixture.jobPath, "utf8");

  await assert.rejects(() => runCli(["--job", fixture.jobPath, "--publish"], fixtureDependencies(fixture, {
    api,
    session: validSession({ scopes: ["threads_basic"] })
  })), /threads_content_publish/);

  assert.equal(api.state.recentCalls, 0);
  assert.equal(api.state.createCalls, 0);
  assert.equal(api.state.publishCalls, 0);
  assert.equal(await fs.readFile(fixture.jobPath, "utf8"), before);
  await assert.rejects(() => fs.stat(lockPathFor(fixture.lockDirectory, fixture.job.id)), { code: "ENOENT" });
});
