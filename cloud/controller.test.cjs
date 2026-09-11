const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { decide, library } = require('./controller.cjs');
const { recentMedia } = require('./official-read.cjs');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-controller-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const now = new Date('2026-09-11T01:00:00Z');
  return { root, now, template: require('./control/current-test.json'), policy: { ...require('./control/policy.json') },
    ledger: { version: 1, actions: [], lock: null }, history: { source: 'official_instagram_graph_api_recent_media', complete: true, checkedAt: now.toISOString(), media: [] },
    rows: [{ id: '999', koreanExpression: '천천히 말해 주세요', primaryFormat: 'card_carousel', status: 'ready' }] };
}
function write(root, file, value) { const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, JSON.stringify(value)); }
test('controller selects a new ready source without fabricating review approvals', t => {
  const f = fixture(t), d = decide(f);
  assert.equal(d.status, 'controller_ready_for_production');
  assert.equal(d.control.asOfDate, '2026-09-11');
  assert.equal(d.control.handoff.consumerAction, 'publish_one_learning_pair');
  assert.equal(d.job.workflow.status, 'draft');
  assert.equal(d.job.workflow.autoPublish, false);
  assert.equal(d.job.workflow.characterReview, undefined);
  assert.equal(d.control.revenue, f.template.revenue);
});
test('controller rejects disabled policy, missing history, future or stale readback and unresolved global locks', t => {
  const f = fixture(t);
  for (const changed of [{ policy: { ...f.policy, enabled: false } }, { history: null }, { history: { ...f.history, checkedAt: '2026-09-10T01:00:00Z' } },
    { history: { ...f.history, checkedAt: '2026-09-12T01:00:00Z' } }, { ledger: { ...f.ledger, lock: { runId: 'old' } } }]) {
    const d = decide({ ...f, ...changed }); assert.equal(d.selected, null); assert.equal(d.control.publishing.postDue, false);
  }
});
test('controller rejects historic captions including target used only as contrast and all old attempts', t => {
  const f = fixture(t);
  f.history.media.push({ id: 'old', timestamp: '2026-09-01T00:00:00Z', media_type: 'CAROUSEL_ALBUM', caption: 'Contrast: 천천히 말해 주세요.' });
  assert.equal(decide(f).status, 'controller_no_unique_ready_expression');
  f.history.media = [];
  write(f.root, 'jobs/old.json', { source: { expressionId: '999' }, workflow: { status: 'failed' } });
  assert.equal(decide(f).status, 'controller_no_unique_ready_expression');
});
test('controller refuses unaccounted publication and invalid receipts', t => {
  const f = fixture(t);
  f.history.media.push({ id: 'ig', timestamp: '2026-09-04T01:00:00Z', media_type: 'CAROUSEL_ALBUM', caption: 'Another lesson', permalink: 'https://www.instagram.com/p/x/' });
  assert.equal(decide(f).status, 'controller_unreconciled_instagram_publication');
  write(f.root, 'operations/revenue-experiment/language-cafe-14d-2026-09-04/publisher-receipts/r.json', { finalStatus: 'published_learning_pair_exactly_once', instagram: { mediaId: 'fake' } });
  assert.equal(decide(f).status, 'controller_receipt_readback_mismatch');
});
function receipt(f, id, date) {
  const link = `https://www.instagram.com/p/${id}/`;
  f.history.media.push({ id, timestamp: date, media_type: 'CAROUSEL_ALBUM', caption: id, permalink: link });
  write(f.root, `operations/revenue-experiment/language-cafe-14d-2026-09-04/publisher-receipts/${id}.json`, { finalStatus: 'threads_companion_published_for_existing_instagram_exactly_once', instagram: { mediaId: id, permalink: link }, reelActionCount: 0, threadsExternalLinkCount: 1, threadsLinkTargetType: 'source_instagram_permalink', threadsLinkTarget: link });
}
test('controller counts legacy paired receipt using fresh official ID and permalink and enforces cadence', t => {
  const f = fixture(t); receipt(f, 'one', '2026-09-04T01:00:00Z');
  assert.equal(decide(f).control.publishing.publishedCount, 1);
  receipt(f, 'two', '2026-09-10T01:00:00Z');
  assert.equal(decide(f).status, 'controller_cadence_not_due');
  receipt(f, 'three', '2026-09-08T01:00:00Z');
  assert.equal(decide(f).status, 'controller_rolling_14d_cap');
});
test('controller rejects used action IDs and preserves remaining 14-day cap across cycle boundary', t => {
  const f = fixture(t);
  f.ledger.actions.push({ actionId: 'cloud-2026-09-11-expression-999' });
  assert.equal(decide(f).status, 'controller_action_already_used');
  f.ledger.actions = []; f.now = new Date('2026-09-18T01:00:00Z'); f.history.checkedAt = f.now.toISOString();
  for (const day of [6, 10, 14]) f.history.media.push({ id: String(day), timestamp: `2026-09-${String(day).padStart(2, '0')}T01:00:00Z`, media_type: 'CAROUSEL_ALBUM', caption: 'old' });
  assert.equal(decide(f).status, 'controller_rolling_14d_cap');
});
test('sheet denial falls back without writing live Sheet state', async t => {
  const f = fixture(t);
  write(f.root, 'content-queue/google-sheet-source.json', { spreadsheetId: 'fixture', sheetName: 'fixture' });
  fs.writeFileSync(path.join(f.root, 'content-queue/korean-conversation-library.csv'), 'id,korean_expression,status,primary_format\n999,테스트,ready,card_carousel\n');
  const result = await library(f.root, async () => ({ ok: false, status: 403 }));
  assert.equal(result.status, 'unavailable_no_access_csv_fallback'); assert.equal(result.writePerformed, false);
});
test('official reader follows only opaque cursors on fixed host and strips token-bearing next URLs', async () => {
  let count = 0;
  const result = await recentMedia({ accessToken: 'private', accountId: '123', graphVersion: 'v23.0' }, async url => {
    assert.equal(url.hostname, 'graph.facebook.com'); count++;
    return { ok: true, json: async () => count === 1 ? { data: [{ id: 'one' }], paging: { next: 'https://evil.invalid/?access_token=private', cursors: { after: 'cursor' } } } : { data: [] } };
  });
  assert.equal(count, 2); assert.equal(result.complete, true); assert.ok(!JSON.stringify(result).includes('private'));
});
