const test = require('node:test');
const assert = require('node:assert/strict');
const { numericMetric, storyReviewErrors, publishStoryOnce, insights } = require('./growth.cjs');
test('scoped hosting token can use verified project read without account-wide permissions', async () => {
  const { verifyHostingAccess } = require('./hosting-access.cjs');
  const env = { CLOUDFLARE_API_TOKEN: 'private', CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32) };
  const deniedWhoami = async () => { throw Error('account listing denied'); };
  const r = await verifyHostingAccess(deniedWhoami, env, async (_, options) => {
    assert.equal(options.method, 'GET');
    return { ok: true, status: 200, json: async () => ({ success: true, result: { name: 'language-cafe-instagram-assets' } }) };
  });
  assert.equal(r.status, 'scoped_project_read_verified_account_listing_unavailable');
  await assert.rejects(verifyHostingAccess(deniedWhoami, env, async () => ({ ok: false, status: 403, json: async () => ({ success: false }) })), /not_verified/);
});
test('insights permission failures retain a sanitized reason rather than a false zero', async () => {
  const result = await insights({ accountId: '123', accessToken: 'never-log-me', graphVersion: 'v25.0' },
    { media: [{ id: '456', media_type: 'CAROUSEL_ALBUM', timestamp: '2026-09-11T00:00:00Z' }] },
    async () => ({ ok: false, status: 400, json: async () => ({ error: { code: 10, message: 'never-log-me' } }) }));
  assert.equal(result.posts[0].metrics.reach.value, null);
  assert.equal(result.posts[0].metrics.reach.reason, 'instagram_read_failed_http_400_code_10');
  assert.equal(JSON.stringify(result).includes('never-log-me'), false);
});
test('missing metrics stay unavailable and actual numeric zero stays observed', () => {
  assert.deepEqual(numericMetric({}, 'reach'), { value: null, status: 'unavailable' });
  assert.deepEqual(numericMetric({ data: [{ name: 'reach', values: [{ value: 0 }] }] }, 'reach'), { value: 0, status: 'observed' });
  assert.equal(numericMetric({ data: [{ name: 'reach', total_value: { value: '0' } }] }, 'reach').status, 'unavailable');
});
test('story has exactly one create and publish request, only after persisted intent', async () => {
  const posts = [], states = [];
  const result = await publishStoryOnce({ imageUrl: 'https://example.pages.dev/story.jpg', persist: async s => states.push(s), sleep: async () => {},
    api: async (method, object, fields) => {
      if (method === 'POST') {
        posts.push(object);
        assert.ok(states.at(-1).status === (object === 'media' ? 'creating_container' : 'publishing'));
        if (object === 'media') { assert.equal(fields.media_type, 'STORIES'); assert.equal(fields.caption, undefined); return { id: 'container' }; }
        return { id: 'story' };
      }
      return object === 'stories' ? { data: [{ id: 'story', media_product_type: 'STORY' }] } : { status_code: 'FINISHED' };
    } });
  assert.deepEqual(posts, ['media', 'media_publish']); assert.equal(result.officialMatchCount, 1);
});
test('ambiguous Story publish never creates a replacement or retries', async () => {
  const posts = [];
  await assert.rejects(publishStoryOnce({ imageUrl: 'test', persist: async () => {}, sleep: async () => {}, api: async (method, object) => {
    if (method === 'GET') return { status_code: 'FINISHED' };
    posts.push(object); if (object === 'media') return { id: 'container' }; throw Error('timeout');
  } }));
  assert.deepEqual(posts, ['media', 'media_publish']);
});
test('unreviewed or modified story cannot be uploaded', () => {
  const errors = storyReviewErrors({}, {}, Buffer.from('unreviewed'), { width: 1080, height: 1350, format: 'png' });
  assert.ok(errors.includes('story_image_invalid')); assert.ok(errors.includes('story_review_incomplete'));
});
test('fresh pair readback rejects duplicate expressions and mismatched Threads text', () => {
  const { matches } = require('./live-verification.cjs');
  const job = { source: { expression: '정말요?' }, instagram: { caption: '정말요? Really?', hashtags: [] }, published: { mediaId: 'ig', verification: { permalink: 'link' } } };
  const thread = { copy: { primaryPost: '정말요? Recall link' }, published: { mediaId: 'th' } };
  const ig = [{ id: 'ig', caption: job.instagram.caption, media_type: 'CAROUSEL_ALBUM', permalink: 'link' }], th = [{ id: 'th', text: thread.copy.primaryPost }];
  assert.equal(matches(job, thread, ig, th), true);
  assert.equal(matches(job, thread, [...ig, { id: 'duplicate', media_type: 'CAROUSEL_ALBUM', caption: 'Contrast 정말요?' }], th), false);
  assert.equal(matches(job, thread, ig, [{ id: 'th', text: 'wrong' }]), false);
  job.instagram.hashtags = ['LearnKorean', '#KoreanExpression'];
  assert.equal(matches(job, thread, ig, th), false);
  const full = [{ ...ig[0], caption: '정말요? Really?\n\n#LearnKorean #KoreanExpression' }];
  assert.equal(matches(job, thread, full, th), true);
  assert.equal(matches(job, thread, [{ ...full[0], caption: full[0].caption + ' #unexpected' }], th), false);
});
test('manual reconciliation requires the exact original claim and immutable control bytes', () => {
  const { reconciliationControl } = require('./runner.cjs'), { digest } = require('./gates.cjs');
  const control = { handoff: { actionId: 'action', idempotencyKey: 'key', requestedPostId: 'job' } };
  const bytes = Buffer.from(JSON.stringify(control));
  const state = { files: { 'operations/cloud-controller/current.json': bytes.toString('base64') } };
  const lock = { ...control.handoff, runId: '123', status: 'needs_official_readback', controlSha256: digest(bytes) };
  assert.equal(reconciliationControl(state, lock).jobPath, 'jobs/job.json');
  assert.throws(() => reconciliationControl(state, { ...lock, actionId: 'different' }), /identity mismatch/);
  assert.throws(() => reconciliationControl(state, { ...lock, controlSha256: '0'.repeat(64) }), /control bytes/);
  assert.throws(() => reconciliationControl(state, { ...lock, requestedPostId: '../escape' }), /reviewable/);
});
test('one-time Story completion cannot resolve any container attempt or changed checkpoint', () => {
  const { unstartedStoryResolution } = require('./runner.cjs');
  const remote = { sha: '4008bb26d8c79344939a26b9d29dcbcd0faa4a1c', ledger: { lock: null,
    lastRun: { runId: '34580004117', status: 'published_learning_pair_exactly_once', storyStatus: 'story_blocked_no_retry' },
    actions: [{ runId: '34578937471', requestedPostId: '2026-09-11-expression-045-cloud' }] } };
  const p = 'operations/growth/2026-09-11-expression-045-cloud/story-lock.json';
  const story = { status: 'story_blocked_no_retry', createAttempts: 0, publishAttempts: 0, reason: 'story_hosting_or_network_failed' };
  const state = { files: { [p]: Buffer.from(JSON.stringify(story)).toString('base64') } };
  assert.equal(unstartedStoryResolution(remote, state).lockPath, p);
  assert.throws(() => unstartedStoryResolution({ ...remote, sha: 'changed' }, state), /Exact/);
  state.files[p] = Buffer.from(JSON.stringify({ ...story, createAttempts: 1 })).toString('base64');
  assert.throws(() => unstartedStoryResolution(remote, state), /may have started/);
});
