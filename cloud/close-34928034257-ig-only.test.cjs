'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { digest } = require('./gates.cjs');
const { encrypt, decrypt } = require('./state.cjs');
const { INCIDENT } = require('./resolve-34928034257-ig-only.cjs');
const { AUDIT_PATH, parseArgs, planClosure, verifyAppliedReadback } = require('./close-34928034257-ig-only.cjs');

const KEY = '1'.repeat(64);
const NOW = new Date('2026-09-25T12:00:00.000Z');
const CAPTION = 'One original Korean lesson.';
const FULL_CAPTION = `${CAPTION}\n\n#LearnKorean`;
const THREADS_TEXT = `Recall this lesson.\n${INCIDENT.instagramPermalink}`;
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function fixture() {
  const control = { testId: INCIDENT.testId, handoff: { actionId: INCIDENT.actionId,
    idempotencyKey: INCIDENT.actionId, requestedPostId: INCIDENT.jobId,
    targetExpression: '행복해요', consumerAction: 'publish_one_learning_pair' } };
  const controlSha256 = digest(Buffer.from(JSON.stringify(control)));
  const binding = { actionId: INCIDENT.actionId, idempotencyKey: INCIDENT.actionId,
    controlSha256, requestedPostId: INCIDENT.jobId };
  const igCheck = { status: 'passed', review: 'passed', source: 'official_instagram_graph_api_recent_media',
    mediaIdMatchCount: 1, normalizedFullCaptionMatchCount: 1, sameHangulExpressionMatchCount: 1,
    exactOnePublishedJobConfirmed: true, matchedMediaId: INCIDENT.instagramMediaId,
    permalink: INCIDENT.instagramPermalink, mediaType: 'CAROUSEL_ALBUM',
    officialMedia: { caption: FULL_CAPTION } };
  const source = { id: INCIDENT.jobId, source: { expression: '행복해요' },
    instagram: { caption: CAPTION, hashtags: ['LearnKorean'] }, controlBinding: binding,
    workflow: { status: 'published', postPublishVerification: igCheck },
    published: { mediaId: INCIDENT.instagramMediaId, verification: { id: INCIDENT.instagramMediaId,
      media_type: 'CAROUSEL_ALBUM', permalink: INCIDENT.instagramPermalink } } };
  const sourcePath = `jobs/${INCIDENT.jobId}.json`;
  const receiptPath = `operations/revenue-experiment/${INCIDENT.testId}/publisher-receipts/${INCIDENT.actionId}.json`;
  const threadsPath = `content-queue/threads/jobs/${INCIDENT.threadsJobId}.json`;
  const threadsLockPath = `content-queue/threads/.publish-locks/${INCIDENT.threadsJobId}.json`;
  const receipt = { finalStatus: 'instagram_published_threads_blocked', actionId: INCIDENT.actionId,
    idempotencyKey: INCIDENT.actionId, controlSha256, testId: INCIDENT.testId,
    sourcePostId: INCIDENT.jobId, instagramJobId: INCIDENT.jobId, targetExpression: '행복해요',
    reelActionCount: 0, instagram: { status: 'published_exactly_once', mediaId: INCIDENT.instagramMediaId,
      permalink: INCIDENT.instagramPermalink, mediaType: 'CAROUSEL_ALBUM', publishCallCount: 1,
      officialReadback: { officialMedia: { caption: FULL_CAPTION } } },
    threads: { status: 'blocked_publish_failed', jobId: INCIDENT.threadsJobId,
      jobPath: threadsPath, lockPath: threadsLockPath,
      containerId: INCIDENT.threadsContainerId, publishCallCount: 1,
      retryAttempted: false, lockRetained: true, mediaId: 'unavailable',
      publisherEvidence: { status: 'text_container_publish_failed', error: 'not accepted (HTTP 400)' },
      officialReadback: { normalizedFullTextMatchCount: 0 } } };
  const threadsJob = { id: INCIDENT.threadsJobId, workflow: { status: 'blocked',
    postToThreadsCommandRun: true, operationalRecoveryReviewRequired: true },
    controlBinding: { ...binding, sourceLinkTarget: INCIDENT.instagramPermalink },
    copy: { primaryPost: THREADS_TEXT } };
  const threadsLock = { jobId: INCIDENT.threadsJobId, stage: 'publishing_text_container',
    containerId: INCIDENT.threadsContainerId, channel: 'threads' };
  const state = { version: 1, files: { 'operations/cloud-controller/current.json': encode(control),
    [sourcePath]: encode(source), [receiptPath]: encode(receipt),
    [threadsPath]: encode(threadsJob), [threadsLockPath]: encode(threadsLock) } };
  const encrypted = Buffer.from('pinned encrypted fixture');
  const expected = { ...INCIDENT, stateHead: 'f'.repeat(40),
    encryptedSha256: sha256(encrypted), controlSha256 };
  const claim = { runId: INCIDENT.runId, runAttempt: '1', actionId: INCIDENT.actionId,
    idempotencyKey: INCIDENT.actionId, controlSha256, requestedPostId: INCIDENT.jobId,
    claimedAt: '2026-09-15T04:14:50.100Z' };
  const ledger = { version: 1, lock: { ...claim, status: 'needs_official_readback' },
    actions: [{ runId: 'earlier-proven-action' }, claim],
    lastRun: { runId: INCIDENT.runId, status: 'blocked_ambiguous_or_incomplete',
      storyStatus: 'story_skipped_pair_not_verified' } };
  const remote = { sha: expected.stateHead, encrypted, ledger };
  const failedRun = { id: Number(INCIDENT.runId), status: 'completed', conclusion: 'failure',
    head_sha: INCIDENT.runHead, run_attempt: 1, updated_at: '2026-09-15T04:24:37Z' };
  const instagramHistory = { accountId: INCIDENT.instagramAccountId, username: INCIDENT.instagramUsername,
    identityCheckedAt: '2026-09-25T11:58:59.000Z', checkedAt: '2026-09-25T11:59:00.000Z',
    complete: true, media: [
      { id: INCIDENT.instagramMediaId, caption: FULL_CAPTION, media_type: 'CAROUSEL_ALBUM',
        permalink: INCIDENT.instagramPermalink, timestamp: '2026-09-15T04:22:55+0000' },
      { id: '100', caption: 'Old', media_type: 'IMAGE',
        permalink: 'https://www.instagram.com/p/old/', timestamp: '2026-09-11T04:00:00+0000' }
    ] };
  const threadsHistory = { accountId: INCIDENT.threadsUserId, username: INCIDENT.threadsUsername,
    identityCheckedAt: '2026-09-25T11:58:59.000Z', checkedAt: '2026-09-25T11:59:00.000Z',
    complete: true, media: [{ id: '200', text: 'An earlier lesson.', media_type: 'TEXT',
      timestamp: '2026-09-11T08:32:47+0000' }] };
  return { input: { remote, state, failedRun, instagramHistory, threadsHistory, now: NOW }, expected,
    paths: { sourcePath, receiptPath, threadsPath, threadsLockPath } };
}

test('one incident closure changes only the global lock and appends one immutable audit file', () => {
  const f = fixture();
  const original = structuredClone(f.input);
  const originalJson = JSON.stringify(f.input);
  const plan = planClosure(f.input, f.expected);
  assert.equal(plan.assessment.status, 'dry_run_ig_only_incident_readback_passed');
  assert.equal(plan.ledger.lock, null);
  assert.deepEqual(plan.ledger.actions, original.remote.ledger.actions);
  assert.deepEqual(plan.ledger.lastRun, original.remote.ledger.lastRun);
  assert.deepEqual(Object.keys(plan.state.files).sort(), [...Object.keys(original.state.files), AUDIT_PATH].sort());
  for (const [name, bytes] of Object.entries(original.state.files)) assert.equal(plan.state.files[name], bytes, name);
  assert.equal(JSON.stringify(f.input), originalJson);
  assert.equal(plan.audit.originalThreadsRetryAuthorized, false);
  assert.equal(plan.audit.socialApiWriteCalls, 0);
  assert.equal(plan.audit.originalArtifactSha256[f.paths.receiptPath],
    sha256(Buffer.from(f.input.state.files[f.paths.receiptPath], 'base64')));
  assert.ok(!JSON.stringify(plan.audit).includes('accessToken'));
});

test('independent decrypt/readback proves audit and original files, job, receipt and history stayed exact', () => {
  const f = fixture(), planned = planClosure(f.input, f.expected);
  const saved = { sha: 'a'.repeat(40) };
  const reread = { sha: saved.sha, ledger: structuredClone(planned.ledger),
    encrypted: encrypt(planned.state, KEY) };
  const commit = { sha: saved.sha, parents: [{ sha: f.input.remote.sha }] };
  const verified = verifyAppliedReadback({ originalRemote: f.input.remote, originalState: f.input.state,
    planned, saved, reread, commit, uploadedEncryptedSha256: sha256(reread.encrypted), key: KEY });
  assert.equal(verified.status, 'ig_only_incident_closed_verified');
  assert.equal(verified.globalV2LockCleared, true);
  assert.equal(verified.originalThreadsLockRetained, true);
  assert.equal(verified.socialApiWriteCalls, 0);
  assert.equal(decrypt(reread.encrypted, KEY).files[f.paths.threadsLockPath],
    f.input.state.files[f.paths.threadsLockPath]);
});

test('drift or weaker official history refuses to create a closure plan', () => {
  const changes = [
    f => { f.input.remote.sha = 'e'.repeat(40); },
    f => { f.input.remote.encrypted = Buffer.from('changed'); },
    f => { f.input.remote.ledger.lock.runId = 'different'; },
    f => { f.input.remote.ledger.actions.pop(); },
    f => { f.input.state.files[f.paths.sourcePath] = encode({ id: 'changed' }); },
    f => { f.input.state.files[f.paths.receiptPath] = encode({ finalStatus: 'changed' }); },
    f => { f.input.state.files[f.paths.threadsLockPath] = encode({ stage: 'published' }); },
    f => { f.input.instagramHistory.complete = false; },
    f => { f.input.instagramHistory.checkedAt = '2026-09-24T00:00:00Z'; },
    f => { f.input.threadsHistory.media.push({ id: '201', text: 'New post', media_type: 'TEXT',
      timestamp: '2026-09-15T04:20:00Z' }); },
    f => { f.input.state.files[AUDIT_PATH] = encode({ overwritten: true }); }
  ];
  for (const mutate of changes) {
    const f = fixture(); mutate(f);
    assert.throws(() => planClosure(f.input, f.expected), /incident_34928034257_/);
  }
});

test('CAS parent, ledger, audit, original bytes or ciphertext drift fails independent readback', () => {
  const changes = [
    value => { value.commit.parents[0].sha = 'b'.repeat(40); },
    value => { value.commit.sha = 'b'.repeat(40); },
    value => { value.reread.sha = 'b'.repeat(40); },
    value => { value.uploadedEncryptedSha256 = '0'.repeat(64); },
    value => { value.reread.ledger.actions = []; },
    value => { value.reread.ledger.lock = { status: 'unexpected' }; },
    value => { const state = decrypt(value.reread.encrypted, KEY);
      state.files[value.f.paths.receiptPath] = encode({ changed: true });
      value.reread.encrypted = encrypt(state, KEY); },
    value => { const state = decrypt(value.reread.encrypted, KEY);
      state.files[AUDIT_PATH] = encode({ changed: true });
      value.reread.encrypted = encrypt(state, KEY); },
    value => { value.reread.encrypted = Buffer.from('not encrypted state'); }
  ];
  for (const mutate of changes) {
    const f = fixture(), planned = planClosure(f.input, f.expected);
    const value = { f, planned, saved: { sha: 'a'.repeat(40) },
      reread: { sha: 'a'.repeat(40), ledger: structuredClone(planned.ledger),
        encrypted: encrypt(planned.state, KEY) },
      commit: { sha: 'a'.repeat(40), parents: [{ sha: f.input.remote.sha }] } };
    value.uploadedEncryptedSha256 = sha256(value.reread.encrypted);
    mutate(value);
    assert.throws(() => verifyAppliedReadback({ originalRemote: f.input.remote,
      originalState: f.input.state, planned, saved: value.saved,
      reread: value.reread, commit: value.commit,
      uploadedEncryptedSha256: value.uploadedEncryptedSha256, key: KEY }),
    /incident_34928034257_closure_/);
  }
});

test('CLI defaults to preview and accepts only an explicit apply switch', () => {
  assert.deepEqual(parseArgs([]), { apply: false });
  assert.deepEqual(parseArgs(['--apply']), { apply: true });
  for (const args of [['--publish'], ['--apply', '--force'], ['--yes'], ['--dry-run', '--apply']]) {
    assert.throws(() => parseArgs(args), /incident_34928034257_closure_usage_dry_run_or_apply_only/);
  }
});
