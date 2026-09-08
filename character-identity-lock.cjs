const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const CANONICAL_CHARACTER = Object.freeze({
  version: "language-cafe-mascot-v1",
  reference: "brand/language-cafe-mascot-v1/language-cafe-mascot-reference-sheet-v1.png",
  sha256: "b050d011021c7a57665c0d81deeba39f5e26b84da5feb42ed72c602918649411",
  sproutCount: 2
});

function validateIdentityLock(job) {
  if (Number(job?.schemaVersion || 1) < 2) return { required: false, version: "legacy" };
  const character = job?.workflow?.characterReview || {};
  const failures = [];
  if (character.identityLockVersion !== CANONICAL_CHARACTER.version) failures.push("identityLockVersion");
  if (character.identityReference !== CANONICAL_CHARACTER.reference) failures.push("identityReference");
  if (character.identityReferenceSha256 !== CANONICAL_CHARACTER.sha256) failures.push("identityReferenceSha256");
  if (character.identityLockConfirmed !== true) failures.push("identityLockConfirmed");
  if (character.identityDriftDetected !== false) failures.push("identityDriftDetected");
  if (character.sceneVariationOnlyConfirmed !== true) failures.push("sceneVariationOnlyConfirmed");
  if (character.sproutCount !== CANONICAL_CHARACTER.sproutCount) failures.push("sproutCount");
  if (character.sproutShapeMatchConfirmed !== true) failures.push("sproutShapeMatchConfirmed");
  if (character.eyeGeometryMatchConfirmed !== true) failures.push("eyeGeometryMatchConfirmed");
  if (character.bodyProportionsMatchConfirmed !== true) failures.push("bodyProportionsMatchConfirmed");
  if (character.surfaceMaterialMatchConfirmed !== true) failures.push("surfaceMaterialMatchConfirmed");
  if (character.sideBySideIdentityReview !== "passed") failures.push("sideBySideIdentityReview");
  if (failures.length) throw new Error(`Character identity lock failed: ${failures.join(", ")}.`);
  return { required: true, version: CANONICAL_CHARACTER.version, review: "passed" };
}

async function verifyCanonicalReference(projectRoot) {
  const referencePath = path.join(projectRoot, ...CANONICAL_CHARACTER.reference.split("/"));
  const buffer = await fs.readFile(referencePath);
  const actual = crypto.createHash("sha256").update(buffer).digest("hex");
  if (actual !== CANONICAL_CHARACTER.sha256) {
    throw new Error(`Canonical character reference hash mismatch: expected ${CANONICAL_CHARACTER.sha256}, found ${actual}.`);
  }
  return { path: referencePath, sha256: actual, review: "passed" };
}

module.exports = { CANONICAL_CHARACTER, validateIdentityLock, verifyCanonicalReference };
