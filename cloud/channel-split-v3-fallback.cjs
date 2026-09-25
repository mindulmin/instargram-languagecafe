'use strict';

// Eligibility is only a scheduling hint. The publication runner must still
// acquire the shared cloud-state claim and commit/read back every API intent.
const GRACE_MS = 90 * 60 * 1000;
const STALE_MS = 24 * 60 * 60 * 1000;

function checkedTime(value) {
  if (typeof value !== 'string' || !/(?:Z|[+-]\d\d:?\d\d)$/u.test(value)) return NaN;
  return Date.parse(value);
}

function decideLocalFallback({ now, scheduledAt, cloudRuns, remoteReachable,
  unresolvedRemoteAction, selectedJobId } = {}) {
  const current = checkedTime(now);
  const scheduled = checkedTime(scheduledAt);
  if (!Number.isFinite(current) || !Number.isFinite(scheduled) || current < scheduled
    || current - scheduled > STALE_MS) return { eligible: false, reason: 'schedule_window_invalid' };
  if (remoteReachable !== true) return { eligible: false, reason: 'shared_state_unreachable' };
  if (unresolvedRemoteAction !== false) return { eligible: false, reason: 'remote_action_unresolved_or_unreadable' };
  if (typeof selectedJobId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{2,119}$/u.test(selectedJobId)) {
    return { eligible: false, reason: 'selected_job_unavailable' };
  }
  if (!Array.isArray(cloudRuns) || cloudRuns.some(run => !run || typeof run !== 'object')) {
    return { eligible: false, reason: 'cloud_run_history_unavailable' };
  }
  const relevant = cloudRuns.filter(run => {
    const created = checkedTime(run.createdAt);
    return Number.isFinite(created) && created >= scheduled - 5 * 60 * 1000
      && created <= current && run.branch === 'main' && run.workflow === 'channel-split-v3';
  });
  if (cloudRuns.some(run => !Number.isFinite(checkedTime(run.createdAt)))) {
    return { eligible: false, reason: 'cloud_run_history_invalid' };
  }
  if (relevant.some(run => run.status !== 'completed')) {
    return { eligible: false, reason: 'cloud_run_still_active' };
  }
  if (relevant.some(run => run.conclusion === 'success')) {
    return { eligible: false, reason: 'cloud_run_succeeded' };
  }
  if (current - scheduled < GRACE_MS) return { eligible: false, reason: 'cloud_grace_period' };
  return { eligible: true, reason: relevant.length ? 'cloud_run_failed_and_no_remote_action' : 'cloud_run_missing_after_grace',
    selectedJobId };
}

module.exports = { GRACE_MS, decideLocalFallback };
