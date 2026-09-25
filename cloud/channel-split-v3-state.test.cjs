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
const GRANT_SHA = "9".repeat(64);
const REVIEWER = "independent_editorial_controller_v1";
const baseLedger = () => ({ version: 1, lock: null,
  actions: [{ actionId: "old-v2-action", requestedPostId: "old-v2-job", status: "completed" }],
  receipts: [{ actionId: "old-v2-action", status: "published_learning_pair_exactly_once" }],
  lastRun: { runId: "old", status: "published_learning_pair_exactly_once" } });
function fixture(channel = "instagram", id = channel === "instagram" ? "ig-promo-001" : "threads-card-001") {
  const imageBytes = channel === "instagram" ? [Buffer.from("first-image")]
    : [Buffer.from("first-card"), Buffer.from("second-card")];
  const images = imageBytes.map((bytes, index) => ({ url: `https://aabbccdd.language-cafe-instagram-assets.pages.dev/${id}-${index + 1}.jpg`,
    sha256: hash(bytes), ...(channel === "threads" ? { altText: `Card ${index + 1}: Korean cafe expression and English practice.` } : {}) }));
  const copy = channel === "instagram"
    ? "Try the free Korean cafe pilot at Language Cafe. Find it through the profile link."
    : "At the cafe, say 포장해 주세요. To go, please.\nTry the Korean cafe mission → https://languagestudio.uk/missions/korean-cafe/";
  const job = { schemaVersion: 1, strategyVersion: "channel-split-v3", id, channel,
    workflow: { status: "approved" }, content: channel === "instagram"
      ? { caption: copy, image: images[0] }
      : { text: copy, images, siteUrl: "https://languagestudio.uk/missions/korean-cafe/" } };
  return { channel, id, copy, job, jobBytes: Buffer.from(`${JSON.stringify(job)}\n`),
    grantSha256: GRANT_SHA, reviewer: REVIEWER,
    verifiedAssets: images.map((image, index) => ({ url: image.url, bytes: imageBytes[index] })),
    jobPath: `content-queue/${channel === "instagram" ? "instagram-promo" : "threads"}/jobs/${id}.json`,
    accountId: channel === "instagram" ? "17841476495914369" : "123456789012345" };
}
function claim(f, ledger = baseLedger(), actionId = `action-${f.id}`) {
  const original = structuredClone(ledger);
  const result = state.claimJob({ ledger, expectedRemoteStateSha: COMMIT.before,
    observedRemoteStateSha: COMMIT.before, jobBytes: f.jobBytes, jobPath: f.jobPath,
    verifiedAssets: f.verifiedAssets, selectedJobId: f.id, runId: "36129604025", runAttempt: 1,
    actionId, accountId: f.accountId, issuedAt: T0, validUntil: EXPIRY,
    grantSha256: f.grantSha256, reviewer: f.reviewer });
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
  if (f.channel === "threads") {
    let ledger = initial.ledger;
    let remoteSha = COMMIT.claimed;
    const checkpoint = number => number.toString(16).padStart(40, "0");
    for (let index = 0; index < f.verifiedAssets.length; index += 1) {
      const child = state.beginThreadsChildCreate({ ledger, permit: initial.permit,
        expectedRemoteStateSha: remoteSha, observedRemoteStateSha: remoteSha,
        jobBytes: f.jobBytes, verifiedAssets: f.verifiedAssets, childIndex: index, at: T1 });
      remoteSha = checkpoint(index * 2 + 1);
      ledger = state.recordThreadsChildContainer({ ledger: child.ledger, permit: initial.permit,
        expectedRemoteStateSha: remoteSha, observedRemoteStateSha: remoteSha,
        childIndex: index, containerId: String(7000 + index), at: T2 });
      remoteSha = checkpoint(index * 2 + 2);
    }
    const parent = state.beginThreadsCarouselCreate({ ledger, permit: initial.permit,
      expectedRemoteStateSha: remoteSha, observedRemoteStateSha: remoteSha,
      jobBytes: f.jobBytes, verifiedAssets: f.verifiedAssets, at: T2 });
    remoteSha = checkpoint(f.verifiedAssets.length * 2 + 1);
    ledger = state.recordThreadsCarouselContainer({ ledger: parent.ledger, permit: initial.permit,
      expectedRemoteStateSha: remoteSha, observedRemoteStateSha: remoteSha,
      containerId: "987654321", at: T3 });
    remoteSha = checkpoint(f.verifiedAssets.length * 2 + 2);
    const publishing = state.beginPublish({ ledger, permit: initial.permit,
      expectedRemoteStateSha: remoteSha, observedRemoteStateSha: remoteSha,
      jobBytes: f.jobBytes, verifiedAssets: f.verifiedAssets, at: T3 });
    return { ...initial, withContainer: ledger, parent, publishing, publishStateSha: checkpoint(f.verifiedAssets.length * 2 + 3) };
  }
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
      mediaType: f.channel === "instagram" ? "IMAGE" : "CAROUSEL_ALBUM",
      permalink: f.channel === "instagram" ? "https://www.instagram.com/p/verifiedOne/"
        : "https://www.threads.com/@mindulmin/post/verifiedOne",
      timestamp: T3,
      ...(f.channel === "threads" ? { childrenEvidenceSource: "official_threads_graph_api_parent_children",
        childrenComplete: true,
        children: f.job.content.images.map((image, index) => ({ id: String(8000 + index),
          mediaType: "IMAGE", mediaUrl: `https://scontent.example.test/transcoded-card-${index + 1}.jpg`,
          altText: image.altText, creationId: String(7000 + index) })) } : {}) }], ...overrides };
}
function complete(f, attemptedState, official = readback(f)) {
  return state.completeVerified({ ledger: attemptedState.publishing.ledger, permit: attemptedState.permit,
    expectedRemoteStateSha: attemptedState.publishStateSha || COMMIT.publish,
    observedRemoteStateSha: attemptedState.publishStateSha || COMMIT.publish,
    jobBytes: f.jobBytes, verifiedAssets: f.verifiedAssets, readback: official,
    expectedMediaId: "112233445566", at: T4 });
}

test("claim preserves all v2 fields and binds exact job bytes, assets, channel, account and remote origin", () => {
  const f = fixture(), original = baseLedger(), { ledger, claim: action } = claim(f, original);
  for (const [key, value] of Object.entries(original)) assert.deepEqual(ledger[key], value);
  assert.equal(action.jobSha256, hash(f.jobBytes));
  assert.equal(action.grantSha256, f.grantSha256);
  assert.equal(action.reviewer, f.reviewer);
  assert.equal(action.assets[0].sha256, hash(f.verifiedAssets[0].bytes));
  assert.equal(action.channel, "instagram");
  assert.equal(action.accountId, f.accountId);
  assert.equal(action.originStateSha, COMMIT.before);
  assert.equal(ledger.channelSplitV3.locks.threads, null);
  assert.equal(ledger.channelSplitV3.locks.instagram.stage, "claimed");
  assert.equal(state.checkedLedger(ledger).audit.length, 1);
});

test("the exact independent grant is bound to the remote claim, permit and final receipt", () => {
  const f = fixture();
  assert.throws(() => claim({ ...f, grantSha256: undefined }), /claim_identity_invalid/);
  assert.throws(() => claim({ ...f, reviewer: "job_author" }), /claim_identity_invalid/);
  const ready = confirmed(f);
  assert.equal(ready.permit.grantSha256, f.grantSha256);
  assert.equal(ready.permit.reviewer, f.reviewer);
  const changed = { ...ready.permit, grantSha256: "8".repeat(64) };
  assert.throws(() => state.beginCreate({ ledger: ready.ledger, permit: changed,
    expectedRemoteStateSha: COMMIT.claimed, observedRemoteStateSha: COMMIT.claimed,
    jobBytes: f.jobBytes, verifiedAssets: f.verifiedAssets, at: T1 }), /permit_or_claim_mismatch/);
  const done = complete(f, attempted(f));
  assert.equal(done.receipt.grantSha256, f.grantSha256);
  assert.equal(done.receipt.reviewer, f.reviewer);
  const tampered = structuredClone(done.ledger);
  tampered.channelSplitV3.receipts[0].grantSha256 = "8".repeat(64);
  assert.throws(() => state.checkedLedger(tampered), /receipt_invalid_or_duplicate/);
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
    runAttempt: 1, actionId: "action-001", accountId: f.accountId, issuedAt: T0, validUntil: EXPIRY,
    grantSha256: f.grantSha256, reviewer: f.reviewer };
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
    { ...good, media: [{ ...good.media[0], id: "not-a-media-id" }] },
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

test("a Threads carousel needs official ordered child identity and a Threads permalink, not identical CDN bytes", () => {
  const f = fixture("threads"), attempt = attempted(f);
  const good = readback(f);
  const receipt = complete(f, attempt, good).receipt;
  assert.equal(receipt.channel, "threads");
  assert.equal(receipt.mediaType, "CAROUSEL_ALBUM");
  const alternateOfficialEnum = { ...good, media: [{ ...good.media[0], mediaType: "CAROUSEL" }] };
  assert.equal(complete(f, attempt, alternateOfficialEnum).receipt.mediaType, "CAROUSEL");
  const unrelatedType = { ...good, media: [{ ...good.media[0], mediaType: "VIDEO" }] };
  assert.throws(() => complete(f, attempt, unrelatedType), /official_media_verification_failed/);
  assert.deepEqual(receipt.publishedChildMediaIds, ["8000", "8001"]);
  assert.deepEqual(receipt.sourceAssetSha256, f.verifiedAssets.map(asset => hash(asset.bytes)));
  assert.throws(() => complete(f, attempt, { ...good, media: [{ ...good.media[0],
    children: [...good.media[0].children].reverse() }] }), /official_media_verification_failed/);
  assert.throws(() => complete(f, attempt, { ...good, media: [{ ...good.media[0],
    permalink: "https://www.instagram.com/p/wrong/" }] }), /official_media_verification_failed/);
});

test("Threads child and parent each need their own durable one-attempt intent", () => {
  const f = fixture("threads"), ready = confirmed(f);
  assert.throws(() => state.beginCreate({ ledger: ready.ledger, permit: ready.permit,
    expectedRemoteStateSha: COMMIT.claimed, observedRemoteStateSha: COMMIT.claimed,
    jobBytes: f.jobBytes, verifiedAssets: f.verifiedAssets, at: T1 }), /create_attempt_not_available/);
  assert.throws(() => state.beginThreadsCarouselCreate({ ledger: ready.ledger, permit: ready.permit,
    expectedRemoteStateSha: COMMIT.claimed, observedRemoteStateSha: COMMIT.claimed,
    jobBytes: f.jobBytes, verifiedAssets: f.verifiedAssets, at: T1 }), /threads_carousel_attempt_not_available/);
  const child0 = state.beginThreadsChildCreate({ ledger: ready.ledger, permit: ready.permit,
    expectedRemoteStateSha: COMMIT.claimed, observedRemoteStateSha: COMMIT.claimed,
    jobBytes: f.jobBytes, verifiedAssets: f.verifiedAssets, childIndex: 0, at: T1 });
  assert.equal(child0.intent.mustCommitAndReadBackBeforeApi, true);
  assert.equal(child0.intent.imageSha256, hash(f.verifiedAssets[0].bytes));
  assert.throws(() => state.beginThreadsChildCreate({ ledger: child0.ledger, permit: ready.permit,
    expectedRemoteStateSha: COMMIT.create, observedRemoteStateSha: COMMIT.create,
    jobBytes: f.jobBytes, verifiedAssets: f.verifiedAssets, childIndex: 0, at: T2 }), /threads_child_attempt_not_available/);
  assert.throws(() => state.recordThreadsChildContainer({ ledger: child0.ledger, permit: ready.permit,
    expectedRemoteStateSha: COMMIT.claimed, observedRemoteStateSha: COMMIT.claimed,
    childIndex: 0, containerId: "7000", at: T2 }), /threads_child_receipt_invalid/);
  const after0 = state.recordThreadsChildContainer({ ledger: child0.ledger, permit: ready.permit,
    expectedRemoteStateSha: COMMIT.create, observedRemoteStateSha: COMMIT.create,
    childIndex: 0, containerId: "7000", at: T2 });
  assert.throws(() => state.beginThreadsCarouselCreate({ ledger: after0, permit: ready.permit,
    expectedRemoteStateSha: COMMIT.container, observedRemoteStateSha: COMMIT.container,
    jobBytes: f.jobBytes, verifiedAssets: f.verifiedAssets, at: T2 }), /threads_carousel_attempt_not_available/);
  const child1 = state.beginThreadsChildCreate({ ledger: after0, permit: ready.permit,
    expectedRemoteStateSha: COMMIT.container, observedRemoteStateSha: COMMIT.container,
    jobBytes: f.jobBytes, verifiedAssets: f.verifiedAssets, childIndex: 1, at: T2 });
  assert.throws(() => state.recordThreadsChildContainer({ ledger: child1.ledger, permit: ready.permit,
    expectedRemoteStateSha: COMMIT.publish, observedRemoteStateSha: COMMIT.publish,
    childIndex: 1, containerId: "7000", at: T2 }), /threads_child_receipt_invalid/);
  const after1 = state.recordThreadsChildContainer({ ledger: child1.ledger, permit: ready.permit,
    expectedRemoteStateSha: COMMIT.publish, observedRemoteStateSha: COMMIT.publish,
    childIndex: 1, containerId: "7001", at: T2 });
  const parent = state.beginThreadsCarouselCreate({ ledger: after1, permit: ready.permit,
    expectedRemoteStateSha: "f".repeat(40), observedRemoteStateSha: "f".repeat(40),
    jobBytes: f.jobBytes, verifiedAssets: f.verifiedAssets, at: T3 });
  assert.deepEqual(parent.intent.orderedChildContainerIds, ["7000", "7001"]);
  assert.equal(parent.intent.mustCommitAndReadBackBeforeApi, true);
  assert.throws(() => state.beginThreadsCarouselCreate({ ledger: parent.ledger, permit: ready.permit,
    expectedRemoteStateSha: COMMIT.create, observedRemoteStateSha: COMMIT.create,
    jobBytes: f.jobBytes, verifiedAssets: f.verifiedAssets, at: T3 }), /threads_carousel_attempt_not_available/);
  const withParent = state.recordThreadsCarouselContainer({ ledger: parent.ledger, permit: ready.permit,
    expectedRemoteStateSha: COMMIT.create, observedRemoteStateSha: COMMIT.create,
    containerId: "987654321", at: T3 });
  const publish = state.beginPublish({ ledger: withParent, permit: ready.permit,
    expectedRemoteStateSha: COMMIT.container, observedRemoteStateSha: COMMIT.container,
    jobBytes: f.jobBytes, verifiedAssets: f.verifiedAssets, at: T3 });
  assert.equal(publish.intent.containerId, "987654321");
  assert.deepEqual(publish.intent.orderedChildContainerIds, ["7000", "7001"]);
  assert.throws(() => state.beginPublish({ ledger: publish.ledger, permit: ready.permit,
    expectedRemoteStateSha: COMMIT.publish, observedRemoteStateSha: COMMIT.publish,
    jobBytes: f.jobBytes, verifiedAssets: f.verifiedAssets, at: T4 }), /publish_attempt_not_available/);
});

test("ambiguous Threads child or parent creation retains lock and forbids continuation", () => {
  const f = fixture("threads"), ready = confirmed(f);
  const child = state.beginThreadsChildCreate({ ledger: ready.ledger, permit: ready.permit,
    expectedRemoteStateSha: COMMIT.claimed, observedRemoteStateSha: COMMIT.claimed,
    jobBytes: f.jobBytes, verifiedAssets: f.verifiedAssets, childIndex: 0, at: T1 });
  const blockedChild = state.markAmbiguous({ ledger: child.ledger, permit: ready.permit,
    expectedRemoteStateSha: COMMIT.create, observedRemoteStateSha: COMMIT.create,
    stage: "child_create_attempted", at: T2 });
  assert.equal(blockedChild.channelSplitV3.locks.threads.stage, "ambiguous");
  assert.throws(() => state.recordThreadsChildContainer({ ledger: blockedChild, permit: ready.permit,
    expectedRemoteStateSha: COMMIT.container, observedRemoteStateSha: COMMIT.container,
    childIndex: 0, containerId: "7000", at: T2 }), /threads_child_receipt_invalid/);
  assert.throws(() => state.beginThreadsChildCreate({ ledger: blockedChild, permit: ready.permit,
    expectedRemoteStateSha: COMMIT.container, observedRemoteStateSha: COMMIT.container,
    jobBytes: f.jobBytes, verifiedAssets: f.verifiedAssets, childIndex: 0, at: T2 }), /threads_child_attempt_not_available/);
  const full = attempted(f);
  const parentAmbiguous = state.markAmbiguous({ ledger: full.parent.ledger, permit: full.permit,
    expectedRemoteStateSha: COMMIT.create, observedRemoteStateSha: COMMIT.create,
    stage: "parent_create_attempted", at: T3 });
  assert.equal(parentAmbiguous.channelSplitV3.locks.threads.ambiguousFrom, "parent_create_attempted");
  assert.throws(() => state.recordThreadsCarouselContainer({ ledger: parentAmbiguous, permit: full.permit,
    expectedRemoteStateSha: COMMIT.container, observedRemoteStateSha: COMMIT.container,
    containerId: "987654321", at: T3 }), /threads_carousel_receipt_invalid/);
});

test("official Threads child evidence must be complete, uniquely identified, typed, ordered, and bound", () => {
  const f = fixture("threads"), attempt = attempted(f), good = readback(f);
  const original = good.media[0], children = original.children;
  const bad = [
    { childrenComplete: false }, { childrenEvidenceSource: "local_guess" }, { children: children.slice(0, 1) },
    { children: [{ ...children[0], id: children[1].id }, children[1]] },
    { children: [{ ...children[0], mediaType: "VIDEO" }, children[1]] },
    { children: [{ ...children[0], mediaUrl: "http://cdn.example.test/card.jpg" }, children[1]] },
    { children: [{ ...children[0], altText: "wrong" }, children[1]] },
    { children: [{ ...children[0], creationId: "wrong" }, children[1]] }
  ];
  for (const change of bad) {
    assert.throws(() => complete(f, attempt, { ...good, media: [{ ...original, ...change }] }), /official_media_verification_failed/);
  }
});

test("Threads reviewed alt text and child checkpoints are tamper resistant", () => {
  const f = fixture("threads");
  for (const images of [
    f.job.content.images.map(({ altText, ...rest }) => rest),
    f.job.content.images.map(image => ({ ...image, altText: "same unreviewed text" }))
  ]) {
    const altered = { ...f.job, content: { ...f.job.content, images } };
    assert.throws(() => state.claimJob({ ledger: baseLedger(), expectedRemoteStateSha: COMMIT.before,
      observedRemoteStateSha: COMMIT.before, jobBytes: Buffer.from(JSON.stringify(altered)), jobPath: f.jobPath,
      verifiedAssets: f.verifiedAssets, selectedJobId: f.id, runId: "36129604025", runAttempt: 1,
      actionId: "action-threads-alt", accountId: f.accountId, issuedAt: T0, validUntil: EXPIRY }), /job_assets_invalid/);
  }
  const full = attempted(f);
  for (const edit of [
    lock => { lock.childContainerIds.reverse(); },
    lock => { lock.childContainerIds.push("7000"); },
    lock => { lock.createAttempts = 1; },
    lock => { lock.pendingChildIndex = 0; },
    lock => { lock.containerId = "7000"; }
  ]) {
    const tampered = structuredClone(full.publishing.ledger);
    edit(tampered.channelSplitV3.locks.threads);
    assert.throws(() => state.checkedLedger(tampered));
  }
});

test("Instagram official transcode no longer needs byte-equal CDN media", () => {
  const f = fixture(), attempt = attempted(f), good = readback(f);
  const transcoded = { ...good, media: [{ ...good.media[0], mediaUrl: "https://scontent.example.test/transcoded.jpg",
    verifiedImageSha256: ["f".repeat(64)] }] };
  assert.equal(complete(f, attempt, transcoded).receipt.mediaId, "112233445566");
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
