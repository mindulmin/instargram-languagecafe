#!/usr/bin/env node
'use strict';

// One incident, one state-head, one operator-only closure. This never calls a
// social write endpoint and never retries the retained Threads container.
const fs = require('node:fs');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { GitHubState } = require('./github-state.cjs');
const { decrypt, encrypt, safePath } = require('./state.cjs');
const { INCIDENT, buildDryRun, readInstagramHistory, readThreadsHistory } = require('./resolve-34928034257-ig-only.cjs');

const AUDIT_PATH = `operations/cloud-controller/reconciliation/${INCIDENT.runId}-ig-only-closure.json`;
function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function fail(code) { throw Error(`incident_34928034257_closure_${code}`); }
function requireThat(condition, code) { if (!condition) fail(code); }
function sameHead(remote, expected = INCIDENT) {
  requireThat(remote?.sha === expected.stateHead && Buffer.isBuffer(remote?.encrypted)
    && sha256(remote.encrypted) === expected.encryptedSha256, 'original_state_drift');
}
function unchangedOriginalFiles(original, next) {
  const beforeNames = Object.keys(original.files).sort();
  const afterNames = Object.keys(next.files).filter(name => name !== AUDIT_PATH).sort();
  requireThat(isDeepStrictEqual(afterNames, beforeNames)
    && beforeNames.every(name => next.files[name] === original.files[name]), 'original_file_changed');
}

function planClosure({ remote, state, failedRun, instagramHistory, threadsHistory, now = new Date() }, expected = INCIDENT) {
  const assessment = buildDryRun({ remote, state, failedRun, instagramHistory, threadsHistory, now }, expected);
  requireThat(state?.version === 1 && state.files && typeof state.files === 'object'
    && safePath(AUDIT_PATH) && !Object.hasOwn(state.files, AUDIT_PATH), 'audit_path_not_available');
  const audit = {
    schemaVersion: 1,
    kind: 'v2_ig_only_incident_closure',
    incidentRunId: expected.runId,
    resolution: 'instagram_published_exactly_once_threads_publish_failed_no_post_in_current_official_history',
    resolvedAt: now.toISOString(),
    originalStateHead: remote.sha,
    originalEncryptedSha256: sha256(remote.encrypted),
    originalLock: structuredClone(remote.ledger.lock),
    originalLastRun: structuredClone(remote.ledger.lastRun),
    originalActionHistorySha256: sha256(Buffer.from(JSON.stringify(remote.ledger.actions))),
    originalArtifactSha256: assessment.originalArtifactSha256,
    hostedFailedRun: { id: expected.runId, headSha: failedRun.head_sha,
      conclusion: failedRun.conclusion, updatedAt: failedRun.updated_at },
    officialReadback: {
      instagram: { ...assessment.evidence.instagram,
        mediaHistorySha256: sha256(Buffer.from(JSON.stringify(instagramHistory.media))) },
      threads: { ...assessment.evidence.threads,
        mediaHistorySha256: sha256(Buffer.from(JSON.stringify(threadsHistory.media))) }
    },
    ledgerChange: { field: 'lock', fromStatus: 'needs_official_readback', to: null },
    originalThreadsJobAndLockRetained: true,
    originalPublisherReceiptRetained: true,
    originalActionHistoryRetained: true,
    originalLastRunRetained: true,
    socialApiWriteCalls: 0,
    originalThreadsRetryAuthorized: false,
    caveat: 'Current complete official history cannot prove that a deleted historical Threads post never existed.'
  };
  const auditBytes = Buffer.from(`${JSON.stringify(audit, null, 2)}\n`, 'utf8');
  const nextState = { ...state, files: { ...state.files, [AUDIT_PATH]: auditBytes.toString('base64') } };
  const nextLedger = { ...remote.ledger, lock: null };
  unchangedOriginalFiles(state, nextState);
  requireThat(isDeepStrictEqual(nextLedger, { ...remote.ledger, lock: null })
    && isDeepStrictEqual(nextLedger.actions, remote.ledger.actions)
    && isDeepStrictEqual(nextLedger.lastRun, remote.ledger.lastRun), 'ledger_change_not_narrow');
  return { assessment, audit, auditBytes, state: nextState, ledger: nextLedger };
}

function verifyAppliedReadback({ originalRemote, originalState, planned, saved, reread,
  commit, uploadedEncryptedSha256, key }) {
  requireThat(typeof saved?.sha === 'string' && saved.sha !== originalRemote.sha
    && reread?.sha === saved.sha && Buffer.isBuffer(reread.encrypted)
    && sha256(reread.encrypted) === uploadedEncryptedSha256
    && commit?.sha === saved.sha
    && Array.isArray(commit?.parents) && commit.parents.length === 1
    && commit.parents[0]?.sha === originalRemote.sha, 'cas_commit_readback_mismatch');
  requireThat(isDeepStrictEqual(reread.ledger, planned.ledger)
    && reread.ledger.lock === null
    && isDeepStrictEqual(reread.ledger.actions, originalRemote.ledger.actions)
    && isDeepStrictEqual(reread.ledger.lastRun, originalRemote.ledger.lastRun), 'ledger_readback_mismatch');
  let decrypted;
  try { decrypted = decrypt(reread.encrypted, key); }
  catch { fail('independent_decrypt_failed'); }
  unchangedOriginalFiles(originalState, decrypted);
  const expectedNames = [...Object.keys(originalState.files), AUDIT_PATH].sort();
  requireThat(isDeepStrictEqual(Object.keys(decrypted.files).sort(), expectedNames)
    && decrypted.files[AUDIT_PATH] === planned.auditBytes.toString('base64')
    && isDeepStrictEqual(decrypted, planned.state), 'audit_readback_mismatch');
  return { status: 'ig_only_incident_closed_verified', originalStateHead: originalRemote.sha,
    newStateHead: reread.sha, auditPath: AUDIT_PATH, auditSha256: sha256(planned.auditBytes),
    originalFileCount: Object.keys(originalState.files).length,
    preservedOriginalFiles: true, originalActionHistoryRetained: true,
    originalThreadsLockRetained: true, globalV2LockCleared: true,
    socialApiWriteCalls: 0, originalThreadsRetryAuthorized: false };
}

async function executeClosure({ apply = false, api, readKey, readInstagramCredential,
  readThreadsCredential, readInstagram = readInstagramHistory,
  readThreads = readThreadsHistory, clock = () => new Date(), expected = INCIDENT } = {}) {
  requireThat(typeof api?.read === 'function' && typeof api?.api === 'function'
    && typeof readKey === 'function' && typeof readInstagramCredential === 'function'
    && typeof readThreadsCredential === 'function', 'dependencies_invalid');
  const originalRemote = await api.read();
  // Abort before loading any private local credential if the pinned checkpoint moved.
  sameHead(originalRemote, expected);
  const key = await readKey();
  let originalState;
  try { originalState = decrypt(originalRemote.encrypted, key); }
  catch { fail('original_decrypt_failed'); }
  const failedRun = await api.api(`actions/runs/${expected.runId}`);
  const instagramCredential = await readInstagramCredential();
  const threadsCredential = await readThreadsCredential();
  const getPlan = async () => {
    const [instagramHistory, threadsHistory] = await Promise.all([
      readInstagram(instagramCredential), readThreads(threadsCredential)
    ]);
    return planClosure({ remote: originalRemote, state: originalState, failedRun,
      instagramHistory, threadsHistory, now: clock() }, expected);
  };
  let planned = await getPlan();
  if (!apply) return { ...planned.assessment, status: 'closure_preview_passed_no_write',
    proposedAuditPath: AUDIT_PATH, proposedAuditSha256: sha256(planned.auditBytes),
    wouldClearOnlyGlobalV2Lock: true, cloudStateWriteCalls: 0, lockCleared: false };

  // Recheck both official complete histories immediately before the one CAS.
  planned = await getPlan();
  const beforeSave = await api.read();
  sameHead(beforeSave, expected);
  requireThat(isDeepStrictEqual(beforeSave.ledger, originalRemote.ledger), 'ledger_drift_before_cas');
  const encrypted = encrypt(planned.state, key);
  const saved = await api.save(beforeSave, planned.ledger, encrypted);
  // GitHubState.save checks the ref, but its return value is not a readback.
  const reread = await api.read();
  const commit = await api.api(`git/commits/${saved.sha}`);
  return verifyAppliedReadback({ originalRemote, originalState, planned, saved, reread,
    commit, uploadedEncryptedSha256: sha256(encrypted), key });
}

function parseArgs(argv) {
  if (argv.length === 0) return { apply: false };
  if (argv.length === 1 && argv[0] === '--apply') return { apply: true };
  fail('usage_dry_run_or_apply_only');
}
function gitToken() {
  const credential = cp.spawnSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8', timeout: 15000
  });
  const token = credential.stdout?.split(/\r?\n/).find(line => line.startsWith('password='))?.slice(9);
  requireThat(credential.status === 0 && Boolean(token), 'github_credential_unavailable');
  return token;
}
async function runCli(argv = process.argv.slice(2)) {
  const { apply } = parseArgs(argv);
  const api = new GitHubState(gitToken());
  return executeClosure({ apply, api,
    readKey: () => fs.readFileSync('cloud/local/state.key', 'utf8').trim(),
    readInstagramCredential: () => fs.readFileSync('C:/Users/earth/.codex/instagram/session.json', 'utf8'),
    readThreadsCredential: () => fs.readFileSync('C:/Users/earth/.codex/threads/session.json', 'utf8') });
}
if (require.main === module) {
  runCli().then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => { console.error(/^incident_34928034257_/.test(error.message)
      ? error.message : 'incident_34928034257_closure_unavailable'); process.exitCode = 1; });
}
module.exports = { AUDIT_PATH, parseArgs, planClosure, runCli, verifyAppliedReadback };
