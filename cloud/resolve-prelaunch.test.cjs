const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveState } = require('./resolve-prelaunch.cjs');
function fixture() {
  const before = { version: 1, files: { 'jobs/old.json': 'b2xk' } };
  const seed = { id: '2026-09-11-expression-045-cloud', workflow: { status: 'draft', autoPublish: false }, instagram: { caption: '' } };
  const state = { version: 1, files: { ...before.files, 'jobs/2026-09-11-expression-045-cloud.json': Buffer.from(JSON.stringify(seed)).toString('base64'),
    'operations/cloud-controller/current.json': 'e30=', 'operations/cloud-controller/history.json': 'e30=', 'operations/cloud-controller/policy.json': 'e30=' } };
  const ledger = { lock: { runId: '34577557652', status: 'needs_official_readback', requestedPostId: seed.id }, actions: [{ runId: '34577557652' }], lastRun: { status: 'blocked_ambiguous_or_incomplete' } };
  const evidence = { failedRun: '34577557652', failedRunConclusion: 'failure', agentFailedBeforeSpawn: true, nativeSpawnVerified: true, instagramUnchanged: true, noNewThreads: true, noNewStories: true, failedLogSha256: 'a'.repeat(64), checkedAt: new Date().toISOString() };
  return { before, state, ledger, evidence };
}
test('explicit proven prelaunch resolution preserves all original state and archives the unstarted attempt', () => {
  const f = fixture(), r = resolveState(f.before, f.state, f.ledger, f.evidence);
  assert.equal(r.state.files['jobs/old.json'], f.before.files['jobs/old.json']);
  assert.equal(r.ledger.lock, null);
  assert.equal(r.ledger.abortedBeforeLaunch.length, 1);
  assert.ok(r.state.files['operations/cloud-controller/recovery/34577557652.json']);
  assert.equal(f.ledger.lock.runId, '34577557652');
});
test('any old file change, production artifact, missing official proof or different claim blocks resolution', () => {
  for (const mutate of [f => { f.state.files['jobs/old.json'] = 'changed'; }, f => { f.state.files['exports/new.jpg'] = 'new'; },
    f => { f.ledger.lock.runId = 'other'; }, f => { f.evidence.noNewThreads = false; }, f => { f.evidence.agentFailedBeforeSpawn = false; },
    f => { f.evidence.checkedAt = '2020-01-01'; }]) {
    const f = fixture(); mutate(f); assert.throws(() => resolveState(f.before, f.state, f.ledger, f.evidence), /evidence mismatch/);
  }
});
