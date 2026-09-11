const fs = require('node:fs');
const path = require('node:path');
const { recentMedia } = require('./official-read.cjs');
const { normalizeCaption, normalizeExpression } = require('../publish-safety.cjs');
const { formatCaption } = require('../carousel-pipeline.cjs');
function matches(job, thread, instagram, threads) {
  const id = job.published?.mediaId, tid = thread.published?.mediaId;
  const text = thread.copy?.primaryPost;
  if (!id || !tid || !job.source?.expression || !text || !Array.isArray(job.instagram?.hashtags)) return false;
  const sameId = instagram.filter(m => m.id === id && m.media_type === 'CAROUSEL_ALBUM' && m.permalink === job.published?.verification?.permalink);
  const sameCaption = instagram.filter(m => m.media_type === 'CAROUSEL_ALBUM' && normalizeCaption(m.caption) === normalizeCaption(formatCaption(job)));
  const sameExpression = instagram.filter(m => m.media_type === 'CAROUSEL_ALBUM' && normalizeExpression(m.caption).includes(normalizeExpression(job.source.expression)));
  const sameThreadId = threads.filter(m => m.id === tid);
  const sameText = threads.filter(m => normalizeCaption(m.text) === normalizeCaption(text));
  return sameId.length === 1 && sameCaption.length === 1 && sameCaption[0].id === id && sameExpression.length === 1 && sameExpression[0].id === id
    && sameThreadId.length === 1 && sameText.length === 1 && sameText[0].id === tid;
}
async function verifyLivePair(root, control) {
  const { jsonFiles } = require('./gates.cjs');
  const permit = JSON.parse(fs.readFileSync(path.join(root, 'cloud-permit.json')));
  const job = JSON.parse(fs.readFileSync(path.join(root, permit.jobPath)));
  const jobs = jsonFiles(path.join(root, 'content-queue/threads/jobs')).map(f => JSON.parse(fs.readFileSync(f))).filter(j => j.controlBinding?.actionId === control.handoff.actionId && j.workflow?.status === 'published');
  if (jobs.length !== 1) return false;
  const ig = await recentMedia(fs.readFileSync('C:/Users/earth/.codex/instagram/session.json', 'utf8'));
  const s = JSON.parse(fs.readFileSync('C:/Users/earth/.codex/threads/session.json'));
  const id = s.userId || s.user_id || s.threadsUserId, token = s.accessToken || s.access_token || s.threadsAccessToken;
  if (!/^\d+$/.test(id || '') || !token) return false;
  const threads = []; let after;
  for (let page = 0; page < 10; page++) {
    const url = new URL(`https://graph.threads.net/v1.0/${id}/threads`);
    for (const [key, value] of Object.entries({ fields: 'id,text,permalink,timestamp', limit: '100', access_token: token, ...(after ? { after } : {}) })) url.searchParams.set(key, value);
    const r = await fetch(url, { signal: AbortSignal.timeout(20000), redirect: 'error' }), j = await r.json();
    if (!r.ok || !Array.isArray(j.data)) return false;
    threads.push(...j.data);
    if (!j.paging?.next) return matches(job, jobs[0], ig.media, threads);
    if (!j.paging?.cursors?.after || after === j.paging.cursors.after) return false;
    after = j.paging.cursors.after;
  }
  return false;
}
module.exports = { matches, verifyLivePair };
