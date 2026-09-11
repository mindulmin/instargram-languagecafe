const fs = require('node:fs');
const path = require('node:path');
const { parseLibrary, selectDailyExpression } = require('../content-queue/daily-content-selector.cjs');
const { normalizeExpression } = require('../publish-safety.cjs');
const DAY = 86400000;
const acceptedStatuses = new Set(['published_learning_pair_exactly_once', 'instagram_published_threads_blocked', 'threads_companion_published_for_existing_instagram_exactly_once']);
const kst = now => new Date(+now + 9 * 3600000).toISOString().slice(0, 10);
function jsonFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? jsonFiles(path.join(dir, e.name)) : e.name.endsWith('.json') ? [path.join(dir, e.name)] : []);
}
function acceptedReceipts(root, testId) {
  return jsonFiles(path.join(root, 'operations/revenue-experiment', testId, 'publisher-receipts')).map(f => JSON.parse(fs.readFileSync(f))).filter(r => acceptedStatuses.has(r.finalStatus));
}
async function library(root, request = fetch) {
  const saved = fs.readFileSync(path.join(root, 'content-queue/korean-conversation-library.csv'), 'utf8');
  const config = JSON.parse(fs.readFileSync(path.join(root, 'content-queue/google-sheet-source.json')));
  if (!/^[A-Za-z0-9_-]+$/.test(config.spreadsheetId || '')) throw Error('sheet_config_invalid');
  const url = `https://docs.google.com/spreadsheets/d/${config.spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(config.sheetName)}`;
  try {
    const r = await request(url, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw Error('sheet_unavailable');
    const csv = await r.text();
    if (!/^\s*"?id"?,/.test(csv) || !csv.includes('korean_expression')) throw Error('sheet_response_invalid');
    const rows = parseLibrary(csv);
    if (!rows.length || rows.some(r => !r.id || !r.koreanExpression)) throw Error('sheet_rows_invalid');
    return { csv, rows, status: 'official_sheet_read', writePerformed: false };
  } catch {
    return { csv: saved, rows: parseLibrary(saved), status: 'unavailable_no_access_csv_fallback', writePerformed: false };
  }
}
function decide({ template, policy, root, ledger, history, rows, now = new Date() }) {
  const date = kst(now), c = structuredClone(template);
  const stop = reason => ({ status: reason, control: c, selected: null });
  c.asOfDate = date;
  c.handoff = { ...c.handoff, consumerAction: 'stop', actionId: null, idempotencyKey: null, issuedAt: null, validUntil: null, requestedPostId: null, targetExpression: null, mayCreateMedia: false, mayPublish: false };
  c.publishing = { ...c.publishing, status: 'blocked_content', postDue: false };
  if (policy.version !== 1 || policy.enabled !== true || policy.maxPosts !== 3 || !Number.isFinite(policy.minimumGapHours) || policy.minimumGapHours < 72 || !Number.isFinite(policy.releaseHours) || policy.releaseHours < 1 || policy.releaseHours > 3) return stop('controller_policy_invalid_or_disabled');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(policy.startsOn) || date < policy.startsOn) return stop('controller_not_started');
  if (!ledger || ledger.version !== 1 || !Array.isArray(ledger.actions) || ledger.lock) return stop('controller_state_locked_or_invalid');
  if (history?.source !== 'official_instagram_graph_api_recent_media' || history.complete !== true || !Array.isArray(history.media)
    || !Number.isFinite(Date.parse(history.checkedAt)) || +now - Date.parse(history.checkedAt) > 300000 || Date.parse(history.checkedAt) > +now + 30000) return stop('controller_official_history_unavailable');
  const start = Date.parse(`${policy.startsOn}T00:00:00+09:00`);
  const cycle = Math.floor((Date.parse(`${date}T00:00:00+09:00`) - start) / (14 * DAY));
  const first = new Date(start + cycle * 14 * DAY);
  c.testId = `language-cafe-14d-${kst(first)}`;
  c.period = { day1: kst(first), day8: kst(new Date(+first + 7 * DAY)), day14: kst(new Date(+first + 13 * DAY)) };
  const published = history.media.filter(m => m.media_type === 'CAROUSEL_ALBUM');
  if (published.some(m => !m.id || !Number.isFinite(Date.parse(m.timestamp)))) return stop('controller_media_evidence_invalid');
  const receipts = acceptedReceipts(root, c.testId);
  const ids = receipts.map(r => r.instagram?.mediaId);
  if (ids.some(id => !id) || new Set(ids).size !== ids.length) return stop('controller_receipt_identity_invalid');
  for (const r of receipts) {
    const matches = published.filter(m => m.id === r.instagram.mediaId && m.permalink === r.instagram.permalink && kst(new Date(m.timestamp)) >= c.period.day1 && kst(new Date(m.timestamp)) <= c.period.day14);
    if (matches.length !== 1 || r.reelActionCount !== 0 || r.threadsExternalLinkCount !== 1 || r.threadsLinkTargetType !== 'source_instagram_permalink' || r.threadsLinkTarget !== r.instagram.permalink) return stop('controller_receipt_readback_mismatch');
  }
  c.publishing.publishedCount = receipts.length;
  c.publishing.maxPosts = policy.maxPosts;
  const inCycle = published.filter(m => kst(new Date(m.timestamp)) >= c.period.day1 && kst(new Date(m.timestamp)) <= c.period.day14);
  if (inCycle.length !== receipts.length) return stop('controller_unreconciled_instagram_publication');
  const rolling = published.filter(m => Date.parse(m.timestamp) >= Math.max(start, +now - 14 * DAY));
  if (rolling.length >= policy.maxPosts || receipts.length >= policy.maxPosts) return stop('controller_rolling_14d_cap');
  const last = Math.max(0, ...published.map(m => Date.parse(m.timestamp)));
  if (+now - last < policy.minimumGapHours * 3600000) return stop('controller_cadence_not_due');
  const jobs = jsonFiles(path.join(root, 'jobs')).map(f => JSON.parse(fs.readFileSync(f)));
  // Include all previous attempts, not only successful jobs. No automatic lock recovery.
  const used = new Set(jobs.map(j => String(j.source?.expressionId || '')));
  const captions = [...history.media.map(m => m.caption), ...jobs.map(j => j.instagram?.caption)].map(normalizeExpression);
  const eligible = rows.filter(r => r.status === 'ready' && r.primaryFormat === 'card_carousel' && /^[A-Za-z0-9_-]+$/.test(r.id) && /^[\p{Script=Hangul}\s?!.,]{2,60}$/u.test(r.koreanExpression) && !used.has(String(r.id))
    && !captions.some(text => text.includes(normalizeExpression(r.koreanExpression))));
  if (!eligible.length) return stop('controller_no_unique_ready_expression');
  let inbox = {};
  const inboxFile = path.join(root, 'content-queue/comment-feedback-signals.json');
  if (fs.existsSync(inboxFile)) inbox = JSON.parse(fs.readFileSync(inboxFile));
  const choice = selectDailyExpression({ rows: eligible, dateValue: date, focusExpression: policy.focusExpression || '', inbox, publishedExpressionIds: used });
  const selected = choice.expression;
  const actionId = `cloud-${date}-expression-${selected.id}`;
  if (ledger.actions.some(a => a.actionId === actionId || a.idempotencyKey === actionId)) return stop('controller_action_already_used');
  const jobId = `${date}-expression-${selected.id}-cloud`;
  const endOfDay = Date.parse(`${date}T23:59:59+09:00`);
  Object.assign(c.publishing, { status: 'learning_ready', statusReasonCode: 'fresh_unique_source_authorized_for_production_review', postDue: true, approvalRequired: false, approvalItems: [] });
  Object.assign(c.handoff, { consumerAction: 'publish_one_learning_pair', reason: choice.selectionBasis, actionId, idempotencyKey: actionId, requestedPostId: jobId,
    targetExpression: selected.koreanExpression, issuedAt: now.toISOString(), validUntil: new Date(Math.min(endOfDay, +now + policy.releaseHours * 3600000)).toISOString(), mayCreateMedia: true, mayPublish: true });
  // This authorizes production, NOT a claim of passed copy/visual reviews.
  return { status: 'controller_ready_for_production', control: c, selected, selectionBasis: choice.selectionBasis,
    job: { schemaVersion: 2, id: jobId, title: selected.koreanExpression, series: 'Korean Conversation',
      source: { expressionId: selected.id, expression: selected.koreanExpression, statusAtSelection: 'ready' },
      content: { html: `series/${jobId}/index.html`, copySpec: `series/${jobId}/copy-review-spec.json`, exportsDir: `exports/${jobId}` },
      instagram: { captionLanguages: ['ko', 'en'], caption: '', hashtags: [] }, workflow: { status: 'draft', autoPublish: false } } };
}
module.exports = { decide, library, acceptedReceipts, kst };
