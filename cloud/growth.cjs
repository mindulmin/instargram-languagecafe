const fs = require('node:fs');
const path = require('node:path');
const { session, graph } = require('./official-read.cjs');
const { digest } = require('./gates.cjs');

function numericMetric(body, name) {
  const row = body?.data?.find(x => x.name === name);
  const value = row?.total_value?.value ?? row?.values?.[0]?.value;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? { value, status: 'observed' } : { value: null, status: 'unavailable' };
}
async function insights(value, history, request = fetch) {
  const s = session(value), output = [];
  for (const media of [...history.media].filter(m => m.media_type === 'CAROUSEL_ALBUM').sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)).slice(0, 3)) {
    const metrics = {};
    // Individual requests preserve supported metrics when another metric is unavailable.
    for (const metric of ['reach', 'saved', 'shares']) {
      try { metrics[metric] = numericMetric(await graph(s, `${media.id}/insights`, { metric }, request), metric); }
      catch (error) {
        metrics[metric] = { value: null, status: 'unavailable',
          reason: /^instagram_read_failed_http_\d+_code_\d+$/.test(error.message) ? error.message : 'official_read_unavailable' };
      }
    }
    output.push({ mediaId: media.id, permalink: media.permalink, publishedAt: media.timestamp, metrics });
  }
  return { checkedAt: new Date().toISOString(), source: 'official_instagram_media_insights', posts: output, revenue: 'unavailable', attribution: 'engagement_is_not_revenue', writes: 0 };
}
function storyReviewErrors(review, job, bytes, metadata, now = new Date()) {
  const errors = [];
  if (review?.review !== 'passed' || review.sourceMediaId !== job.published?.mediaId || review.sourcePermalink !== job.published?.verification?.permalink) errors.push('story_review_source_mismatch');
  if (review?.jpegSha256 !== digest(bytes) || metadata.width !== 1080 || metadata.height !== 1920 || metadata.format !== 'jpeg') errors.push('story_image_invalid');
  if (review?.recallPromptConfirmed !== true || review.noSalesCopyConfirmed !== true || review.safeAreaConfirmed !== true || typeof review.evidence !== 'string' || review.evidence.length < 40) errors.push('story_review_incomplete');
  const age = +now - Date.parse(review?.reviewedAt);
  if (!Number.isFinite(age) || age < 0 || age > 3 * 3600000) errors.push('story_review_expired');
  return errors;
}
async function publishStoryOnce({ api, imageUrl, persist, sleep = ms => new Promise(r => setTimeout(r, ms)) }) {
  // Persist before each non-idempotent POST; a timeout never authorizes a retry.
  await persist({ status: 'creating_container', createAttempts: 1, publishAttempts: 0 });
  const container = await api('POST', 'media', { media_type: 'STORIES', image_url: imageUrl });
  if (!container.id) throw Error('story_container_id_missing');
  await persist({ status: 'container_created', containerId: container.id });
  let finished = false;
  for (let i = 0; i < 12; i++) {
    const result = await api('GET', container.id, { fields: 'status_code' });
    if (result.status_code === 'FINISHED') { finished = true; break; }
    if (['ERROR', 'EXPIRED'].includes(result.status_code)) throw Error('story_container_failed');
    await sleep(5000);
  }
  if (!finished) throw Error('story_container_timeout');
  await persist({ status: 'publishing', publishAttempts: 1 });
  const published = await api('POST', 'media_publish', { creation_id: container.id });
  if (!published.id) throw Error('story_media_id_missing');
  await persist({ status: 'awaiting_readback', mediaId: published.id });
  for (let i = 0; i < 6; i++) {
    const listing = await api('GET', 'stories', { fields: 'id,media_product_type,timestamp', limit: 100 });
    const matches = listing.data?.filter(m => m.id === published.id && m.media_product_type === 'STORY');
    if (matches?.length === 1) {
      const result = { status: 'published_story_exactly_once', mediaId: published.id, officialMatchCount: 1, checkedAt: new Date().toISOString() };
      await persist(result); return result;
    }
    await sleep(3000);
  }
  throw Error('story_official_readback_unavailable');
}
async function runStory(root, control) {
  const { verifiedPair } = require('./runner.cjs');
  if (!verifiedPair(root, control)) return { status: 'story_skipped_pair_not_verified' };
  const permit = JSON.parse(fs.readFileSync(path.join(root, 'cloud-permit.json')));
  if (permit.controlSha256 !== digest(Buffer.from(JSON.stringify(control, null, 2) + '\n'))) throw Error('story_control_binding_changed');
  const policy = JSON.parse(fs.readFileSync(path.join(root, 'operations/cloud-controller/policy.json')));
  if (policy.storiesEnabled !== true || policy.storyLimitPerPair !== 1) return { status: 'story_disabled' };
  const job = JSON.parse(fs.readFileSync(path.join(root, permit.jobPath)));
  const dir = path.join(root, 'operations/growth', job.id);
  const reviewFile = path.join(dir, 'story-review.json');
  const lockFile = path.join(dir, 'story-lock.json');
  const imageFile = path.join(root, 'exports', job.id, 'story.jpg');
  if (fs.existsSync(lockFile)) return { status: 'story_existing_attempt_not_retried' };
  if (!fs.existsSync(reviewFile) || !fs.existsSync(imageFile)) return { status: 'story_review_ready_missing_asset_or_review' };
  const bytes = fs.readFileSync(imageFile), sharp = require('sharp');
  const errors = storyReviewErrors(JSON.parse(fs.readFileSync(reviewFile)), job, bytes, await sharp(bytes).metadata());
  if (errors.length) return { status: 'story_blocked_review', errors };
  const s = session(JSON.parse(fs.readFileSync('C:/Users/earth/.codex/instagram/session.json')));
  // Independent fresh source readback before hosting or creating the Story.
  const source = await graph(s, job.published.mediaId, { fields: 'id,permalink,media_type' });
  if (source.id !== job.published.mediaId || source.permalink !== job.published.verification.permalink || source.media_type !== 'CAROUSEL_ALBUM') throw Error('story_source_readback_mismatch');
  fs.mkdirSync(dir, { recursive: true });
  let state = { sourceMediaId: source.id, sourcePermalink: source.permalink, imageSha256: digest(bytes), status: 'claimed', createAttempts: 0, publishAttempts: 0 };
  fs.writeFileSync(lockFile, JSON.stringify(state, null, 2), { flag: 'wx' });
  const persist = async patch => { state = { ...state, ...patch }; fs.writeFileSync(lockFile, JSON.stringify(state, null, 2)); };
  try {
    const hosting = require('../public-image-hosting.cjs');
    await persist({ phase: 'hosting_auth_read' });
    await hosting.runWrangler(['whoami']);
    const stage = path.join(root, 'exports', job.id, 'story-site');
    fs.mkdirSync(stage, { recursive: true }); fs.copyFileSync(imageFile, path.join(stage, 'story.jpg'));
    await persist({ phase: 'hosting_deploy' });
    const deployed = await hosting.runWrangler(['pages', 'deploy', stage, '--project-name=language-cafe-instagram-assets', '--branch=main', '--commit-dirty=true'], { cwd: root });
    const base = hosting.parseDeploymentUrl(deployed.combined, 'language-cafe-instagram-assets');
    const imageUrl = `${base.replace(/\/$/, '')}/story.jpg`;
    await persist({ phase: 'hosting_byte_readback' });
    const response = await fetch(imageUrl, { signal: AbortSignal.timeout(20000) });
    if (!response.ok || digest(Buffer.from(await response.arrayBuffer())) !== digest(bytes)) throw Error('story_hosted_bytes_mismatch');
    const api = async (method, object, fields) => {
      if (method === 'GET') return graph(s, object === 'stories' ? `${s.accountId}/stories` : object, fields);
      const body = new URLSearchParams({ ...fields, access_token: s.accessToken });
      const r = await fetch(`https://graph.facebook.com/${s.graphVersion}/${s.accountId}/${object}`, { method: 'POST', body, signal: AbortSignal.timeout(30000) });
      const j = await r.json();
      if (!r.ok || j.error) throw Error(`story_api_http_${r.status}_code_${Number(j.error?.code) || 0}`);
      return j;
    };
    return await publishStoryOnce({ api, imageUrl, persist });
  } catch (error) {
    await persist({ status: 'story_blocked_no_retry', reason: /^story_/.test(error.message) ? error.message : 'story_hosting_or_network_failed' });
    return state;
  }
}
module.exports = { numericMetric, insights, storyReviewErrors, publishStoryOnce, runStory };
