"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs/promises");
const launcher = require("./local-v3-fallback.cjs");

const ROOT = path.resolve(__dirname, "..");
const PROFILE = path.resolve(ROOT, "..", "fake-profile");
const HEAD = "a".repeat(40);
const NOW = new Date("2026-09-25T02:00:00.000Z");

function fakeGit({ status = "", branch = "main", remote = "https://github.com/mindulmin/instargram-languagecafe.git" } = {}) {
  return args => {
    const key = args.join(" ");
    if (key === "rev-parse --show-toplevel") return ROOT;
    if (key === "symbolic-ref --short HEAD") return branch;
    if (key === "remote get-url origin") return remote;
    if (key === "status --porcelain=v1 --untracked-files=all") return status;
    if (key === "rev-parse HEAD" || key === "rev-parse refs/heads/main") return HEAD;
    throw new Error(`unexpected_git_call:${key}`);
  };
}
function fakeIo({ threadsEnabled = false } = {}) {
  const policy = { schemaVersion: 1, strategyVersion: "channel-split-v3", enabled: true,
    channels: { instagram: { enabled: true }, threads: { enabled: threadsEnabled } } };
  return { readFile: async file => {
    const normalized = String(file).replaceAll("\\", "/");
    if (normalized.endsWith("/cloud/local/state.key")) return "b".repeat(64);
    if (normalized.endsWith("/cloud/control/channel-split-v3-policy.json")) return JSON.stringify(policy);
    if (normalized.endsWith("/.codex/instagram/session.json")) return JSON.stringify({
      accountId: "123456789", accessToken: "synthetic", graphVersion: "v25.0",
      selectedAccount: { accountId: "123456789", pageId: "987654321", username: "mindulmin" } });
    if (normalized.endsWith("/.codex/threads/session.json")) return JSON.stringify({
      userId: "123456789", username: "mindulmin", accessToken: "synthetic",
      expiresAt: "2027-01-01T00:00:00Z", scopes: ["threads_basic", "threads_content_publish"] });
    throw new Error("missing_file");
  } };
}
function fakeFetch({ cloudRuns = [], mainSha = HEAD } = {}) {
  return async url => {
    const target = String(url);
    if (target.endsWith("/git/ref/heads/main")) return { ok: true, json: async () => ({
      ref: "refs/heads/main", object: { type: "commit", sha: mainSha } }) };
    if (target.includes("/actions/workflows/channel-split-v3-publisher.yml/runs")) {
      return { ok: true, json: async () => ({ total_count: cloudRuns.length, workflow_runs: cloudRuns }) };
    }
    throw new Error("unexpected_url");
  };
}
function preflightOptions(overrides = {}) {
  return { now: NOW, root: ROOT, userProfile: PROFILE, git: fakeGit(), credential: () => "test-token",
    io: fakeIo(), fetchImpl: fakeFetch(), remoteFactory: () => ({ readVerified: async () => ({
      sha: HEAD, ledger: { version: 1, actions: [], lock: null } }) }), ...overrides };
}

test("defaults to read-only preflight and accepts only an explicit publish flag", () => {
  assert.equal(launcher.parseArgs([]), "preflight");
  assert.equal(launcher.parseArgs(["--preflight"]), "preflight");
  assert.equal(launcher.parseArgs(["--publish"]), "publish");
  assert.throws(() => launcher.parseArgs(["--publish", "--publish"]), /arguments_invalid/u);
});

test("local window begins at 10:35 KST, not at the 90-minute grace boundary", () => {
  assert.deepEqual(launcher.kstWindow(new Date("2026-09-25T01:34:59Z")), {
    day: "20260925", scheduledAt: "2026-09-25T00:00:00.000Z",
    eligible: false, reason: "before_1035_kst" });
  assert.equal(launcher.kstWindow(new Date("2026-09-25T01:35:00Z")).eligible, true);
});

test("full-checkout cleanliness, exact branch, and repository identity are required", () => {
  assert.equal(launcher.assertCleanMain({ root: ROOT, git: fakeGit() }), HEAD);
  assert.throws(() => launcher.assertCleanMain({ root: ROOT, git: fakeGit({ status: "?? draft.txt" }) }),
    /checkout_dirty/u);
  assert.throws(() => launcher.assertCleanMain({ root: ROOT, git: fakeGit({ branch: "feature" }) }),
    /checkout_not_main/u);
  assert.throws(() => launcher.assertCleanMain({ root: ROOT, git: fakeGit({ remote: "https://github.com/other/repo.git" }) }),
    /repository_mismatch/u);
});

test("preflight is eligible only after complete cloud history, current main, and clear remote state", async () => {
  const result = await launcher.preflight(preflightOptions());
  assert.equal(result.status, "eligible");
  assert.equal(result.reason, "cloud_run_missing_after_grace");
  assert.deepEqual(result.enabledChannels, ["instagram"]);
  assert.equal(result.secrets.token, "test-token");
  assert.equal(result.secrets.key, "b".repeat(64));

  const success = { created_at: "2026-09-25T00:01:00Z", head_branch: "main", status: "completed", conclusion: "success" };
  const blocked = await launcher.preflight(preflightOptions({ fetchImpl: fakeFetch({ cloudRuns: [success] }) }));
  assert.equal(blocked.reason, "cloud_run_succeeded");
  await assert.rejects(launcher.preflight(preflightOptions({ fetchImpl: fakeFetch({ mainSha: "c".repeat(40) }) })),
    /checkout_not_current_main/u);
  const invalidRemote = () => ({ readVerified: async () => ({
    sha: HEAD, ledger: { version: 1, actions: [], lock: null,
      channelSplitV3: { schemaVersion: 1, strategyVersion: "channel-split-v3",
        locks: { instagram: null, threads: {} }, actions: [], receipts: [], audit: [] } } }) });
  await assert.rejects(launcher.preflight(preflightOptions({ remoteFactory: invalidRemote })),
    /lock_invalid_or_tampered/u);
  // A malformed remote lock is unavailable authority, never an eligible takeover.
});

test("disabled Threads never requires a local Threads session", async () => {
  const authority = await launcher.readLocalAuthority({ root: ROOT, userProfile: PROFILE, io: fakeIo(), now: NOW });
  assert.deepEqual(authority.enabled, ["instagram"]);
  assert.equal(authority.sessions.threads, undefined);
  const both = await launcher.readLocalAuthority({ root: ROOT, userProfile: PROFILE,
    io: fakeIo({ threadsEnabled: true }), now: NOW });
  assert.deepEqual(both.enabled, ["instagram", "threads"]);
});

test("preflight never marks or launches; publish marks once and stops on the first ambiguous outcome", async () => {
  const result = { status: "eligible", day: "20260925", scheduledAt: "2026-09-25T00:00:00.000Z",
    headSha: HEAD, enabledChannels: ["instagram", "threads"], secrets: { token: "secret" } };
  const events = [];
  const preview = await launcher.runCli([], { preflight: async () => result,
    markOnce: async () => { events.push("marked"); return "1"; },
    runPublisher: () => { events.push("published"); } });
  assert.equal(preview.wouldPublish, false);
  assert.equal(JSON.stringify(preview).includes("secret"), false);
  assert.deepEqual(events, []);

  await assert.rejects(launcher.runCli(["--publish"], { preflight: async () => result,
    markOnce: async () => { events.push("marked"); return "1"; },
    runPublisher: (_result, channel) => { events.push(channel); throw new Error("ambiguous"); } }), /ambiguous/u);
  assert.deepEqual(events, ["marked", "instagram"]);
});

test("one-attempt marker is atomic and a second invocation cannot publish", async () => {
  const directory = await fs.mkdtemp(path.join(require("node:os").tmpdir(), "v3-fallback-test-"));
  try {
    const result = { day: "20260925", scheduledAt: "2026-09-25T00:00:00.000Z",
      headSha: HEAD, enabledChannels: ["instagram"] };
    const runId = await launcher.markOnce(result, { root: directory, now: NOW });
    assert.match(runId, /^[0-9]+$/u);
    await assert.rejects(launcher.markOnce(result, { root: directory, now: NOW }), /already_attempted_today/u);
    const marker = JSON.parse(await fs.readFile(path.join(directory, "cloud", "local",
      "v3-fallback-20260925.attempt.json"), "utf8"));
    assert.equal(marker.runId, runId);
    assert.equal(JSON.stringify(marker).includes("token"), false);
  } finally {
    const relative = path.relative(require("node:os").tmpdir(), directory);
    assert.match(relative, /^v3-fallback-test-[^\\/]+$/u);
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("GCM credential parsing and child environment keep secrets out of output", () => {
  const token = launcher.readGcmToken({ execFile: (_program, args, options) => {
    assert.deepEqual(args, ["credential", "fill"]);
    assert.equal(options.input, "protocol=https\nhost=github.com\n\n");
    assert.equal(options.env.GIT_TERMINAL_PROMPT, "0");
    assert.equal(options.env.GCM_INTERACTIVE, "never");
    return "protocol=https\nhost=github.com\nusername=mindulmin\npassword=private-token\n";
  } });
  assert.equal(token, "private-token");
  const result = { secrets: { token, key: "b".repeat(64),
    sessions: { instagram: "{\"accessToken\":\"ig\"}", threads: "{\"accessToken\":\"threads\"}" } } };
  const env = launcher.childEnvironment(result, "instagram", "123", {
    PATH: "test-path", GITHUB_ACTIONS: "true", GITHUB_RUN_ID: "999", THREADS_ACCESS_TOKEN: "extra" });
  assert.equal(env.INSTAGRAM_SESSION_JSON, result.secrets.sessions.instagram);
  assert.equal(env.THREADS_SESSION_JSON, undefined);
  assert.equal(env.GITHUB_RUN_ID, undefined);
  assert.equal(env.GITHUB_ACTIONS, undefined);
  assert.equal(env.LANGUAGE_CAFE_LOCAL_FALLBACK, "1");
});

test("publisher output is whitelisted and a child failure is never echoed or retried", () => {
  const result = { headSha: HEAD, secrets: { token: "private-token", key: "b".repeat(64),
    sessions: { threads: "{}" } } };
  let callCount = 0;
  const options = { root: ROOT, verifyCheckout: () => HEAD,
    spawn: (_program, _args, settings) => {
      callCount += 1;
      assert.equal(settings.env.GITHUB_TOKEN, "private-token");
      return { status: 0, stdout: JSON.stringify({ channel: "threads", status: "published_verified",
        jobId: "threads-job-01", mediaId: "123456789",
        permalink: "https://www.threads.com/@mindulmin/post/Example", receipt: { accessToken: "private-token" } }) };
    } };
  const output = launcher.runPublisher(result, "threads", "123", options);
  assert.equal(callCount, 1);
  assert.equal(output.mediaId, "123456789");
  assert.equal(JSON.stringify(output).includes("private-token"), false);
  assert.throws(() => launcher.runPublisher(result, "threads", "123", { ...options,
    spawn: () => ({ status: 1, stderr: "private-token" }) }), /readback_required/u);
  assert.throws(() => launcher.runPublisher(result, "threads", "123", { ...options,
    spawn: () => ({ status: 0, stdout: JSON.stringify({ channel: "threads", status: "published_verified",
      jobId: "threads-job-01", mediaId: "123456789",
      permalink: "https://www.threads.com/@mindulmin/post/Example?access_token=private-token" }) }) }),
  /result_invalid/u);
});
