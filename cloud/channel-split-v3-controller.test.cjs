const test = require('node:test');
const assert = require('node:assert/strict');
const { decide } = require('./channel-split-v3-controller.cjs');

const NOW = '2026-09-25T01:00:00.000Z';
const SHA = 'a'.repeat(64);
const SITE = 'https://languagestudio.uk/missions/korean-cafe/?utm_source=threads&utm_medium=organic&utm_campaign=language_cafe&utm_content=coffee-order';
const image = name => ({ url: `https://aabbccdd.language-cafe-instagram-assets.pages.dev/${name}.jpg`, sha256: SHA });
const instagramJob = (id = 'ig-promo-001') => ({ schemaVersion: 1, id, channel: 'instagram', strategyVersion: 'channel-split-v3',
  workflow: { status: 'approved' }, content: { caption: 'Try ordering in Korean at Language Cafe. Find the free cafe pilot through the profile link.', image: image(id) } });
const threadsJob = (id = 'threads-card-001') => ({ schemaVersion: 1, id, channel: 'threads', strategyVersion: 'channel-split-v3',
  workflow: { status: 'approved' }, content: { text: `At a cafe, say 포장해 주세요. It means "Please make it to go."\nTry the free Korean cafe pilot at Language Cafe → ${SITE}`, siteUrl: SITE,
    images: [image(`${id}-1`), image(`${id}-2`)] } });
const history = (channel, media = [], checkedAt = NOW) => ({
  source: channel === 'instagram' ? 'official_instagram_graph_api_recent_media' : 'official_threads_graph_api_recent_media',
  complete: true, checkedAt, media
});
const media = (channel, id, timestamp, copy = `earlier ${id}`) => ({ id, timestamp,
  [channel === 'instagram' ? 'caption' : 'text']: copy });
function fixture() {
  return {
    policy: { schemaVersion: 1, strategyVersion: 'channel-split-v3', enabled: true,
      channels: { instagram: { maxPosts: 3, minimumGapHours: 72 }, threads: { maxPosts: 3, minimumGapHours: 72 } } },
    jobs: [instagramJob(), threadsJob()],
    ledger: { schemaVersion: 1, actions: [], locks: { instagram: null, threads: null } },
    instagramHistory: history('instagram'), threadsHistory: history('threads'), now: NOW
  };
}

test('disabled policy blocks both channels without selecting or authorizing publication', () => {
  const input = fixture(); input.policy.enabled = false;
  const decision = decide(input);
  assert.equal(decision.authorizesPublish, false);
  assert.equal(decision.channels.instagram.reason, 'policy_disabled');
  assert.equal(decision.channels.threads.reason, 'policy_disabled');
});

test('one paused channel does not disable the other reviewed channel', () => {
  const input = fixture();
  input.policy.channels.instagram.enabled = true;
  input.policy.channels.threads.enabled = false;
  input.ledger.locks.threads = { actionId: 'unresolved-threads-intent' };
  const decision = decide(input);
  assert.equal(decision.channels.instagram.status, 'selected');
  assert.equal(decision.channels.threads.reason, 'channel_disabled');
});

test('complete empty official histories allow independent approved-job selection without mutation', () => {
  const input = fixture(), before = structuredClone(input);
  const decision = decide(input);
  assert.equal(decision.channels.instagram.selectedJobId, 'ig-promo-001');
  assert.equal(decision.channels.threads.selectedJobId, 'threads-card-001');
  assert.equal(decision.channels.instagram.recentPostCount14d, 0);
  assert.equal(decision.channels.threads.lastPublishedAt, null);
  assert.deepEqual(input, before);
});

test('missing, partial, stale, or future official history never becomes a zero count', () => {
  for (const value of [null, { ...history('threads'), complete: false }, history('threads', [], '2026-09-24T00:00:00Z'),
    history('threads', [], '2026-09-25T01:01:00Z')]) {
    const input = fixture(); input.threadsHistory = value;
    const decision = decide(input);
    assert.equal(decision.channels.threads.reason, 'official_history_unavailable');
    assert.equal(decision.channels.threads.recentPostCount14d, undefined);
    assert.equal(decision.channels.instagram.status, 'selected');
  }
});

test('rolling cap counts earlier v2 official media but does not count a v2 receipt as a v3 job', () => {
  const input = fixture();
  input.instagramHistory.media = [
    media('instagram', 'v2-1', '2026-09-15T01:00:00Z'),
    media('instagram', 'v2-2', '2026-09-19T01:00:00Z'),
    media('instagram', 'v2-3', '2026-09-22T01:00:00Z')
  ];
  input.ledger.receipts = [{ finalStatus: 'published_learning_pair_exactly_once', actionId: 'old-pair' }];
  const decision = decide(input);
  assert.equal(decision.channels.instagram.reason, 'rolling_14d_cap');
  assert.equal(decision.channels.instagram.recentPostCount14d, 3);
  assert.equal(decision.channels.threads.status, 'selected');
  input.instagramHistory.media = [];
  assert.equal(decide(input).channels.instagram.status, 'selected');
});

test('minimum gap is per channel and exactly 72 hours is eligible', () => {
  const input = fixture();
  input.threadsHistory.media = [media('threads', 'recent', '2026-09-22T02:00:00Z')];
  let decision = decide(input);
  assert.equal(decision.channels.threads.reason, 'minimum_gap_not_met');
  assert.equal(decision.channels.threads.nextEligibleAt, '2026-09-25T02:00:00.000Z');
  assert.equal(decision.channels.instagram.status, 'selected');
  input.threadsHistory.media[0].timestamp = '2026-09-22T01:00:00Z';
  decision = decide(input);
  assert.equal(decision.channels.threads.status, 'selected');
  input.threadsHistory.media[0].timestamp = '2026-09-22T01:00:00+0000';
  assert.equal(decide(input).channels.threads.status, 'selected');
});

test('unresolved channel and global locks block without clearing them', () => {
  const input = fixture(); input.ledger.locks.instagram = { jobId: 'stuck' };
  let decision = decide(input);
  assert.equal(decision.channels.instagram.reason, 'unresolved_channel_lock');
  assert.equal(decision.channels.threads.status, 'selected');
  input.ledger.lock = { oldPair: 'unresolved' };
  decision = decide(input);
  assert.equal(decision.channels.instagram.reason, 'unresolved_global_lock');
  assert.equal(decision.channels.threads.reason, 'unresolved_global_lock');
});

test('recorded unresolved attempt and official text duplicate block the exact candidate, not a replacement', () => {
  const input = fixture(); input.jobs.push(instagramJob('ig-promo-002'));
  input.ledger.actions.push({ channel: 'instagram', jobId: 'ig-promo-001', status: 'completed' });
  let decision = decide(input);
  assert.equal(decision.channels.instagram.reason, 'job_already_attempted');
  assert.equal(decision.channels.instagram.selectedJobId, null);
  input.ledger.actions = [];
  input.instagramHistory.media.push(media('instagram', 'old', '2026-09-01T01:00:00Z', input.jobs[0].content.caption));
  decision = decide(input);
  assert.equal(decision.channels.instagram.reason, 'duplicate_official_copy');
});

test('a verified published receipt allows the next reviewed queue item, but an attempt alone does not', () => {
  const input = fixture();
  input.jobs.push(instagramJob('ig-promo-002'));
  input.jobs[2].content.caption = 'A second, distinct reviewed Korean café situation at Language Cafe.';
  input.ledger.actions.push({ strategyVersion: 'channel-split-v3', channel: 'instagram',
    jobId: 'ig-promo-001', status: 'completed' });
  assert.equal(decide(input).channels.instagram.reason, 'job_already_attempted');
  input.ledger.receipts = [{ strategyVersion: 'channel-split-v3', status: 'published_verified',
    channel: 'instagram', jobId: 'ig-promo-001', mediaId: '101' }];
  assert.equal(decide(input).channels.instagram.selectedJobId, 'ig-promo-002');
  input.jobs.pop();
  assert.equal(decide(input).channels.instagram.reason, 'all_approved_jobs_published');
});

test('unknown v3 schema, strategy, and malformed approved content fail closed by channel', () => {
  const input = fixture();
  input.jobs[0].strategyVersion = 'instagram-study-companion-link-v2';
  assert.equal(decide(input).channels.instagram.reason, 'job_schema_or_strategy_invalid');
  assert.equal(decide(input).channels.threads.status, 'selected');
  input.jobs[0].strategyVersion = 'channel-split-v3';
  input.jobs[0].schemaVersion = 2;
  assert.equal(decide(input).channels.instagram.reason, 'job_schema_or_strategy_invalid');
  input.jobs[0].schemaVersion = 1;
  input.jobs[0].content.image.sha256 = 'invalid';
  assert.equal(decide(input).channels.instagram.reason, 'approved_job_content_invalid');
  input.jobs[0].workflow.status = 'draft';
  assert.equal(decide(input).channels.instagram.reason, 'no_approved_job');
});

test('Threads candidate destination rejects root, unapproved tracking, and duplicate UTM keys', () => {
  for (const siteUrl of [
    'https://languagestudio.uk/',
    `${SITE}&next=https://evil.example`,
    `${SITE}&utm_source=threads`,
    SITE.replace('utm_campaign=language_cafe', 'utm_campaign=other')
  ]) {
    const input = fixture();
    input.jobs[1].content.siteUrl = siteUrl;
    input.jobs[1].content.text = input.jobs[1].content.text.replace(SITE, siteUrl);
    assert.equal(decide(input).channels.threads.reason, 'approved_job_content_invalid');
  }
});

test('unresolved action, duplicate IDs and missing ledger are never treated as a fresh run', () => {
  const input = fixture();
  input.ledger.actions.push({ channel: 'threads', status: 'ambiguous', jobId: 'other-job' });
  assert.equal(decide(input).channels.threads.reason, 'unresolved_channel_action');
  input.ledger.actions = [];
  input.jobs.push(instagramJob());
  assert.equal(decide(input).channels.instagram.reason, 'duplicate_job_id');
  input.jobs.pop();
  input.jobs[1].id = input.jobs[0].id;
  assert.equal(decide(input).channels.instagram.reason, 'duplicate_job_id');
  assert.equal(decide(input).channels.threads.reason, 'duplicate_job_id');
  input.jobs[1].id = 'threads-card-001';
  input.ledger.actions.push({ strategyVersion: 'channel-split-v3', channel: 'threads', status: 'completed' });
  assert.equal(decide(input).channels.instagram.reason, 'v3_action_identity_invalid');
  input.ledger.actions = [];
  input.ledger.locks = null;
  assert.equal(decide(input).channels.instagram.reason, 'ledger_invalid');
  assert.equal(decide(input).channels.threads.reason, 'ledger_invalid');
});
