#!/usr/bin/env node
"use strict";

// A single, fail-closed local takeover attempt. This is not a scheduler and
// never bypasses the v3 publisher's own cloud-history, remote-CAS, or social
// readback gates. The default mode is read-only preflight.
const childProcess = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const { V3RemoteState } = require("./channel-split-v3-remote.cjs");
const state = require("./channel-split-v3-state.cjs");
const { decideLocalFallback } = require("./channel-split-v3-fallback.cjs");
const instagram = require("../content-queue/instagram-promo/publish-promo.cjs");
const threads = require("../content-queue/threads/publish-threads-carousel.cjs");

const ROOT = path.resolve(__dirname, "..");
const REPOSITORY = "mindulmin/instargram-languagecafe";
const WORKFLOW = "channel-split-v3-publisher.yml";
const CHANNELS = ["instagram", "threads"];
const HEX40 = /^[a-f0-9]{40}$/u;
const HEX64 = /^[a-f0-9]{64}$/u;
const TIMEOUT_MS = 20_000;

function fail(code) { throw new Error(`v3_fallback_${code}`); }
function parseArgs(args) {
  if (args.length === 0 || (args.length === 1 && args[0] === "--preflight")) return "preflight";
  if (args.length === 1 && args[0] === "--publish") return "publish";
  fail("arguments_invalid");
}
function kstWindow(now) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) fail("clock_invalid");
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const day = kst.toISOString().slice(0, 10);
  const minute = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  const scheduledAt = `${day}T00:00:00.000Z`;
  return { day: day.replaceAll("-", ""), scheduledAt,
    eligible: minute >= 10 * 60 + 35, reason: minute < 10 * 60 + 35 ? "before_1035_kst" : "within_local_window" };
}
function gitText(args, { cwd = ROOT, execFile = childProcess.execFileSync } = {}) {
  try {
    return String(execFile("git", args, { cwd, encoding: "utf8", timeout: 10_000,
      windowsHide: true, stdio: ["pipe", "pipe", "pipe"] })).trim();
  } catch { fail("git_unavailable"); }
}
function assertCleanMain({ root = ROOT, git = gitText } = {}) {
  const top = git(["rev-parse", "--show-toplevel"], { cwd: root });
  const canonical = value => path.resolve(value).replaceAll("\\", "/").toLowerCase();
  if (canonical(top) !== canonical(root)) fail("checkout_root_mismatch");
  if (git(["symbolic-ref", "--short", "HEAD"], { cwd: root }) !== "main") fail("checkout_not_main");
  if (!/^https:\/\/github\.com\/mindulmin\/instargram-languagecafe(?:\.git)?$/iu.test(
    git(["remote", "get-url", "origin"], { cwd: root }))) fail("repository_mismatch");
  if (git(["status", "--porcelain=v1", "--untracked-files=all"], { cwd: root })) fail("checkout_dirty");
  const headSha = git(["rev-parse", "HEAD"], { cwd: root });
  if (!HEX40.test(headSha) || git(["rev-parse", "refs/heads/main"], { cwd: root }) !== headSha) {
    fail("checkout_commit_invalid");
  }
  return headSha;
}
function readGcmToken({ execFile = childProcess.execFileSync } = {}) {
  let output;
  try {
    output = String(execFile("git", ["credential", "fill"], { cwd: ROOT,
      input: "protocol=https\nhost=github.com\n\n", encoding: "utf8", timeout: TIMEOUT_MS,
      windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" } }));
  } catch { fail("github_credential_unavailable"); }
  const passwords = output.split(/\r?\n/u).filter(line => line.startsWith("password="));
  if (passwords.length !== 1 || passwords[0].length <= "password=".length) {
    fail("github_credential_unavailable");
  }
  return passwords[0].slice("password=".length);
}
async function githubJson(url, token, fetchImpl = globalThis.fetch) {
  let response;
  try {
    response = await fetchImpl(url, { method: "GET", redirect: "error",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch { fail("github_read_unavailable"); }
  if (!response?.ok) fail("github_read_unavailable");
  try { return await response.json(); } catch { fail("github_json_invalid"); }
}
async function assertRemoteMain(headSha, token, fetchImpl = globalThis.fetch) {
  const data = await githubJson(`https://api.github.com/repos/${REPOSITORY}/git/ref/heads/main`, token, fetchImpl);
  if (data?.ref !== "refs/heads/main" || data?.object?.type !== "commit"
    || data.object.sha !== headSha) fail("checkout_not_current_main");
}
async function readCloudRuns(scheduledAt, token, fetchImpl = globalThis.fetch) {
  const date = scheduledAt.slice(0, 10);
  const runs = [];
  let total = null;
  for (let page = 1; page <= 10; page += 1) {
    const url = new URL(`https://api.github.com/repos/${REPOSITORY}/actions/workflows/${WORKFLOW}/runs`);
    for (const [key, value] of Object.entries({ branch: "main", created: date, per_page: "100", page: String(page) })) {
      url.searchParams.set(key, value);
    }
    const data = await githubJson(url, token, fetchImpl);
    if (!Number.isInteger(data?.total_count) || data.total_count < 0 || data.total_count > 1000
      || !Array.isArray(data.workflow_runs) || data.workflow_runs.length > 100) fail("cloud_runs_invalid");
    if (total === null) total = data.total_count;
    else if (total !== data.total_count) fail("cloud_runs_changed");
    for (const run of data.workflow_runs) {
      if (!run || run.head_branch !== "main" || !Number.isFinite(Date.parse(run.created_at))
        || !["queued", "in_progress", "completed", "requested", "waiting", "pending"].includes(run.status)
        || !(run.conclusion === null || typeof run.conclusion === "string")) fail("cloud_runs_invalid");
      runs.push({ createdAt: run.created_at, branch: run.head_branch,
        workflow: "channel-split-v3", status: run.status, conclusion: run.conclusion });
    }
    if (runs.length >= total) break;
    if (data.workflow_runs.length === 0) fail("cloud_runs_incomplete");
  }
  if (runs.length !== total) fail("cloud_runs_incomplete");
  return runs;
}
async function readLocalAuthority({ root = ROOT, userProfile = process.env.USERPROFILE,
  io = fs, now = new Date(), channels } = {}) {
  if (!path.isAbsolute(userProfile || "")) fail("user_profile_unavailable");
  let key, policy;
  try {
    key = (await io.readFile(path.join(root, "cloud", "local", "state.key"), "utf8")).trim();
    policy = JSON.parse(await io.readFile(path.join(root, "cloud", "control", "channel-split-v3-policy.json"), "utf8"));
  } catch { fail("local_authority_unavailable"); }
  if (!HEX64.test(key)) fail("state_key_invalid");
  if (policy?.schemaVersion !== 1 || policy.strategyVersion !== "channel-split-v3"
    || typeof policy.enabled !== "boolean"
    || CHANNELS.some(channel => typeof policy.channels?.[channel]?.enabled !== "boolean")) fail("policy_invalid");
  const enabled = policy.enabled ? CHANNELS.filter(channel => policy.channels[channel].enabled) : [];
  const sessions = {};
  for (const channel of enabled) {
    let raw, parsed;
    try {
      raw = await io.readFile(path.join(userProfile, ".codex", channel, "session.json"), "utf8");
      parsed = JSON.parse(raw);
      if (channel === "instagram") instagram.sessionValues(parsed);
      else threads.sessionValues(parsed, () => now);
    } catch { fail(`${channel}_session_unavailable_or_invalid`); }
    sessions[channel] = raw;
  }
  return { key, enabled, sessions };
}
async function preflight({ now = new Date(), root = ROOT, userProfile = process.env.USERPROFILE,
  git = gitText, credential = readGcmToken, fetchImpl = globalThis.fetch, io = fs,
  remoteFactory = args => new V3RemoteState(args) } = {}) {
  const window = kstWindow(now);
  if (!window.eligible) return { status: "blocked", reason: window.reason, day: window.day };
  const headSha = assertCleanMain({ root, git });
  const authority = await readLocalAuthority({ root, userProfile, io, now });
  if (authority.enabled.length === 0) return { status: "not_due", reason: "all_channels_disabled", day: window.day };
  const token = credential();
  await assertRemoteMain(headSha, token, fetchImpl);
  const [cloudRuns, remote] = await Promise.all([
    readCloudRuns(window.scheduledAt, token, fetchImpl),
    remoteFactory({ token, stateKey: authority.key }).readVerified()
  ]);
  const ledger = state.checkedLedger(remote.ledger);
  const unresolved = Object.values(ledger.locks).some(lock => lock !== null);
  const decision = decideLocalFallback({ now: now.toISOString(), scheduledAt: window.scheduledAt,
    cloudRuns, remoteReachable: true, unresolvedRemoteAction: unresolved,
    selectedJobId: "launcher-preflight" });
  if (!decision.eligible) return { status: "blocked", reason: decision.reason, day: window.day };
  return { status: "eligible", reason: decision.reason, day: window.day,
    scheduledAt: window.scheduledAt, headSha, enabledChannels: authority.enabled,
    remoteStateSha: remote.sha, secrets: { token, key: authority.key, sessions: authority.sessions } };
}
async function markOnce(result, { root = ROOT, io = fs, now = new Date() } = {}) {
  if (kstWindow(now).day !== result.day) fail("preflight_day_changed");
  const directory = path.join(root, "cloud", "local");
  const file = path.join(directory, `v3-fallback-${result.day}.attempt.json`);
  await io.mkdir(directory, { recursive: true });
  let handle;
  try { handle = await io.open(file, "wx", 0o600); }
  catch (error) {
    if (error?.code === "EEXIST") fail("already_attempted_today");
    fail("attempt_marker_unavailable");
  }
  const runId = String(now.getTime());
  try {
    await handle.writeFile(JSON.stringify({ schemaVersion: 1, attemptedAt: now.toISOString(),
      scheduledAt: result.scheduledAt, headSha: result.headSha, channels: result.enabledChannels,
      runId }) + "\n", "utf8");
    await handle.sync();
  } catch { fail("attempt_marker_unavailable"); }
  finally { await handle.close(); }
  return runId;
}
function childEnvironment(result, channel, runId, source = process.env) {
  const env = {};
  for (const key of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA"]) {
    if (source[key]) env[key] = source[key];
  }
  env.GITHUB_TOKEN = result.secrets.token;
  env.LANGUAGE_CAFE_STATE_KEY = result.secrets.key;
  env.LANGUAGE_CAFE_LOCAL_FALLBACK = "1";
  env.LANGUAGE_CAFE_LOCAL_RUN_ID = runId;
  env.GITHUB_RUN_ATTEMPT = "1";
  env[channel === "instagram" ? "INSTAGRAM_SESSION_JSON" : "THREADS_SESSION_JSON"] = result.secrets.sessions[channel];
  return env;
}
function safePermalink(value, channel) {
  if (typeof value !== "string") return false;
  let url;
  try { url = new URL(value); } catch { return false; }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash
    || url.href !== value) return false;
  if (channel === "instagram") {
    return url.hostname === "www.instagram.com" && /^\/p\/[A-Za-z0-9_-]+\/?$/u.test(url.pathname);
  }
  return ["www.threads.net", "www.threads.com"].includes(url.hostname)
    && /^\/@mindulmin\/post\/[A-Za-z0-9_-]+\/?$/u.test(url.pathname);
}
function runPublisher(result, channel, runId, { root = ROOT, spawn = childProcess.spawnSync,
  environment = process.env, verifyCheckout = assertCleanMain } = {}) {
  if (verifyCheckout({ root }) !== result.headSha) fail("checkout_changed_after_preflight");
  const child = spawn(process.execPath, [path.join(root, "cloud", "channel-split-v3-publisher.cjs"),
    "--mode", "publish", "--channel", channel, "--job-id", "auto"],
  { cwd: root, env: childEnvironment(result, channel, runId, environment), encoding: "utf8",
    windowsHide: true, timeout: 55 * 60 * 1000, maxBuffer: 1024 * 1024 });
  if (child.error || child.signal || child.status !== 0) fail("publisher_failed_or_ambiguous_readback_required");
  let outcome;
  try { outcome = JSON.parse(String(child.stdout).trim()); }
  catch { fail("publisher_result_invalid_readback_required"); }
  if (outcome?.channel !== channel || !["published_verified", "not_due"].includes(outcome.status)) {
    fail("publisher_result_invalid_readback_required");
  }
  if (outcome.status === "published_verified"
    && (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,119}$/u.test(String(outcome.jobId || ""))
      || !/^[0-9]+$/u.test(String(outcome.mediaId || ""))
      || !safePermalink(outcome.permalink, channel))) {
    fail("publisher_result_invalid_readback_required");
  }
  return { channel, status: outcome.status,
    ...(outcome.status === "not_due" ? {
      reason: /^[a-z0-9_]+$/u.test(String(outcome.reason || "")) ? outcome.reason : "not_due"
    } : {
      jobId: outcome.jobId, mediaId: outcome.mediaId, permalink: outcome.permalink }) };
}
async function runCli(args = process.argv.slice(2), dependencies = {}) {
  const mode = parseArgs(args);
  const result = await (dependencies.preflight || preflight)(dependencies.preflightOptions);
  if (mode === "preflight" || result.status !== "eligible") {
    const { secrets: _secrets, ...safe } = result;
    return { ...safe, mode, wouldPublish: false };
  }
  const runId = await (dependencies.markOnce || markOnce)(result, dependencies.markOptions);
  const outcomes = [];
  for (const channel of result.enabledChannels) {
    outcomes.push((dependencies.runPublisher || runPublisher)(result, channel, runId, dependencies.publisherOptions));
  }
  return { status: "completed", mode, day: result.day, outcomes };
}

if (require.main === module) {
  runCli().then(result => console.log(JSON.stringify(result)))
    .catch(error => {
      console.error(/^v3_fallback_[a-z0-9_]+$/u.test(error?.message || "")
        ? error.message : "v3_fallback_blocked_or_ambiguous_readback_required");
      process.exitCode = 1;
    });
}

module.exports = { parseArgs, kstWindow, assertCleanMain, readGcmToken, readCloudRuns,
  readLocalAuthority, preflight, markOnce, childEnvironment, runPublisher, runCli };
