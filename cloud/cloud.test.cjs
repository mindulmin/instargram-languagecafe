const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { encrypt, decrypt, restore, safePath } = require('./state.cjs');
const { GitHubState } = require('./github-state.cjs');
const { evaluate } = require('./gates.cjs');
const { verifiedPair } = require('./runner.cjs');
const key = 'a'.repeat(64);
const now = new Date('2026-09-08T00:00:00Z');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-cloud-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (name, value) => {
    const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
  };
  const control = structuredClone(require('./control/current-test.json'));
  Object.assign(control, { testId: 'test', asOfDate: '2026-09-08' });
  control.strategy.instagramRequiredBeforeThreads = true;
  Object.assign(control.publishing, { status: 'learning_ready', postDue: true, publishedCount: 0 });
  Object.assign(control.handoff, { consumerAction: 'publish_one_learning_pair', actionId: 'action-one',
    idempotencyKey: 'unique-one', requestedPostId: 'job-one', targetExpression: '테스트예요',
    issuedAt: '2026-09-07T23:00:00Z', validUntil: '2026-09-08T02:00:00Z', mayPublish: true, mayCreateMedia: true });
  write('jobs/source.json', { id: 'job-one', source: { expressionId: '099', expression: '테스트예요' }, workflow: { status: 'ready' } });
  write('content-queue/korean-conversation-library.csv', 'id,category,korean_expression,english_hint,romanization,scene,primary_format,status\n099,test,테스트예요,Test,test,scene,card_carousel,ready\n');
  return { root, write, control, ledger: { version: 1, lock: null, actions: [] } };
}
test('encrypted state roundtrips hidden locks and detects tampering', () => {
  const state = { version: 1, files: { 'content-queue/threads/.publish-locks/a.json': Buffer.from('{"keep":true}').toString('base64') } };
  const bytes = encrypt(state, key); assert.deepEqual(decrypt(bytes, key), state);
  bytes[bytes.length - 1] ^= 1; assert.throws(() => decrypt(bytes, key));
});
test('wrong key and traversal are rejected before restore', () => {
  assert.throws(() => decrypt(encrypt({ version: 1, files: {} }, key), 'b'.repeat(64)));
  for (const name of ['../session.json', 'jobs/../../session.json', 'C:/secrets', 'jobs\\a.json', 'jobs//x']) assert.equal(safePath(name), false);
  assert.throws(() => restore(os.tmpdir(), { files: { '../escape': '' } }));
});
test('a valid unique ready release passes without revenue dependencies', t => {
  const f = fixture(t); f.control.revenue = { status: 'blocked_checkout' };
  assert.equal(evaluate(f.control, f.root, f.ledger, now).eligible, true);
});
test('stale and not-due release stops before queue or API access', () => {
  const c = structuredClone(require('./control/current-test.json'));
  const result = evaluate(c, '/directory-that-does-not-exist', { version: 1, actions: [] }, now);
  assert.equal(result.eligible, false);
  assert(result.errors.includes('control_publishing_not_due_or_ready'));
});
test('cancelled remote claim and reused identity cannot publish again', t => {
  const f = fixture(t); f.ledger.lock = { runId: 'old-run' };
  assert(evaluate(f.control, f.root, f.ledger, now).errors.includes('cloud_unresolved_run_lock'));
  f.ledger.lock = null; f.ledger.actions.push({ idempotencyKey: f.control.handoff.idempotencyKey });
  assert(evaluate(f.control, f.root, f.ledger, now).errors.includes('cloud_action_already_claimed'));
});
test('missing and published sources, count mismatch and source locks block', t => {
  const f = fixture(t);
  f.control.publishing.publishedCount = 1;
  assert(evaluate(f.control, f.root, f.ledger, now).errors.includes('cloud_published_count_not_reconciled'));
  f.control.publishing.publishedCount = 0;
  f.write('tmp/publish-locks/job-one.json', { stage: 'ambiguous' });
  assert(evaluate(f.control, f.root, f.ledger, now).errors.includes('cloud_source_or_action_lock_exists'));
  f.write('jobs/other.json', { id: 'job-two', source: { expression: '테스트예요' }, published: { mediaId: 'old' } });
  assert(evaluate(f.control, f.root, f.ledger, now).errors.includes('cloud_expression_already_published'));
  f.control.handoff.requestedPostId = 'missing';
  assert(evaluate(f.control, f.root, f.ledger, now).errors.includes('cloud_requested_source_not_unique'));
});
test('changed GitHub state refuses a write without overwriting the new head', async () => {
  const client = new GitHubState('test'); const calls = [];
  client.api = async (route, method) => { calls.push([route, method]); return { object: { sha: 'someone-else' } }; };
  await assert.rejects(client.save({ sha: 'old' }, {}, Buffer.alloc(0)), /concurrently/);
  assert.equal(calls.length, 1);
});
test('GitHub 500 is not retried or treated as missing state', async () => {
  let calls = 0;
  const client = new GitHubState('test', async () => { calls++; return { ok: false, status: 500 }; });
  await assert.rejects(client.read(), /no automatic retry/); assert.equal(calls, 1);
});
test('claim save must confirm the remote ref before returning', async () => {
  const client = new GitHubState('test'); let reads = 0;
  client.api = async route => {
    if (route.startsWith('git/ref/')) return { object: { sha: ++reads === 1 ? 'old' : 'not-our-commit' } };
    return { sha: 'new' };
  };
  await assert.rejects(client.save({ sha: 'old', tree: 'tree' }, {}, Buffer.alloc(0)), /readback mismatch/);
});
test('an agent success message without two official receipts retains the lock', t => {
  const f = fixture(t); assert.equal(verifiedPair(f.root, f.control), false);
  f.write('operations/revenue-experiment/test/publisher-receipts/action-one.json', {
    finalStatus: 'published_learning_pair_exactly_once', actionId: 'action-one', idempotencyKey: 'unique-one'
  });
  assert.equal(verifiedPair(f.root, f.control), false);
});
test('only cross-matching Instagram and Threads readbacks release the cloud lock', t => {
  const f = fixture(t); const link = 'https://www.instagram.com/p/test/';
  f.write('operations/revenue-experiment/test/publisher-receipts/action-one.json', {
    finalStatus: 'published_learning_pair_exactly_once', actionId: 'action-one', idempotencyKey: 'unique-one',
    reelActionCount: 0, threadsExternalLinkCount: 1, threadsLinkTargetType: 'source_instagram_permalink',
    threadsLinkTarget: link, threadsExplicitLinkAttachmentRequested: false,
    threadsPlatformPreviewState: 'unavailable_platform_managed', instagram: { mediaId: 'ig' }, threads: { mediaId: 'th' }
  });
  f.write('jobs/source.json', { id: 'job-one', workflow: { postPublishVerification: {
    status: 'passed', review: 'passed', source: 'official_instagram_graph_api_recent_media',
    mediaIdMatchCount: 1, normalizedFullCaptionMatchCount: 1, sameHangulExpressionMatchCount: 1,
    exactOnePublishedJobConfirmed: true, mediaType: 'CAROUSEL_ALBUM', matchedMediaId: 'ig', permalink: link
  } }, published: { mediaId: 'ig', verification: { id: 'ig', permalink: link } } });
  const thread = { workflow: { status: 'published' }, controlBinding: { actionId: 'action-one', sourceLinkTarget: link },
    published: { mediaId: 'th', verification: { id: 'th', review: 'passed', mediaIdMatchCount: 1,
      normalizedFullTextMatchCount: 1, threadsLinkTarget: link } } };
  f.write('content-queue/threads/jobs/source.json', thread);
  assert.equal(verifiedPair(f.root, f.control), true);
  thread.published.verification.normalizedFullTextMatchCount = 0;
  f.write('content-queue/threads/jobs/source.json', thread);
  assert.equal(verifiedPair(f.root, f.control), false);
});
