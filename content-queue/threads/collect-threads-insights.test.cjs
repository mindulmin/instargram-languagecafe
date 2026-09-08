const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  INSIGHT_METRICS,
  createThreadsInsightsApi,
  enrollPublishedExperimentJobs,
  runCli,
  safeErrorMessage,
  synchronizeExperimentCheckpoint
} = require("./collect-threads-insights.cjs");

const PUBLISHED_AT = "2026-08-30T00:00:00+0000";
const SECRET_TOKEN = "threads-secret-never-print";

function jobFixture() {
  return {
    schemaVersion: 3,
    channel: "threads",
    id: "2026-08-30-expression-036-threads-one-line-recall",
    source: { expressionId: "036", expression: "지금 가요" },
    workflow: { status: "published", autoPublish: false },
    measurement: {
      funnelStage: "threads_link_to_landing_to_first_korean_reply_to_saved_sentence",
      evidenceStatus: "unverified_priority",
      metrics: {
        views: { value: null, status: "unavailable" },
        replies: { value: null, status: "unavailable" },
        linkClicks: { value: null, status: "unavailable" },
        landingViews: { value: null, status: "unavailable" },
        savedSentences: { value: null, status: "unavailable" }
      }
    },
    published: {
      mediaId: "media-036",
      verification: {
        id: "media-036",
        permalink: "https://www.threads.com/@mindulmin/post/example",
        timestamp: PUBLISHED_AT,
        review: "passed"
      },
      publishedAt: "2026-08-30T00:00:05.000Z"
    }
  };
}

function validSession() {
  return {
    userId: "user-1",
    accessToken: SECRET_TOKEN,
    expiresAt: "2027-01-01T00:00:00.000Z",
    scopes: ["threads_basic", "threads_manage_insights"]
  };
}

async function setupJob() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "language-cafe-threads-insights-"));
  const jobsDirectory = path.join(root, "content-queue", "threads", "jobs");
  const lockDirectory = path.join(root, "content-queue", "threads", ".insights-locks");
  const experimentPath = path.join(root, "content-queue", "threads", "threads-exposure-experiment.json");
  await fs.mkdir(jobsDirectory, { recursive: true });
  const jobPath = path.join(jobsDirectory, "published.json");
  await fs.writeFile(jobPath, `${JSON.stringify(jobFixture(), null, 2)}\n`, "utf8");
  await fs.writeFile(experimentPath, `${JSON.stringify({
    schemaVersion: 1,
    id: "threads-exposure-v1-20260830",
    status: "active",
    scope: { maximumPosts: 3, cohortJobs: [] }
  }, null, 2)}\n`, "utf8");
  return { root, jobsDirectory, lockDirectory, experimentPath, jobPath };
}

function jsonResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(data);
    }
  };
}

function insightsPayload(overrides = {}) {
  const values = {
    views: 11,
    likes: 2,
    replies: 1,
    reposts: 0,
    quotes: 0,
    shares: 1,
    ...overrides
  };
  return {
    data: INSIGHT_METRICS.map((name) => ({ name, period: "lifetime", values: [{ value: values[name] }] }))
  };
}

test("defaults to a local dry run with no session read, API call, or job write", async () => {
  const fixture = await setupJob();
  const before = await fs.readFile(fixture.jobPath, "utf8");
  let calls = 0;
  const api = { async getPostInsights() { calls += 1; return []; } };
  const result = await runCli(["--job", fixture.jobPath], {
    jobsDirectory: fixture.jobsDirectory,
    lockDirectory: fixture.lockDirectory,
    experimentPath: fixture.experimentPath,
    api,
    session: validSession(),
    clock: () => new Date("2026-08-30T23:00:00.000Z")
  });

  assert.equal(result.status, "dry_run");
  assert.equal(result.wouldCallThreadsApi, false);
  assert.equal(result.sessionRead, false);
  assert.equal(result.jobWritten, false);
  assert.equal(calls, 0);
  assert.equal(await fs.readFile(fixture.jobPath, "utf8"), before);
});

test("a due 24h checkpoint uses one official read-only request and never puts the token in the URL or result", async () => {
  const fixture = await setupJob();
  let calls = 0;
  const fetchImpl = async (url, options) => {
    calls += 1;
    const parsed = new URL(String(url));
    assert.equal(parsed.origin, "https://graph.threads.net");
    assert.equal(parsed.pathname, "/v1.0/media-036/insights");
    assert.deepEqual(parsed.searchParams.get("metric").split(","), INSIGHT_METRICS);
    assert.equal(parsed.searchParams.has("access_token"), false);
    assert.equal(options.method, "GET");
    assert.equal(options.headers.authorization, `Bearer ${SECRET_TOKEN}`);
    return jsonResponse(insightsPayload());
  };
  const result = await runCli(["--job", fixture.jobPath, "--checkpoint-hours", "24"], {
    jobsDirectory: fixture.jobsDirectory,
    lockDirectory: fixture.lockDirectory,
    experimentPath: fixture.experimentPath,
    api: createThreadsInsightsApi({ fetchImpl }),
    session: validSession(),
    clock: () => new Date("2026-08-30T23:00:00.000Z")
  });
  const saved = JSON.parse(await fs.readFile(fixture.jobPath, "utf8"));

  assert.equal(result.status, "recorded");
  assert.equal(result.checkpoint, "24h");
  assert.equal(result.observedAtKst, "2026-08-31T08:00:00.000+09:00");
  assert.equal(result.postAgeHours, 23);
  assert.equal(calls, 1);
  assert.equal(JSON.stringify(result).includes(SECRET_TOKEN), false);
  assert.equal(saved.measurement.threadsInsights.checkpoints["24h"].metrics.views.value, 11);
  assert.equal(saved.measurement.metrics.views.value, 11);
  assert.equal(saved.measurement.metrics.linkClicks.value, null);
  assert.equal(saved.measurement.metrics.linkClicks.status, "unavailable");
  assert.equal(saved.measurement.threadsInsights.checkpoints["24h"].externalActions.publishAttempted, false);
});

test("null or missing API values remain unavailable while an observed zero remains zero", async () => {
  const fixture = await setupJob();
  const payload = {
    data: [
      { name: "views", values: [{ value: null }] },
      { name: "likes", values: [{ value: 0 }] },
      { name: "reposts", total_value: { value: null } },
      { name: "quotes", values: [{ value: 2 }] },
      { name: "shares", value: null }
    ]
  };
  const result = await runCli(["--job", fixture.jobPath, "--checkpoint-hours", "24"], {
    jobsDirectory: fixture.jobsDirectory,
    lockDirectory: fixture.lockDirectory,
    experimentPath: fixture.experimentPath,
    api: createThreadsInsightsApi({ fetchImpl: async () => jsonResponse(payload) }),
    session: validSession(),
    clock: () => new Date("2026-08-30T23:15:00.000Z")
  });

  assert.deepEqual(result.metrics.views, {
    value: null,
    status: "unavailable",
    source: "official_graph_threads_post_insights",
    availabilityReason: "api_returned_null_or_non_numeric"
  });
  assert.equal(result.metrics.likes.value, 0);
  assert.equal(result.metrics.likes.status, "observed");
  assert.equal(result.metrics.replies.value, null);
  assert.equal(result.metrics.replies.status, "unavailable");
  assert.equal(result.metrics.replies.availabilityReason, "metric_not_returned");
  assert.equal(result.metrics.quotes.value, 2);
});

test("a not-due checkpoint does not validate a session, call the API, or change the job", async () => {
  const fixture = await setupJob();
  const before = await fs.readFile(fixture.jobPath, "utf8");
  let calls = 0;
  const result = await runCli(["--job", fixture.jobPath, "--checkpoint-hours", "24"], {
    jobsDirectory: fixture.jobsDirectory,
    lockDirectory: fixture.lockDirectory,
    experimentPath: fixture.experimentPath,
    api: { async getPostInsights() { calls += 1; return []; } },
    session: { accessToken: "invalid-but-must-not-be-read" },
    clock: () => new Date("2026-08-30T22:59:59.000Z")
  });

  assert.equal(result.status, "not_due");
  assert.equal(result.wouldCallThreadsApi, false);
  assert.equal(result.sessionRead, false);
  assert.equal(result.jobWritten, false);
  assert.equal(calls, 0);
  assert.equal(await fs.readFile(fixture.jobPath, "utf8"), before);
});

test("24h and 72h checkpoint records are each idempotent", async () => {
  const fixture = await setupJob();
  let calls = 0;
  const api = {
    async getPostInsights() {
      calls += 1;
      return insightsPayload({ views: calls * 10 }).data;
    }
  };
  const common = {
    jobsDirectory: fixture.jobsDirectory,
    lockDirectory: fixture.lockDirectory,
    experimentPath: fixture.experimentPath,
    api,
    session: validSession()
  };

  const first24 = await runCli(["--job", fixture.jobPath, "--checkpoint-hours", "24"], {
    ...common,
    clock: () => new Date("2026-08-30T23:00:00.000Z")
  });
  const second24 = await runCli(["--job", fixture.jobPath, "--checkpoint-hours", "24"], {
    ...common,
    clock: () => new Date("2026-08-31T00:00:00.000Z")
  });
  const first72 = await runCli(["--job", fixture.jobPath, "--checkpoint-hours", "72"], {
    ...common,
    clock: () => new Date("2026-09-01T23:00:00.000Z")
  });
  const second72 = await runCli(["--job", fixture.jobPath, "--checkpoint-hours", "72"], {
    ...common,
    clock: () => new Date("2026-09-02T00:00:00.000Z")
  });
  const saved = JSON.parse(await fs.readFile(fixture.jobPath, "utf8"));

  assert.equal(first24.status, "recorded");
  assert.equal(second24.status, "already_recorded");
  assert.equal(first72.status, "recorded");
  assert.equal(second72.status, "already_recorded");
  assert.equal(calls, 2);
  assert.equal(saved.measurement.threadsInsights.checkpoints["24h"].metrics.views.value, 10);
  assert.equal(saved.measurement.threadsInsights.checkpoints["72h"].metrics.views.value, 20);
  assert.equal(saved.measurement.threadsInsights.latestCheckpoint, "72h");
});

test("collector-visible error messages redact every supported token form", () => {
  const message = safeErrorMessage(new Error(
    `accessToken=${SECRET_TOKEN} access_token=${SECRET_TOKEN} Authorization: Bearer ${SECRET_TOKEN}`
  ));
  assert.equal(message.includes(SECRET_TOKEN), false);
  assert.match(message, /\[redacted\]/u);
});

test("discovers only officially published experiment jobs, excludes baseline 036, preserves entries, and caps the cohort at three", async () => {
  const fixture = await setupJob();
  const existing = { jobId: "existing-job", note: "must remain byte-for-byte equivalent as an object" };
  await fs.writeFile(fixture.experimentPath, `${JSON.stringify({
    schemaVersion: 1,
    id: "threads-exposure-v1-20260830",
    status: "active",
    scope: { maximumPosts: 3, cohortJobs: [existing] },
    unrelatedField: { preserve: true }
  }, null, 2)}\n`, "utf8");

  async function writeCandidate({ expressionId, published = true, exactReceipt = true, timestamp }) {
    const candidate = jobFixture();
    candidate.id = `experiment-${expressionId}`;
    candidate.source = {
      expressionId,
      expression: `표현 ${expressionId}`,
      sourceCarouselJobId: `carousel-${expressionId}`
    };
    candidate.copy = {
      experiment: {
        id: "threads-exposure-v1-20260830",
        variant: "scene_first_question"
      }
    };
    candidate.workflow.status = published ? "published" : "approved";
    candidate.published = published ? {
      mediaId: `media-${expressionId}`,
      verification: {
        id: `media-${expressionId}`,
        permalink: `https://www.threads.com/@mindulmin/post/${expressionId}`,
        timestamp,
        review: "passed",
        mediaIdMatchCount: 1,
        normalizedFullTextMatchCount: exactReceipt ? 1 : 0
      }
    } : undefined;
    await fs.writeFile(path.join(fixture.jobsDirectory, `${candidate.id}.json`), `${JSON.stringify(candidate, null, 2)}\n`);
  }

  await writeCandidate({ expressionId: "036", timestamp: "2026-08-30T00:00:00Z" });
  await writeCandidate({ expressionId: "037", timestamp: "2026-08-31T00:00:00Z" });
  await writeCandidate({ expressionId: "038", timestamp: "2026-09-01T00:00:00Z" });
  await writeCandidate({ expressionId: "039", timestamp: "2026-09-02T00:00:00Z" });
  await writeCandidate({ expressionId: "040", published: false, timestamp: "2026-09-03T00:00:00Z" });
  await writeCandidate({ expressionId: "041", exactReceipt: false, timestamp: "2026-09-04T00:00:00Z" });

  const first = await enrollPublishedExperimentJobs({
    jobsDirectory: fixture.jobsDirectory,
    experimentPath: fixture.experimentPath,
    lockDirectory: fixture.lockDirectory,
    clock: () => new Date("2026-09-02T01:00:00Z")
  });
  const afterFirst = JSON.parse(await fs.readFile(fixture.experimentPath, "utf8"));
  const firstFile = await fs.readFile(fixture.experimentPath, "utf8");
  const second = await enrollPublishedExperimentJobs({
    jobsDirectory: fixture.jobsDirectory,
    experimentPath: fixture.experimentPath,
    lockDirectory: fixture.lockDirectory,
    clock: () => new Date("2026-09-02T02:00:00Z")
  });

  assert.equal(first.status, "enrolled");
  assert.deepEqual(first.enrolled, ["experiment-037", "experiment-038"]);
  assert.equal(afterFirst.scope.cohortJobs.length, 3);
  assert.deepEqual(afterFirst.scope.cohortJobs[0], existing);
  assert.equal(afterFirst.scope.cohortJobs.some((entry) => entry.jobId === "experiment-036"), false);
  assert.equal(afterFirst.scope.cohortJobs.some((entry) => entry.jobId === "experiment-039"), false);
  assert.equal(afterFirst.unrelatedField.preserve, true);
  assert.equal(second.status, "cohort_full");
  assert.equal(second.experimentWritten, false);
  assert.equal(await fs.readFile(fixture.experimentPath, "utf8"), firstFile);
});

test("a retired experiment preserves its historical cohort and never enrolls a new published candidate", async () => {
  const fixture = await setupJob();
  const historicalEntry = {
    jobId: "experiment-037",
    checkpoints: { "24h": "pending", "72h": "pending" },
    note: "historical evidence must remain unchanged"
  };
  await fs.writeFile(fixture.experimentPath, `${JSON.stringify({
    schemaVersion: 1,
    id: "threads-exposure-v1-20260830",
    status: "retired_no_new_enrollment",
    newEnrollmentAllowed: false,
    scope: { maximumPosts: 3, cohortJobs: [historicalEntry] },
    stoppedAtKst: "2026-09-04T15:29:18+09:00",
    stopReason: "direction_replaced_by_instagram_first_native_study_companion",
    replacementStrategy: "instagram-study-companion-link-v2"
  }, null, 2)}\n`, "utf8");

  const candidate = jobFixture();
  candidate.id = "experiment-038";
  candidate.source = {
    expressionId: "038",
    expression: "새 후보",
    sourceCarouselJobId: "carousel-038"
  };
  candidate.copy = {
    experiment: { id: "threads-exposure-v1-20260830", variant: "scene_first_question" }
  };
  candidate.published = {
    mediaId: "media-038",
    verification: {
      id: "media-038",
      permalink: "https://www.threads.com/@mindulmin/post/038",
      timestamp: "2026-09-03T00:00:00Z",
      review: "passed",
      mediaIdMatchCount: 1,
      normalizedFullTextMatchCount: 1
    }
  };
  await fs.writeFile(path.join(fixture.jobsDirectory, `${candidate.id}.json`), `${JSON.stringify(candidate, null, 2)}\n`, "utf8");
  const before = await fs.readFile(fixture.experimentPath, "utf8");

  const result = await enrollPublishedExperimentJobs({
    jobsDirectory: fixture.jobsDirectory,
    experimentPath: fixture.experimentPath,
    lockDirectory: fixture.lockDirectory,
    clock: () => new Date("2026-09-04T07:00:00Z")
  });

  assert.equal(result.status, "retired_no_new_enrollment");
  assert.deepEqual(result.enrolled, []);
  assert.equal(result.experimentWritten, false);
  assert.equal(result.cohortSize, 1);
  assert.equal(await fs.readFile(fixture.experimentPath, "utf8"), before);
});

test("a retired experiment blocks checkpoint collection for a job outside the historical cohort", async () => {
  const fixture = await setupJob();
  const job = jobFixture();
  job.id = "experiment-038";
  job.source = { expressionId: "038", expression: "새 후보", sourceCarouselJobId: "carousel-038" };
  job.copy = { experiment: { id: "threads-exposure-v1-20260830", variant: "scene_first_question" } };
  await fs.writeFile(fixture.jobPath, `${JSON.stringify(job, null, 2)}\n`, "utf8");
  await fs.writeFile(fixture.experimentPath, `${JSON.stringify({
    schemaVersion: 1,
    id: "threads-exposure-v1-20260830",
    status: "retired_no_new_enrollment",
    newEnrollmentAllowed: false,
    scope: {
      maximumPosts: 3,
      cohortJobs: [{ jobId: "experiment-037", checkpoints: { "24h": "pending", "72h": "pending" } }]
    }
  }, null, 2)}\n`, "utf8");
  const before = await fs.readFile(fixture.jobPath, "utf8");
  let calls = 0;

  const result = await runCli(["--job", fixture.jobPath, "--checkpoint-hours", "24"], {
    jobsDirectory: fixture.jobsDirectory,
    lockDirectory: fixture.lockDirectory,
    experimentPath: fixture.experimentPath,
    api: { async getPostInsights() { calls += 1; return []; } },
    session: { userId: "", accessToken: "", expiresAt: "", scopes: [] },
    clock: () => new Date("2026-08-30T23:00:00.000Z")
  });

  assert.equal(result.status, "retired_experiment_job_not_enrolled");
  assert.equal(result.wouldCallThreadsApi, false);
  assert.equal(result.sessionRead, false);
  assert.equal(result.jobWritten, false);
  assert.equal(calls, 0);
  assert.equal(await fs.readFile(fixture.jobPath, "utf8"), before);
  await assert.rejects(() => fs.stat(path.join(fixture.lockDirectory, `${job.id}-24h.json`)), { code: "ENOENT" });
});

test("a retired experiment still synchronizes an already-enrolled checkpoint without turning unavailable metrics into zero", async () => {
  const fixture = await setupJob();
  const job = jobFixture();
  job.id = "experiment-037";
  job.source = { expressionId: "037", expression: "다음 표현" };
  job.copy = { experiment: { id: "threads-exposure-v1-20260830", variant: "scene_first_question" } };
  job.measurement.threadsInsights = {
    checkpoints: {
      "24h": {
        status: "observed",
        observedAtKst: "2026-09-01T09:03:00.000+09:00",
        postAgeHours: 23.55,
        metrics: {
          views: { value: 17, status: "observed" },
          likes: { value: 0, status: "observed" },
          replies: { value: null, status: "unavailable" },
          reposts: { value: null, status: "unavailable" },
          quotes: { value: 1, status: "observed" },
          shares: { value: null, status: "unavailable" }
        }
      }
    }
  };
  const untouched = {
    jobId: "experiment-038",
    note: "do not rewrite this entry",
    checkpoints: { "24h": "pending", "72h": "pending" }
  };
  await fs.writeFile(fixture.experimentPath, `${JSON.stringify({
    schemaVersion: 1,
    id: "threads-exposure-v1-20260830",
    status: "retired_no_new_enrollment",
    newEnrollmentAllowed: false,
    scope: {
      maximumPosts: 3,
      cohortJobs: [
        { jobId: job.id, checkpoints: { "24h": "pending", "72h": "pending" } },
        untouched
      ]
    }
  }, null, 2)}\n`);

  const first = await synchronizeExperimentCheckpoint({
    job,
    checkpointHours: 24,
    experimentPath: fixture.experimentPath,
    lockDirectory: fixture.lockDirectory,
    clock: () => new Date("2026-09-01T00:03:00Z")
  });
  const firstFile = await fs.readFile(fixture.experimentPath, "utf8");
  const saved = JSON.parse(firstFile);
  const second = await synchronizeExperimentCheckpoint({
    job,
    checkpointHours: 24,
    experimentPath: fixture.experimentPath,
    lockDirectory: fixture.lockDirectory,
    clock: () => new Date("2026-09-01T00:04:00Z")
  });
  const checkpoint = saved.scope.cohortJobs[0].checkpoints["24h"];

  assert.equal(first.status, "synchronized");
  assert.equal(checkpoint.jobCheckpointReference, "measurement.threadsInsights.checkpoints.24h");
  assert.equal(checkpoint.observedAtKst, "2026-09-01T09:03:00.000+09:00");
  assert.equal(checkpoint.postAgeHours, 23.55);
  assert.equal(checkpoint.metrics.views.value, 17);
  assert.equal(checkpoint.metrics.likes.value, 0);
  assert.equal(checkpoint.metrics.likes.status, "observed");
  assert.equal(checkpoint.metrics.replies.value, null);
  assert.equal(checkpoint.metrics.replies.status, "unavailable");
  assert.deepEqual(saved.scope.cohortJobs[1], untouched);
  assert.equal(saved.status, "retired_no_new_enrollment");
  assert.equal(saved.newEnrollmentAllowed, false);
  assert.equal(second.status, "already_synchronized");
  assert.equal(await fs.readFile(fixture.experimentPath, "utf8"), firstFile);
});

test("sets awaiting_evaluation only when exactly three enrolled jobs each have observed 72h checkpoints", async () => {
  const fixture = await setupJob();
  const job = jobFixture();
  job.id = "experiment-039";
  job.source = { expressionId: "039", expression: "세 번째 표현" };
  job.copy = { experiment: { id: "threads-exposure-v1-20260830", variant: "scene_first_question" } };
  job.measurement.threadsInsights = {
    checkpoints: {
      "72h": {
        status: "observed",
        observedAtKst: "2026-09-05T09:00:00.000+09:00",
        postAgeHours: 71.5,
        metrics: Object.fromEntries(INSIGHT_METRICS.map((name) => [name, { value: null, status: "unavailable" }]))
      }
    }
  };
  const observed72 = {
    status: "observed",
    observedAtKst: "2026-09-04T09:00:00.000+09:00",
    postAgeHours: 71.5,
    metrics: {}
  };
  await fs.writeFile(fixture.experimentPath, `${JSON.stringify({
    schemaVersion: 1,
    id: "threads-exposure-v1-20260830",
    status: "active",
    scope: {
      maximumPosts: 3,
      cohortJobs: [
        { jobId: "experiment-037", checkpoints: { "72h": observed72 } },
        { jobId: "experiment-038", checkpoints: { "72h": observed72 } },
        { jobId: "experiment-039", checkpoints: { "72h": "pending" } }
      ]
    }
  }, null, 2)}\n`);

  const result = await synchronizeExperimentCheckpoint({
    job,
    checkpointHours: 72,
    experimentPath: fixture.experimentPath,
    lockDirectory: fixture.lockDirectory,
    clock: () => new Date("2026-09-05T00:00:00Z")
  });
  const saved = JSON.parse(await fs.readFile(fixture.experimentPath, "utf8"));

  assert.equal(result.status, "synchronized_awaiting_evaluation");
  assert.equal(saved.status, "awaiting_evaluation");
  assert.equal(saved.scope.cohortJobs.length, 3);
  assert.equal(saved.scope.cohortJobs[2].checkpoints["72h"].metrics.views.value, null);
  assert.equal(saved.scope.cohortJobs[2].checkpoints["72h"].metrics.views.status, "unavailable");
  assert.equal(saved.awaitingEvaluationAtKst, "2026-09-05T09:00:00.000+09:00");
});

test("a recorded due checkpoint enrolls and synchronizes its exact-receipt cohort job in one idempotent flow", async () => {
  const fixture = await setupJob();
  const job = jobFixture();
  job.id = "experiment-037";
  job.source = { expressionId: "037", expression: "곧 가요", sourceCarouselJobId: "carousel-037" };
  job.copy = { experiment: { id: "threads-exposure-v1-20260830", variant: "scene_first_question" } };
  job.published.mediaId = "media-037";
  job.published.verification = {
    id: "media-037",
    permalink: "https://www.threads.com/@mindulmin/post/037",
    timestamp: PUBLISHED_AT,
    review: "passed",
    mediaIdMatchCount: 1,
    normalizedFullTextMatchCount: 1
  };
  await fs.writeFile(fixture.jobPath, `${JSON.stringify(job, null, 2)}\n`);
  let calls = 0;
  const common = {
    jobsDirectory: fixture.jobsDirectory,
    lockDirectory: fixture.lockDirectory,
    experimentPath: fixture.experimentPath,
    api: {
      async getPostInsights() {
        calls += 1;
        return insightsPayload({ views: 19 }).data;
      }
    },
    session: validSession()
  };

  const first = await runCli(["--job", fixture.jobPath, "--checkpoint-hours", "24"], {
    ...common,
    clock: () => new Date("2026-08-30T23:10:00.000Z")
  });
  const second = await runCli(["--job", fixture.jobPath, "--checkpoint-hours", "24"], {
    ...common,
    clock: () => new Date("2026-08-31T00:10:00.000Z")
  });
  const experiment = JSON.parse(await fs.readFile(fixture.experimentPath, "utf8"));
  const cohortEntry = experiment.scope.cohortJobs[0];

  assert.equal(first.status, "recorded");
  assert.equal(first.experimentEnrollment.status, "enrolled");
  assert.equal(first.experimentSynchronization.status, "synchronized");
  assert.equal(cohortEntry.jobId, "experiment-037");
  assert.equal(cohortEntry.checkpoints["24h"].status, "observed");
  assert.equal(cohortEntry.checkpoints["24h"].metrics.views.value, 19);
  assert.equal(second.status, "already_recorded");
  assert.equal(second.experimentSynchronization.status, "already_synchronized");
  assert.equal(calls, 1);
});
