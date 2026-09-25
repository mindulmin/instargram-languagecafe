"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { isDeepStrictEqual } = require("node:util");
const state = require("./channel-split-v3-state.cjs");
const { V3RemoteState } = require("./channel-split-v3-remote.cjs");
const { encrypt } = require("./state.cjs");
const { parseArgs, preview, execute } = require("./close-v3-threads-36141543126.cjs");

const PIN = state.THREADS_RECOVERY;
const NOW = "2026-09-25T14:00:00.000Z";
const JOB_PATH = `content-queue/threads/jobs/${PIN.jobId}.json`;
const GRANT_PATH = `cloud/control/channel-split-v3-grants/${PIN.jobId}.json`;
const KEY = "a".repeat(64);
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort()
    .map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
const digest = value => sha(Buffer.from(stable(value)));
const bytes = relative => fs.readFileSync(path.join(__dirname, "..", relative));
function fixture() {
  // The queued job is retired on current main; reconstruct the pinned run's
  // original LF JSON bytes exactly without requiring shallow CI to fetch it.
  const currentJob = JSON.parse(bytes(JOB_PATH).toString("utf8"));
  const originalJob = structuredClone(currentJob);
  originalJob.workflow.status = "approved";
  originalJob.workflow.autoPublish = true;
  const jobBytes = Buffer.from(`${JSON.stringify(originalJob, null, 2)}\n`);
  const grantBytes = bytes(GRANT_PATH);
  assert.equal(sha(jobBytes), PIN.jobSha256);
  assert.equal(sha(grantBytes), PIN.grantSha256);
  const job = JSON.parse(jobBytes.toString("utf8"));
  const action = { schemaVersion: 1, strategyVersion: "channel-split-v3", channel: "threads",
    action: "publish_one_threads_carousel", actionId: PIN.actionId, jobId: PIN.jobId,
    jobPath: JOB_PATH, jobSha256: PIN.jobSha256, contentSha256: digest(job.content),
    grantSha256: PIN.grantSha256, reviewer: "independent_editorial_controller_v1",
    copySha256: PIN.copySha256, assets: job.content.images.map(({ url, sha256, altText }) => ({ url, sha256, altText })),
    accountId: PIN.accountId, runId: PIN.runId, runAttempt: "1",
    issuedAt: "2026-09-25T13:32:40.673Z", validUntil: "2026-09-25T13:57:40.673Z",
    originStateSha: PIN.originStateSha };
  action.claimHash = digest(action);
  assert.equal(action.claimHash, PIN.claimHash);
  const lock = { actionId: PIN.actionId, claimHash: PIN.claimHash,
    stage: "child_create_attempted", createAttempts: 4, publishAttempts: 0,
    containerId: null, childContainerIds: [...PIN.childContainerIds], pendingChildIndex: 3 };
  const v3 = { schemaVersion: 1, strategyVersion: "channel-split-v3",
    locks: { instagram: null, threads: lock }, actions: [action], receipts: [], audit: [] };
  const audit = { sequence: 1, previousHash: null, at: action.issuedAt,
    kind: "threads_child_create_intent", channel: "threads", actionId: PIN.actionId,
    childIndex: 3, assetSha256: action.assets[3].sha256,
    stateHash: digest({ locks: v3.locks, actions: v3.actions, receipts: v3.receipts }) };
  audit.hash = digest(audit);
  v3.audit.push(audit);
  const ledger = { version: 1, lock: null, actions: [{ actionId: "historical-v2" }],
    receipts: [{ actionId: "historical-v2" }], lastRun: { status: "preserved" }, channelSplitV3: v3 };
  state.checkedLedger(ledger);
  const retiredJob = structuredClone(job);
  retiredJob.workflow = { ...retiredJob.workflow, status: "blocked", autoPublish: false };
  const evidence = { jobBytes, grantBytes, retiredJobBytes: Buffer.from(JSON.stringify(retiredJob)),
    retiredPolicyBytes: Buffer.from(JSON.stringify({ strategyVersion: "channel-split-v3",
      channels: { threads: { enabled: false } } })), retiredMainSha: "b".repeat(40),
    failedRun: { id: Number(PIN.runId), status: "completed", conclusion: "failure",
      head_sha: PIN.runHeadSha, run_attempt: 1, head_branch: "main",
      path: ".github/workflows/channel-split-v3-publisher.yml", event: "workflow_dispatch",
      repository: { full_name: "mindulmin/instargram-languagecafe" }, updated_at: "2026-09-25T13:34:57Z" },
    officialHistory: { source: "official_threads_graph_api_full_history", complete: true,
      accountId: PIN.accountId, username: "mindulmin",
      identityCheckedAt: "2026-09-25T13:59:50Z", checkedAt: "2026-09-25T13:59:53Z",
      media: [{ id: "123456789012345", text: "A different old lesson", media_type: "TEXT_POST",
        timestamp: "2026-09-11T08:32:47+0000" },
      { id: "123456789012346", media_type: "VIDEO", timestamp: "2026-09-10T08:32:47+0000" }] },
    knownChildren: PIN.childContainerIds.map(id => ({ id, status: "FINISHED",
      checkedAt: "2026-09-25T13:59:58Z" })) };
  return { ledger, evidence, job };
}
function runPure(f = fixture()) {
  return state.abandonThreads36141543126({ ledger: f.ledger,
    expectedRemoteStateSha: "c".repeat(40), observedRemoteStateSha: "c".repeat(40),
    ...f.evidence, at: NOW });
}

test("only the pinned pre-publish Threads incident becomes a terminal non-published receipt", () => {
  const f = fixture(), original = structuredClone(f.ledger), result = runPure(f);
  assert.equal(result.receipt.status, "abandoned_before_publish_intent");
  assert.equal(result.receipt.publishAttempts, 0);
  assert.equal(result.receipt.unknownFourthChildMayExist, true);
  assert.equal(result.receipt.originalAttemptRetryAuthorized, false);
  assert.equal(result.ledger.channelSplitV3.locks.threads, null);
  assert.deepEqual(result.ledger.channelSplitV3.actions, original.channelSplitV3.actions);
  assert.deepEqual(result.ledger.actions, original.actions);
  assert.deepEqual(result.ledger.receipts, original.receipts);
  assert.deepEqual(result.ledger.lastRun, original.lastRun);
  assert.deepEqual(result.ledger.channelSplitV3.audit[0], original.channelSplitV3.audit[0]);
  state.checkedLedger(result.ledger);
  assert.throws(() => state.abandonThreads36141543126({ ledger: result.ledger,
    expectedRemoteStateSha: "e".repeat(40), observedRemoteStateSha: "e".repeat(40),
    ...f.evidence, at: NOW }), /v3_state_incident_checkpoint_changed/);
  assert.equal(isDeepStrictEqual(f.ledger, original), true);
});

test("every state, run, source, retirement, official-history and child drift fails closed", () => {
  const mutations = [
    f => { f.ledger.channelSplitV3.locks.threads.pendingChildIndex = 4; },
    f => { f.ledger.channelSplitV3.locks.threads.publishAttempts = 1; },
    f => { f.ledger.channelSplitV3.locks.threads.containerId = "987"; },
    f => { f.ledger.channelSplitV3.locks.threads.childContainerIds[0] = "987"; },
    f => { f.evidence.failedRun.status = "in_progress"; },
    f => { f.evidence.failedRun.head_sha = "0".repeat(40); },
    f => { f.evidence.jobBytes = Buffer.from("changed"); },
    f => { f.evidence.grantBytes = Buffer.from("changed"); },
    f => { const j = JSON.parse(f.evidence.retiredJobBytes); j.workflow.status = "approved";
      f.evidence.retiredJobBytes = Buffer.from(JSON.stringify(j)); },
    f => { const p = JSON.parse(f.evidence.retiredPolicyBytes); p.channels.threads.enabled = true;
      f.evidence.retiredPolicyBytes = Buffer.from(JSON.stringify(p)); },
    f => { f.evidence.officialHistory.complete = false; },
    f => { f.evidence.officialHistory.checkedAt = "2026-09-25T13:40:00Z"; },
    f => { f.evidence.officialHistory.media[0].text = f.job.content.text; },
    f => { f.evidence.officialHistory.media[0].text = `Old ${PIN.targetExpression}`; },
    f => { f.evidence.officialHistory.media[0].timestamp = "2026-09-25T13:33:00Z"; },
    f => { f.evidence.knownChildren[1].status = "PUBLISHED"; },
    f => { f.evidence.knownChildren[2].id = "999"; }
  ];
  for (const mutate of mutations) {
    const f = fixture(); mutate(f);
    assert.throws(() => runPure(f), /v3_state_/);
  }
});

class FakeStore {
  constructor(ledger) {
    this.current = { sha: "c".repeat(40), tree: "d".repeat(40), ledger,
      encrypted: encrypt({ version: 1, files: { "jobs/v2.json": Buffer.from("preserved").toString("base64") } }, KEY) };
    this.saves = 0; this.reads = 0;
  }
  async read() {
    this.reads += 1;
    return { ...structuredClone(this.current), encrypted: Buffer.from(this.current.encrypted),
      branch: "cloud-state", repository: "mindulmin/instargram-languagecafe" };
  }
  async save(previous, ledger, encrypted) {
    this.saves += 1;
    if (previous.sha !== this.current.sha) throw new Error("conflict");
    this.current = { sha: "e".repeat(40), tree: "f".repeat(40), ledger,
      encrypted: Buffer.from(encrypted) };
    return { ...structuredClone(this.current), encrypted: Buffer.from(this.current.encrypted) };
  }
}
test("remote recovery uses one CAS and independent encrypted-state readback", async () => {
  const f = fixture(), store = new FakeStore(f.ledger);
  const remote = new V3RemoteState({ githubState: store, stateKey: KEY });
  const expected = runPure(f);
  const result = await remote.abandonThreads36141543126({ expectedSha: "c".repeat(40),
    ...f.evidence, at: NOW });
  assert.equal(result.sha, "e".repeat(40));
  assert.deepEqual(result.receipt, expected.receipt);
  assert.equal(store.saves, 1);
  assert.equal(store.reads, 2);
  assert.deepEqual(store.current.ledger, expected.ledger);
  await assert.rejects(remote.abandonThreads36141543126({ expectedSha: result.sha,
    ...f.evidence, at: NOW }), /v3_state_incident_checkpoint_changed/);
  assert.equal(store.saves, 1);
});

test("CLI defaults to read-only and cannot turn malformed flags into apply", () => {
  assert.deepEqual(parseArgs([]), { apply: false });
  assert.deepEqual(parseArgs(["--apply"]), { apply: true });
  for (const argv of [["publish"], ["--apply", "--force"], ["--retry"]]) {
    assert.throws(() => parseArgs(argv), /usage_dry_run_or_apply_only/);
  }
});

test("read-only operator preview obtains pinned original source and current main retirement without writes", async () => {
  const f = fixture();
  const retired = JSON.parse(f.evidence.retiredJobBytes);
  const files = {
    [`${JOB_PATH}@${PIN.runHeadSha}`]: f.evidence.jobBytes,
    [`${GRANT_PATH}@${PIN.runHeadSha}`]: f.evidence.grantBytes,
    [`${JOB_PATH}@${f.evidence.retiredMainSha}`]: Buffer.from(JSON.stringify(retired)),
    [`cloud/control/channel-split-v3-policy.json@${f.evidence.retiredMainSha}`]: f.evidence.retiredPolicyBytes
  };
  const github = { async api(route) {
    if (route === `actions/runs/${PIN.runId}`) return f.evidence.failedRun;
    if (route === "git/ref/heads/main") return { ref: "refs/heads/main",
      object: { type: "commit", sha: f.evidence.retiredMainSha } };
    const match = /^contents\/(.+)\?ref=([a-f0-9]{40})$/u.exec(route);
    if (!match || !files[`${match[1]}@${match[2]}`]) throw new Error("unexpected GitHub read");
    return { path: match[1], encoding: "base64", content: files[`${match[1]}@${match[2]}`].toString("base64") };
  } };
  let writes = 0;
  const remote = { async readVerified() { return { sha: "c".repeat(40), ledger: structuredClone(f.ledger) }; },
    async abandonThreads36141543126() { writes += 1; throw new Error("unexpected write"); } };
  const threadsApi = {
    async getIdentity() { return { id: PIN.accountId, username: "mindulmin" }; },
    async listRecentPosts() { return f.evidence.officialHistory.media; },
    async getContainerStatus(_session, id) { return { id, status: "FINISHED" }; }
  };
  const result = await execute({ remote, github, threadsApi, apply: false,
    clock: () => new Date(NOW), readSession: () => ({ userId: PIN.accountId, username: "mindulmin",
      accessToken: "synthetic", expiresAt: "2026-10-01T00:00:00Z",
      scopes: ["threads_basic", "threads_content_publish"] }) });
  assert.equal(result.status, "preview_passed_no_write");
  assert.equal(result.cloudStateWriteCalls, 0);
  assert.equal(result.socialApiWriteCalls, 0);
  assert.equal(writes, 0);
});
