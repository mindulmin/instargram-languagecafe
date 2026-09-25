// Candidate selection only. A selected job is not a publication permit or claim.
const STRATEGY = 'channel-split-v3';
const CHANNELS = ['instagram', 'threads'];
const SOURCES = {
  instagram: 'official_instagram_graph_api_recent_media',
  threads: 'official_threads_graph_api_recent_media'
};
const DAY = 24 * 60 * 60 * 1000;
const HISTORY_MAX_AGE = 5 * 60 * 1000;
const CLOCK_SKEW = 30 * 1000;
const IMAGE_HOST = /^[a-f0-9]{8,}\.language-cafe-instagram-assets\.pages\.dev$/;
const HEX_SHA256 = /^[a-f0-9]{64}$/;
const JOB_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/;
const UNRESOLVED = new Set(['claimed', 'publishing', 'ambiguous', 'unresolved']);
const WORKFLOW_STATUSES = new Set(['draft', 'approved', 'published', 'rejected', 'cancelled', 'blocked', 'publishing', 'ambiguous']);

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const blocked = reason => ({ status: 'blocked', reason, selectedJobId: null });
const result = () => ({
  schemaVersion: 1,
  strategyVersion: STRATEGY,
  authorizesPublish: false,
  channels: { instagram: blocked('not_evaluated'), threads: blocked('not_evaluated') }
});
function allBlocked(output, reason) {
  for (const channel of CHANNELS) output.channels[channel] = blocked(reason);
  return output;
}
function parseTime(value) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : NaN;
  if (typeof value !== 'string' || !/(?:Z|[+-]\d\d:?\d\d)$/i.test(value)) return NaN;
  return Date.parse(value);
}
function normalized(value) {
  return value.normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/gu, ' ').trim().toLocaleLowerCase('en');
}
function validImage(image, channel) {
  if (!record(image) || !HEX_SHA256.test(image.sha256 || '')) return false;
  try {
    const url = new URL(image.url);
    return url.protocol === 'https:' && IMAGE_HOST.test(url.hostname) && !url.username && !url.password
      && !url.port && !url.search && !url.hash
      && (channel === 'instagram' ? /\.jpe?g$/i : /\.(?:jpe?g|png)$/i).test(url.pathname);
  } catch {
    return false;
  }
}
function validSiteUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'languagestudio.uk' || url.pathname !== '/missions/korean-cafe/'
      || url.username || url.password || url.port || url.hash || url.href !== value) return false;
    const entries = [...url.searchParams.entries()];
    if (!entries.length) return true;
    const expected = { utm_source: 'threads', utm_medium: 'organic', utm_campaign: 'language_cafe' };
    const keys = entries.map(([key]) => key);
    return keys.length >= 3 && keys.length <= 4 && new Set(keys).size === keys.length
      && Object.entries(expected).every(([key, item]) => url.searchParams.get(key) === item)
      && keys.every(key => Object.hasOwn(expected, key) || key === 'utm_content')
      && (!url.searchParams.has('utm_content') || /^[a-z0-9][a-z0-9_-]{0,79}$/u.test(url.searchParams.get('utm_content')));
  } catch {
    return false;
  }
}
function validContent(job) {
  const content = job.content;
  if (!record(content)) return false;
  if (job.channel === 'instagram') {
    return nonempty(content.caption) && content.caption.length <= 2200 && validImage(content.image, 'instagram');
  }
  if (!nonempty(content.text) || content.text.length > 500 || !validSiteUrl(content.siteUrl)
    || !Array.isArray(content.images) || content.images.length < 2 || content.images.length > 8
    || !content.images.every(image => validImage(image, 'threads'))
    || new Set(content.images.map(image => image.url)).size !== content.images.length) return false;
  const urls = content.text.match(/https?:\/\/[^\s]+/g) || [];
  return urls.length === 1 && urls[0] === content.siteUrl
    && content.text.trimEnd().split(/\r?\n/).at(-1).endsWith(content.siteUrl);
}
function validatedHistory(history, channel, nowMs) {
  if (!record(history) || history.source !== SOURCES[channel] || history.complete !== true || !Array.isArray(history.media)) return null;
  const checkedAt = parseTime(history.checkedAt);
  if (!Number.isFinite(checkedAt) || checkedAt > nowMs + CLOCK_SKEW || nowMs - checkedAt > HISTORY_MAX_AGE) return null;
  const textField = channel === 'instagram' ? 'caption' : 'text';
  const seen = new Set();
  const media = [];
  for (const entry of history.media) {
    const time = parseTime(entry?.timestamp);
    if (!record(entry) || !nonempty(entry.id) || seen.has(entry.id) || !Number.isFinite(time)
      || time > nowMs + CLOCK_SKEW || typeof entry[textField] !== 'string') return null;
    seen.add(entry.id);
    media.push({ id: entry.id, timestamp: time, text: entry[textField] });
  }
  return media;
}
function usedByLedger(ledger, job) {
  const key = `${STRATEGY}:${job.channel}:${job.id}`;
  return [...ledger.actions, ...(ledger.receipts || [])].some(item =>
    [item.jobId, item.id, item.actionId, item.idempotencyKey].some(value => value === job.id || value === key));
}
function publishedByLedger(ledger, job) {
  return Array.isArray(ledger.receipts) && ledger.receipts.some(item =>
    item.strategyVersion === STRATEGY && item.status === 'published_verified'
      && item.channel === job.channel && item.jobId === job.id);
}
function unresolvedAction(ledger, channel) {
  return ledger.actions.some(action => UNRESOLVED.has(action.status)
    && (action.channel === channel || action.channel === undefined || action.channel === null));
}

/**
 * Read-only v3 selector. The caller must supply fresh, complete official
 * histories for both channels and a separately maintained v3 jobs queue.
 * Historical v2 receipts are never counted as v3 jobs; their official media
 * still count against each channel's rolling cap and minimum gap.
 */
function decide({ policy, jobs, ledger, instagramHistory, threadsHistory, now }) {
  const output = result();
  if (!record(policy) || policy.schemaVersion !== 1 || policy.strategyVersion !== STRATEGY
    || typeof policy.enabled !== 'boolean') return allBlocked(output, 'policy_schema_or_strategy_invalid');
  if (policy.enabled === false) return allBlocked(output, 'policy_disabled');
  const nowMs = parseTime(now);
  if (!Number.isFinite(nowMs)) return allBlocked(output, 'now_invalid');
  if (!record(ledger) || ledger.schemaVersion !== 1 || !Array.isArray(ledger.actions)
    || !record(ledger.locks) || !CHANNELS.every(channel => Object.hasOwn(ledger.locks, channel))
    || ledger.actions.some(action => !record(action))
    || (ledger.receipts !== undefined && (!Array.isArray(ledger.receipts) || ledger.receipts.some(receipt => !record(receipt))))) {
    return allBlocked(output, 'ledger_invalid');
  }
  if (ledger.lock !== undefined && ledger.lock !== null) return allBlocked(output, 'unresolved_global_lock');
  if (!Array.isArray(jobs)) return allBlocked(output, 'jobs_unavailable');
  const grouped = { instagram: [], threads: [] };
  const jobErrors = { instagram: null, threads: null };
  const seenIds = new Map();
  for (const job of jobs) {
    if (!record(job) || !CHANNELS.includes(job.channel)) return allBlocked(output, 'job_channel_invalid');
    const channel = job.channel;
    if (job.schemaVersion !== 1 || job.strategyVersion !== STRATEGY) jobErrors[channel] ||= 'job_schema_or_strategy_invalid';
    if (!nonempty(job.id) || !JOB_ID.test(job.id)) jobErrors[channel] ||= 'job_id_invalid';
    else if (seenIds.has(job.id)) {
      jobErrors[channel] ||= 'duplicate_job_id';
      jobErrors[seenIds.get(job.id)] ||= 'duplicate_job_id';
    } else seenIds.set(job.id, channel);
    if (!record(job.workflow) || !WORKFLOW_STATUSES.has(job.workflow.status)) jobErrors[channel] ||= 'job_workflow_invalid';
    if (job.workflow?.status === 'approved' && !validContent(job)) jobErrors[channel] ||= 'approved_job_content_invalid';
    grouped[channel].push(job);
  }
  for (const action of ledger.actions) {
    if (action.strategyVersion === STRATEGY && (!CHANNELS.includes(action.channel) || !nonempty(action.jobId))) {
      return allBlocked(output, 'v3_action_identity_invalid');
    }
  }
  for (const channel of CHANNELS) {
    const settings = policy.channels?.[channel];
    if (!record(settings) || !Number.isInteger(settings.maxPosts) || settings.maxPosts < 1 || settings.maxPosts > 3
      || !Number.isFinite(settings.minimumGapHours) || settings.minimumGapHours < 72) {
      output.channels[channel] = blocked('channel_policy_invalid');
      continue;
    }
    if (jobErrors[channel]) { output.channels[channel] = blocked(jobErrors[channel]); continue; }
    if (ledger.locks[channel] !== null) { output.channels[channel] = blocked('unresolved_channel_lock'); continue; }
    if (unresolvedAction(ledger, channel) || grouped[channel].some(job => UNRESOLVED.has(job.workflow.status))) {
      output.channels[channel] = blocked('unresolved_channel_action');
      continue;
    }
    const history = validatedHistory(channel === 'instagram' ? instagramHistory : threadsHistory, channel, nowMs);
    if (history === null) { output.channels[channel] = blocked('official_history_unavailable'); continue; }
    const recent = history.filter(media => media.timestamp >= nowMs - 14 * DAY);
    const last = Math.max(...history.map(media => media.timestamp), -Infinity);
    const evidence = { recentPostCount14d: recent.length, lastPublishedAt: Number.isFinite(last) ? new Date(last).toISOString() : null };
    const stop = (reason, extra = {}) => { output.channels[channel] = { ...blocked(reason), ...evidence, ...extra }; };
    if (recent.length >= settings.maxPosts) {
      stop('rolling_14d_cap', { nextEligibleAt: new Date(Math.min(...recent.map(media => media.timestamp)) + 14 * DAY).toISOString() });
      continue;
    }
    if (nowMs - last < settings.minimumGapHours * 3600000) {
      stop('minimum_gap_not_met', { nextEligibleAt: new Date(last + settings.minimumGapHours * 3600000).toISOString() });
      continue;
    }
    const approved = grouped[channel].filter(job => job.workflow.status === 'approved').sort((a, b) => a.id.localeCompare(b.id, 'en'));
    if (!approved.length) { stop('no_approved_job'); continue; }
    const candidates = approved.filter(job => !publishedByLedger(ledger, job));
    if (!candidates.length) { stop('all_approved_jobs_published'); continue; }
    const job = candidates[0];
    if (usedByLedger(ledger, job)) { stop('job_already_attempted'); continue; }
    const copy = channel === 'instagram' ? job.content.caption : job.content.text;
    if (history.some(media => normalized(media.text) === normalized(copy))) { stop('duplicate_official_copy'); continue; }
    if (candidates.slice(1).some(other => normalized(channel === 'instagram' ? other.content.caption : other.content.text) === normalized(copy))) {
      stop('duplicate_approved_copy');
      continue;
    }
    output.channels[channel] = { status: 'selected', reason: null, selectedJobId: job.id, ...evidence };
  }
  return output;
}

module.exports = { decide, STRATEGY, CHANNELS };
