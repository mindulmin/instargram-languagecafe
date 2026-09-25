"use strict";

// Durable transport for the pure v3 state machine. This module never calls a
// social API and never treats GitHubState.save's optimistic response as proof
// that an intent reached cloud-state: every write gets an independent read.
const { isDeepStrictEqual } = require("node:util");
const { GitHubState, BRANCH, REPOSITORY } = require("./github-state.cjs");
const { decrypt } = require("./state.cjs");
const v3 = require("./channel-split-v3-state.cjs");

const GIT_SHA = /^[a-f0-9]{40,64}$/u;
const MAX_CHECKPOINT_BYTES = 90 * 1024 * 1024;
const TRANSITIONS = new Set([
  "beginCreate", "recordContainer", "beginThreadsChildCreate",
  "recordThreadsChildContainer", "beginThreadsCarouselCreate",
  "recordThreadsCarouselContainer", "beginPublish", "markAmbiguous",
  "completeVerified", "abandonThreads36141543126"
]);
const ENVELOPED = new Set(["claimJob", "beginCreate", "beginThreadsChildCreate",
  "beginThreadsCarouselCreate", "beginPublish", "completeVerified", "abandonThreads36141543126"]);
const API_INTENTS = new Set(["beginCreate", "beginThreadsChildCreate",
  "beginThreadsCarouselCreate", "beginPublish"]);

function fail(code) { throw new Error(`v3_remote_${code}`); }
function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function copy(value) { return structuredClone(value); }
function withoutV3(ledger) {
  const { channelSplitV3: _v3, ...historical } = ledger;
  return historical;
}

class V3RemoteState {
  constructor({ token, stateKey, githubState } = {}) {
    // The production store is pinned by github-state.cjs to this repository's
    // cloud-state branch. Injection is only for hermetic tests.
    this.githubState = githubState || new GitHubState(token);
    if (!this.githubState || typeof this.githubState.read !== "function"
      || typeof this.githubState.save !== "function") fail("store_invalid");
    if (!/^[a-f0-9]{64}$/u.test(stateKey || "")) fail("state_key_missing_or_invalid");
    this.stateKey = stateKey;
  }

  async _read() {
    const snapshot = await this.githubState.read();
    if (!isRecord(snapshot) || !GIT_SHA.test(snapshot.sha || "")
      || !GIT_SHA.test(snapshot.tree || "") || !isRecord(snapshot.ledger)
      || !Buffer.isBuffer(snapshot.encrypted) || snapshot.encrypted.length === 0
      || (snapshot.branch !== undefined && snapshot.branch !== BRANCH)
      || (snapshot.repository !== undefined && snapshot.repository !== REPOSITORY)) fail("snapshot_invalid");
    try {
      const restored = decrypt(snapshot.encrypted, this.stateKey);
      if (!isRecord(restored.files) || Object.keys(restored.files).length === 0) fail("restored_state_missing");
    } catch (error) {
      if (/^v3_remote_/u.test(error?.message || "")) throw error;
      fail("encrypted_state_authentication_failed");
    }
    v3.checkedLedger(snapshot.ledger);
    return snapshot;
  }

  async readVerified() {
    const snapshot = await this._read();
    return { sha: snapshot.sha, ledger: copy(snapshot.ledger) };
  }

  async _commit(kind, { expectedSha, ...argumentsForTransition }) {
    if (kind !== "claimJob" && !TRANSITIONS.has(kind)) fail("transition_not_allowed");
    if (!GIT_SHA.test(expectedSha || "")) fail("expected_head_invalid");
    const before = await this._read();
    if (before.sha !== expectedSha) fail("head_changed");
    const transition = v3[kind];
    if (typeof transition !== "function") fail("transition_unavailable");
    const result = transition({ ...argumentsForTransition, ledger: copy(before.ledger),
      expectedRemoteStateSha: expectedSha, observedRemoteStateSha: before.sha });
    if (ENVELOPED.has(kind) && (!isRecord(result) || !isRecord(result.ledger))) fail("transition_result_invalid");
    if (kind === "claimJob" && !isRecord(result.claim)) fail("transition_result_invalid");
    if (API_INTENTS.has(kind) && (!isRecord(result.intent)
      || result.intent.mustCommitAndReadBackBeforeApi !== true)) fail("transition_result_invalid");
    if (["completeVerified", "abandonThreads36141543126"].includes(kind)
      && !isRecord(result.receipt)) fail("transition_result_invalid");
    const nextLedger = ENVELOPED.has(kind) ? result.ledger : result;
    if (!isRecord(nextLedger) || isDeepStrictEqual(nextLedger, before.ledger)
      || !isDeepStrictEqual(withoutV3(nextLedger), withoutV3(before.ledger))) fail("transition_invalid");
    v3.checkedLedger(nextLedger);
    if (Buffer.byteLength(JSON.stringify(nextLedger), "utf8") + before.encrypted.length > MAX_CHECKPOINT_BYTES) {
      fail("checkpoint_too_large");
    }

    // GitHubState.save performs a non-forced ref CAS. A failed/uncertain save
    // is not retried here; a subsequent runner must reconcile cloud-state.
    const saved = await this.githubState.save(before, nextLedger, before.encrypted);
    if (!isRecord(saved) || !GIT_SHA.test(saved.sha || "") || !GIT_SHA.test(saved.tree || "")
      || saved.sha === before.sha || !isDeepStrictEqual(saved.ledger, nextLedger)
      || !Buffer.isBuffer(saved.encrypted) || !saved.encrypted.equals(before.encrypted)) {
      fail("save_result_invalid");
    }
    const confirmed = await this._read();
    if (confirmed.sha !== saved.sha || confirmed.tree !== saved.tree
      || !isDeepStrictEqual(confirmed.ledger, nextLedger)
      || !confirmed.encrypted.equals(before.encrypted)) fail("independent_readback_mismatch");
    return { sha: confirmed.sha, ledger: confirmed.ledger, result };
  }

  async claimJob({ expectedSha, confirmedAt, ...claimArgs }) {
    if (typeof confirmedAt !== "string" || !Number.isFinite(Date.parse(confirmedAt))) {
      fail("confirmation_time_invalid");
    }
    const committed = await this._commit("claimJob", { expectedSha, ...claimArgs });
    const claim = committed.result.claim;
    const permit = v3.confirmRemoteClaim({ ledger: committed.ledger, claimHash: claim.claimHash,
      expectedClaimStateSha: committed.sha, observedClaimStateSha: committed.sha, at: confirmedAt });
    return { sha: committed.sha, claim: copy(claim), permit: copy(permit) };
  }

  async transition({ kind, expectedSha, ...args }) {
    if (!TRANSITIONS.has(kind)) fail("transition_not_allowed");
    const committed = await this._commit(kind, { expectedSha, ...args });
    const value = committed.result;
    return { sha: committed.sha,
      ...(isRecord(value?.intent) ? { intent: copy(value.intent) } : {}),
      ...(isRecord(value?.receipt) ? { receipt: copy(value.receipt) } : {}) };
  }

  beginCreate(args) { return this.transition({ ...args, kind: "beginCreate" }); }
  recordContainer(args) { return this.transition({ ...args, kind: "recordContainer" }); }
  beginThreadsChildCreate(args) { return this.transition({ ...args, kind: "beginThreadsChildCreate" }); }
  recordThreadsChildContainer(args) { return this.transition({ ...args, kind: "recordThreadsChildContainer" }); }
  beginThreadsCarouselCreate(args) { return this.transition({ ...args, kind: "beginThreadsCarouselCreate" }); }
  recordThreadsCarouselContainer(args) { return this.transition({ ...args, kind: "recordThreadsCarouselContainer" }); }
  beginPublish(args) { return this.transition({ ...args, kind: "beginPublish" }); }
  markAmbiguous(args) { return this.transition({ ...args, kind: "markAmbiguous" }); }
  completeVerified(args) { return this.transition({ ...args, kind: "completeVerified" }); }
  abandonThreads36141543126(args) { return this.transition({ ...args, kind: "abandonThreads36141543126" }); }
}

module.exports = { V3RemoteState };
