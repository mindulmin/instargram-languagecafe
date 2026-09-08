const test = require("node:test");
const assert = require("node:assert/strict");
const { selectDailyExpression } = require("./daily-content-selector.cjs");

const rows = [
  { id: "001", koreanExpression: "안녕하세요", status: "ready" },
  { id: "002", koreanExpression: "도와주세요", status: "ready" },
  { id: "003", koreanExpression: "천천히 말해 주세요", status: "published" }
];

function select(inbox, focusExpression = "", publishedExpressionIds = new Set()) {
  return selectDailyExpression({
    rows,
    dateValue: "2026-01-01",
    focusExpression,
    inbox,
    collection: { status: "available", source: "test" },
    publishedExpressionIds
  });
}

test("two distinct accepted requests prioritize one ready expression", () => {
  const result = select({
    policy: { minimumDistinctAcceptedSignals: 2 },
    signals: [
      { id: "signal-1", sourceItemId: "comment-a", type: "next_expression", status: "accepted", targetExpressionId: "002" },
      { id: "signal-2", sourceItemId: "comment-b", type: "real_scene_request", status: "accepted", targetExpressionId: "002" }
    ]
  });
  assert.equal(result.expression.id, "002");
  assert.equal(result.selectionBasis, "accepted_comment_feedback");
  assert.deepEqual(result.feedback.selectedSignalIds, ["signal-1", "signal-2"]);
});

test("one accepted request stays evidence and does not displace the deterministic fallback", () => {
  const result = select({
    signals: [
      { id: "signal-1", sourceItemId: "comment-a", type: "next_expression", status: "accepted", targetExpressionId: "002" }
    ]
  });
  assert.equal(result.expression.id, "001");
  assert.equal(result.selectionBasis, "date_rotation_fallback");
  assert.equal(result.feedback.candidates[0].priorityEligible, false);
});

test("published or non-ready targets cannot become a scheduled feedback candidate", () => {
  const result = select({
    signals: [
      { id: "signal-1", sourceItemId: "comment-a", type: "next_expression", status: "accepted", targetExpressionId: "003" }
    ]
  });
  assert.equal(result.expression.id, "001");
  assert.equal(result.feedback.signalReviews[0].selectionStatus, "target_not_ready");
  assert.equal(result.feedback.signalReviews[0].libraryStatus, "published");
});

test("a local published job excludes a still-ready CSV row", () => {
  const result = select({
    signals: [
      { id: "signal-1", sourceItemId: "comment-a", type: "next_expression", status: "accepted", targetExpressionId: "002" },
      { id: "signal-2", sourceItemId: "comment-b", type: "real_scene_request", status: "accepted", targetExpressionId: "002" }
    ]
  }, "", new Set(["002"]));
  assert.equal(result.expression.id, "001");
  assert.equal(result.feedback.signalReviews[0].selectionStatus, "target_already_published");
  assert.equal(result.feedback.signalReviews[1].selectionStatus, "target_already_published");
});

test("date rotation never selects a still-ready CSV row with a local published job", () => {
  const result = select({ signals: [] }, "", new Set(["001"]));
  assert.equal(result.expression.id, "002");
  assert.equal(result.selectionBasis, "date_rotation_fallback");
});

test("an exact ready current-focus match outranks comment-feedback priority", () => {
  const result = select({
    signals: [
      { id: "signal-1", sourceItemId: "comment-a", type: "next_expression", status: "accepted", targetExpressionId: "002" },
      { id: "signal-2", sourceItemId: "comment-b", type: "real_scene_request", status: "accepted", targetExpressionId: "002" }
    ]
  }, "안녕하세요");
  assert.equal(result.expression.id, "001");
  assert.equal(result.selectionBasis, "current_focus_exact_ready_match");
  assert.equal(result.feedback.prioritySuppressedByCurrentFocus, true);
});

test("correction feedback is retained without automatically selecting either paired expression", () => {
  const result = select({
    signals: [
      {
        id: "signal-1",
        type: "confusion_or_correction",
        status: "accepted",
        targetExpressionId: "002",
        contrastExpressionId: "003"
      }
    ]
  });
  assert.equal(result.expression.id, "001");
  assert.equal(result.feedback.signalReviews[0].selectionStatus, "not_actionable_type");
});
