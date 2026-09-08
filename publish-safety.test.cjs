const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  acquirePublishLock,
  containsLanguageHeading,
  findDuplicateRecentMedia,
  findExpressionDuplicateRecentMedia,
  lockPathFor,
  normalizeCaption,
  normalizeExpression,
  releasePublishLock
} = require("./publish-safety.cjs");

test("language headings are rejected while bilingual body copy remains valid", () => {
  assert.equal(containsLanguageHeading("[한국어]\n안녕\n\n[English]\nHello"), true);
  assert.equal(containsLanguageHeading("안녕\n\nHello"), false);
});

test("duplicate comparison ignores removed language headings and whitespace", () => {
  const recent = [{
    id: "1",
    media_type: "CAROUSEL_ALBUM",
    caption: "[한국어]\n안녕\n\n[English]\nHello  #English"
  }];
  const duplicate = findDuplicateRecentMedia(recent, "안녕\nHello\n\n#English");
  assert.equal(duplicate?.id, "1");
  assert.equal(normalizeCaption("[Korean] Hi"), "hi");
});

test("target Hangul expression is blocked even when an older caption uses it as a contrast", () => {
  const recent = [{
    id: "old-repeat-lesson",
    media_type: "CAROUSEL_ALBUM",
    caption: "다시 말해 주세요. asks for a repeat. 천천히 말해 주세요. asks for slower speech."
  }];
  const duplicate = findExpressionDuplicateRecentMedia(recent, "천천히 말해 주세요");
  assert.equal(duplicate?.id, "old-repeat-lesson");
  assert.equal(normalizeExpression("천천히 말해 주세요."), "천천히말해주세요");
});

test("publish lock rejects a concurrent attempt and can be released", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "language-cafe-publish-lock-"));
  const lockPath = lockPathFor(tempRoot, "job-1");
  try {
    await acquirePublishLock(lockPath, { startedAt: "2026-07-17T00:00:00.000Z", stage: "publishing" });
    await assert.rejects(
      acquirePublishLock(lockPath, { startedAt: "later", stage: "starting" }),
      /Duplicate publish blocked/
    );
    await releasePublishLock(lockPath);
    await acquirePublishLock(lockPath, { startedAt: "later", stage: "starting" });
  } finally {
    await releasePublishLock(lockPath);
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
