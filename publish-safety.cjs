const fs = require("node:fs/promises");
const path = require("node:path");

const LANGUAGE_HEADING_PATTERN = /\[(?:한국어|영어|English|Korean)\]/giu;
const LANGUAGE_HEADING_TEST_PATTERN = /\[(?:한국어|영어|English|Korean)\]/iu;

function containsLanguageHeading(caption) {
  return LANGUAGE_HEADING_TEST_PATTERN.test(String(caption || ""));
}

function normalizeCaption(caption) {
  return String(caption || "")
    .normalize("NFC")
    .replace(LANGUAGE_HEADING_PATTERN, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}

function findDuplicateRecentMedia(media, caption) {
  const expected = normalizeCaption(caption);
  if (!expected) return undefined;
  return (Array.isArray(media) ? media : []).find((item) => (
    item?.media_type === "CAROUSEL_ALBUM"
    && normalizeCaption(item.caption) === expected
  ));
}

function normalizeExpression(expression) {
  return String(expression || "")
    .normalize("NFC")
    .replace(/[\p{P}\p{S}\s]+/gu, "")
    .toLocaleLowerCase("en-US");
}

function findExpressionDuplicateRecentMedia(media, expression) {
  const expected = normalizeExpression(expression);
  if (!expected) return undefined;
  return (Array.isArray(media) ? media : []).find((item) => (
    item?.media_type === "CAROUSEL_ALBUM"
    && normalizeExpression(item.caption).includes(expected)
  ));
}

function lockPathFor(root, jobId) {
  const safeJobId = String(jobId).replace(/[^a-z0-9._-]/giu, "-");
  return path.join(root, "tmp", "publish-locks", `${safeJobId}.json`);
}

async function acquirePublishLock(lockPath, details) {
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  let handle;
  try {
    handle = await fs.open(lockPath, "wx");
    await handle.writeFile(`${JSON.stringify(details, null, 2)}\n`);
    return lockPath;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    let existing = "an earlier publish attempt";
    try {
      const value = JSON.parse(await fs.readFile(lockPath, "utf8"));
      existing = `the attempt started at ${value.startedAt || "an unknown time"} (stage: ${value.stage || "unknown"})`;
    } catch {
      // Keep the safe generic description when the lock cannot be read.
    }
    throw new Error(`Duplicate publish blocked: ${existing} is unresolved. Check the job and recent Instagram media before clearing ${lockPath}.`);
  } finally {
    await handle?.close();
  }
}

async function updatePublishLock(lockPath, details) {
  await fs.writeFile(lockPath, `${JSON.stringify(details, null, 2)}\n`);
}

async function releasePublishLock(lockPath) {
  await fs.unlink(lockPath).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
}

module.exports = {
  acquirePublishLock,
  containsLanguageHeading,
  findDuplicateRecentMedia,
  findExpressionDuplicateRecentMedia,
  lockPathFor,
  normalizeCaption,
  normalizeExpression,
  releasePublishLock,
  updatePublishLock
};
