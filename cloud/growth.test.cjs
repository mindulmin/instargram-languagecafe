const test = require('node:test');
const assert = require('node:assert/strict');
const { numericMetric, storyReviewErrors, publishStoryOnce } = require('./growth.cjs');
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
  const job = { source: { expression: '정말요?' }, instagram: { caption: '정말요? Really?' }, published: { mediaId: 'ig', verification: { permalink: 'link' } } };
  const thread = { copy: { primaryPost: '정말요? Recall link' }, published: { mediaId: 'th' } };
  const ig = [{ id: 'ig', caption: job.instagram.caption, media_type: 'CAROUSEL_ALBUM', permalink: 'link' }], th = [{ id: 'th', text: thread.copy.primaryPost }];
  assert.equal(matches(job, thread, ig, th), true);
  assert.equal(matches(job, thread, [...ig, { id: 'duplicate', media_type: 'CAROUSEL_ALBUM', caption: 'Contrast 정말요?' }], th), false);
  assert.equal(matches(job, thread, ig, [{ id: 'th', text: 'wrong' }]), false);
});
