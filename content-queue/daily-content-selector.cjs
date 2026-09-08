const fs = require("node:fs/promises");
const path = require("node:path");

const ACTIONABLE_FEEDBACK_TYPES = new Set(["next_expression", "real_scene_request"]);
const DEFAULT_MINIMUM_DISTINCT_SIGNALS = 2;

function argumentValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function normalize(value) {
  return String(value || "")
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("ko-KR");
}

function parseLibrary(csv) {
  return csv.trim().split(/\r?\n/).slice(1).map((line) => {
    const [id, category, koreanExpression, englishHint, romanization, scene, primaryFormat, status] = line.split(",");
    return { id, category, koreanExpression, englishHint, romanization, scene, primaryFormat, status };
  });
}

function normalizeDate(dateValue) {
  const date = new Date(String(dateValue) + "T00:00:00Z");
  if (Number.isNaN(date.valueOf())) throw new Error("Use --date YYYY-MM-DD.");
  return date;
}

function feedbackSummary(rows, inbox, collection, publishedExpressionIds = new Set()) {
  const policy = inbox && typeof inbox.policy === "object" ? inbox.policy : {};
  const minimumDistinctSignals = Number.isInteger(policy.minimumDistinctAcceptedSignals)
    ? policy.minimumDistinctAcceptedSignals
    : DEFAULT_MINIMUM_DISTINCT_SIGNALS;
  const signals = Array.isArray(inbox && inbox.signals) ? inbox.signals : [];
  const byId = new Map(rows.map((row) => [String(row.id), row]));
  const byExpression = new Map(rows.map((row) => [normalize(row.koreanExpression), row]));
  const candidateSignals = new Map();
  const signalReviews = [];

  for (const signal of signals) {
    const signalId = String(signal.id || "unidentified-signal");
    const type = String(signal.type || signal.classification || "");
    const requestedExpressionId = signal.targetExpressionId ? String(signal.targetExpressionId) : "";
    const requestedExpression = signal.targetExpression || signal.suggestedExpression || "";
    const row = byId.get(requestedExpressionId) || byExpression.get(normalize(requestedExpression));
    const review = {
      signalId,
      type: type || "unclassified",
      requestedExpressionId: requestedExpressionId || null,
      requestedExpression: requestedExpression || null,
      selectionStatus: "record_only"
    };

    if (signal.status !== "accepted") {
      review.selectionStatus = signal.selectionStatus || "not_accepted";
      review.reason = signal.reason || "The signal is retained as evidence but is not accepted for automatic selection.";
    } else if (!ACTIONABLE_FEEDBACK_TYPES.has(type)) {
      review.selectionStatus = "not_actionable_type";
      review.reason = "Only next_expression and real_scene_request signals can influence candidate priority.";
    } else if (!row) {
      review.selectionStatus = "target_not_in_library";
      review.reason = "The requested expression is not present in the controlled source library.";
    } else if (row.status !== "ready") {
      review.selectionStatus = "target_not_ready";
      review.libraryStatus = row.status;
      review.reason = "Only a ready source row can become a future scheduled candidate.";
    } else if (publishedExpressionIds.has(String(row.id))) {
      review.selectionStatus = "target_already_published";
      review.libraryStatus = row.status;
      review.reason = "A local published job already exists for this expression, so feedback cannot schedule it again.";
    } else {
      review.selectionStatus = "eligible_signal";
      review.libraryStatus = row.status;
      const existing = candidateSignals.get(row.id) || { row, signalIds: [], sourceKeys: new Set() };
      const sourceKey = String(signal.distinctSourceKey || signal.sourceItemId || signalId);
      existing.signalIds.push(signalId);
      existing.sourceKeys.add(sourceKey);
      candidateSignals.set(row.id, existing);
    }

    signalReviews.push(review);
  }

  const candidates = [...candidateSignals.values()]
    .map(({ row, signalIds, sourceKeys }) => ({
      expressionId: row.id,
      expression: row.koreanExpression,
      signalIds,
      distinctSignalCount: sourceKeys.size,
      priorityEligible: sourceKeys.size >= minimumDistinctSignals
    }))
    .sort((left, right) => right.distinctSignalCount - left.distinctSignalCount || left.expressionId.localeCompare(right.expressionId));

  return {
    collection,
    policy: {
      minimumDistinctAcceptedSignals: minimumDistinctSignals,
      actionableTypes: [...ACTIONABLE_FEEDBACK_TYPES],
      automaticRepliesSent: false,
      publishedOrNonReadyTargetsExcluded: true
    },
    signalReviews,
    candidates,
    priorityCandidateIds: candidates.filter((candidate) => candidate.priorityEligible).map((candidate) => candidate.expressionId)
  };
}

function selectDailyExpression({
  rows,
  dateValue,
  focusExpression = "",
  inbox = {},
  collection = { status: "unavailable", source: null },
  publishedExpressionIds = new Set()
}) {
  const date = normalizeDate(dateValue);
  const readyRows = rows.filter((row) =>
    row.status === "ready" && !publishedExpressionIds.has(String(row.id))
  );
  if (!readyRows.length) {
    throw new Error("No unpublished ready Korean conversation rows are available.");
  }

  const feedback = feedbackSummary(rows, inbox, collection, publishedExpressionIds);
  const normalizedFocus = normalize(focusExpression);
  const focusRow = normalizedFocus
    ? readyRows.find((row) => normalize(row.koreanExpression) === normalizedFocus)
    : null;
  const start = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const fallbackIndex = Math.floor((date - start) / 86400000) % readyRows.length;
  const fallbackRow = readyRows[fallbackIndex];
  const priorityCandidates = feedback.candidates.filter((candidate) => candidate.priorityEligible);
  const priorityRow = priorityCandidates.length
    ? readyRows.find((row) => row.id === priorityCandidates[0].expressionId)
    : null;

  let expression = fallbackRow;
  let selectionBasis = "date_rotation_fallback";
  if (priorityRow) {
    expression = priorityRow;
    selectionBasis = "accepted_comment_feedback";
  }
  if (focusRow) {
    expression = focusRow;
    selectionBasis = "current_focus_exact_ready_match";
  }

  return {
    expression,
    format: [0, 1, 3, 5].includes(date.getUTCDay()) ? "card_carousel" : "motion_reel",
    selectionBasis,
    feedback: {
      ...feedback,
      prioritySuppressedByCurrentFocus: Boolean(focusRow && priorityRow),
      selectedSignalIds: selectionBasis === "accepted_comment_feedback"
        ? priorityCandidates[0].signalIds
        : []
    }
  };
}

async function readInbox(feedbackPath) {
  try {
    const raw = await fs.readFile(feedbackPath, "utf8");
    return {
      inbox: JSON.parse(raw),
      collection: { status: "available", source: feedbackPath }
    };
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return {
        inbox: { signals: [] },
        collection: { status: "unavailable", source: feedbackPath, reason: "feedback_inbox_missing" }
      };
    }
    return {
      inbox: { signals: [] },
      collection: { status: "unavailable", source: feedbackPath, reason: "feedback_inbox_invalid" }
    };
  }
}

async function readPublishedExpressionIds(jobsDir) {
  try {
    const entries = await fs.readdir(jobsDir, { withFileTypes: true });
    const publishedExpressionIds = new Set();
    let checkedJobFiles = 0;
    let invalidJobFiles = 0;
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      checkedJobFiles += 1;
      try {
        const job = JSON.parse(await fs.readFile(path.join(jobsDir, entry.name), "utf8"));
        if ((job.published || job.workflow?.status === "published") && job.source?.expressionId) {
          publishedExpressionIds.add(String(job.source.expressionId));
        }
      } catch {
        invalidJobFiles += 1;
      }
    }
    return {
      publishedExpressionIds,
      review: {
        status: "available",
        source: jobsDir,
        checkedJobFiles,
        invalidJobFiles,
        publishedExpressionIds: [...publishedExpressionIds].sort()
      }
    };
  } catch (error) {
    return {
      publishedExpressionIds: new Set(),
      review: {
        status: "unavailable",
        source: jobsDir,
        reason: error && error.code === "ENOENT" ? "jobs_directory_missing" : "jobs_directory_unreadable"
      }
    };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dateValue = argumentValue(args, "--date") || new Date().toISOString().slice(0, 10);
  const csvPath = argumentValue(args, "--library") || path.join(__dirname, "korean-conversation-library.csv");
  const feedbackPath = argumentValue(args, "--feedback") || path.join(__dirname, "comment-feedback-signals.json");
  const outputPath = argumentValue(args, "--out") || path.join(__dirname, "daily-selection.json");
  const focusExpression = argumentValue(args, "--focus-expression") || "";
  const jobsDir = argumentValue(args, "--jobs-dir") || path.join(__dirname, "..", "jobs");
  const rows = parseLibrary(await fs.readFile(csvPath, "utf8"));
  const { inbox, collection: commentCollection } = await readInbox(feedbackPath);
  const { publishedExpressionIds, review: publishedJobReview } = await readPublishedExpressionIds(jobsDir);
  const collection = { ...commentCollection, publishedJobReview };
  const selected = selectDailyExpression({ rows, dateValue, focusExpression, inbox, collection, publishedExpressionIds });
  const selection = {
    date: dateValue,
    expression: selected.expression,
    format: selected.format,
    selectionBasis: selected.selectionBasis,
    feedback: selected.feedback,
    cardRule: "Teach one polite everyday Korean line to a global learner. Create eight 1080x1920 (9:16) master images with all essential Hangul, English bridge copy, pronunciation guidance, and Studio mindulmin credit inside the centered 1080x1350 feed-safe area, plus eight 1080x1350 feed derivatives. Reserve Hangul for real dialogue, the target Korean phrase and its components, and limited pronunciation practice. Write every explanation, meaning note, rule, instruction, swipe reason, and CTA guidance in natural global English. Romanization appears only where it improves pronunciation. Use brand/language-cafe-mascot-v1/language-cafe-mascot-reference-sheet-v1.png as the sole character identity reference. Keep the exact same two short sprouts, eye geometry, body proportions, mint color, and pebbled material; change only expression, pose, camera angle, and scene for one context card. Reject identity drift, unnatural Korean, Korean learner-facing explanations, and opaque English support.",
    reelRule: "Create a silent 30-second 1080x1920 card Reel only from the eight approved Korean-conversation masters. Keep all cards fully visible and reserve final music selection for the Instagram app owner.",
    bgmStatus: "instagram-app-owner-only: do not search or select a track automatically; hand off three non-song-specific mood intentions after visual review."
  };
  await fs.writeFile(outputPath, JSON.stringify(selection, null, 2) + "\n");
  console.log(JSON.stringify(selection, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { parseLibrary, selectDailyExpression, feedbackSummary, readPublishedExpressionIds };
