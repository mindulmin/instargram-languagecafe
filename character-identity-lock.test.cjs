const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { CANONICAL_CHARACTER, validateIdentityLock, verifyCanonicalReference } = require("./character-identity-lock.cjs");

function validJob() {
  return {
    schemaVersion: 2,
    workflow: {
      characterReview: {
        identityLockVersion: CANONICAL_CHARACTER.version,
        identityReference: CANONICAL_CHARACTER.reference,
        identityReferenceSha256: CANONICAL_CHARACTER.sha256,
        identityLockConfirmed: true,
        identityDriftDetected: false,
        sceneVariationOnlyConfirmed: true,
        sproutCount: 2,
        sproutShapeMatchConfirmed: true,
        eyeGeometryMatchConfirmed: true,
        bodyProportionsMatchConfirmed: true,
        surfaceMaterialMatchConfirmed: true,
        sideBySideIdentityReview: "passed"
      }
    }
  };
}

test("schema v2 accepts the canonical locked character record", () => {
  assert.equal(validateIdentityLock(validJob()).review, "passed");
});

test("schema v2 blocks visible identity drift", () => {
  const job = validJob();
  job.workflow.characterReview.sproutCount = 3;
  job.workflow.characterReview.identityDriftDetected = true;
  assert.throws(() => validateIdentityLock(job), /sproutCount|identityDriftDetected/);
});

test("canonical reference file matches the locked hash", async () => {
  const result = await verifyCanonicalReference(path.resolve(__dirname));
  assert.equal(result.sha256, CANONICAL_CHARACTER.sha256);
});
