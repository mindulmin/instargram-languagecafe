#!/usr/bin/env node
"use strict";

// Operator-only, one-incident closure. GET requests only on GitHub and Meta;
// --apply writes one cloud-state CAS. It never creates or publishes a post.
const cp = require("node:child_process");
const fs = require("node:fs");
const { isDeepStrictEqual } = require("node:util");
const { GitHubState } = require("./github-state.cjs");
const { V3RemoteState } = require("./channel-split-v3-remote.cjs");
const state = require("./channel-split-v3-state.cjs");
const threads = require("../content-queue/threads/publish-threads-carousel.cjs");

const PIN = state.THREADS_RECOVERY;
const JOB_PATH = `content-queue/threads/jobs/${PIN.jobId}.json`;
const GRANT_PATH = `cloud/control/channel-split-v3-grants/${PIN.jobId}.json`;
const POLICY_PATH = "cloud/control/channel-split-v3-policy.json";
function fail(code) { throw new Error(`v3_threads_36141543126_${code}`); }
function parseArgs(argv) {
  if (argv.length === 0) return { apply: false };
  if (argv.length === 1 && argv[0] === "--apply") return { apply: true };
  fail("usage_dry_run_or_apply_only");
}
function pinnedCheckpoint(ledger) {
  const v3 = state.checkedLedger(ledger);
  const action = v3.actions.find(item => item.actionId === PIN.actionId);
  const lock = v3.locks.threads;
  if (action?.claimHash !== PIN.claimHash || action?.jobSha256 !== PIN.jobSha256
    || action?.grantSha256 !== PIN.grantSha256 || action?.originStateSha !== PIN.originStateSha
    || lock?.actionId !== PIN.actionId || lock?.claimHash !== PIN.claimHash
    || lock?.stage !== "child_create_attempted" || lock?.pendingChildIndex !== 3
    || lock?.publishAttempts !== 0 || lock?.createAttempts !== 4 || lock?.containerId !== null
    || !isDeepStrictEqual(lock?.childContainerIds, PIN.childContainerIds)) fail("checkpoint_changed");
}
async function sourceBytes(github, path, ref) {
  const blob = await github.api(`contents/${path}?ref=${encodeURIComponent(ref)}`);
  if (blob?.path !== path || blob?.encoding !== "base64" || typeof blob.content !== "string"
    || blob.content.length > 2_000_000) fail("source_blob_unavailable");
  const bytes = Buffer.from(blob.content.replace(/\s+/gu, ""), "base64");
  if (!bytes.length || bytes.length > 1024 * 1024) fail("source_blob_invalid");
  return bytes;
}
async function readGitHubEvidence(github) {
  const failedRun = await github.api(`actions/runs/${PIN.runId}`);
  if (String(failedRun?.id) !== PIN.runId || failedRun?.head_sha !== PIN.runHeadSha
    || failedRun?.status !== "completed" || failedRun?.conclusion !== "failure") fail("run_changed");
  const mainRef = await github.api("git/ref/heads/main");
  if (mainRef?.ref !== "refs/heads/main" || mainRef?.object?.type !== "commit"
    || !/^[a-f0-9]{40}$/u.test(mainRef.object.sha || "")) fail("main_unavailable");
  const retiredMainSha = mainRef.object.sha;
  const [jobBytes, grantBytes, retiredJobBytes, retiredPolicyBytes] = await Promise.all([
    sourceBytes(github, JOB_PATH, PIN.runHeadSha),
    sourceBytes(github, GRANT_PATH, PIN.runHeadSha),
    sourceBytes(github, JOB_PATH, retiredMainSha),
    sourceBytes(github, POLICY_PATH, retiredMainSha)
  ]);
  return { failedRun, retiredMainSha, jobBytes, grantBytes, retiredJobBytes, retiredPolicyBytes };
}
async function readOfficialEvidence({ readSession, threadsApi, clock }) {
  const session = threads.sessionValues(await readSession(), clock);
  if (session.userId !== PIN.accountId) fail("account_mismatch");
  const identity = await threadsApi.getIdentity(session);
  if (String(identity?.id) !== PIN.accountId || identity?.username !== "mindulmin") fail("identity_mismatch");
  const identityCheckedAt = clock().toISOString();
  // The publisher API follows every paging cursor and throws if a page is
  // missing. A one-page `limit=100` result is not assumed complete.
  const media = await threadsApi.listRecentPosts(session);
  const officialHistory = { source: "official_threads_graph_api_full_history", complete: true,
    accountId: PIN.accountId, username: identity.username, identityCheckedAt,
    checkedAt: clock().toISOString(), media };
  const knownChildren = [];
  for (const id of PIN.childContainerIds) {
    const item = await threadsApi.getContainerStatus(session, id);
    knownChildren.push({ id: String(item?.id || ""), status: item?.status,
      checkedAt: clock().toISOString() });
  }
  return { officialHistory, knownChildren };
}
function preview({ snapshot, evidence, at }) {
  return state.abandonThreads36141543126({ ledger: snapshot.ledger,
    expectedRemoteStateSha: snapshot.sha, observedRemoteStateSha: snapshot.sha,
    ...evidence, at });
}
async function execute({ apply = false, remote, github, readSession, threadsApi,
  clock = () => new Date() } = {}) {
  if (!remote || typeof remote.readVerified !== "function" || !github
    || typeof github.api !== "function" || typeof readSession !== "function"
    || !threadsApi || typeof threadsApi.getIdentity !== "function"
    || typeof threadsApi.listRecentPosts !== "function"
    || typeof threadsApi.getContainerStatus !== "function") fail("dependencies_invalid");
  const original = await remote.readVerified();
  pinnedCheckpoint(original.ledger);
  const gather = async () => ({ ...await readGitHubEvidence(github),
    ...await readOfficialEvidence({ readSession, threadsApi, clock }) });
  let evidence = await gather();
  let planned = preview({ snapshot: original, evidence, at: clock().toISOString() });
  if (!apply) return { status: "preview_passed_no_write", actionId: PIN.actionId,
    remoteStateSha: original.sha, retiredMainSha: evidence.retiredMainSha,
    officialHistorySha256: planned.receipt.officialHistorySha256,
    knownChildrenSha256: planned.receipt.knownChildrenSha256,
    unknownFourthChildMayExist: true, socialApiWriteCalls: 0, cloudStateWriteCalls: 0,
    originalAttemptRetryAuthorized: false };
  // Refresh every external proof immediately before one non-forced state CAS.
  const before = await remote.readVerified();
  if (before.sha !== original.sha || !isDeepStrictEqual(before.ledger, original.ledger)) fail("remote_changed_before_apply");
  evidence = await gather();
  if (evidence.retiredMainSha !== planned.receipt.retiredMainSha) fail("main_changed_before_apply");
  planned = preview({ snapshot: before, evidence, at: clock().toISOString() });
  const finalMain = await github.api("git/ref/heads/main");
  if (finalMain?.object?.sha !== evidence.retiredMainSha) fail("main_changed_before_cas");
  const saved = await remote.abandonThreads36141543126({ expectedSha: before.sha,
    ...evidence, at: planned.receipt.closedAt });
  const reread = await remote.readVerified();
  const commit = await github.api(`git/commits/${saved.sha}`);
  if (reread.sha !== saved.sha || !isDeepStrictEqual(reread.ledger, planned.ledger)
    || !isDeepStrictEqual(saved.receipt, planned.receipt)
    || commit?.sha !== saved.sha || commit?.parents?.length !== 1
    || commit.parents[0]?.sha !== before.sha) fail("independent_cas_readback_mismatch");
  return { status: "abandoned_before_publish_intent_verified", actionId: PIN.actionId,
    oldRemoteStateSha: before.sha, newRemoteStateSha: saved.sha,
    retiredMainSha: evidence.retiredMainSha,
    officialHistorySha256: saved.receipt.officialHistorySha256,
    knownChildrenSha256: saved.receipt.knownChildrenSha256,
    unknownFourthChildMayExist: true, originalAttemptRetryAuthorized: false,
    socialApiWriteCalls: 0, cloudStateWriteCalls: 1 };
}
function githubToken() {
  const result = cp.spawnSync("git", ["credential", "fill"],
    { input: "protocol=https\nhost=github.com\n\n", encoding: "utf8", timeout: 15000, windowsHide: true });
  const token = result.stdout?.split(/\r?\n/u).find(line => line.startsWith("password="))?.slice(9);
  if (result.status !== 0 || !token) fail("github_credential_unavailable");
  return token;
}
async function runCli(argv = process.argv.slice(2)) {
  const { apply } = parseArgs(argv);
  const token = githubToken();
  const github = new GitHubState(token);
  const remote = new V3RemoteState({ githubState: github,
    stateKey: fs.readFileSync("cloud/local/state.key", "utf8").trim() });
  return execute({ apply, remote, github,
    readSession: () => JSON.parse(fs.readFileSync("C:/Users/earth/.codex/threads/session.json", "utf8")),
    threadsApi: threads.createThreadsApi() });
}
if (require.main === module) {
  runCli().then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => { console.error(/^v3_(?:threads_36141543126|state_|remote_)/u.test(error?.message || "")
      ? error.message : "v3_threads_36141543126_unavailable"); process.exitCode = 1; });
}
module.exports = { execute, parseArgs, preview, readGitHubEvidence, readOfficialEvidence, runCli };
