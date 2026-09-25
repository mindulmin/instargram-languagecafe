"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { V3RemoteState } = require("./channel-split-v3-remote.cjs");
const { encrypt } = require("./state.cjs");
const STATE_KEY = "a".repeat(64);

const T0 = "2026-09-25T02:00:00.000Z";
const T1 = "2026-09-25T02:01:00.000Z";
const T2 = "2026-09-25T02:02:00.000Z";
const T3 = "2026-09-25T02:03:00.000Z";
const EXPIRY = "2026-09-25T02:25:00.000Z";
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const ledger = () => ({ version: 1, lock: null,
  actions: [{ actionId: "historical-v2" }], receipts: [{ actionId: "historical-v2" }],
  lastRun: { status: "published_learning_pair_exactly_once" } });

class FakeGitHubState {
  constructor() {
    this.current = { sha: "a".repeat(40), tree: "b".repeat(40),
      ledger: ledger(), encrypted: encrypt({ version: 1,
        files: { "jobs/old-v2-job.json": Buffer.from("preserved historical job").toString("base64") } }, STATE_KEY) };
    this.reads = 0;
    this.saves = 0;
    this.mode = null;
  }
  async read() {
    this.reads += 1;
    if (this.mode === "read_error_after_save" && this.saves) throw new Error("remote GET unavailable");
    return { sha: this.current.sha, tree: this.current.tree,
      ledger: structuredClone(this.current.ledger), encrypted: Buffer.from(this.current.encrypted),
      branch: this.mode === "wrong_branch" || (this.mode === "wrong_branch_after_save" && this.saves)
        ? "main" : "cloud-state",
      repository: "mindulmin/instargram-languagecafe" };
  }
  async save(previous, nextLedger, encrypted) {
    this.saves += 1;
    if (this.mode === "conflict" || this.current.sha !== previous.sha) {
      throw new Error("Cloud state changed concurrently; abort");
    }
    const saved = { sha: "cdef1234567890ab"[this.saves - 1].repeat(40),
      tree: "def1234567890abc"[this.saves - 1].repeat(40),
      ledger: structuredClone(nextLedger), encrypted: Buffer.from(encrypted) };
    if (this.mode !== "stale_ref") {
      this.current = { sha: saved.sha, tree: saved.tree,
        ledger: structuredClone(nextLedger), encrypted: Buffer.from(encrypted) };
    }
    if (this.mode === "tampered_ledger") this.current.ledger.channelSplitV3.audit[0].hash = "0".repeat(64);
    if (this.mode === "changed_v2_ledger") this.current.ledger.lastRun.status = "fabricated";
    if (this.mode === "changed_cipher") this.current.encrypted = Buffer.from("different encrypted state");
    return saved;
  }
}

function fixture(channel = "instagram") {
  const id = channel === "instagram" ? "ig-promo-001" : "threads-card-001";
  const originalBytes = channel === "instagram" ? [Buffer.from("reviewed original image bytes")]
    : [Buffer.from("reviewed first card"), Buffer.from("reviewed second card")];
  const images = originalBytes.map((bytes, index) => ({
    url: `https://aabbccdd.language-cafe-instagram-assets.pages.dev/${id}-${index}.jpg`,
    sha256: hash(bytes), ...(channel === "threads" ? { altText: `Card ${index + 1}: a Korean cafe phrase.` } : {}) }));
  const content = channel === "instagram"
    ? { caption: "Try the free Korean cafe mission via the profile link.", image: images[0] }
    : { text: "At the cafe, say 포장해 주세요. To go, please. https://languagestudio.uk/missions/korean-cafe/",
      images, siteUrl: "https://languagestudio.uk/missions/korean-cafe/" };
  const job = { schemaVersion: 1, strategyVersion: "channel-split-v3", id, channel,
    workflow: { status: "approved" }, content };
  return { selectedJobId: id, jobPath: `content-queue/${channel === "instagram" ? "instagram-promo" : "threads"}/jobs/${id}.json`,
    jobBytes: Buffer.from(`${JSON.stringify(job)}\n`),
    grantSha256: "9".repeat(64), reviewer: "independent_editorial_controller_v1",
    verifiedAssets: images.map((image, index) => ({ url: image.url, bytes: originalBytes[index] })),
    runId: "36129604025", runAttempt: 1, actionId: `v3-${id}`,
    accountId: channel === "instagram" ? "17841476495914369" : "123456789012345",
    issuedAt: T0, validUntil: EXPIRY };
}
async function claim(store = new FakeGitHubState(), f = fixture()) {
  const remote = new V3RemoteState({ githubState: store, stateKey: STATE_KEY });
  const head = await remote.readVerified();
  const result = await remote.claimJob({ expectedSha: head.sha, confirmedAt: T1, ...f });
  return { remote, store, head, result };
}

test("encrypted historical state must authenticate before any v3 claim", async () => {
  const store = new FakeGitHubState();
  assert.throws(() => new V3RemoteState({ githubState: store }), /state_key_missing_or_invalid/);
  const wrongKey = new V3RemoteState({ githubState: store, stateKey: "b".repeat(64) });
  await assert.rejects(wrongKey.readVerified(), /encrypted_state_authentication_failed/);
  store.current.encrypted[store.current.encrypted.length - 1] ^= 1;
  const tampered = new V3RemoteState({ githubState: store, stateKey: STATE_KEY });
  await assert.rejects(tampered.readVerified(), /encrypted_state_authentication_failed/);
  assert.equal(store.saves, 0);
});

test("a claim and create intent become available only after independent branch, ledger and cipher readback", async () => {
  const { remote, store, head, result } = await claim();
  assert.equal(result.sha, "c".repeat(40));
  assert.equal(result.permit.remoteClaimCommitSha, result.sha);
  assert.equal(store.reads, 3, "initial read, fresh pre-CAS read, independent post-CAS read");
  assert.equal(store.saves, 1);
  assert.deepEqual(store.current.ledger.actions, head.ledger.actions);
  assert.deepEqual(store.current.ledger.receipts, head.ledger.receipts);
  assert.deepEqual(store.current.ledger.lastRun, head.ledger.lastRun);
  const f = fixture();
  const intent = await remote.beginCreate({ expectedSha: result.sha, permit: result.permit,
    jobBytes: f.jobBytes, verifiedAssets: f.verifiedAssets, at: T2 });
  assert.equal(intent.intent.mustCommitAndReadBackBeforeApi, true);
  assert.equal(intent.intent.channel, "instagram");
  assert.equal(store.reads, 5);
  assert.equal(store.current.ledger.channelSplitV3.locks.instagram.stage, "create_attempted");
  await assert.rejects(remote.beginCreate({ expectedSha: intent.sha, permit: result.permit,
    jobBytes: f.jobBytes, verifiedAssets: f.verifiedAssets, at: T3 }), /create_attempt_not_available/);
  assert.equal(store.saves, 2, "a second create intent must never be saved");
});

test("stale head and concurrent CAS conflict never produce a permit or intent", async () => {
  const store = new FakeGitHubState();
  const remote = new V3RemoteState({ githubState: store, stateKey: STATE_KEY });
  await assert.rejects(remote.claimJob({ expectedSha: "f".repeat(40), confirmedAt: T1,
    ...fixture() }), /v3_remote_head_changed/);
  assert.equal(store.saves, 0);
  store.mode = "conflict";
  await assert.rejects(remote.claimJob({ expectedSha: store.current.sha, confirmedAt: T1,
    ...fixture() }), /concurrently/);
  assert.equal(store.current.ledger.channelSplitV3, undefined);
});

test("unresolved historical lock and wrong branch fail before CAS", async () => {
  const store = new FakeGitHubState();
  store.current.ledger.lock = { status: "needs_official_readback" };
  const remote = new V3RemoteState({ githubState: store, stateKey: STATE_KEY });
  await assert.rejects(remote.readVerified(), /v2_global_lock_unresolved/);
  assert.equal(store.saves, 0);
  store.current.ledger.lock = null;
  store.mode = "wrong_branch";
  await assert.rejects(remote.readVerified(), /v3_remote_snapshot_invalid/);
});

test("an optimistic save without a changed ref cannot authorize an API call", async () => {
  const store = new FakeGitHubState();
  store.mode = "stale_ref";
  const remote = new V3RemoteState({ githubState: store, stateKey: STATE_KEY });
  await assert.rejects(remote.claimJob({ expectedSha: store.current.sha, confirmedAt: T1,
    ...fixture() }), /v3_remote_independent_readback_mismatch/);
  assert.equal(store.saves, 1);
});

test("tampered ledger, wrong branch, changed encrypted v2 bytes, and missing readback all fail closed", async () => {
  for (const mode of ["tampered_ledger", "changed_v2_ledger", "changed_cipher",
    "wrong_branch_after_save", "read_error_after_save"]) {
    const store = new FakeGitHubState(); store.mode = mode;
    const remote = new V3RemoteState({ githubState: store, stateKey: STATE_KEY });
    await assert.rejects(remote.claimJob({ expectedSha: store.current.sha, confirmedAt: T1,
      ...fixture() }));
    assert.equal(store.saves, 1);
    assert.notEqual(store.current.sha, "a".repeat(40));
    // A new attempt with the stale decision head cannot publish or overwrite.
    await assert.rejects(remote.claimJob({ expectedSha: "a".repeat(40), confirmedAt: T1,
      ...fixture() }));
    assert.equal(store.saves, 1);
  }
});

test("only recognized pure transitions can be persisted", async () => {
  const { remote, store, result } = await claim();
  await assert.rejects(remote.transition({ kind: "clearLock", expectedSha: result.sha }),
    /v3_remote_transition_not_allowed/);
  assert.equal(store.saves, 1);
});

test("Threads child, parent and publish intents each require their own durable CAS and readback", async () => {
  const f = fixture("threads");
  const { remote, store, result } = await claim(new FakeGitHubState(), f);
  let sha = result.sha;
  for (let index = 0; index < f.verifiedAssets.length; index += 1) {
    const child = await remote.beginThreadsChildCreate({ expectedSha: sha, permit: result.permit,
      jobBytes: f.jobBytes, verifiedAssets: f.verifiedAssets, childIndex: index, at: T2 });
    assert.equal(child.intent.mustCommitAndReadBackBeforeApi, true);
    assert.equal(child.intent.childIndex, index);
    assert.equal(child.intent.altText, `Card ${index + 1}: a Korean cafe phrase.`);
    sha = child.sha;
    const recorded = await remote.recordThreadsChildContainer({ expectedSha: sha,
      permit: result.permit, childIndex: index, containerId: String(7000 + index), at: T2 });
    sha = recorded.sha;
  }
  const parent = await remote.beginThreadsCarouselCreate({ expectedSha: sha, permit: result.permit,
    jobBytes: f.jobBytes, verifiedAssets: f.verifiedAssets, at: T2 });
  assert.deepEqual(parent.intent.orderedChildContainerIds, ["7000", "7001"]);
  assert.equal(parent.intent.mustCommitAndReadBackBeforeApi, true);
  sha = parent.sha;
  const recordedParent = await remote.recordThreadsCarouselContainer({ expectedSha: sha,
    permit: result.permit, containerId: "9000", at: T3 });
  sha = recordedParent.sha;
  const publishing = await remote.beginPublish({ expectedSha: sha, permit: result.permit,
    jobBytes: f.jobBytes, verifiedAssets: f.verifiedAssets, at: T3 });
  assert.equal(publishing.intent.mustCommitAndReadBackBeforeApi, true);
  assert.deepEqual(publishing.intent.orderedChildContainerIds, ["7000", "7001"]);
  assert.equal(store.current.ledger.channelSplitV3.locks.threads.stage, "publish_attempted");
  assert.equal(store.saves, 8);
  assert.equal(store.reads, 17, "each of eight writes has a fresh pre-read and independent post-read");
  await assert.rejects(remote.beginPublish({ expectedSha: publishing.sha, permit: result.permit,
    jobBytes: f.jobBytes, verifiedAssets: f.verifiedAssets, at: T3 }), /publish_attempt_not_available/);
  assert.equal(store.saves, 8);
});
