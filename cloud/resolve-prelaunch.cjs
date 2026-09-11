// Explicit operator-only resolution. Never called by the scheduled workflow.
const fs = require('node:fs');
const cp = require('node:child_process');
const { GitHubState } = require('./github-state.cjs');
const { decrypt, encrypt } = require('./state.cjs');
const { digest } = require('./gates.cjs');
const { recentMedia, graph, session } = require('./official-read.cjs');
const FAILED_RUN = '34577557652';
const EXPECTED_STATE = 'a42b2a89531909e6c7093de19d3b05ca35492c20';
const BASELINE = 'e20f89c267f8ac595bb99c259b4c1a83217254ec';
const SEED = 'jobs/2026-09-11-expression-045-cloud.json';
const INCIDENTS = [
  { FAILED_RUN, EXPECTED_STATE, BASELINE, jobId: 103193387008, head: '9c04bb0', kind: 'spawn_enoent' },
  { FAILED_RUN: '34578531585', EXPECTED_STATE: '60a2c809002c9190fc84f23146319418bb96a7f9',
    BASELINE: '7c735d2214ff150ffba77991ba1329505d649ae4', jobId: 103196489194, head: 'c5a33c3', kind: 'duplicate_cli_argument' }
];
function resolveState(before, current, ledger, evidence, incident = INCIDENTS[0]) {
  const { FAILED_RUN, EXPECTED_STATE, BASELINE } = incident;
  const fail = () => { throw Error('Prelaunch resolution evidence mismatch; state remains locked'); };
  if (ledger.lock?.runId !== FAILED_RUN || ledger.lock.status !== 'needs_official_readback'
    || ledger.actions?.length !== 1 || ledger.actions[0].runId !== FAILED_RUN
    || ledger.lastRun?.status !== 'blocked_ambiguous_or_incomplete') fail();
  const preparation = ['operations/cloud-controller/current.json', 'operations/cloud-controller/history.json', 'operations/cloud-controller/policy.json'];
  const expected = [SEED, ...preparation.filter(p => !(p in before.files))].sort();
  const added = Object.keys(current.files).filter(p => !(p in before.files)).sort();
  if (JSON.stringify(added) !== JSON.stringify(expected)
    || Object.keys(before.files).some(p => !preparation.includes(p) && current.files[p] !== before.files[p])) fail();
  const seed = JSON.parse(Buffer.from(current.files[SEED], 'base64'));
  if (seed.id !== ledger.lock.requestedPostId || seed.workflow?.status !== 'draft'
    || seed.workflow.autoPublish !== false || seed.instagram?.caption !== '' || seed.published) fail();
  if (evidence.failedRun !== FAILED_RUN || evidence.failedRunConclusion !== 'failure'
    || evidence.agentFailedBeforeSpawn !== true || evidence.nativeSpawnVerified !== true
    || evidence.instagramUnchanged !== true || evidence.noNewThreads !== true || evidence.noNewStories !== true
    || !/^[a-f0-9]{64}$/.test(evidence.failedLogSha256 || '')
    || !Number.isFinite(Date.parse(evidence.checkedAt)) || Date.now() - Date.parse(evidence.checkedAt) > 300000) fail();
  const audit = { ...evidence, originalLock: ledger.lock, originalLastRun: ledger.lastRun, archivedUnstartedSeed: seed,
    baselineCommit: BASELINE, failedCheckpoint: EXPECTED_STATE, resolution: 'confirmed_no_agent_process_no_social_writes' };
  const files = { ...current.files };
  // Preserve the unstarted seed inside the audit, rather than treating it as a real production attempt.
  delete files[SEED];
  files[`operations/cloud-controller/recovery/${FAILED_RUN}.json`] = Buffer.from(JSON.stringify(audit, null, 2) + '\n').toString('base64');
  return { state: { ...current, files }, ledger: { ...ledger, lock: null, actions: [],
    abortedBeforeLaunch: [...(ledger.abortedBeforeLaunch || []), { ...ledger.actions[0], ...audit }],
    lastRun: { ...ledger.lastRun, resolution: audit.resolution, resolvedAt: evidence.checkedAt } } };
}
async function main() {
  const previewId = process.argv[2], apply = process.argv[3] === '--apply';
  if (!/^\d+$/.test(previewId || '')) throw Error('A completed native-runtime preview run ID is required');
  const credential = cp.spawnSync('git', ['credential', 'fill'], { input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8', timeout: 15000 });
  const token = credential.stdout.split(/\r?\n/).find(s => s.startsWith('password='))?.slice(9);
  const api = new GitHubState(token), current = await api.read();
  const incident = INCIDENTS.find(i => i.EXPECTED_STATE === current.sha);
  if (!incident) throw Error('State head changed; fresh operator investigation required');
  const { FAILED_RUN, EXPECTED_STATE, BASELINE } = incident;
  const key = fs.readFileSync('cloud/local/state.key', 'utf8').trim();
  const commit = await api.api('git/commits/' + BASELINE), tree = await api.api('git/trees/' + commit.tree.sha);
  const blob = await api.api('git/blobs/' + tree.tree.find(e => e.path === 'publisher-state.enc').sha);
  const before = decrypt(Buffer.from(blob.content, 'base64'), key), state = decrypt(current.encrypted, key);
  const failed = await api.api('actions/runs/' + FAILED_RUN), preview = await api.api('actions/runs/' + previewId);
  const failedJobs = await api.api(`actions/runs/${FAILED_RUN}/jobs`), previewJobs = await api.api(`actions/runs/${previewId}/jobs`);
  const job = failedJobs.jobs.find(j => j.id === incident.jobId);
  const native = previewJobs.jobs[0]?.steps.find(s => s.name === 'Verify native Codex executable before claiming any publication');
  if (failed.status !== 'completed' || preview.status !== 'completed' || preview.conclusion !== 'success' || native?.conclusion !== 'success'
    || failed.head_sha.slice(0, 7) !== incident.head || !job?.steps.some(s => s.name === 'Produce and publish one authorized learning pair' && s.conclusion === 'failure')) throw Error('Hosted run evidence not verified');
  const lr = await fetch(`https://api.github.com/repos/mindulmin/instargram-languagecafe/actions/jobs/${job.id}/logs`, {
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(20000) });
  if (!lr.ok) throw Error('Failed run log unavailable');
  const log = await lr.text();
  const plainLog = log.replace(/\u001b\[[0-9;]*m/g, '');
  const s = session(fs.readFileSync('C:/Users/earth/.codex/instagram/session.json', 'utf8'));
  const fresh = await recentMedia(s), old = JSON.parse(Buffer.from(state.files['operations/cloud-controller/history.json'], 'base64'));
  const stable = m => [m.id, m.caption, m.media_type, m.permalink, m.timestamp];
  const mediaEqual = a => JSON.stringify(a.map(stable).sort((x,y) => String(x[0]).localeCompare(String(y[0]))));
  const stories = await graph(s, `${s.accountId}/stories`, { fields: 'id,timestamp', limit: 100 });
  const ts = JSON.parse(fs.readFileSync('C:/Users/earth/.codex/threads/session.json'));
  const tid = ts.userId || ts.user_id || ts.threadsUserId, tt = ts.accessToken || ts.access_token || ts.threadsAccessToken;
  if (!/^\d+$/.test(tid || '') || !tt) throw Error('Threads read credentials unavailable');
  const threads = []; let after;
  for (let i = 0; i < 10; i++) {
    const u = new URL(`https://graph.threads.net/v1.0/${tid}/threads`);
    for (const [k,v] of Object.entries({ fields: 'id,timestamp', limit: '100', access_token: tt, ...(after ? { after } : {}) })) u.searchParams.set(k,v);
    const r = await fetch(u, { signal: AbortSignal.timeout(20000), redirect: 'error' }), j = await r.json();
    if (!r.ok || !Array.isArray(j.data)) throw Error('Threads official readback unavailable');
    threads.push(...j.data);
    if (!j.paging?.next) break;
    if (i === 9 || !j.paging?.cursors?.after || after === j.paging.cursors.after) throw Error('Threads readback incomplete');
    after = j.paging.cursors.after;
  }
  const older = m => Number.isFinite(Date.parse(m.timestamp)) && Date.parse(m.timestamp) < Date.parse(current.ledger.lock.claimedAt);
  const evidence = { failedRun: FAILED_RUN, failedRunConclusion: failed.conclusion, checkedAt: new Date().toISOString(), nativePreviewRun: previewId,
    nativeSpawnVerified: true, failedLogSha256: digest(log), failureKind: incident.kind,
    agentFailedBeforeSpawn: incident.kind === 'spawn_enoent'
      ? /Error: spawn codex ENOENT/.test(plainLog) && /syscall: 'spawn codex'/.test(plainLog)
      : /error: the argument '--skip-git-repo-check' cannot be used multiple times/.test(plainLog) && /Error: codex exited with code 2/.test(plainLog),
    instagramUnchanged: fresh.complete && mediaEqual(fresh.media) === mediaEqual(old.media),
    noNewThreads: threads.every(older), noNewStories: Array.isArray(stories.data) && !stories.paging?.next && stories.data.every(older) };
  console.log(JSON.stringify({ verificationOnly: true, evidence }));
  const resolved = resolveState(before, state, current.ledger, evidence, incident);
  if (apply) await api.save(current, resolved.ledger, encrypt(resolved.state, key));
  console.log(JSON.stringify({ status: apply ? 'resolved_before_agent_launch_with_audit' : 'resolution_preview_passed_no_write', evidence, preservedOriginalFiles: Object.keys(before.files).length }));
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { resolveState, INCIDENTS };
