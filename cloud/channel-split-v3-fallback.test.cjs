'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { decideLocalFallback } = require('./channel-split-v3-fallback.cjs');

const base = { now: '2026-09-25T02:00:00Z', scheduledAt: '2026-09-25T00:00:00Z',
  cloudRuns: [], remoteReachable: true, unresolvedRemoteAction: false, selectedJobId: 'promo-20260925-01' };

test('local fallback is only a post-grace scheduling hint with shared remote state', () => {
  assert.deepEqual(decideLocalFallback(base), { eligible: true,
    reason: 'cloud_run_missing_after_grace', selectedJobId: base.selectedJobId });
  assert.equal(decideLocalFallback({ ...base, now: '2026-09-25T01:00:00Z' }).reason, 'cloud_grace_period');
  assert.equal(decideLocalFallback({ ...base, remoteReachable: false }).reason, 'shared_state_unreachable');
  assert.equal(decideLocalFallback({ ...base, unresolvedRemoteAction: true }).reason,
    'remote_action_unresolved_or_unreadable');
});

test('cloud success or active run blocks local fallback, failed completed run can proceed after grace', () => {
  const run = { createdAt: '2026-09-25T00:01:00Z', branch: 'main', workflow: 'channel-split-v3',
    status: 'in_progress', conclusion: null };
  assert.equal(decideLocalFallback({ ...base, cloudRuns: [run] }).reason, 'cloud_run_still_active');
  assert.equal(decideLocalFallback({ ...base, cloudRuns: [{ ...run, status: 'completed', conclusion: 'success' }] }).reason,
    'cloud_run_succeeded');
  assert.equal(decideLocalFallback({ ...base, cloudRuns: [{ ...run, status: 'completed', conclusion: 'failure' }] }).reason,
    'cloud_run_failed_and_no_remote_action');
});

test('unreadable evidence and stale scheduler windows fail closed', () => {
  assert.equal(decideLocalFallback({ ...base, cloudRuns: null }).reason, 'cloud_run_history_unavailable');
  assert.equal(decideLocalFallback({ ...base, cloudRuns: [{ createdAt: 'bad' }] }).reason, 'cloud_run_history_invalid');
  assert.equal(decideLocalFallback({ ...base, selectedJobId: '../bad' }).reason, 'selected_job_unavailable');
  assert.equal(decideLocalFallback({ ...base, now: '2026-09-26T02:00:00Z' }).reason, 'schedule_window_invalid');
});
