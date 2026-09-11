const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { GitHubState, REPOSITORY } = require('./github-state.cjs');
const { collect, encrypt, decrypt, restore } = require('./state.cjs');
const { evaluate, digest } = require('./gates.cjs');
const { decide, library } = require('./controller.cjs');
const { recentMedia } = require('./official-read.cjs');
const ROOT = path.resolve(__dirname, '..');
const CANONICAL_PARENT = 'C:\\Users\\earth\\OneDrive\\Desktop\\codex';
const RUNTIME = path.win32.join(CANONICAL_PARENT, 'instagram-card-test', 'meaning-switch-series-v1');
const CONTROL = path.win32.join(CANONICAL_PARENT, 'Koreanstudy_studio', 'my-app', 'docs', 'revenue-operations', 'current-test.json');
const RESULTS = path.join(ROOT, 'cloud/results');
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); }
function output(key, value) { if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`); }
function summarize(result) {
  write(path.join(RESULTS, 'preflight.json'), result);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `## Language Cafe cloud publisher\n\nStatus: **${result.status}**\n\n${(result.errors || []).map(e => '- ' + e).join('\n')}\n\nMissing repository secrets: ${(result.missingSecrets || []).join(', ') || 'none'}.\n\nControl date: ${result.sourceDate || 'unavailable'}. Post due: ${result.postDue === true}.\n\nController: ${result.controllerStatus}. Social writes during preparation: 0. New Reels: 0.\nA successful infrastructure check does not mean a social post was published.\n`);
  console.log(JSON.stringify(result));
}
function hostedOnly() {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_REPOSITORY !== REPOSITORY || process.platform !== 'win32') {
    throw new Error('Cloud runner commands require the designated GitHub-hosted Windows repository context');
  }
  if (process.env.GITHUB_REF !== 'refs/heads/main') throw new Error('Only main may run the publisher');
}
async function prepare() {
  hostedOnly();
  const stateApi = new GitHubState(process.env.GH_TOKEN);
  const remote = await stateApi.read();
  const state = decrypt(remote.encrypted, process.env.LANGUAGE_CAFE_STATE_KEY);
  if (fs.existsSync(RUNTIME)) throw new Error('Canonical runner directory must start absent');
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT }).toString().split('\0').filter(Boolean);
  for (const relative of tracked) {
    if (relative.startsWith('.github/')) continue;
    const target = path.join(RUNTIME, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(path.join(ROOT, relative), target);
  }
  restore(RUNTIME, state);
  const mode = process.env.RUN_MODE || 'publish';
  if (!['preflight', 'controller-preview', 'publish'].includes(mode)) throw Error('Unknown run mode');
  let bytes = fs.readFileSync(path.join(ROOT, 'cloud/control/current-test.json'));
  let decision = null, history = null;
  const policy = JSON.parse(fs.readFileSync(path.join(ROOT, 'cloud/control/policy.json')));
  // The trusted controller is the sole cloud release writer. Preview never claims or publishes.
  if (mode !== 'preflight') {
    history = await recentMedia(process.env.INSTAGRAM_SESSION_JSON);
    write(path.join(RESULTS, 'growth-insights.json'), await require('./growth.cjs').insights(process.env.INSTAGRAM_SESSION_JSON, history));
    const source = await library(RUNTIME);
    decision = decide({ template: JSON.parse(bytes), policy, root: RUNTIME, ledger: remote.ledger, history, rows: source.rows });
    bytes = Buffer.from(JSON.stringify(decision.control, null, 2) + '\n');
    write(path.join(RESULTS, 'controller.json'), { checkedAt: new Date().toISOString(), status: decision.status, sourceStatus: source.status,
      selectedExpression: decision.selected?.koreanExpression || null, postDue: decision.control.publishing.postDue,
      publishedCount: decision.control.publishing.publishedCount, sourceWritePerformed: false, socialWriteCalls: 0 });
    // An ephemeral metadata seed is not a review approval or a social write.
    if (decision.job) {
      write(path.join(RUNTIME, 'jobs', decision.job.id + '.json'), decision.job);
      fs.writeFileSync(path.join(RUNTIME, 'content-queue/korean-conversation-library.csv'), source.csv);
    }
  }
  fs.mkdirSync(path.dirname(CONTROL), { recursive: true }); fs.writeFileSync(CONTROL, bytes);
  fs.mkdirSync(CANONICAL_PARENT, { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'AGENTS.md'), path.join(CANONICAL_PARENT, 'AGENTS.md'));
  fs.copyFileSync(path.join(ROOT, 'cloud/AI_TEAM.md'), path.join(CANONICAL_PARENT, 'AI_TEAM.md'));
  const control = JSON.parse(bytes);
  const gate = evaluate(control, RUNTIME, remote.ledger);
  const missingSecrets = ['OPENAI_API_KEY', 'INSTAGRAM_SESSION_JSON', 'THREADS_SESSION_JSON',
    'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'].filter(name => !process.env[name]?.trim());
  const result = { checkedAt: new Date().toISOString(), mode, status: gate.eligible ? 'eligible' : 'blocked_preflight',
    errors: gate.errors, missingSecrets, sourceDate: control.asOfDate, postDue: control.publishing?.postDue,
    stateFilesRestored: Object.keys(state.files).length, controlSha256: digest(bytes),
    reelActionCount: 0, socialApiCalls: mode === 'preflight' ? 0 : 'read_only_controller', socialWriteCalls: 0,
    controllerStatus: decision?.status || 'not_run', requestedPostId: control.handoff?.requestedPostId || null };
  output('run_agent', 'false');
  if (mode !== 'publish' || !gate.eligible) { summarize(result); return; }
  if (missingSecrets.length) {
    result.status = 'blocked_missing_secrets'; summarize(result); throw new Error('Required cloud secrets are missing');
  }
  const lock = { runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    actionId: control.handoff.actionId, idempotencyKey: control.handoff.idempotencyKey,
    controlSha256: digest(bytes), requestedPostId: control.handoff.requestedPostId,
    claimedAt: new Date().toISOString() };
  write(path.join(RUNTIME, 'operations/cloud-controller/current.json'), control);
  write(path.join(RUNTIME, 'operations/cloud-controller/history.json'), history);
  write(path.join(RUNTIME, 'operations/cloud-controller/policy.json'), policy);
  const claimed = await stateApi.save(remote, { ...remote.ledger, lock,
    actions: [...remote.ledger.actions, lock] }, encrypt(collect(RUNTIME, true), process.env.LANGUAGE_CAFE_STATE_KEY));
  // Do not inject platform credentials until durable claim and readback succeeded.
  write(path.join(RUNTIME, 'cloud-permit.json'), { ...lock, remoteClaimSha: claimed.sha, jobPath: gate.jobPath });
  write(path.join(RESULTS, 'claim.json'), { ...lock, remoteClaimSha: claimed.sha });
  for (const [channel, name] of [['instagram', 'INSTAGRAM_SESSION_JSON'], ['threads', 'THREADS_SESSION_JSON']]) {
    const session = JSON.parse(process.env[name]);
    const mask = value => {
      for (const [field, item] of Object.entries(value)) {
        if (/token|secret|password/i.test(field) && typeof item === 'string') console.log('::add-mask::' + item.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A'));
        else if (item && typeof item === 'object') mask(item);
      }
    };
    mask(session);
    const directories = [path.join(process.env.USERPROFILE, '.codex', channel), `C:\\Users\\earth\\.codex\\${channel}`];
    for (const directory of new Set(directories)) write(path.join(directory, 'session.json'), session);
  }
  summarize({ ...result, status: 'claimed_for_one_learning_pair' });
  output('run_agent', 'true');
}
function verifiedPair(root, control) {
  const file = path.join(root, 'operations/revenue-experiment', control.testId, 'publisher-receipts', control.handoff.actionId + '.json');
  if (!fs.existsSync(file)) return false;
  const receipt = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (receipt.finalStatus !== 'published_learning_pair_exactly_once'
    || receipt.actionId !== control.handoff.actionId || receipt.idempotencyKey !== control.handoff.idempotencyKey
    || receipt.reelActionCount !== 0 || receipt.threadsExternalLinkCount !== 1
    || receipt.threadsLinkTargetType !== 'source_instagram_permalink'
    || receipt.threadsExplicitLinkAttachmentRequested !== false
    || receipt.threadsPlatformPreviewState !== 'unavailable_platform_managed') return false;
  const { jsonFiles } = require('./gates.cjs');
  const jobs = jsonFiles(path.join(root, 'jobs')).map(f => JSON.parse(fs.readFileSync(f, 'utf8')))
    .filter(j => j.id === control.handoff.requestedPostId);
  if (jobs.length !== 1) return false;
  const ig = jobs[0], check = ig.workflow?.postPublishVerification;
  if (check?.status !== 'passed' || check.review !== 'passed'
    || check.source !== 'official_instagram_graph_api_recent_media' || check.mediaIdMatchCount !== 1
    || check.normalizedFullCaptionMatchCount !== 1 || check.sameHangulExpressionMatchCount !== 1
    || check.exactOnePublishedJobConfirmed !== true || check.mediaType !== 'CAROUSEL_ALBUM'
    || !check.matchedMediaId || ig.published?.mediaId !== check.matchedMediaId
    || ig.published?.verification?.id !== check.matchedMediaId
    || ig.published?.verification?.permalink !== check.permalink
    || receipt.instagram?.mediaId !== check.matchedMediaId || receipt.threadsLinkTarget !== check.permalink) return false;
  const threads = jsonFiles(path.join(root, 'content-queue/threads/jobs'))
    .map(f => JSON.parse(fs.readFileSync(f, 'utf8')))
    .filter(j => j.controlBinding?.actionId === control.handoff.actionId && j.workflow?.status === 'published');
  if (threads.length !== 1) return false;
  const thread = threads[0];
  const tv = thread.published?.verification;
  return !!(tv && tv.review === 'passed' && tv.mediaIdMatchCount === 1 && tv.normalizedFullTextMatchCount === 1
    && receipt.threads?.mediaId && thread.published?.mediaId === receipt.threads.mediaId
    && tv.id === receipt.threads.mediaId && tv.threadsLinkTarget === check.permalink
    && thread.controlBinding?.sourceLinkTarget === check.permalink);
}
async function finalize() {
  hostedOnly();
  const claimFile = path.join(RESULTS, 'claim.json');
  if (!fs.existsSync(claimFile)) return;
  const claim = JSON.parse(fs.readFileSync(claimFile, 'utf8'));
  const api = new GitHubState(process.env.GH_TOKEN);
  const remote = await api.read();
  if (remote.sha !== claim.remoteClaimSha || remote.ledger.lock?.runId !== process.env.GITHUB_RUN_ID) throw new Error('Claim ownership changed');
  const controlBytes = fs.readFileSync(CONTROL);
  const unchanged = digest(controlBytes) === claim.controlSha256;
  let success = unchanged && process.env.AGENT_OUTCOME === 'success' && verifiedPair(RUNTIME, JSON.parse(controlBytes));
  if (success) {
    try { success = await require('./live-verification.cjs').verifyLivePair(RUNTIME, JSON.parse(controlBytes)); }
    catch { success = false; }
  }
  let story = { status: 'story_skipped_pair_not_verified' };
  if (success) {
    try { story = await require('./growth.cjs').runStory(RUNTIME, JSON.parse(controlBytes)); }
    catch { story = { status: 'story_blocked_validation_or_network' }; }
  }
  write(path.join(RESULTS, 'story.json'), story);
  const encrypted = encrypt(collect(RUNTIME, true), process.env.LANGUAGE_CAFE_STATE_KEY);
  const ledger = { ...remote.ledger, lock: success ? null : { ...remote.ledger.lock, status: 'needs_official_readback' },
    lastRun: { runId: process.env.GITHUB_RUN_ID, completedAt: new Date().toISOString(),
      status: success ? 'published_learning_pair_exactly_once' : 'blocked_ambiguous_or_incomplete', storyStatus: story.status } };
  await api.save(remote, ledger, encrypted);
  write(path.join(RESULTS, 'checkpoint.json'), ledger.lastRun);
  console.log(JSON.stringify(ledger.lastRun));
  if (!success) throw new Error('Encrypted checkpoint saved; cloud lock retained until review. No automatic retry.');
}
if (require.main === module) {
  const command = process.argv[2];
  Promise.resolve().then(() => command === 'prepare' ? prepare() : command === 'finalize' ? finalize() : Promise.reject(new Error('Unknown runner command')))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { verifiedPair };
