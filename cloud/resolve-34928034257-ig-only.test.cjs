'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const path = require('node:path');
const crypto = require('node:crypto');
const { digest } = require('./gates.cjs');
const { INCIDENT, buildDryRun, readInstagramHistory, readThreadsHistory } = require('./resolve-34928034257-ig-only.cjs');

const EXPECTED_AT = new Date('2026-09-25T12:00:00.000Z');
const caption = 'One original Korean lesson.';
const fullCaption = `${caption}\n\n#LearnKorean`;
const plannedText = `Recall this lesson.\n${INCIDENT.instagramPermalink}`;
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function encode(value) { return Buffer.from(JSON.stringify(value)).toString('base64'); }
function fixture() {
  const control = { testId: INCIDENT.testId, handoff: {
    actionId: INCIDENT.actionId, idempotencyKey: INCIDENT.actionId,
    requestedPostId: INCIDENT.jobId, targetExpression: '행복해요',
    consumerAction: 'publish_one_learning_pair'
  } };
  const controlSha256 = digest(Buffer.from(JSON.stringify(control)));
  const expected = { ...INCIDENT, stateHead: 'f'.repeat(40),
    encryptedSha256: sha256(Buffer.from('fixed encrypted fixture')), controlSha256 };
  const claim = {
    runId: INCIDENT.runId, runAttempt: '1', actionId: INCIDENT.actionId,
    idempotencyKey: INCIDENT.actionId, controlSha256, requestedPostId: INCIDENT.jobId,
    claimedAt: '2026-09-15T04:14:50.100Z'
  };
  const binding = { actionId: INCIDENT.actionId, idempotencyKey: INCIDENT.actionId,
    controlSha256, requestedPostId: INCIDENT.jobId };
  const igCheck = { status: 'passed', review: 'passed', source: 'official_instagram_graph_api_recent_media',
    mediaIdMatchCount: 1, normalizedFullCaptionMatchCount: 1, sameHangulExpressionMatchCount: 1,
    exactOnePublishedJobConfirmed: true, matchedMediaId: INCIDENT.instagramMediaId,
    permalink: INCIDENT.instagramPermalink, mediaType: 'CAROUSEL_ALBUM',
    officialMedia: { caption: fullCaption } };
  const source = { id: INCIDENT.jobId, source: { expression: '행복해요' },
    instagram: { caption, hashtags: ['LearnKorean'] }, controlBinding: binding,
    workflow: { status: 'published', postPublishVerification: igCheck },
    published: { mediaId: INCIDENT.instagramMediaId, verification: {
      id: INCIDENT.instagramMediaId, media_type: 'CAROUSEL_ALBUM', permalink: INCIDENT.instagramPermalink
    } } };
  const threadsJobId = INCIDENT.threadsJobId;
  const threadsPath = `content-queue/threads/jobs/${threadsJobId}.json`;
  const threadsLockPath = `content-queue/threads/.publish-locks/${threadsJobId}.json`;
  const receipt = {
    finalStatus: 'instagram_published_threads_blocked', actionId: INCIDENT.actionId,
    idempotencyKey: INCIDENT.actionId, controlSha256, testId: INCIDENT.testId,
    sourcePostId: INCIDENT.jobId, instagramJobId: INCIDENT.jobId, targetExpression: '행복해요',
    reelActionCount: 0, instagram: { status: 'published_exactly_once', mediaId: INCIDENT.instagramMediaId,
      permalink: INCIDENT.instagramPermalink, mediaType: 'CAROUSEL_ALBUM', publishCallCount: 1,
      officialReadback: { officialMedia: { caption: fullCaption } } },
    threads: { status: 'blocked_publish_failed', jobId: threadsJobId, jobPath: threadsPath,
      lockPath: threadsLockPath, containerId: INCIDENT.threadsContainerId, publishCallCount: 1,
      retryAttempted: false, lockRetained: true, mediaId: 'unavailable',
      publisherEvidence: { status: 'text_container_publish_failed', error: 'not accepted (HTTP 400)' },
      officialReadback: { normalizedFullTextMatchCount: 0 } }
  };
  const threads = { id: threadsJobId, workflow: { status: 'blocked', postToThreadsCommandRun: true,
    operationalRecoveryReviewRequired: true }, controlBinding: { ...binding, sourceLinkTarget: INCIDENT.instagramPermalink },
    copy: { primaryPost: plannedText } };
  const threadsLock = { jobId: threadsJobId, stage: 'publishing_text_container',
    containerId: INCIDENT.threadsContainerId, channel: 'threads' };
  const sourcePath = `jobs/${INCIDENT.jobId}.json`;
  const receiptPath = `operations/revenue-experiment/${INCIDENT.testId}/publisher-receipts/${INCIDENT.actionId}.json`;
  const state = { version: 1, files: {
    'operations/cloud-controller/current.json': encode(control),
    [sourcePath]: encode(source), [receiptPath]: encode(receipt),
    [threadsPath]: encode(threads), [threadsLockPath]: encode(threadsLock)
  } };
  const remote = { sha: expected.stateHead, encrypted: Buffer.from('fixed encrypted fixture'),
    ledger: { lock: { ...claim, status: 'needs_official_readback' },
      actions: [{ runId: 'earlier-proven-action' }, claim],
      lastRun: { runId: INCIDENT.runId, status: 'blocked_ambiguous_or_incomplete',
        storyStatus: 'story_skipped_pair_not_verified' } } };
  const failedRun = { id: Number(INCIDENT.runId), status: 'completed', conclusion: 'failure',
    head_sha: INCIDENT.runHead, run_attempt: 1, updated_at: '2026-09-15T04:24:37Z' };
  const instagramHistory = { accountId: INCIDENT.instagramAccountId, username: INCIDENT.instagramUsername,
    identityCheckedAt: '2026-09-25T11:58:59.000Z', checkedAt: '2026-09-25T11:59:00.000Z',
    complete: true, media: [
      { id: INCIDENT.instagramMediaId, caption: fullCaption, media_type: 'CAROUSEL_ALBUM',
        permalink: INCIDENT.instagramPermalink, timestamp: '2026-09-15T04:22:55+0000' },
      { id: '100', caption: 'Old', media_type: 'IMAGE', permalink: 'https://www.instagram.com/p/old/',
        timestamp: '2026-09-11T04:00:00+0000' }
    ] };
  const threadsHistory = { accountId: INCIDENT.threadsUserId, username: INCIDENT.threadsUsername,
    identityCheckedAt: '2026-09-25T11:58:59.000Z', checkedAt: '2026-09-25T11:59:00.000Z',
    complete: true, media: [
      { id: '200', text: 'An earlier lesson.', media_type: 'TEXT', timestamp: '2026-09-11T08:32:47+0000' },
      { id: '201', media_type: 'VIDEO', timestamp: '2026-07-13T03:53:50+0000' }
    ] };
  return { input: { remote, state, failedRun, instagramHistory, threadsHistory, now: EXPECTED_AT },
    expected, paths: { sourcePath, receiptPath, threadsPath, threadsLockPath } };
}

test('the exact IG-only incident produces a read-only assessment without altering the lock or files', () => {
  const f = fixture(), before = JSON.stringify(f.input.state);
  const result = buildDryRun(f.input, f.expected);
  assert.equal(result.status, 'dry_run_ig_only_incident_readback_passed');
  assert.equal(result.socialWriteCalls, 0);
  assert.equal(result.cloudStateWriteCalls, 0);
  assert.equal(result.lockCleared, false);
  assert.equal(result.retryAuthorized, false);
  assert.equal(result.evidence.instagram.exactMediaMatches, 1);
  assert.equal(result.evidence.threads.currentPostsSinceClaim, 0);
  assert.equal(JSON.stringify(f.input.state), before);
  assert.equal(f.input.remote.ledger.lock.status, 'needs_official_readback');
  assert.equal(Object.keys(result.originalArtifactSha256).length, 4);
});

test('changes to original immutable state, claim, control, receipt, job or retained lock fail closed', () => {
  const changes = [
    f => { f.input.remote.sha = 'e'.repeat(40); },
    f => { f.input.remote.encrypted = Buffer.from('changed'); },
    f => { f.input.remote.ledger.lock.status = 'cleared'; },
    f => { f.input.remote.ledger.actions[1].requestedPostId = 'different'; },
    f => { f.input.failedRun.conclusion = 'success'; },
    f => { f.input.state.files['operations/cloud-controller/current.json'] = encode({ handoff: {} }); },
    f => { const p = f.paths.sourcePath; const j = JSON.parse(Buffer.from(f.input.state.files[p], 'base64')); j.published.mediaId = 'other'; f.input.state.files[p] = encode(j); },
    f => { const p = f.paths.receiptPath; const r = JSON.parse(Buffer.from(f.input.state.files[p], 'base64')); r.threads.publishCallCount = 2; f.input.state.files[p] = encode(r); },
    f => { const p = f.paths.threadsPath; const j = JSON.parse(Buffer.from(f.input.state.files[p], 'base64')); j.published = { mediaId: 'new' }; f.input.state.files[p] = encode(j); },
    f => { const p = f.paths.threadsLockPath; const lock = JSON.parse(Buffer.from(f.input.state.files[p], 'base64')); lock.stage = 'published'; f.input.state.files[p] = encode(lock); }
  ];
  for (const change of changes) {
    const f = fixture(); change(f);
    assert.throws(() => buildDryRun(f.input, f.expected), /incident_34928034257_/);
  }
});

test('stale, partial, wrong-account, duplicate or newer official history fails closed', () => {
  const changes = [
    f => { f.input.instagramHistory.complete = false; },
    f => { f.input.instagramHistory.checkedAt = '2026-09-24T00:00:00Z'; },
    f => { f.input.instagramHistory.accountId = 'wrong'; },
    f => { f.input.instagramHistory.username = 'other'; },
    f => { f.input.instagramHistory.identityCheckedAt = '2026-09-24T00:00:00Z'; },
    f => { f.input.instagramHistory.media[0].caption = 'changed'; },
    f => { f.input.instagramHistory.media.push({ ...f.input.instagramHistory.media[0] }); },
    f => { f.input.threadsHistory.complete = false; },
    f => { f.input.threadsHistory.media.push({ id: '202', text: plannedText,
      media_type: 'TEXT', timestamp: '2026-09-11T00:00:00Z' }); },
    f => { f.input.threadsHistory.media.push({ id: '202', text: 'New unrelated post',
      media_type: 'TEXT', timestamp: '2026-09-15T04:20:00Z' }); },
    f => { f.input.threadsHistory.accountId = 'wrong'; }
    , f => { f.input.threadsHistory.username = 'other'; }
    , f => { f.input.threadsHistory.identityCheckedAt = '2026-09-24T00:00:00Z'; }
  ];
  for (const change of changes) {
    const f = fixture(); change(f);
    assert.throws(() => buildDryRun(f.input, f.expected), /incident_34928034257_/);
  }
});

test('Threads official read paginates with GET only and rejects incomplete pages', async () => {
  const calls = [];
  const request = async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) return { ok: true, json: async () => ({ id: INCIDENT.threadsUserId, username: INCIDENT.threadsUsername }) };
    const first = calls.length === 2;
    return { ok: true, json: async () => ({ data: [{ id: first ? '1' : '2', text: 'prior',
      timestamp: '2026-09-11T00:00:00Z' }], paging: first ? { next: 'redacted', cursors: { after: 'page-2' } } : {} }) };
  };
  const history = await readThreadsHistory({ userId: INCIDENT.threadsUserId, accessToken: 'test-secret' }, request);
  assert.equal(history.complete, true);
  assert.equal(history.media.length, 2);
  assert.equal(calls.length, 3);
  assert.ok(calls.every(call => call.options.method === 'GET'));
  assert.match(calls[0].url.pathname, /\/me$/);
  assert.equal(calls[2].url.searchParams.get('after'), 'page-2');
  assert.ok(!JSON.stringify(history).includes('test-secret'));
  await assert.rejects(readThreadsHistory({ userId: INCIDENT.threadsUserId, accessToken: 'test-secret' },
    async url => ({ ok: true, json: async () => url.pathname.endsWith('/me')
      ? { id: INCIDENT.threadsUserId, username: INCIDENT.threadsUsername }
      : { data: [], paging: { next: 'redacted' } } })),
  /incident_34928034257_threads_official_history_incomplete/);
  let historyCalled = false;
  await assert.rejects(readThreadsHistory({ userId: INCIDENT.threadsUserId, accessToken: 'test-secret' },
    async url => {
      if (!url.pathname.endsWith('/me')) historyCalled = true;
      return { ok: true, json: async () => ({ id: INCIDENT.threadsUserId, username: 'other' }) };
    }), /incident_34928034257_threads_official_identity_mismatch/);
  assert.equal(historyCalled, false);
});

test('Instagram official account identity is checked before media history', async () => {
  const calls = [];
  const session = { accountId: INCIDENT.instagramAccountId, accessToken: 'test-secret', graphVersion: 'v23.0' };
  const request = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => url.pathname.endsWith('/media')
      ? { data: [{ id: INCIDENT.instagramMediaId, caption: fullCaption,
        media_type: 'CAROUSEL_ALBUM', permalink: INCIDENT.instagramPermalink,
        timestamp: '2026-09-15T04:22:55+0000' }] }
      : { id: INCIDENT.instagramAccountId, username: INCIDENT.instagramUsername } };
  };
  const history = await readInstagramHistory(session, request);
  assert.equal(history.complete, true);
  assert.equal(history.accountId, INCIDENT.instagramAccountId);
  assert.equal(history.username, INCIDENT.instagramUsername);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.options.method === undefined || call.options.method === 'GET'));
  assert.ok(calls[1].url.pathname.endsWith('/media'));
  assert.ok(!JSON.stringify(history).includes('test-secret'));
  let mediaCalled = false;
  await assert.rejects(readInstagramHistory(session, async url => {
    if (url.pathname.endsWith('/media')) mediaCalled = true;
    return { ok: true, json: async () => ({ id: INCIDENT.instagramAccountId, username: 'other' }) };
  }), /incident_34928034257_instagram_official_identity_mismatch/);
  assert.equal(mediaCalled, false);
});

test('the command line has no --apply path', () => {
  const script = path.join(__dirname, 'resolve-34928034257-ig-only.cjs');
  const attempt = cp.spawnSync(process.execPath, [script, '--apply'], { encoding: 'utf8' });
  assert.equal(attempt.status, 1);
  assert.match(attempt.stderr, /Read-only usage/);
  assert.equal(attempt.stdout, '');
});
