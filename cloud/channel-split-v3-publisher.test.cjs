"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const childProcess = require("node:child_process");
const sharp = require("sharp");
const state = require("./channel-split-v3-state.cjs");
const runner = require("./channel-split-v3-publisher.cjs");
const threads = require("../content-queue/threads/publish-threads-carousel.cjs");

const T = "2026-09-25T12:45:00.000Z";
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const clock = () => new Date(T);
const root = "https://aabbccdd.language-cafe-instagram-assets.pages.dev";
test("synthetic publisher seam is absent on direct import outside the test runner", () => {
  const result = childProcess.spawnSync(process.execPath,
    ["-e", "process.env.NODE_TEST_CONTEXT='child-v8';const p=require('./cloud/channel-split-v3-publisher.cjs');process.stdout.write(String(Boolean(p.__testOnly)))"],
    { cwd: require("node:path").resolve(__dirname, ".."), encoding: "utf8" });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "false");
});

class FakeRemote {
  constructor() { this.ledger = { version: 1, lock: null, actions: [], receipts: [] }; this.counter = 10; this.sha = this.nextSha(); this.calls = []; }
  nextSha() { return (this.counter++).toString(16).padStart(40, "0"); }
  async readVerified() { return { sha: this.sha, ledger: structuredClone(this.ledger) }; }
  async claimJob(args) {
    assert.equal(args.expectedSha, this.sha);
    const result = state.claimJob({ ...args, ledger: this.ledger,
      expectedRemoteStateSha: this.sha, observedRemoteStateSha: this.sha });
    this.ledger = result.ledger; this.sha = this.nextSha(); this.calls.push("claimJob");
    const permit = state.confirmRemoteClaim({ ledger: this.ledger, claimHash: result.claim.claimHash,
      expectedClaimStateSha: this.sha, observedClaimStateSha: this.sha, at: args.confirmedAt });
    return { sha: this.sha, claim: result.claim, permit };
  }
  advance(kind, args) {
    assert.equal(args.expectedSha, this.sha);
    const result = state[kind]({ ...args, ledger: this.ledger,
      expectedRemoteStateSha: this.sha, observedRemoteStateSha: this.sha });
    this.ledger = result.ledger || result;
    this.sha = this.nextSha(); this.calls.push(kind);
    return { sha: this.sha, ...(result.intent ? { intent: result.intent } : {}),
      ...(result.receipt ? { receipt: result.receipt } : {}) };
  }
}
for (const kind of ["beginCreate", "recordContainer", "beginThreadsChildCreate",
  "recordThreadsChildContainer", "beginThreadsCarouselCreate", "recordThreadsCarouselContainer",
  "beginPublish", "completeVerified"]) FakeRemote.prototype[kind] = function (args) { return this.advance(kind, args); };

async function fixture(channel) {
  const bytes = await sharp({ create: { width: 600, height: 600, channels: 3,
    background: { r: 220, g: 245, b: 236 } } }).jpeg().toBuffer();
  const id = channel === "instagram" ? "ig-synthetic-001" : "threads-synthetic-001";
  const images = [1, 2].map(index => ({ url: `${root}/${id}-${index}.jpg`, sha256: hash(bytes),
    ...(channel === "threads" ? { altText: `Unique reviewed Korean cafe card number ${index}` } : {}) }));
  const caption = "Try Language Cafe's free Korean cafe pilot. You can read Hangul and practice a cafe order. Open the profile link to start the mission and try the changed order too.";
  const text = "At the cafe, say 포장해 주세요. — To go, please. Say it again in three minutes.\n\nTry the free Korean cafe mission → https://languagestudio.uk/missions/korean-cafe/";
  const content = channel === "instagram" ? { caption, destinationUrl: "https://languagestudio.uk/missions/korean-cafe/", image: images[0] }
    : { koreanExpression: "포장해 주세요.", englishExplanation: "To go, please.", text,
      siteUrl: "https://languagestudio.uk/missions/korean-cafe/", images };
  const job = { schemaVersion: 1, strategyVersion: "channel-split-v3", id, channel,
    workflow: { status: "approved" }, content };
  if (channel === "instagram") {
    job.editorialReview = { status: "approved", offerClaimApproved: true, landingMatchApproved: true,
      profileCtaApproved: true, visualApproved: true, captionSha256: hash(Buffer.from(caption)),
      imageSha256: images[0].sha256, destinationUrl: "https://languagestudio.uk/missions/korean-cafe/",
      evidence: { approvedClaimIds: ["free_korean_cafe_ordering_pilot_after_login"],
        homepage: { url: "https://languagestudio.uk/", linksToDestination: true, checkedAt: T },
        mission: { url: "https://languagestudio.uk/missions/korean-cafe/", freePilotVerified: true,
          orderPracticeVerified: true, hangulReaderPrerequisiteVerified: true,
          loginRequiredVerified: true, noCardRequiredVerified: true, checkedAt: T },
        profile: { website: "https://languagestudio.uk/", username: "mindulmin", checkedAt: T } } };
  } else {
    job.review = { status: "passed", contentSha256: threads.contentSha256(content),
      koreanExpressionAccuracy: { status: "passed", evidence: "The polite Korean line is accurate for takeaway orders." },
      englishExplanation: { status: "passed", evidence: "The English explanation matches the Korean order request." },
      mobileLegibility: { status: "passed", checkedImageCount: images.length,
        evidence: "Every synthetic card was reviewed at phone size for legibility." },
      siteOfferAccuracy: { status: "passed", url: "https://languagestudio.uk/missions/korean-cafe/", checkedAt: T,
        evidence: "The free Korean mission is separate from paid English plans." } };
  }
  const jobBytes = Buffer.from(JSON.stringify(job));
  const grant = { schemaVersion: 1, strategyVersion: "channel-split-v3", channel, jobId: id,
    jobSha256: hash(jobBytes), copySha256: hash(Buffer.from(channel === "instagram" ? caption : text)),
    assets: (channel === "instagram" ? [images[0]] : images),
    review: { status: "passed", reviewer: "independent_editorial_controller_v1", reviewedAt: T,
      accuracy: "passed", completeness: "passed", practicality: "passed", revenueAlignment: "passed",
      evidence: "Independent review confirmed exact copy, images, offer and channel-specific learner value." },
    siteOffer: { homepageUrl: "https://languagestudio.uk/",
      missionUrl: "https://languagestudio.uk/missions/korean-cafe/", checkedAt: T,
      homepageLinksMission: true, missionFreePilot: true } };
  const policy = { schemaVersion: 1, strategyVersion: "channel-split-v3", enabled: true,
    channels: { instagram: { maxPosts: 3, minimumGapHours: 72 }, threads: { maxPosts: 3, minimumGapHours: 72 } } };
  const files = new Map([[runner.jobPath(channel, id), jobBytes],
    [runner.approvalPath(id), Buffer.from(JSON.stringify(grant))],
    [require("node:path").join(__dirname, "control", "channel-split-v3-policy.json"), Buffer.from(JSON.stringify(policy))]]);
  const io = { readdir: async () => [`${id}.json`], readFile: async name => {
    if (!files.has(name)) throw new Error("synthetic file missing");
    return files.get(name);
  } };
  const home = "<a href='/missions/korean-cafe/'>Free Korean mission</a> free Korean café pilot for beginners who read Hangul. Log in to start; no card required.";
  const mission = "Free pilot. English guidance for beginners who read Hangul. Log in to start; no card required.";
  const fetchImpl = async value => {
    const url = String(value);
    return new Response(url === "https://languagestudio.uk/" ? home
      : url === "https://languagestudio.uk/missions/korean-cafe/" ? mission : bytes,
    { headers: url.startsWith(root) ? { "content-type": "image/jpeg" } : { "content-type": "text/html" } });
  };
  return { channel, id, job, jobBytes, grant, policy, files, io, fetchImpl, bytes };
}

function igApi(f, remote, { failCreate = false, duplicate = false } = {}) {
  let published = false;
  const post = { id: "222222222", caption: f.job.content.caption, media_type: "IMAGE",
    permalink: "https://www.instagram.com/p/SyntheticOne/",
    timestamp: duplicate ? "2026-09-19T12:45:00.000Z" : T };
  const api = {
    async getApp() { return { id: "2109337976465317" }; },
    async getProfile() { return { id: "123456789", username: "mindulmin", website: "https://languagestudio.uk/" }; },
    async getPage() { return { id: "987654321", instagram_business_account: { id: "123456789" } }; },
    async getPermissions() { return { data: ["instagram_basic", "instagram_content_publish", "pages_show_list", "pages_read_engagement"]
      .map(permission => ({ permission, status: "granted" })) }; },
    async listMedia() { return published || duplicate ? [post] : []; },
    async createContainer() {
      assert.equal(remote.calls.at(-1), "beginCreate");
      if (failCreate) throw new Error("ambiguous synthetic create");
      return "111111111";
    },
    async publishContainer() { assert.equal(remote.calls.at(-1), "beginPublish"); published = true; return post.id; },
    async getMedia() { return post; }
  };
  const session = { accountId: "123456789", pageId: "987654321", accessToken: "synthetic", graphVersion: "v25.0" };
  return { api, session };
}
function threadsApi(f, remote) {
  let published = false;
  const children = [{ id: "8001" }, { id: "8002" }];
  const post = { id: "999999999", text: f.job.content.text, media_type: "CAROUSEL",
    permalink: "https://www.threads.com/@mindulmin/post/SyntheticOne", timestamp: T,
    children: { data: children } };
  let nextChild = 0;
  const api = {
    async getIdentity() { return { id: "123456789", username: "mindulmin" }; },
    async listRecentPosts() { return published ? [post] : []; },
    async createImageContainer() {
      assert.equal(remote.calls.at(-1), "beginThreadsChildCreate");
      return String(7001 + nextChild++);
    },
    async getContainerStatus(_session, id) { return { id, status: "FINISHED" }; },
    async createCarouselContainer() { assert.equal(remote.calls.at(-1), "beginThreadsCarouselCreate"); return "7999"; },
    async publishContainer() { assert.equal(remote.calls.at(-1), "beginPublish"); published = true; return post.id; },
    async getPost() { return post; },
    async getChildMedia(_session, id) { const index = children.findIndex(child => child.id === id);
      return { id, media_type: "IMAGE", media_url: `https://cdn.example.test/card-${index}.jpg`,
        alt_text: f.job.content.images[index].altText }; }
  };
  return { api, session: { userId: "123456789", username: "mindulmin", accessToken: "synthetic" } };
}
function deps(f, remote, transport) {
  return { io: f.io, clock, fetchImpl: f.fetchImpl, remote, ...transport,
    runId: "36133744721", runAttempt: "1", env: {} };
}

test("preview verifies independent hash-bound grant while disabled policy never publishes", async () => {
  const f = await fixture("instagram");
  const result = await runner.__testOnly.run({ channel: f.channel, jobId: f.id, publish: false }, deps(f));
  assert.equal(result.status, "dry_run");
  f.policy.enabled = false;
  f.files.set(require("node:path").join(__dirname, "control", "channel-split-v3-policy.json"), Buffer.from(JSON.stringify(f.policy)));
  await assert.rejects(runner.__testOnly.run({ channel: f.channel, jobId: f.id, publish: true }, deps(f)), /policy_disabled/);
  f.grant.jobSha256 = "0".repeat(64);
  f.files.set(runner.approvalPath(f.id), Buffer.from(JSON.stringify(f.grant)));
  await assert.rejects(runner.__testOnly.run({ channel: f.channel, jobId: f.id, publish: false }, deps(f)), /review_grant_invalid/);
});

test("auto preview needs no API and disabled auto publish is a non-posting no-op", async () => {
  const f = await fixture("threads");
  const preview = await runner.__testOnly.run({ channel: f.channel, jobId: "auto", publish: false }, deps(f));
  assert.deepEqual(preview.approvedJobIds, [f.id]);
  f.policy.enabled = false;
  f.files.set(require("node:path").join(__dirname, "control", "channel-split-v3-policy.json"), Buffer.from(JSON.stringify(f.policy)));
  const blocked = await runner.__testOnly.run({ channel: f.channel, jobId: "auto", publish: true }, deps(f));
  assert.equal(blocked.status, "blocked_policy_disabled");
  assert.equal(blocked.wouldCallSocialApi, false);
});

test("auto publish treats a paused channel as a successful non-posting skip", async () => {
  const f = await fixture("threads"), remote = new FakeRemote();
  f.policy.channels.threads.enabled = false;
  f.files.set(require("node:path").join(__dirname, "control", "channel-split-v3-policy.json"),
    Buffer.from(JSON.stringify(f.policy)));
  const result = await runner.__testOnly.run({ channel: "threads", jobId: "auto", publish: true },
    deps(f, remote, threadsApi(f, remote)));
  assert.equal(result.status, "not_due");
  assert.equal(result.reason, "channel_disabled");
  assert.equal(result.wouldCallSocialApi, false);
  assert.equal(remote.calls.length, 0);
});

test("offer check requires an actual homepage anchor, not just matching page words", async () => {
  const f = await fixture("instagram");
  const withoutAnchor = async value => {
    const response = await f.fetchImpl(value);
    if (String(value) !== "https://languagestudio.uk/") return response;
    return new Response("free Korean café pilot for beginners who read Hangul. Log in to start; no card required. Free Korean mission");
  };
  await assert.rejects(runner.__testOnly.verifyCurrentOffer(withoutAnchor), /site_offer_changed/);
  const scriptOnly = async value => {
    const response = await f.fetchImpl(value);
    if (String(value) !== "https://languagestudio.uk/") return response;
    return new Response("<script>const cached = \"<a href='/missions/korean-cafe/'>Free Korean mission</a> free Korean café pilot for beginners who read Hangul. Log in to start; no card required.\"</script>");
  };
  await assert.rejects(runner.__testOnly.verifyCurrentOffer(scriptOnly), /site_offer_changed/);
});

test("local takeover uses authenticated complete GitHub run history and shared state, not an env flag", async () => {
  const f = await fixture("instagram"), remote = new FakeRemote();
  const initial = await remote.readVerified();
  const checkoutSha = "a".repeat(40);
  const env = { LANGUAGE_CAFE_LOCAL_FALLBACK: "1", LANGUAGE_CAFE_LOCAL_RUN_ID: "202609250001",
    GITHUB_TOKEN: "synthetic-github-token" };
  const runsFetch = runs => async (url, options) => {
    assert.equal(options.headers.Authorization, "Bearer synthetic-github-token");
    if (String(url).endsWith("/git/ref/heads/main")) return new Response(JSON.stringify({
      ref: "refs/heads/main", object: { type: "commit", sha: checkoutSha }
    }), { headers: { "content-type": "application/json" } });
    assert.match(String(url), /actions\/workflows\/channel-split-v3-publisher\.yml\/runs/u);
    return new Response(JSON.stringify({ total_count: runs.length, workflow_runs: runs }),
      { headers: { "content-type": "application/json" } });
  };
  const allowed = await runner.__testOnly.verifyLocalTakeover({ env, fetchImpl: runsFetch([]), clock,
    initial, jobId: f.id, checkoutSha });
  assert.equal(allowed, "202609250001");
  const active = [{ created_at: T, head_branch: "main", status: "in_progress", conclusion: null }];
  await assert.rejects(runner.__testOnly.verifyLocalTakeover({ env, fetchImpl: runsFetch(active), clock,
    initial, jobId: f.id, checkoutSha }), /local_fallback_cloud_run_still_active/);
  await assert.rejects(runner.__testOnly.verifyLocalTakeover({ env: { ...env, GITHUB_RUN_ID: "123" },
    fetchImpl: runsFetch([]), clock, initial, jobId: f.id, checkoutSha }), /local_fallback_identity_invalid/);
  await assert.rejects(runner.__testOnly.verifyLocalTakeover({ env,
    fetchImpl: async () => new Response(JSON.stringify({ ref: "refs/heads/main",
      object: { type: "commit", sha: "b".repeat(40) } })), clock, initial, jobId: f.id, checkoutSha }),
  /local_source_commit_not_main/);
});

test("cloud runner identity requires the active official workflow and exact main commit", async () => {
  const checkoutSha = "a".repeat(40);
  const env = { GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "mindulmin/instargram-languagecafe",
    GITHUB_REF: "refs/heads/main", GITHUB_SHA: checkoutSha, GITHUB_RUN_ID: "123",
    GITHUB_TOKEN: "synthetic-github-token" };
  const fetchImpl = async (url, options) => {
    assert.equal(String(url), "https://api.github.com/repos/mindulmin/instargram-languagecafe/actions/runs/123");
    assert.equal(options.headers.Authorization, "Bearer synthetic-github-token");
    return new Response(JSON.stringify({ id: 123, head_sha: checkoutSha, head_branch: "main",
      repository: { full_name: env.GITHUB_REPOSITORY },
      path: ".github/workflows/channel-split-v3-publisher.yml@main", event: "workflow_dispatch",
      status: "in_progress" }), { headers: { "content-type": "application/json" } });
  };
  assert.equal(await runner.__testOnly.verifyCloudRun({ env, fetchImpl, checkoutSha }), "123");
  await assert.rejects(runner.__testOnly.verifyCloudRun({ env: { ...env, GITHUB_SHA: "b".repeat(40) },
    fetchImpl, checkoutSha }), /cloud_runner_identity_invalid/);
  await assert.rejects(runner.__testOnly.verifyCloudRun({ env, checkoutSha,
    fetchImpl: async () => new Response(JSON.stringify({ id: 123, head_sha: checkoutSha,
      head_branch: "main", repository: { full_name: env.GITHUB_REPOSITORY },
      path: ".github/workflows/other.yml", event: "workflow_dispatch", status: "in_progress" })) }),
  /cloud_runner_readback_mismatch/);
});

test("optional official caption or Threads text is an empty string, never unavailable history", () => {
  for (const channel of ["instagram", "threads"]) {
    const history = runner.__testOnly.sanitizeHistory(channel,
      [{ id: "123", media_type: channel === "instagram" ? "IMAGE" : "VIDEO",
        permalink: "https://example.test/post", timestamp: T }], "123456789", T);
    assert.equal(history.media[0][channel === "instagram" ? "caption" : "text"], "");
    assert.equal(history.complete, true);
  }
  const missingTextPost = runner.__testOnly.sanitizeHistory("threads",
    [{ id: "124", media_type: "TEXT_POST", timestamp: T }], "123456789", T);
  assert.equal(missingTextPost.media[0].text, undefined,
    "a malformed text-only post must not be silently normalized");
});

test("Instagram intent commits before each social write and exact official readback closes one lock", async () => {
  const f = await fixture("instagram"), remote = new FakeRemote();
  const result = await runner.__testOnly.run({ channel: f.channel, jobId: f.id, publish: true },
    deps(f, remote, igApi(f, remote)));
  assert.equal(result.status, "published_verified");
  assert.deepEqual(remote.calls, ["claimJob", "beginCreate", "recordContainer", "beginPublish", "completeVerified"]);
  assert.equal(remote.ledger.channelSplitV3.locks.instagram, null);
  assert.equal(remote.ledger.channelSplitV3.receipts.length, 1);
});

test("official duplicate stops before claim; uncertain create retains one-attempt lock", async () => {
  const f = await fixture("instagram"), remote = new FakeRemote();
  await assert.rejects(runner.__testOnly.run({ channel: f.channel, jobId: f.id, publish: true },
    deps(f, remote, igApi(f, remote, { duplicate: true }))), /selection_duplicate_official_copy/);
  assert.equal(remote.calls.length, 0);
  await assert.rejects(runner.__testOnly.run({ channel: f.channel, jobId: f.id, publish: true },
    deps(f, remote, igApi(f, remote, { failCreate: true }))), /ambiguous synthetic create/);
  assert.deepEqual(remote.calls, ["claimJob", "beginCreate"]);
  assert.equal(remote.ledger.channelSplitV3.locks.instagram.stage, "create_attempted");
  await assert.rejects(runner.__testOnly.run({ channel: f.channel, jobId: f.id, publish: true },
    deps(f, remote, igApi(f, remote))), /selection_unresolved_channel_lock/);
});

test("Threads commits each child, parent, and publish intent before API and verifies official child type/order", async () => {
  const f = await fixture("threads"), remote = new FakeRemote();
  const result = await runner.__testOnly.run({ channel: f.channel, jobId: "auto", publish: true },
    deps(f, remote, threadsApi(f, remote)));
  assert.equal(result.status, "published_verified");
  assert.deepEqual(remote.calls, ["claimJob", "beginThreadsChildCreate", "recordThreadsChildContainer",
    "beginThreadsChildCreate", "recordThreadsChildContainer", "beginThreadsCarouselCreate",
    "recordThreadsCarouselContainer", "beginPublish", "completeVerified"]);
  assert.equal(remote.ledger.channelSplitV3.receipts[0].childOrderEvidence,
    "official_parent_children_order_and_reviewed_unique_alt_text");
});
