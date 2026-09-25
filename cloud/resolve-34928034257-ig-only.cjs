#!/usr/bin/env node
'use strict';

// Operator investigation of one immutable v2 incident. This program has no
// state-save, social POST, unlock, or retry route. It only prints a dry-run
// assessment after fresh, complete official account-history GETs.
const fs = require('node:fs');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const { GitHubState } = require('./github-state.cjs');
const { decrypt } = require('./state.cjs');
const { digest } = require('./gates.cjs');
const { reconciliationControl } = require('./runner.cjs');
const { graph, recentMedia, session: instagramSession } = require('./official-read.cjs');

const INCIDENT = Object.freeze({
  stateHead: '4cddea6416476c9c3c152201df44f0509a15c356',
  encryptedSha256: '68973bc48dee57ec59d118e2f07e2018a75c177561f33dbef6c8473c3d3dd9cb',
  runId: '34928034257',
  runHead: '6446849b892a765332a2f6d176668e6812020b7f',
  actionId: 'cloud-2026-09-15-expression-059',
  jobId: '2026-09-15-expression-059-cloud',
  threadsJobId: '2026-09-15-expression-059-threads-instagram-lesson-recall-v2',
  controlSha256: 'aaf66f465b91cfd97d30be1f46abc6c5e3db3929e3324a1afcd6ff8ac74465d8',
  instagramAccountId: '17841476495914369',
  instagramUsername: 'mindulmin',
  instagramMediaId: '18121366456913510',
  instagramPermalink: 'https://www.instagram.com/p/DdS16OhHLMO/',
  threadsUserId: '26852882424410102',
  threadsUsername: 'mindulmin',
  threadsContainerId: '17902407981569815',
  testId: 'language-cafe-14d-2026-09-04'
});

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function fail(code) { throw new Error(`incident_34928034257_${code}`); }
function requireThat(condition, code) { if (!condition) fail(code); }
function readJson(state, name) {
  const encoded = state?.files?.[name];
  requireThat(typeof encoded === 'string', 'state_file_missing');
  try { return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')); }
  catch { return fail('state_file_invalid'); }
}
function freshComplete(history, accountId, username, now) {
  const checked = Date.parse(history?.checkedAt);
  const identityChecked = Date.parse(history?.identityCheckedAt);
  requireThat(history?.complete === true && history.accountId === accountId
    && history.username === username
    && Array.isArray(history.media) && Number.isFinite(checked)
    && Number.isFinite(identityChecked) && identityChecked <= checked
    && identityChecked <= now.getTime() && now.getTime() - identityChecked <= 5 * 60 * 1000
    && checked <= now.getTime() && now.getTime() - checked <= 5 * 60 * 1000,
  'official_history_incomplete_or_stale');
  const ids = history.media.map(item => item?.id);
  requireThat(ids.every(id => /^\d+$/.test(String(id || ''))) && new Set(ids).size === ids.length,
    'official_history_identity_invalid');
}
function sameBinding(binding, expected) {
  return binding?.actionId === expected.actionId
    && binding?.idempotencyKey === expected.actionId
    && binding?.controlSha256 === expected.controlSha256
    && binding?.requestedPostId === expected.jobId;
}

function buildDryRun({ remote, state, failedRun, instagramHistory, threadsHistory, now = new Date() }, expected = INCIDENT) {
  requireThat(remote?.sha === expected.stateHead && sha256(remote.encrypted) === expected.encryptedSha256,
    'state_head_or_encrypted_hash_changed');
  const ledger = remote.ledger, lock = ledger?.lock;
  requireThat(lock?.status === 'needs_official_readback' && lock.runId === expected.runId
    && lock.runAttempt === '1' && lock.actionId === expected.actionId
    && lock.idempotencyKey === expected.actionId && lock.controlSha256 === expected.controlSha256
    && lock.requestedPostId === expected.jobId && Number.isFinite(Date.parse(lock.claimedAt)),
  'original_lock_changed');
  requireThat(ledger?.lastRun?.runId === expected.runId
    && ledger.lastRun.status === 'blocked_ambiguous_or_incomplete'
    && ledger.lastRun.storyStatus === 'story_skipped_pair_not_verified'
    && Array.isArray(ledger.actions) && ledger.actions.length === 2
    && JSON.stringify(ledger.actions[1]) === JSON.stringify(Object.fromEntries(
      Object.entries(lock).filter(([key]) => key !== 'status'))),
  'ledger_incident_changed');
  requireThat(String(failedRun?.id) === expected.runId && failedRun.status === 'completed'
    && failedRun.conclusion === 'failure' && failedRun.head_sha === expected.runHead
    && Number(failedRun.run_attempt) === 1 && Number.isFinite(Date.parse(failedRun.updated_at)),
  'hosted_run_evidence_changed');

  // The original control bytes, handoff and claim are verified by the existing
  // reconciliation helper. Its normal full-pair reconciliation is NOT invoked.
  let control;
  try { control = reconciliationControl(state, lock).control; }
  catch { fail('original_control_binding_changed'); }
  requireThat(control.testId === expected.testId && control.handoff?.targetExpression === '행복해요'
    && control.handoff.consumerAction === 'publish_one_learning_pair', 'original_control_changed');
  const sourcePath = `jobs/${expected.jobId}.json`;
  const receiptPath = `operations/revenue-experiment/${expected.testId}/publisher-receipts/${expected.actionId}.json`;
  const threadsPath = `content-queue/threads/jobs/${expected.threadsJobId}.json`;
  const threadsLockPath = `content-queue/threads/.publish-locks/${expected.threadsJobId}.json`;
  const source = readJson(state, sourcePath), receipt = readJson(state, receiptPath);
  const threads = readJson(state, threadsPath), threadsLock = readJson(state, threadsLockPath);
  const igCheck = source.workflow?.postPublishVerification;
  requireThat(source.id === expected.jobId && source.workflow?.status === 'published'
    && source.source?.expression === '행복해요' && sameBinding(source.controlBinding, expected)
    && source.published?.mediaId === expected.instagramMediaId
    && source.published?.verification?.id === expected.instagramMediaId
    && source.published?.verification?.media_type === 'CAROUSEL_ALBUM'
    && source.published?.verification?.permalink === expected.instagramPermalink
    && igCheck?.status === 'passed' && igCheck.review === 'passed'
    && igCheck.source === 'official_instagram_graph_api_recent_media'
    && igCheck.mediaIdMatchCount === 1 && igCheck.normalizedFullCaptionMatchCount === 1
    && igCheck.sameHangulExpressionMatchCount === 1 && igCheck.exactOnePublishedJobConfirmed === true
    && igCheck.matchedMediaId === expected.instagramMediaId
    && igCheck.permalink === expected.instagramPermalink && igCheck.mediaType === 'CAROUSEL_ALBUM',
  'instagram_source_or_receipt_binding_changed');
  const intendedCaption = `${source.instagram?.caption}\n\n${source.instagram?.hashtags?.map(tag => `#${tag}`).join(' ')}`;
  requireThat(Array.isArray(source.instagram?.hashtags) && source.instagram.hashtags.length > 0
    && !intendedCaption.includes('undefined')
    && igCheck.officialMedia?.caption === intendedCaption,
  'instagram_caption_binding_changed');
  requireThat(receipt.finalStatus === 'instagram_published_threads_blocked'
    && receipt.actionId === expected.actionId && receipt.idempotencyKey === expected.actionId
    && receipt.controlSha256 === expected.controlSha256 && receipt.testId === expected.testId
    && receipt.sourcePostId === expected.jobId && receipt.instagramJobId === expected.jobId
    && receipt.targetExpression === '행복해요' && receipt.reelActionCount === 0
    && receipt.instagram?.status === 'published_exactly_once'
    && receipt.instagram.mediaId === expected.instagramMediaId
    && receipt.instagram.permalink === expected.instagramPermalink
    && receipt.instagram.mediaType === 'CAROUSEL_ALBUM'
    && receipt.instagram.publishCallCount === 1
    && receipt.instagram.officialReadback?.officialMedia?.caption === intendedCaption
    && receipt.threads?.status === 'blocked_publish_failed'
    && receipt.threads.jobId === expected.threadsJobId
    && receipt.threads.jobPath === threadsPath
    && receipt.threads.lockPath === threadsLockPath
    && receipt.threads.containerId === expected.threadsContainerId
    && receipt.threads.publishCallCount === 1 && receipt.threads.retryAttempted === false
    && receipt.threads.lockRetained === true && receipt.threads.mediaId === 'unavailable'
    && receipt.threads.publisherEvidence?.status === 'text_container_publish_failed'
    && /HTTP 400/.test(receipt.threads.publisherEvidence.error || '')
    && receipt.threads.officialReadback?.normalizedFullTextMatchCount === 0,
  'publisher_receipt_changed');
  requireThat(threads.id === expected.threadsJobId && threads.workflow?.status === 'blocked'
    && threads.workflow.postToThreadsCommandRun === true
    && threads.workflow.operationalRecoveryReviewRequired === true
    && sameBinding(threads.controlBinding, expected)
    && threads.controlBinding?.sourceLinkTarget === expected.instagramPermalink
    && !threads.published && typeof threads.copy?.primaryPost === 'string'
    && threads.copy.primaryPost.endsWith(expected.instagramPermalink)
    && threadsLock.jobId === expected.threadsJobId
    && threadsLock.stage === 'publishing_text_container'
    && threadsLock.containerId === expected.threadsContainerId
    && threadsLock.channel === 'threads' && !threadsLock.mediaId,
  'threads_attempt_or_lock_changed');

  requireThat(now instanceof Date && Number.isFinite(now.getTime()), 'clock_invalid');
  freshComplete(instagramHistory, expected.instagramAccountId, expected.instagramUsername, now);
  freshComplete(threadsHistory, expected.threadsUserId, expected.threadsUsername, now);
  const igMatches = instagramHistory.media.filter(item => item.id === expected.instagramMediaId);
  requireThat(igMatches.length === 1 && igMatches[0].caption === intendedCaption
    && igMatches[0].media_type === 'CAROUSEL_ALBUM'
    && igMatches[0].permalink === expected.instagramPermalink
    && Date.parse(igMatches[0].timestamp) >= Date.parse(lock.claimedAt)
    && Date.parse(igMatches[0].timestamp) <= Date.parse(failedRun.updated_at),
  'official_instagram_match_failed');
  const afterClaim = instagramHistory.media.filter(item => Date.parse(item.timestamp) >= Date.parse(lock.claimedAt));
  requireThat(instagramHistory.media.every(item => Number.isFinite(Date.parse(item.timestamp)))
    && afterClaim.length === 1 && afterClaim[0].id === expected.instagramMediaId,
  'official_instagram_history_changed');
  const normalize = value => String(value || '').normalize('NFC').replace(/\s+/gu, ' ').trim();
  requireThat(threadsHistory.media.every(item => (typeof item.text === 'string'
      || (item.text == null && item.media_type !== 'TEXT'))
    && Number.isFinite(Date.parse(item.timestamp))
    && Date.parse(item.timestamp) < Date.parse(lock.claimedAt))
    && threadsHistory.media.filter(item => normalize(item.text) === normalize(threads.copy.primaryPost)).length === 0,
  'official_threads_history_changed');

  return {
    status: 'dry_run_ig_only_incident_readback_passed',
    originalStateHead: remote.sha,
    originalEncryptedSha256: sha256(remote.encrypted),
    runId: expected.runId,
    actionId: expected.actionId,
    instagramMediaId: expected.instagramMediaId,
    threadsContainerId: expected.threadsContainerId,
    evidence: {
      instagram: { identityCheckedAt: instagramHistory.identityCheckedAt, checkedAt: instagramHistory.checkedAt,
        accountId: instagramHistory.accountId, username: instagramHistory.username,
        complete: true, totalMedia: instagramHistory.media.length,
        exactMediaMatches: igMatches.length, postsSinceClaim: afterClaim.length },
      threads: { identityCheckedAt: threadsHistory.identityCheckedAt, checkedAt: threadsHistory.checkedAt,
        accountId: threadsHistory.accountId, username: threadsHistory.username,
        complete: true, totalMedia: threadsHistory.media.length,
        currentExactTextMatches: 0, currentPostsSinceClaim: 0 }
    },
    originalArtifactSha256: Object.fromEntries([sourcePath, receiptPath, threadsPath, threadsLockPath]
      .map(name => [name, sha256(Buffer.from(state.files[name], 'base64'))])),
    socialWriteCalls: 0,
    cloudStateWriteCalls: 0,
    retryAuthorized: false,
    lockCleared: false,
    operatorNextStep: 'Review immutable evidence. A separate, explicitly authorized operator change would be required to archive this IG-only incident; never retry the original Threads attempt. Current history cannot prove a deleted historical post never existed.'
  };
}

async function readInstagramHistory(value, request = fetch, expected = INCIDENT) {
  const session = instagramSession(value);
  requireThat(session.accountId === expected.instagramAccountId, 'instagram_account_mismatch');
  // Match the credential to Meta's account object before accepting any media list.
  const identity = await graph(session, session.accountId, { fields: 'id,username' }, request);
  requireThat(identity?.id === expected.instagramAccountId
    && identity?.username === expected.instagramUsername, 'instagram_official_identity_mismatch');
  const identityCheckedAt = new Date().toISOString();
  const history = await recentMedia(session, request);
  return { ...history, accountId: identity.id, username: identity.username, identityCheckedAt };
}

async function readThreadsHistory(value, request = fetch, expected = INCIDENT) {
  const session = typeof value === 'string' ? JSON.parse(value) : value;
  if (!/^\d+$/.test(String(session?.userId || '')) || !session?.accessToken) fail('threads_session_unavailable');
  requireThat(String(session.userId) === expected.threadsUserId, 'threads_account_mismatch');
  const me = new URL('https://graph.threads.net/v1.0/me');
  me.searchParams.set('fields', 'id,username');
  me.searchParams.set('access_token', session.accessToken);
  let meResponse, identity;
  try {
    meResponse = await request(me, { method: 'GET', signal: AbortSignal.timeout(20000), redirect: 'error' });
    identity = await meResponse.json();
  } catch { fail('threads_official_identity_unavailable'); }
  if (!meResponse.ok || identity?.id !== expected.threadsUserId
    || identity?.username !== expected.threadsUsername) fail('threads_official_identity_mismatch');
  const identityCheckedAt = new Date().toISOString();
  const media = [];
  let after;
  for (let page = 0; page < 10; page++) {
    const url = new URL(`https://graph.threads.net/v1.0/${session.userId}/threads`);
    for (const [key, val] of Object.entries({ fields: 'id,text,permalink,timestamp,media_type', limit: '100',
      access_token: session.accessToken, ...(after ? { after } : {}) })) url.searchParams.set(key, val);
    let response, body;
    try {
      response = await request(url, { method: 'GET', signal: AbortSignal.timeout(20000), redirect: 'error' });
      body = await response.json();
    } catch { fail('threads_official_get_unavailable'); }
    if (!response.ok || !Array.isArray(body.data)) fail('threads_official_get_unavailable');
    media.push(...body.data);
    if (!body.paging?.next) return { accountId: identity.id, username: identity.username,
      identityCheckedAt, checkedAt: new Date().toISOString(), complete: true, media };
    const next = body.paging?.cursors?.after;
    if (!next || next === after) fail('threads_official_history_incomplete');
    after = next;
  }
  fail('threads_official_history_incomplete');
}

async function runDryRun() {
  const credential = cp.spawnSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8', timeout: 15000
  });
  const token = credential.stdout?.split(/\r?\n/).find(line => line.startsWith('password='))?.slice(9);
  if (credential.status !== 0 || !token) fail('github_read_credential_unavailable');
  const api = new GitHubState(token);
  const remote = await api.read();
  // This exact immutable head is required before loading any local social session.
  if (remote.sha !== INCIDENT.stateHead || sha256(remote.encrypted) !== INCIDENT.encryptedSha256) {
    fail('state_head_or_encrypted_hash_changed');
  }
  const key = fs.readFileSync('cloud/local/state.key', 'utf8').trim();
  const state = decrypt(remote.encrypted, key);
  const failedRun = await api.api(`actions/runs/${INCIDENT.runId}`);
  const instagram = instagramSession(fs.readFileSync('C:/Users/earth/.codex/instagram/session.json', 'utf8'));
  const threads = JSON.parse(fs.readFileSync('C:/Users/earth/.codex/threads/session.json', 'utf8'));
  const [igHistory, threadsHistory] = await Promise.all([
    readInstagramHistory(instagram),
    readThreadsHistory(threads)
  ]);
  return buildDryRun({ remote, state, failedRun, instagramHistory: igHistory, threadsHistory });
}

if (require.main === module) {
  if (process.argv.length > 2) {
    console.error('Read-only usage: node cloud/resolve-34928034257-ig-only.cjs (no --apply or other options)');
    process.exitCode = 1;
  } else {
    runDryRun().then(result => console.log(JSON.stringify(result, null, 2)))
      .catch(error => { console.error(/^incident_34928034257_/.test(error.message)
        ? error.message : 'incident_34928034257_readback_unavailable'); process.exitCode = 1; });
  }
}

module.exports = { INCIDENT, buildDryRun, readInstagramHistory, readThreadsHistory, runDryRun };
