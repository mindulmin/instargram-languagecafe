const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { controlReleaseErrors } = require('../content-queue/threads/prepare-threads-draft.cjs');
const { parseLibrary } = require('../content-queue/daily-content-selector.cjs');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
function jsonFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? jsonFiles(file) : entry.name.endsWith('.json') ? [file] : [];
  });
}
function evaluate(control, root, ledger, now = new Date()) {
  const errors = controlReleaseErrors(control, { now });
  if (control.handoff?.consumerAction !== 'publish_one_learning_pair') errors.push('cloud_learning_pair_action_required');
  if (!ledger || ledger.version !== 1 || !Array.isArray(ledger.actions)) errors.push('cloud_ledger_invalid');
  if (ledger?.lock) errors.push('cloud_unresolved_run_lock');
  const handoff = control.handoff || {};
  if (ledger?.actions?.some(a => a.actionId === handoff.actionId || a.idempotencyKey === handoff.idempotencyKey)) {
    errors.push('cloud_action_already_claimed');
  }
  // Contract rejection precedes queue/source inspection.
  if (errors.length) return { eligible: false, errors: [...new Set(errors)] };
  if (![control.testId, handoff.actionId, handoff.requestedPostId].every(v => /^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/.test(v))) {
    return { eligible: false, errors: ['cloud_unsafe_identifier'] };
  }
  const jobs = jsonFiles(path.join(root, 'jobs')).map(file => ({ file, job: JSON.parse(fs.readFileSync(file, 'utf8')) }));
  const matches = jobs.filter(({ job }) => job.id === handoff.requestedPostId);
  if (matches.length !== 1) errors.push('cloud_requested_source_not_unique');
  const selected = matches[0];
  if (selected) {
    const job = selected.job;
    if (job.source?.expression !== handoff.targetExpression) errors.push('cloud_source_expression_mismatch');
    if (job.published?.mediaId || !['ready', 'draft', 'approved'].includes(job.workflow?.status)) errors.push('cloud_source_not_unpublished');
    const rows = parseLibrary(fs.readFileSync(path.join(root, 'content-queue/korean-conversation-library.csv'), 'utf8'));
    const sources = rows.filter(row => row.id === job.source?.expressionId && row.koreanExpression === handoff.targetExpression);
    if (sources.length !== 1 || sources[0].status !== 'ready') errors.push('cloud_source_library_not_ready');
    if (jobs.some(({ job: other }) => other.id !== job.id && (other.published?.mediaId || other.workflow?.status === 'published')
      && (other.source?.expression === handoff.targetExpression || other.source?.expressionId === job.source?.expressionId))) {
      errors.push('cloud_expression_already_published');
    }
    const locks = [path.join(root, 'tmp/publish-locks', job.id + '.json'),
      path.join(root, 'operations/revenue-experiment', control.testId, 'publisher-locks', handoff.actionId + '.json')];
    if (locks.some(file => fs.existsSync(file))) errors.push('cloud_source_or_action_lock_exists');
  }
  const receipts = jsonFiles(path.join(root, 'operations/revenue-experiment', control.testId, 'publisher-receipts'))
    .map(file => JSON.parse(fs.readFileSync(file, 'utf8')));
  const accepted = receipts.filter(r => ['published_learning_pair_exactly_once', 'instagram_published_threads_blocked', 'threads_companion_published_for_existing_instagram_exactly_once'].includes(r.finalStatus));
  if (accepted.length !== control.publishing.publishedCount) errors.push('cloud_published_count_not_reconciled');
  const identityFiles = [...jobs.map(j => j.file),
    ...jsonFiles(path.join(root, 'content-queue/threads/jobs')),
    ...jsonFiles(path.join(root, 'operations/revenue-experiment')),
    ...jsonFiles(path.join(root, 'tmp/publish-locks')),
    ...jsonFiles(path.join(root, 'content-queue/threads/.publish-locks'))];
  const containsIdentity = value => value && typeof value === 'object' && Object.entries(value).some(([key, item]) =>
    (key === 'actionId' && item === handoff.actionId) || (key === 'idempotencyKey' && item === handoff.idempotencyKey)
    || (item && typeof item === 'object' && containsIdentity(item)));
  if (identityFiles.some(file => containsIdentity(JSON.parse(fs.readFileSync(file, 'utf8'))))) errors.push('cloud_identity_already_used');
  return { eligible: errors.length === 0, errors: [...new Set(errors)],
    jobPath: selected ? path.relative(root, selected.file).replace(/\\/g, '/') : null };
}
function assertPermit(root, job, phase) {
  if (process.env.LANGUAGE_CAFE_CLOUD !== '1') return;
  const permit = JSON.parse(fs.readFileSync(path.join(root, 'cloud-permit.json'), 'utf8'));
  const { DEFAULT_CONTROL_PATH } = require('../content-queue/threads/prepare-threads-draft.cjs');
  const bytes = fs.readFileSync(DEFAULT_CONTROL_PATH);
  const control = JSON.parse(bytes);
  const errors = controlReleaseErrors(control);
  if (digest(bytes) !== permit.controlSha256) errors.push('cloud_control_changed');
  if (permit.runId !== process.env.GITHUB_RUN_ID || !permit.remoteClaimSha) errors.push('cloud_remote_claim_missing');
  const jobId = phase === 'instagram' ? job.id : job.controlBinding?.requestedPostId;
  if (jobId !== permit.requestedPostId || control.handoff.actionId !== permit.actionId) errors.push('cloud_job_not_claimed');
  if (errors.length) throw new Error('Cloud publish gate blocked: ' + errors.join(', '));
}
module.exports = { digest, evaluate, assertPermit, jsonFiles };
