const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const root = __dirname;
const sourceHtml = path.join(root, "series", "2026-07-23-expression-012-igeo-juseyo", "index.html");
const sourceSpec = path.join(root, "series", "2026-07-23-expression-012-igeo-juseyo", "copy-review-spec.json");

function runReview(html) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "language-cafe-copy-gate-"));
  const htmlPath = path.join(temp, "index.html");
  const statePath = path.join(temp, "status.json");
  const reportPath = path.join(temp, "report.json");
  fs.writeFileSync(htmlPath, html);
  fs.writeFileSync(statePath, JSON.stringify({ attempts: [] }));
  const result = spawnSync(process.execPath, [
    path.join(root, "review-copy.cjs"),
    "--html", htmlPath,
    "--spec", sourceSpec,
    "--state", statePath,
    "--report", reportPath
  ], { cwd: root, encoding: "utf8" });
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  fs.rmSync(temp, { recursive: true, force: true });
  return { result, report };
}

test("corrected global Korean cards allow only dialogue and target Hangul", () => {
  const { result, report } = runReview(fs.readFileSync(sourceHtml, "utf8"));
  assert.equal(result.status, 0);
  assert.equal(report.status, "passed");
  assert.equal(report.summary.instructionalKoreanFailures, 0);
  assert.equal(report.summary.englishCardFailures, 0);
});

test("learner-facing Korean explanation blocks the copy review", () => {
  const html = fs.readFileSync(sourceHtml, "utf8").replace(
    "Use it when you can point to what you want.",
    "지금 가리키는 거예요."
  );
  const { result, report } = runReview(html);
  assert.notEqual(result.status, 0);
  assert.equal(report.status, "failed");
  assert.equal(report.summary.instructionalKoreanFailures, 1);
  assert.ok(report.instructionalKorean[1].unexpectedHangul.includes("지금"));
});
