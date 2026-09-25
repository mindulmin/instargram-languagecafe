"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const state = require("./channel-split-v3-state.cjs");

const T0 = "2026-09-25T02:00:00.000Z";
const T1 = "2026-09-25T02:01:00.000Z";
const T2 = "2026-09-25T02:02:00.000Z";
const T3 = "2026-09-25T02:03:00.000Z";
const T4 = "2026-09-25T02:04:00.000Z";
const EXPIRY = "2026-09-25T02:25:00.000Z";
const COMMIT = { before: "a".repeat(40), claimed: "b".repeat(40), create: "c".repeat(40),
  container: "d".repeat(40), publish: "e".repeat(40) };
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const baseLedger = () => ({ version: 1, lock: null,
  actions: [{ actionId: "old-v2-action", requestedPostId: "old-v2-job", status: "completed" }],
  receipts: [{ actionId: "old-v2-action", status: "published_learning_pair_exactly_once" }],
  lastRun: { runId: "old", status: "published_learning_pair_exactly_once" } });
function fixture(channel = "instagram", id = channel === "instagram" ? "ig-promo-001" : "threads-card-001") {
  const imageBytes = channel === "instagram" ? [Buffer.from("first-image")]
    : [Buffer.from("first-card"), Buffer.from("second-card")];
  const images = imageBytes.map((bytes, index) => ({ url: `https://aabbccdd.language-cafe-instagram-assets.pages.dev/${id}-${index + 1}.jpg`,
    sha256: hash(bytes) }));
  const copy = channel === "instagram"
    ? "Try the free Korean cafe pilot at Language Cafe. Find it through the profile link."
    : "At the cafe, say 포장해 주세요. To go, please.\nTry the Korean cafe mission → https://languagestudio.uk/missions/korean-cafe/";
  const job = { schemaVersion: 1, strategyVersion: "channel-split-v3", id, channel,
    workflow: { status: "approved" }, content: channel === "instagram"
      ? { caption: copy, image: images[0] }
      : { text: copy, images, siteUrl: "https://languagestudio.uk/missions/korean-cafe/" } };
  return { channel, id, copy, job, jobBytes: Buffer.from(`${JSON.stringify(job)}\n`),
    verifiedAssets: images.map((image, index) => ({ url: image.url, bytes: imageBytes[index] })),
    jobPath: `content-queue/${channel === "instagram" ? "instagram-promo" : "threads"}/jobs/${id}.json`,
    accountId: channel === "instagram" ? "17841476495914369" : "123456789012345" };
}
function claim(f, ledger = baseLedger(), actionId = `action-${f.id}`) {
  const original = structuredClone(ledger);
  const result = state.claimJob({ ledger, expectedRemoteStateSha: COMMIT.before,
    observedRemoteStateSha: COMMIT.before, jobBytes: f.jobBytes, jobPath: f.jobPath,
    verifiedAssets: f.verifiedAssets, selectedJobId: f.id, runId: "36129604025", runAttempt: 1,
    actionId, accountId: f.accountId, issuedAt: T0, validUntil: EXPIRY });
  assert.deepEqual(ledger, original, "pure transition must preserve input");
  return result;
}
function confirmed(f) {
  const claimed = claim(f);
  const permit = state.confirmRemoteClaim({ ledger: claimed.ledger, claimHash: claimed.claim.claimHash,
    expectedClaimStateSha: COMMIT.claimed, observedClaimStateSha: COMMIT.claimed, at: T1 });
  return { ...claimed, permit };
}
function attempted(f) {
  const initial = confirmed(f);
  const created = state.beginCreate({ ledger: initial.ledger, permit: initial.permit,
    expectedRemoteStateSha: COMMIT.claimed, observedRemoteStateSha: COMMIT.claimed,
    jobBytes: f.jobBytes, verifiedAssets: f.verifiedAssets, at: T1 });
  const withContainer = state.recordContainer({ ledger: created.ledger, permit: initial.permit,
    expectedRemoteStateSha: COMMIT.create, observedRemoteStateSha: COMMIT.create,
    containerId: "987654321", at: T2 });
  const publishing = state.beginPublish({ ledger: withContainer, permit: initial.permit,
    expectedRemoteStateSha: COMMIT.container, observedRemoteStateSha: COMMIT.container,
    jobBytes: f.jobBytes, verifiedAssets: f.verifiedAssets, at: T3 });
  return { ...initial, created, withContainer, publishing };
}
function readback(f, overrides = {}) {
  return { source: f.channel === "instagram" ? "official_instagram_graph_api_recent_media" : "official_threads_graph_api_recent_media",
    complete: true, accountId: f.accountId, checkedAt: T4, expectedCopy: f.copy,
    media: [{ id: "112233445566", [f.channel === "instagram" ? "caption" : "text"]: f.copy,
      mediaType: f.channel === "instagram" ? "IMAGE" : "CAROUSEL",
      permalink: f.channel === "instagram" ? "https://www.instagram.com/p/verifiedOne/"
        : "https://www.threads.com/@mindulmin/post/verifiedOne",
      timestamp: T3, verifiedImageSha256: f.verifiedAssets.map(asset => hash(asset.bytes)),
      imageEvidenceSource: "official_media_url_verified_bytes" }], ...overrides };
}
function complete(f, attemptedState, official = readback(f)) {
  return state.completeVerified({ ledger: attemptedState.publishing.ledger, permit: attemptedState.permit,
    expectedRemoteStateSha: COMMIT.publish, observedRemoteStateSha: COMMIT.publish,
    jobBytes: f.jobBytes, verifiedAssets: f.verifiedAssets, readback: official,
    expectedMediaId: "112233445566", at: T4 });
}

test("claim preserves all v2 fields and binds exact job bytes, assets, channel, account and remote origin", () => {
  const f = fixture(), original = baseLedger(), { ledger, claim: action } = claim(f, original);
  for (const [key, value] of Object.entries(original)) assert.deepEqual(ledger[key], value);
  assert.equal(action.jobSha256, hash(f.jobBytes));
  assert.equal(action.assets[0].sha256, hash(f.verifiedAssets[0].bytes));
  assert.equal(action.channel, "instagram");
  assert.equal(action.accountId, f.accountId);
  assert.equal(action.originStateSha, COMMIT.before);
  assert.equal(ledger.channelSplitV3.locks.threads, null);
  assert.equal(ledger.channelSplitV3.locks.instagram.stage, "claimed");
  assert.equal(state.checkedLedger(ledger).audit.length, 1);
});

test("v2 unresolved global lock forbids any v3 claim or transition and is never cleared", () => {
  const f = fixture(), locked = { ...baseLedger(), lock: { status: "needs_official_readback" } };
  assert.throws(() => claim(f, locked), /v2_global_lock_unresolved/);
  const ready = confirmed(f);
  ready.ledger.lock = { status: "needs_official_readback" };
  assert.throws(() => state.beginCreate({ ledger: ready.ledger, permit: ready.permit,
    expectedRemoteStateSha: COMMIT.claimed, observedRemoteStateSha: COMMIT.claimed,
    jobBytes: f.jobBytes, verifiedAssets: f.verifiedAssets, at: T1 }), /v2_global_lock_unresolved/);
});

test("wrong path, candidate, account, remote state, job bytes, and raw assets cannot claim", () => {
  const f = fixture();
  const args = { ledger: baseLedger(), expectedRemoteStateSha: COMMIT.before,
    observedRemoteStateSha: COMMIT.before, jobBytes: f.jobBytes, jobPath: f.jobPath,
    verifiedAssets: f.verifiedAssets, selectedJobId: f.id, runId: "36129604025",
    runAttempt: 1, actionId: "action-001", accountId: f.accountId, issuedAt: T0, validUntil: EXPIRY };
  for (const changed of [
    { jobPath: `content-queue/threads/jobs/${f.id}.json` }, { selectedJobId: "different" },
    { accountId: "not-numeric" }, { observedRemoteStateSha: COMMIT.claimed },
    { jobBytes: Buffer.from(f.jobBytes.toString().replace("Language Cafe", "Other Cafe")) },
    { verifiedAssets: [{ ...f.verifiedAssets[0], bytes: Buffer.from("tampered") }] }
  ]) {
    const input = { ...args, ...changed };
    if (changed.jobBytes) {
      // A different approved job may form a new claim, but the claim hash must differ.
      assert.notEqual(state.claimJob(input).claim.jobSha256, hash(f.jobBytes));
    } else assert.throws(() => state.claimJob(input));
  }
});

test("remote claim must be committed and read back before a permit exists", () => {
  const f = fixture(), { ledger, claim: action } = claim(f);
  assert.throws(() => state.confirmRemoteClaim({ ledger, claimHash: action.claimHash,
    expectedClaimStateSha: COMMIT.claimed, observedClaimStateSha: COMMIT.before, at: T1 }), /remote_state_changed/);
  assert.throws(() => state.confirmRemoteClaim({ ledger, claimHash: action.claimHash,
    expectedClaimStateSha: COMMIT.before, observedClaimStateSha: COMMIT.before, at: T1 }), /remote_claim_not_verified/);
  const permit = state.confirmRemoteClaim({ ledger, claimHash: action.claimHash,
    expectedClaimStateSha: COMMIT.claimed, observedClaimStateSha: COMMIT.claimed, at: T1 });
  assert.equal(permit.remoteClaimSha256, hash(COMMIT.claimed));
  assert.equal(permit.action, "publish_one_instagram_promo");
});

test("create and publish intents are one-attempt only; an ambiguous create stays locked", () => {
  const f = fixture(), ready = confirmed(f);
  const first = state.beginCreate({ ledger: ready.ledger, permit: ready.permit,
    expectedRemoteStateSha: COMMIT.claimed, observedRemoteStateSha: COMMIT.claimed,
    jobBytes: f.jobBytes, verifiedAssets: f.verifiedAssets, at: T1 });
  assert.equal(first.intent.mustCommitAndReadBackBeforeApi, true);
  assert.equal(first.ledger.channelSplitV3.locks.instagram.createAttempts, 1);
  assert.throws(() => state.beginCreate({ ledger: first.ledger, permit: ready.permit,
    expectedRemoteStateSha: COMMIT.create, observedRemoteStateSha: COMMIT.create,
    jobBytes: f.jobBytes, verifiedAssets: f.verifiedAssets, at: T2 }), /create_attempt_not_available/);
  const ambiguous = state.markAmbiguous({ ledger: first.ledger, permit: ready.permit,
    expectedRemoteStateSha: COMMIT.create, observedRemoteStateSha: COMMIT.create,
    stage: "create_attempted", at: T2 });
  assert.equal(ambiguous.channelSplitV3.locks.instagram.stage, "ambiguous");
  assert.equal(ambiguous.channelSplitV3.locks.threads, null);
  assert.throws(() => state.recordContainer({ ledger: ambiguous, permit: ready.permit,
    expectedRemoteStateSha: COMMIT.container, observedRemoteStateSha: COMMIT.container,
    containerId: "22", at: T3 }), /container_receipt_invalid/);
});

test("publish attempt requires durable create intent, container receipt and unchanged job/assets", () => {
  const f = fixture(), ready = confirmed(f);
  assert.throws(() => state.beginPublish({ ledger: ready.ledger, permit: ready.permit,
    expectedRemoteStateSha: COMMIT.claimed, observedRemoteStateSha: COMMIT.claimed,
    jobBytes: f.jobBytes, verifiedAssets: f.verifiedAssets, at: T1 }), /publish_attempt_not_available/);
  const created = state.beginCreate({ ledger: ready.ledger, permit: ready.permit,
    expectedRemoteStateSha: COMMIT.claimed, observedRemoteStateSha: COMMIT.claimed,
    jobBytes: f.jobBytes, verifiedAssets: f.verifiedAssets, at: T1 });
  assert.throws(() => state.recordContainer({ ledger: created.ledger, permit: ready.permit,
    expectedRemoteStateSha: COMMIT.claimed, observedRemoteStateSha: COMMIT.claimed,
    containerId: "11", at: T2 }), /container_receipt_invalid/);
  const withContainer = state.recordContainer({ ledger: created.ledger, permit: ready.permit,
    expectedRemoteStateSha: COMMIT.create, observedRemoteStateSha: COMMIT.create,
    containerId: "11", at: T2 });
  assert.throws(() => state.beginPublish({ ledger: withContainer, permit: ready.permit,
    expectedRemoteStateSha: COMMIT.container, observedRemoteStateSha: COMMIT.container,
    jobBytes: Buffer.from(`${f.jobBytes.toString().trimEnd()} `), verifiedAssets: f.verifiedAssets,
    at: T3 }), /job_or_asset_changed_after_claim/);
  const publishing = state.beginPublish({ ledger: withContainer, permit: ready.permit,
    expectedRemoteStateSha: COMMIT.container, observedRemoteStateSha: COMMIT.container,
    jobBytes: f.jobBytes, verifiedAssets: f.verifiedAssets, at: T3 });
  assert.equal(publishing.intent.mustCommitAndReadBackBeforeApi, true);
  assert.throws(() => state.beginPublish({ ledger: publishing.ledger, permit: ready.permit,
    expectedRemoteStateSha: COMMIT.publish, observedRemoteStateSha: COMMIT.publish,
    jobBytes: f.jobBytes, verifiedAssets: f.verifiedAssets, at: T4 }), /publish_attempt_not_available/);
});

test("official exact-one readback produces one terminal receipt and preserves historical state", () => {
  const f = fixture(), attempt = attempted(f);
  const finished = complete(f, attempt);
  assert.equal(finished.receipt.status, "published_verified");
  assert.equal(finished.receipt.mediaId, "112233445566");
  assert.equal(finished.ledger.channelSplitV3.locks.instagram, null);
  assert.equal(finished.ledger.channelSplitV3.receipts.length, 1);
  assert.equal(finished.ledger.channelSplitV3.audit.at(-1).kind, "published_verified");
  assert.equal(finished.ledger.lastRun.status, "published_learning_pair_exactly_once");
  assert.equal(attempt.publishing.ledger.channelSplitV3.locks.instagram.stage, "publish_attempted");
  assert.throws(() => claim(f, finished.ledger), /v3_replay/);
  assert.throws(() => complete(f, { ...attempt, publishing: { ledger: finished.ledger } }), /permit_or_claim_mismatch/);
});

test("missing, stale, partial, cross-account or duplicate readback cannot unlock", () => {
  const f = fixture(), attempt = attempted(f);
  const good = readback(f);
  const failures = [null, { ...good, complete: false }, { ...good, checkedAt: "2026-09-24T02:00:00Z" },
    { ...good, accountId: "999999999" }, { ...good, expectedCopy: "other copy" },
    { ...good, media: [...good.media, { ...good.media[0], id: "223344556677" }] },
    { ...good, media: [{ ...good.media[0], verifiedImageSha256: ["f".repeat(64)] }] },
    { ...good, media: [{ ...good.media[0], mediaType: "VIDEO" }] },
    { ...good, media: [{ ...good.media[0], timestamp: "2026-09-20T02:00:00Z" }] }];
  for (const official of failures) {
    assert.throws(() => complete(f, attempt, official));
    assert.equal(attempt.publishing.ledger.channelSplitV3.locks.instagram.stage, "publish_attempted");
  }
});

test("ambiguous publish stays locked, forbids retry, and can resolve only via exact official readback", () => {
  const f = fixture(), attempt = attempted(f);
  const ambiguous = state.markAmbiguous({ ledger: attempt.publishing.ledger, permit: attempt.permit,
    expectedRemoteStateSha: COMMIT.publish, observedRemoteStateSha: COMMIT.publish,
    stage: "publish_attempted", at: T4 });
  assert.equal(ambiguous.channelSplitV3.locks.instagram.publishAttempts, 1);
  assert.throws(() => state.beginPublish({ ledger: ambiguous, permit: attempt.permit,
    expectedRemoteStateSha: "f".repeat(40), observedRemoteStateSha: "f".repeat(40),
    jobBytes: f.jobBytes, verifiedAssets: f.verifiedAssets, at: T4 }), /publish_attempt_not_available/);
  const after = state.completeVerified({ ledger: ambiguous, permit: attempt.permit,
    expectedRemoteStateSha: "f".repeat(40), observedRemoteStateSha: "f".repeat(40),
    jobBytes: f.jobBytes, verifiedAssets: f.verifiedAssets, readback: readback(f), at: T4 });
  assert.equal(after.receipt.mediaId, "112233445566");
});

test("cross-channel claims and locks are independent but a permit cannot cross channels", () => {
  const ig = fixture("instagram"), th = fixture("threads");
  const igClaimed = claim(ig);
  const thClaimed = claim(th, igClaimed.ledger);
  assert.equal(thClaimed.ledger.channelSplitV3.locks.instagram.stage, "claimed");
  assert.equal(thClaimed.ledger.channelSplitV3.locks.threads.stage, "claimed");
  const thPermit = state.confirmRemoteClaim({ ledger: thClaimed.ledger,
    claimHash: thClaimed.claim.claimHash, expectedClaimStateSha: COMMIT.claimed,
    observedClaimStateSha: COMMIT.claimed, at: T1 });
  assert.equal(thPermit.action, "publish_one_threads_carousel");
  const cross = { ...thPermit, channel: "instagram" };
  assert.throws(() => state.beginCreate({ ledger: thClaimed.ledger, permit: cross,
    expectedRemoteStateSha: COMMIT.claimed, observedRemoteStateSha: COMMIT.claimed,
    jobBytes: th.jobBytes, verifiedAssets: th.verifiedAssets, at: T1 }), /permit_or_claim_mismatch/);
  assert.throws(() => claim(th, thClaimed.ledger), /channel_lock_unresolved/);
});

test("a Threads carousel needs official ordered image hashes and a Threads permalink", () => {
  const f = fixture("threads"), attempt = attempted(f);
  const good = readback(f);
  assert.equal(complete(f, attempt, good).receipt.channel, "threads");
  assert.throws(() => complete(f, attempt, { ...good, media: [{ ...good.media[0],
    verifiedImageSha256: [...good.media[0].verifiedImageSha256].reverse() }] }), /official_media_verification_failed/);
  assert.throws(() => complete(f, attempt, { ...good, media: [{ ...good.media[0],
    permalink: "https://www.instagram.com/p/wrong/" }] }), /official_media_verification_failed/);
});

test("audit chain, lock, claim and receipt tampering all fail closed", () => {
  const f = fixture(), claimed = claim(f);
  const variants = [
    ledger => { ledger.channelSplitV3.audit[0].hash = "0".repeat(64); },
    ledger => { ledger.channelSplitV3.actions[0].jobSha256 = "0".repeat(64); },
    ledger => { ledger.channelSplitV3.locks.instagram.createAttempts = 1; },
    ledger => { ledger.channelSplitV3.audit.pop(); },
    ledger => { ledger.channelSplitV3.locks.instagram = null; }
  ];
  for (const change of variants) {
    const tampered = structuredClone(claimed.ledger);
    change(tampered);
    assert.throws(() => state.checkedLedger(tampered));
  }
});

test("historical job/action replay and invalid permit windows fail closed", () => {
  const f = fixture();
  const historical = baseLedger(); historical.actions.push({ jobId: f.id });
  assert.throws(() => claim(f, historical), /historical_replay/);
  const historicalAction = baseLedger(); historicalAction.actions.push({ actionId: `action-${f.id}` });
  assert.throws(() => claim(f, historicalAction), /historical_replay/);
  const ready = confirmed(f);
  const altered = { ...ready.permit, jobSha256: "0".repeat(64) };
  assert.throws(() => state.beginCreate({ ledger: ready.ledger, permit: altered,
    expectedRemoteStateSha: COMMIT.claimed, observedRemoteStateSha: COMMIT.claimed,
    jobBytes: f.jobBytes, verifiedAssets: f.verifiedAssets, at: T1 }), /permit_or_claim_mismatch/);
  assert.throws(() => state.beginCreate({ ledger: ready.ledger, permit: ready.permit,
    expectedRemoteStateSha: COMMIT.claimed, observedRemoteStateSha: COMMIT.claimed,
    jobBytes: f.jobBytes, verifiedAssets: f.verifiedAssets, at: "2026-09-25T03:00:00Z" }), /permit_expired/);
});
