const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const THREADS_JOBS_DIR = path.join(__dirname, "jobs");
const THREADS_LOCKS_DIR = path.join(__dirname, ".publish-locks");
const THREADS_RECOVERY_EVIDENCE_DIR = path.join(__dirname, "recovery-evidence");
const DEFAULT_CONTROL_PATH = "C:\\Users\\earth\\OneDrive\\Desktop\\codex\\Koreanstudy_studio\\my-app\\docs\\revenue-operations\\current-test.json";
const CONTROL_SCHEMA_VERSION = "1.2";
const HANDOFF_CONTRACT_VERSION = "1.2";
const THREADS_STRATEGY_VERSION = "instagram-study-companion-link-v2";
const INSTAGRAM_ACCOUNT_HANDLE = "@mindulmin";
const LEGACY_INSTAGRAM_STUDY_CUE = `Study the full visual lesson on Instagram: ${INSTAGRAM_ACCOUNT_HANDLE}`;
const LEARNING_EXTENSION_CTA = "Review the full visual lesson on Instagram →";
const APPROVED_OWNED_SITE_HOST = "languagestudio.uk";
const APPROVED_OWNED_SITE_HOSTS = new Set([APPROVED_OWNED_SITE_HOST]);
const LINK_TARGET_SOURCE_INSTAGRAM = "source_instagram_permalink";
const LINK_TARGET_OWNED_PRACTICE = "owned_practice_landing";
const LINK_TARGET_TYPES = new Set([LINK_TARGET_SOURCE_INSTAGRAM, LINK_TARGET_OWNED_PRACTICE]);
const LINK_PREVIEW_POLICY = "explicit_preview_not_requested_platform_auto_render_may_occur";
const LINK_PREVIEW_OBSERVATION = "unavailable_platform_managed";
const LEARNING_PAIR_ACTION = "publish_one_learning_pair";
const THREADS_RECOVERY_ACTION = "publish_one_threads_companion_for_existing_instagram";
const RECOVERY_EVIDENCE_TYPE = "threads_ambiguous_publish_recovery_preflight";
const RECOVERY_RESOLUTION = "abandoned_do_not_publish_original_container";
const WORKING_CHARACTER_MINIMUM = 180;
const WORKING_CHARACTER_MAXIMUM = 480;
const HARD_CHARACTER_LIMIT = 500;
const DEFAULT_THREADS_ANGLE = "instagram-lesson-recall-v2";
const EXPOSURE_EXPERIMENT_ANGLE = "scene-question-recall-v1";
const EXPOSURE_EXPERIMENT_ID = "threads-exposure-v1-20260830";
const EXPOSURE_EXPERIMENT_PATH = path.join(__dirname, "threads-exposure-experiment.json");
const DISALLOWED_LANGUAGE_HEADINGS = /\[(?:korean|english|한국어|영어)\]/i;
const HTTP_URL_PATTERN = /https?:\/\/[^\s]+/giu;
const BARE_WEB_ADDRESS_PATTERN = /(?:www\.|\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59}))\b(?:\/[^\s]*)?/iu;
const COMMERCIAL_COPY_PATTERNS = [
  /\b(?:buy|purchase|checkout|subscribe|enroll)(?:\s+(?:now|today|here|the|our|this|your|a|an))?\b/iu,
  /\bour\s+(?:korean\s+|language\s+|online\s+)?(?:course|product|membership|subscription)\b/iu,
  /\b(?:free[- ]?trial|pricing plan|limited-time offer|membership fee|subscription fee|upgrade to (?:the |our )?(?:membership|subscription))\b/iu,
  /\b(?:join|start)\s+(?:the\s+|our\s+|a\s+)?(?:membership|subscription)\b/iu,
  /\b(?:discount code|sale ends?|save\s+\d+(?:[.,]\d+)?\s*%|\d+(?:[.,]\d+)?\s*%\s*off)\b/iu,
  /\b(?:costs?|fees?)\s*(?:is|are|:)?\s*(?:\$|€|£|₩|\d)/iu,
  /(?:\$|€|£|₩)\s*\d+(?:[.,]\d+)?/iu,
  /\b\d+(?:[.,]\d+)?\s*(?:usd|krw|eur|gbp|cad|aud|jpy|dollars?|won|euros?|pounds?|yen)\b/iu,
  /\b(?:usd|krw|eur|gbp|cad|aud|jpy)\s*\d+(?:[.,]\d+)?\b/iu,
  /(?:지금 구매|구매하기|결제하기|등록하기|우리 (?:강의|코스|상품|제품|멤버십|구독)|무료 체험|멤버십 가입|구독 신청|가격은?\s*(?:\d|₩|\$)|비용은?\s*(?:\d|₩|\$))/u,
  /continue\s+with\s+language\s+cafe/iu
];
const REQUIRED_RECEIPT_FIELDS = [
  "actionId",
  "idempotencyKey",
  "targetExpression",
  "sourcePostId",
  "instagram",
  "threads",
  "threadsLinkTargetType",
  "threadsLinkTarget",
  "threadsExternalLinkCount",
  "threadsExplicitLinkAttachmentRequested",
  "threadsPlatformPreviewState",
  "reelActionCount",
  "finalStatus",
  "evidencePath"
];
const EXPECTED_RECEIPT_PATH_PATTERN = "C:\\Users\\earth\\OneDrive\\Desktop\\codex\\instagram-card-test\\meaning-switch-series-v1\\operations\\revenue-experiment\\<testId>\\publisher-receipts\\<actionId>.json";
const ENGAGEMENT_BAIT_PATTERNS = [
  /(?:like|follow|share|comment on) (?:this|the) (?:post|thread)/i,
  /(?:leave|drop) a comment/i,
  /(?:reply|answer|respond)(?: to this)? (?:below|in (?:the )?(?:comments|replies))/i,
  /send (?:me|us) (?:a )?(?:dm|message)/i,
  /좋아요|공유|댓글|팔로우|디엠/
];
const ENGLISH_HINT_OVERRIDES = new Map([
  ["hello polite", "Hello."],
  ["hi casual", "Hi."],
  ["thank you formal", "Thank you."],
  ["thanks polite", "Thanks."],
  ["i am sorry formal", "I'm sorry."],
  ["it is okay", "It's okay."],
  ["please give me", "Please give me [something]."],
  ["this one please", "This one, please."],
  ["water please", "Water, please."],
  ["check please", "Could I have the check, please?"],
  ["a bag please", "A bag, please."],
  ["a receipt please", "A receipt, please."],
  ["it is delicious", "It's delicious."],
  ["it is fun", "It's fun."],
  ["let us take a photo together", "Let's take a photo together."],
  ["let us go together", "Let's go together."],
  ["one moment please", "One moment, please."],
  ["that is right", "That's right."],
  ["no not really", "Not really."],
  ["do not worry", "Don't worry."]
]);

function argumentValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function hasArgument(args, name) {
  return args.includes(name);
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

function countCharacters(value) {
  return Array.from(String(value || "")).length;
}

function extractHangulRuns(value) {
  return String(value || "").match(/[\u3131-\uD79D]+/g) || [];
}

function joinedStringValues(value) {
  const values = [];
  const visit = (item) => {
    if (typeof item === "string") {
      values.push(item);
      return;
    }
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    if (item && typeof item === "object") Object.values(item).forEach(visit);
  };
  visit(value);
  return values.join("\n");
}

function normalizedExpressionId(value) {
  const text = asNonemptyString(value);
  return /^\d+$/u.test(text) ? text.padStart(3, "0") : text;
}

function learningLinkUtm(expressionId) {
  return {
    source: "threads",
    medium: "organic",
    campaign: "language_cafe",
    content: `${normalizedExpressionId(expressionId)}-instagram-lesson-recall-v2`
  };
}

function buildTrackedLearningUrl(baseTarget, expressionId) {
  const url = new URL(asNonemptyString(baseTarget));
  const utm = learningLinkUtm(expressionId);
  url.searchParams.set("utm_source", utm.source);
  url.searchParams.set("utm_medium", utm.medium);
  url.searchParams.set("utm_campaign", utm.campaign);
  url.searchParams.set("utm_content", utm.content);
  return url.toString();
}

function httpUrls(value) {
  return String(value || "").match(HTTP_URL_PATTERN) || [];
}

function currentKstDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}

function currentKstTimestamp() {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date());
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}T${lookup.hour}:${lookup.minute}:${lookup.second}+09:00`;
}

function asNonemptyString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parsedTimestamp(value) {
  const text = asNonemptyString(value);
  const milliseconds = Date.parse(text);
  return text && Number.isFinite(milliseconds) ? milliseconds : null;
}

function isInside(parent, target) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function projectRelativePath(value) {
  return asNonemptyString(value).replace(/\\/gu, "/");
}

function resolveProjectEvidencePath(value, { projectRoot = PROJECT_ROOT, allowedDirectory, label } = {}) {
  const relative = projectRelativePath(value);
  if (!relative || path.isAbsolute(relative)) throw new Error(`${label}_path_must_be_project_relative`);
  const resolved = path.resolve(projectRoot, relative);
  const allowedRoot = path.resolve(projectRoot, allowedDirectory);
  const canonicalRelative = path.relative(path.resolve(projectRoot), resolved).split(path.sep).join("/");
  if (!isInside(allowedRoot, resolved) || path.extname(resolved).toLowerCase() !== ".json") {
    throw new Error(`${label}_path_outside_allowed_directory`);
  }
  if (relative !== canonicalRelative) throw new Error(`${label}_path_not_canonical`);
  return { relative, resolved };
}

function recoveryDescriptor(value) {
  return {
    supersedesJobId: asNonemptyString(value?.supersedesJobId),
    recoveryEvidencePath: projectRelativePath(value?.recoveryEvidencePath),
    recoveryEvidenceSha256: asNonemptyString(value?.recoveryEvidenceSha256).toLowerCase()
  };
}

function unresolvedPublishingApprovals(value) {
  if (!Array.isArray(value)) return true;
  const resolvedStatuses = new Set(["approved", "complete", "not_required", "resolved"]);
  return value.some((item) => !item || typeof item !== "object" || !resolvedStatuses.has(asNonemptyString(item.status)));
}

function controlReleaseErrors(control, {
  sourceJobId,
  sourceExpressionId,
  targetExpression,
  sourcePermalink,
  now = new Date()
} = {}) {
  const errors = [];
  const strategy = control?.strategy;
  const publishing = control?.publishing;
  const handoff = control?.handoff;
  const currentMilliseconds = now instanceof Date ? now.getTime() : Date.parse(now);
  const currentDate = Number.isFinite(currentMilliseconds) ? currentKstDate(new Date(currentMilliseconds)) : "";
  const periodDay1 = asNonemptyString(control?.period?.day1);
  const periodDay14 = asNonemptyString(control?.period?.day14);
  const issuedMilliseconds = parsedTimestamp(handoff?.issuedAt);
  const validUntilMilliseconds = parsedTimestamp(handoff?.validUntil);
  const consumerAction = asNonemptyString(handoff?.consumerAction);
  const isLearningPairAction = consumerAction === LEARNING_PAIR_ACTION;
  const isThreadsRecoveryAction = consumerAction === THREADS_RECOVERY_ACTION;

  if (control?.schemaVersion !== CONTROL_SCHEMA_VERSION) errors.push("control_schema_version_mismatch");
  if (!asNonemptyString(control?.testId)) errors.push("control_test_id_missing");
  if (control?.timezone !== "Asia/Seoul" || control?.asOfDate !== currentDate) {
    errors.push("control_kst_date_or_timezone_mismatch");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(periodDay1)
      || !/^\d{4}-\d{2}-\d{2}$/u.test(periodDay14)
      || currentDate < periodDay1
      || currentDate > periodDay14) {
    errors.push("control_outside_declared_period");
  }
  if (strategy?.primaryChannel !== "instagram"
      || strategy?.primaryJob !== "korean_expression_learning"
      || strategy?.threadsRole !== "native_study_companion_with_source_link"
      || strategy?.threadsStrategyVersion !== THREADS_STRATEGY_VERSION
      || strategy?.instagramRequiredBeforeThreads !== true) {
    errors.push("control_instagram_first_strategy_mismatch");
  }
  if (strategy?.threadsExternalLinkRequired !== true
      || strategy?.threadsExternalLinkCount !== 1
      || strategy?.threadsLinkPosition !== "final_line"
      || strategy?.threadsExplicitLinkAttachmentAllowed !== false
      || strategy?.threadsPlatformPreviewState !== LINK_PREVIEW_OBSERVATION
      || strategy?.threadsProductOrPriceCopyAllowed !== false
      || strategy?.threadsSalesCtaAllowed !== false
      || strategy?.threadsStudyCtaPrefix !== LEARNING_EXTENSION_CTA) {
    errors.push("control_threads_safety_strategy_mismatch");
  }
  const linkTargetType = asNonemptyString(strategy?.threadsLinkTargetType);
  const approvedLinkTarget = asNonemptyString(strategy?.threadsApprovedLinkTarget);
  if (!LINK_TARGET_TYPES.has(linkTargetType)) {
    errors.push("control_threads_link_target_missing_or_unsupported");
  } else if (linkTargetType === LINK_TARGET_SOURCE_INSTAGRAM) {
    if (strategy?.threadsLinkTargetBinding !== "derive_exactly_from_official_instagram_readback"
        || approvedLinkTarget) {
      errors.push("control_threads_source_instagram_derivation_contract_mismatch");
    }
  } else {
    errors.push("control_threads_link_target_type_must_be_source_instagram_permalink");
    let ownedTarget;
    try {
      ownedTarget = new URL(approvedLinkTarget);
    } catch {
      errors.push("control_owned_practice_target_invalid");
    }
    const expectedUtm = learningLinkUtm(sourceExpressionId);
    const actualEntries = ownedTarget ? [...ownedTarget.searchParams.entries()] : [];
    if (!ownedTarget
        || ownedTarget.protocol !== "https:"
        || !APPROVED_OWNED_SITE_HOSTS.has(ownedTarget.hostname)
        || ownedTarget.username
        || ownedTarget.password
        || ownedTarget.hash) {
      errors.push("control_owned_practice_target_not_allowlisted_https");
    }
    if (actualEntries.length !== 4
        || ownedTarget?.searchParams.get("utm_source") !== expectedUtm.source
        || ownedTarget?.searchParams.get("utm_medium") !== expectedUtm.medium
        || ownedTarget?.searchParams.get("utm_campaign") !== expectedUtm.campaign
        || ownedTarget?.searchParams.get("utm_content") !== expectedUtm.content
        || new Set(actualEntries.map(([key]) => key)).size !== 4) {
      errors.push("control_owned_practice_target_utm_mismatch");
    }
    const verification = strategy?.threadsOwnedPracticeLandingVerification;
    if (verification?.status !== "passed"
        || verification?.koreanLearningAligned !== true
        || verification?.officialReadbackStatus !== "passed"
        || asNonemptyString(verification?.approvedUrl) !== approvedLinkTarget) {
      errors.push("control_owned_practice_target_not_verified_for_korean_learning");
    }
  }
  if (!publishing
      || (isThreadsRecoveryAction ? publishing.status !== "active" : !["learning_ready", "active"].includes(publishing.status))
      || publishing.postDue !== true) {
    errors.push("control_publishing_not_due_or_ready");
  }
  if (!Number.isInteger(publishing?.maxPosts)
      || publishing.maxPosts < 1
      || publishing.maxPosts > 3
      || !Number.isInteger(publishing?.publishedCount)
      || publishing.publishedCount < 0
      || publishing.publishedCount >= publishing.maxPosts) {
    errors.push("control_learning_pair_cap_invalid_or_reached");
  }
  if (publishing?.approvalRequired !== false || unresolvedPublishingApprovals(publishing?.approvalItems)) {
    errors.push("control_publishing_approval_unresolved");
  }
  if (handoff?.contractVersion !== HANDOFF_CONTRACT_VERSION
      || (!isLearningPairAction && !isThreadsRecoveryAction)
      || handoff?.mayPublish !== true
      || (isLearningPairAction && handoff?.mayCreateMedia !== true)
      || (isThreadsRecoveryAction && handoff?.mayCreateMedia !== false)) {
    errors.push("control_learning_pair_handoff_not_authorized");
  }
  const recovery = recoveryDescriptor(handoff);
  if (isThreadsRecoveryAction) {
    if (!recovery.supersedesJobId
        || !recovery.recoveryEvidencePath
        || !/^[a-f0-9]{64}$/u.test(recovery.recoveryEvidenceSha256)) {
      errors.push("control_threads_recovery_binding_missing_or_invalid");
    }
  } else if (recovery.supersedesJobId || recovery.recoveryEvidencePath || recovery.recoveryEvidenceSha256) {
    errors.push("control_threads_recovery_binding_forbidden_for_learning_pair");
  }
  if (handoff?.threadsLinkTargetType !== LINK_TARGET_SOURCE_INSTAGRAM
      || asNonemptyString(handoff?.threadsLinkTarget)) {
    errors.push("control_handoff_source_link_derivation_mismatch");
  }
  if (!asNonemptyString(handoff?.actionId) || !asNonemptyString(handoff?.idempotencyKey)) {
    errors.push("control_handoff_identity_missing");
  }
  if (!asNonemptyString(handoff?.requestedPostId) || !asNonemptyString(handoff?.targetExpression)) {
    errors.push("control_requested_source_missing");
  }
  if (!Number.isFinite(currentMilliseconds)
      || issuedMilliseconds == null
      || validUntilMilliseconds == null
      || issuedMilliseconds > currentMilliseconds
      || currentMilliseconds > validUntilMilliseconds
      || issuedMilliseconds > validUntilMilliseconds) {
    errors.push("control_handoff_not_fresh");
  }
  if (handoff?.receiptPathPattern !== EXPECTED_RECEIPT_PATH_PATTERN) {
    errors.push("control_receipt_path_pattern_mismatch");
  }
  const receiptFields = Array.isArray(handoff?.requiredReceiptFields) ? new Set(handoff.requiredReceiptFields) : new Set();
  if (REQUIRED_RECEIPT_FIELDS.some((field) => !receiptFields.has(field))) {
    errors.push("control_required_receipt_fields_missing");
  }
  if (isThreadsRecoveryAction && !receiptFields.has("legacyRecovery")) {
    errors.push("control_threads_recovery_receipt_field_missing");
  }
  if (sourceJobId !== undefined && asNonemptyString(handoff?.requestedPostId) !== asNonemptyString(sourceJobId)) {
    errors.push("control_requested_post_id_source_mismatch");
  }
  if (targetExpression !== undefined && asNonemptyString(handoff?.targetExpression) !== asNonemptyString(targetExpression)) {
    errors.push("control_target_expression_source_mismatch");
  }
  return errors;
}

async function readControlSnapshot(controlPath = DEFAULT_CONTROL_PATH) {
  const resolvedPath = path.resolve(controlPath);
  let raw;
  try {
    raw = await fs.readFile(resolvedPath, "utf8");
  } catch (error) {
    throw new Error(`Cannot read learning-pair control at ${resolvedPath}: ${error.message}`);
  }
  let control;
  try {
    control = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Cannot parse learning-pair control at ${resolvedPath}: ${error.message}`);
  }
  return {
    control,
    controlPath: resolvedPath,
    controlSha256: sha256(raw),
    raw
  };
}

async function readRecoveryEvidenceSnapshot(value, { projectRoot = PROJECT_ROOT } = {}) {
  const descriptor = recoveryDescriptor(value?.handoff || value);
  const evidenceLocation = resolveProjectEvidencePath(descriptor.recoveryEvidencePath, {
    projectRoot,
    allowedDirectory: "content-queue/threads/recovery-evidence",
    label: "threads_recovery_evidence"
  });
  const raw = await fs.readFile(evidenceLocation.resolved, "utf8");
  const evidenceSha256 = sha256(raw);
  if (!/^[a-f0-9]{64}$/u.test(descriptor.recoveryEvidenceSha256)
      || evidenceSha256 !== descriptor.recoveryEvidenceSha256) {
    throw new Error("threads_recovery_evidence_sha256_mismatch");
  }
  let evidence;
  try {
    evidence = JSON.parse(raw);
  } catch (error) {
    throw new Error(`threads_recovery_evidence_json_invalid: ${error.message}`);
  }
  const legacyJobLocation = resolveProjectEvidencePath(evidence?.legacyJob?.path, {
    projectRoot,
    allowedDirectory: "content-queue/threads/jobs",
    label: "threads_recovery_legacy_job"
  });
  const legacyLockLocation = resolveProjectEvidencePath(evidence?.legacyLock?.path, {
    projectRoot,
    allowedDirectory: "content-queue/threads/.publish-locks",
    label: "threads_recovery_legacy_lock"
  });
  const [legacyJobRaw, legacyLockRaw] = await Promise.all([
    fs.readFile(legacyJobLocation.resolved, "utf8"),
    fs.readFile(legacyLockLocation.resolved, "utf8")
  ]);
  let legacyJob;
  let legacyLock;
  try {
    legacyJob = JSON.parse(legacyJobRaw);
    legacyLock = JSON.parse(legacyLockRaw);
  } catch (error) {
    throw new Error(`threads_recovery_legacy_artifact_json_invalid: ${error.message}`);
  }
  return {
    descriptor,
    projectRoot: path.resolve(projectRoot),
    evidencePath: evidenceLocation.relative,
    evidenceResolvedPath: evidenceLocation.resolved,
    evidenceSha256,
    raw,
    evidence,
    legacyJobPath: legacyJobLocation.relative,
    legacyJobResolvedPath: legacyJobLocation.resolved,
    legacyJobRaw,
    legacyJob,
    legacyLockPath: legacyLockLocation.relative,
    legacyLockResolvedPath: legacyLockLocation.resolved,
    legacyLockRaw,
    legacyLock
  };
}

function recoveryEvidenceErrors({
  descriptor: descriptorValue,
  evidenceSnapshot,
  supersedingJobId,
  sourceCarouselJobId,
  sourceExpressionId,
  targetExpression,
  instagramMediaId,
  instagramPermalink
} = {}) {
  const errors = [];
  const descriptor = recoveryDescriptor(descriptorValue);
  const snapshot = evidenceSnapshot;
  const evidence = snapshot?.evidence;
  const legacyJob = snapshot?.legacyJob;
  const legacyLock = snapshot?.legacyLock;
  const expectedJobHash = asNonemptyString(evidence?.legacyJob?.sha256).toLowerCase();
  const expectedLockHash = asNonemptyString(evidence?.legacyLock?.sha256).toLowerCase();

  if (!snapshot || !evidence || !legacyJob || !legacyLock) return ["threads_recovery_evidence_snapshot_missing"];
  if (descriptor.supersedesJobId !== asNonemptyString(evidence?.legacyJob?.id)
      || descriptor.supersedesJobId !== asNonemptyString(legacyJob?.id)) {
    errors.push("threads_recovery_superseded_job_id_mismatch");
  }
  if (descriptor.recoveryEvidencePath !== snapshot.evidencePath
      || descriptor.recoveryEvidenceSha256 !== snapshot.evidenceSha256
      || sha256(snapshot.raw) !== descriptor.recoveryEvidenceSha256) {
    errors.push("threads_recovery_evidence_binding_mismatch");
  }
  if (evidence?.schemaVersion !== 1
      || evidence?.evidenceType !== RECOVERY_EVIDENCE_TYPE
      || evidence?.immutable !== true) {
    errors.push("threads_recovery_evidence_contract_invalid");
  }
  if (snapshot.legacyJobPath !== projectRelativePath(evidence?.legacyJob?.path)
      || !/^[a-f0-9]{64}$/u.test(expectedJobHash)
      || sha256(snapshot.legacyJobRaw) !== expectedJobHash) {
    errors.push("threads_recovery_legacy_job_hash_mismatch");
  }
  if (snapshot.legacyLockPath !== projectRelativePath(evidence?.legacyLock?.path)
      || !/^[a-f0-9]{64}$/u.test(expectedLockHash)
      || sha256(snapshot.legacyLockRaw) !== expectedLockHash) {
    errors.push("threads_recovery_legacy_lock_hash_mismatch");
  }
  if (asNonemptyString(evidence?.supersedingJobId) !== asNonemptyString(supersedingJobId)) {
    errors.push("threads_recovery_superseding_job_id_mismatch");
  }
  if (asNonemptyString(evidence?.source?.carouselJobId) !== asNonemptyString(sourceCarouselJobId)
      || asNonemptyString(legacyJob?.source?.sourceCarouselJobId) !== asNonemptyString(sourceCarouselJobId)
      || asNonemptyString(evidence?.source?.expressionId) !== asNonemptyString(sourceExpressionId)
      || asNonemptyString(legacyJob?.source?.expressionId) !== asNonemptyString(sourceExpressionId)
      || asNonemptyString(evidence?.source?.expression) !== asNonemptyString(targetExpression)
      || asNonemptyString(legacyJob?.source?.expression) !== asNonemptyString(targetExpression)) {
    errors.push("threads_recovery_source_or_expression_mismatch");
  }
  if (asNonemptyString(evidence?.source?.instagramMediaId) !== asNonemptyString(instagramMediaId)
      || asNonemptyString(evidence?.source?.instagramPermalink) !== asNonemptyString(instagramPermalink)) {
    errors.push("threads_recovery_instagram_readback_mismatch");
  }
  if (evidence?.legacyContainer?.status !== "FINISHED"
      || !asNonemptyString(evidence?.legacyContainer?.id)
      || evidence?.legacyContainer?.officialReadbackHttpStatus !== 200
      || evidence?.legacyContainer?.errorMessagePresent !== false
      || legacyLock?.channel !== "threads"
      || legacyLock?.stage !== "publishing_text_container"
      || asNonemptyString(legacyLock?.jobId) !== descriptor.supersedesJobId
      || asNonemptyString(legacyLock?.containerId) !== asNonemptyString(evidence?.legacyContainer?.id)) {
    errors.push("threads_recovery_legacy_container_not_safely_abandoned");
  }
  if (evidence?.officialThreadsRecentReadback?.normalizedLegacyFullTextMatchCount !== 0
      || evidence?.officialThreadsRecentReadback?.targetHangulMatchCount !== 0
      || evidence?.officialThreadsRecentReadback?.exactNoPublicMatch !== true) {
    errors.push("threads_recovery_official_zero_match_evidence_missing");
  }
  if (evidence?.resolution !== RECOVERY_RESOLUTION || evidence?.retryOriginalContainerAllowed !== false) {
    errors.push("threads_recovery_resolution_not_abandoned");
  }
  if (legacyJob?.workflow?.status !== "blocked"
      || legacyJob?.review?.publisher?.status !== "ambiguous_result_manual_readback_required"
      || asNonemptyString(legacyJob?.review?.publisher?.containerId) !== asNonemptyString(evidence?.legacyContainer?.id)
      || legacyJob?.review?.publisher?.containerStatus !== "FINISHED"
      || legacyJob?.review?.publisher?.normalizedFullTextMatchCount !== 0
      || legacyJob?.review?.publisher?.targetHangulMatchCount !== 0
      || legacyJob?.review?.publisher?.lockRetained !== true) {
    errors.push("threads_recovery_legacy_job_not_blocked_ambiguous");
  }
  return [...new Set(errors)];
}

function createRecoveryBinding({ control, evidenceSnapshot }) {
  if (asNonemptyString(control?.handoff?.consumerAction) !== THREADS_RECOVERY_ACTION) return null;
  const evidence = evidenceSnapshot.evidence;
  return {
    consumerAction: THREADS_RECOVERY_ACTION,
    supersedesJobId: asNonemptyString(control.handoff.supersedesJobId),
    recoveryEvidencePath: evidenceSnapshot.evidencePath,
    recoveryEvidenceSha256: evidenceSnapshot.evidenceSha256,
    legacyJobPath: evidenceSnapshot.legacyJobPath,
    legacyJobSha256: asNonemptyString(evidence?.legacyJob?.sha256).toLowerCase(),
    legacyLockPath: evidenceSnapshot.legacyLockPath,
    legacyLockSha256: asNonemptyString(evidence?.legacyLock?.sha256).toLowerCase(),
    sourceCarouselJobId: asNonemptyString(evidence?.source?.carouselJobId),
    targetExpression: asNonemptyString(evidence?.source?.expression),
    legacyContainerId: asNonemptyString(evidence?.legacyContainer?.id),
    resolution: asNonemptyString(evidence?.resolution)
  };
}

async function validateRecoveryBinding(job, { projectRoot = PROJECT_ROOT } = {}) {
  const errors = [];
  const consumerAction = asNonemptyString(job?.controlBinding?.consumerAction);
  const binding = job?.recoveryBinding;
  if (consumerAction !== THREADS_RECOVERY_ACTION) {
    if (binding !== undefined && binding !== null) errors.push("threads_recovery_binding_forbidden_for_learning_pair");
    return { passed: errors.length === 0, errors, allowance: null, snapshot: null };
  }
  if (!binding || typeof binding !== "object") {
    return { passed: false, errors: ["threads_recovery_binding_missing"], allowance: null, snapshot: null };
  }
  const required = [
    "consumerAction",
    "supersedesJobId",
    "recoveryEvidencePath",
    "recoveryEvidenceSha256",
    "legacyJobPath",
    "legacyJobSha256",
    "legacyLockPath",
    "legacyLockSha256",
    "sourceCarouselJobId",
    "targetExpression",
    "legacyContainerId",
    "resolution"
  ];
  for (const field of required) {
    if (!asNonemptyString(binding[field])) errors.push(`threads_recovery_binding_${field}_missing`);
  }
  let snapshot = null;
  try {
    snapshot = await readRecoveryEvidenceSnapshot(binding, { projectRoot });
  } catch (error) {
    errors.push(asNonemptyString(error?.message) || "threads_recovery_evidence_read_failed");
  }
  if (snapshot) {
    errors.push(...recoveryEvidenceErrors({
      descriptor: binding,
      evidenceSnapshot: snapshot,
      supersedingJobId: job?.id,
      sourceCarouselJobId: job?.source?.sourceCarouselJobId,
      sourceExpressionId: job?.source?.expressionId,
      targetExpression: job?.source?.expression,
      instagramMediaId: job?.source?.sourceCarouselMediaId,
      instagramPermalink: job?.source?.sourceCarouselPermalink
    }));
    const expected = {
      consumerAction: THREADS_RECOVERY_ACTION,
      supersedesJobId: asNonemptyString(snapshot?.evidence?.legacyJob?.id),
      recoveryEvidencePath: snapshot.evidencePath,
      recoveryEvidenceSha256: snapshot.evidenceSha256,
      legacyJobPath: snapshot.legacyJobPath,
      legacyJobSha256: asNonemptyString(snapshot?.evidence?.legacyJob?.sha256).toLowerCase(),
      legacyLockPath: snapshot.legacyLockPath,
      legacyLockSha256: asNonemptyString(snapshot?.evidence?.legacyLock?.sha256).toLowerCase(),
      sourceCarouselJobId: asNonemptyString(snapshot?.evidence?.source?.carouselJobId),
      targetExpression: asNonemptyString(snapshot?.evidence?.source?.expression),
      legacyContainerId: asNonemptyString(snapshot?.evidence?.legacyContainer?.id),
      resolution: RECOVERY_RESOLUTION
    };
    for (const [field, expectedValue] of Object.entries(expected)) {
      if (asNonemptyString(binding[field]) !== expectedValue) errors.push(`threads_recovery_binding_${field}_mismatch`);
    }
  }
  const uniqueErrors = [...new Set(errors)];
  return {
    passed: uniqueErrors.length === 0,
    errors: uniqueErrors,
    allowance: uniqueErrors.length === 0 ? {
      supersedesJobId: asNonemptyString(binding.supersedesJobId),
      legacyJobResolvedPath: snapshot.legacyJobResolvedPath
    } : null,
    snapshot
  };
}

function createControlBinding({ control, controlPath, controlSha256, sourceLinkTarget }) {
  return {
    testId: asNonemptyString(control?.testId),
    actionId: asNonemptyString(control?.handoff?.actionId),
    idempotencyKey: asNonemptyString(control?.handoff?.idempotencyKey),
    controlPath: path.resolve(asNonemptyString(controlPath)),
    controlSha256: asNonemptyString(controlSha256),
    requestedPostId: asNonemptyString(control?.handoff?.requestedPostId),
    targetExpression: asNonemptyString(control?.handoff?.targetExpression),
    validUntil: asNonemptyString(control?.handoff?.validUntil),
    contractVersion: asNonemptyString(control?.handoff?.contractVersion),
    consumerAction: asNonemptyString(control?.handoff?.consumerAction),
    strategyVersion: asNonemptyString(control?.strategy?.threadsStrategyVersion),
    linkTargetType: asNonemptyString(control?.strategy?.threadsLinkTargetType),
    sourceLinkTarget: asNonemptyString(sourceLinkTarget)
  };
}

function controlBindingErrors(job, { now = new Date(), expectedControlPath = DEFAULT_CONTROL_PATH } = {}) {
  const errors = [];
  const binding = job?.controlBinding;
  const required = [
    "testId",
    "actionId",
    "idempotencyKey",
    "controlPath",
    "controlSha256",
    "requestedPostId",
    "targetExpression",
    "validUntil",
    "contractVersion",
    "consumerAction",
    "strategyVersion",
    "linkTargetType",
    "sourceLinkTarget"
  ];
  if (!binding || typeof binding !== "object") return ["control_binding_missing"];
  for (const field of required) {
    if (!asNonemptyString(binding[field])) errors.push(`control_binding_${field}_missing`);
  }
  if (!path.isAbsolute(asNonemptyString(binding.controlPath))) errors.push("control_binding_path_must_be_absolute");
  if (path.resolve(asNonemptyString(binding.controlPath)).toLocaleLowerCase("en-US")
      !== path.resolve(expectedControlPath).toLocaleLowerCase("en-US")) {
    errors.push("control_binding_path_not_canonical");
  }
  if (!/^[a-f0-9]{64}$/u.test(asNonemptyString(binding.controlSha256))) errors.push("control_binding_sha256_invalid");
  if (binding.contractVersion !== HANDOFF_CONTRACT_VERSION) errors.push("control_binding_contract_version_mismatch");
  if (![LEARNING_PAIR_ACTION, THREADS_RECOVERY_ACTION].includes(binding.consumerAction)) errors.push("control_binding_consumer_action_mismatch");
  if (binding.strategyVersion !== THREADS_STRATEGY_VERSION) errors.push("control_binding_strategy_version_mismatch");
  if (binding.linkTargetType !== LINK_TARGET_SOURCE_INSTAGRAM) errors.push("control_binding_link_target_type_mismatch");
  if (binding.sourceLinkTarget !== job?.source?.sourceCarouselPermalink) errors.push("control_binding_source_link_target_mismatch");
  if (binding.requestedPostId !== job?.source?.sourceCarouselJobId) errors.push("control_binding_requested_post_id_mismatch");
  if (binding.targetExpression !== job?.source?.expression) errors.push("control_binding_target_expression_mismatch");
  const validUntilMilliseconds = parsedTimestamp(binding.validUntil);
  const currentMilliseconds = now instanceof Date ? now.getTime() : Date.parse(now);
  if (validUntilMilliseconds == null || !Number.isFinite(currentMilliseconds) || currentMilliseconds > validUntilMilliseconds) {
    errors.push("control_binding_expired");
  }
  return errors;
}

function validateControlSnapshotForJob(job, snapshot, { now = new Date(), expectedControlPath = DEFAULT_CONTROL_PATH } = {}) {
  const errors = [];
  const control = snapshot?.control;
  const binding = job?.controlBinding;
  const raw = typeof snapshot?.raw === "string" ? snapshot.raw : "";
  const snapshotHash = raw ? sha256(raw) : asNonemptyString(snapshot?.controlSha256);
  const snapshotPath = path.resolve(asNonemptyString(snapshot?.controlPath));
  errors.push(...controlReleaseErrors(control, {
    sourceJobId: job?.source?.sourceCarouselJobId,
    sourceExpressionId: job?.source?.expressionId,
    targetExpression: job?.source?.expression,
    sourcePermalink: job?.source?.sourceCarouselPermalink,
    now
  }));
  errors.push(...controlBindingErrors(job, { now, expectedControlPath }));
  if (snapshotPath.toLocaleLowerCase("en-US") !== path.resolve(expectedControlPath).toLocaleLowerCase("en-US")) {
    errors.push("control_snapshot_path_not_canonical");
  }
  if (!binding || snapshotPath !== path.resolve(asNonemptyString(binding.controlPath))) {
    errors.push("control_path_mismatch");
  }
  if (!snapshotHash || snapshotHash !== asNonemptyString(binding?.controlSha256)) {
    errors.push("control_sha256_mismatch");
  }
  const expectedBinding = createControlBinding({
    control,
    controlPath: snapshotPath,
    controlSha256: snapshotHash,
    sourceLinkTarget: job?.source?.sourceCarouselPermalink
  });
  for (const field of ["testId", "actionId", "idempotencyKey", "requestedPostId", "targetExpression", "validUntil", "contractVersion", "consumerAction", "strategyVersion", "linkTargetType", "sourceLinkTarget"]) {
    if (asNonemptyString(binding?.[field]) !== asNonemptyString(expectedBinding[field])) {
      errors.push(`control_${field}_changed`);
    }
  }
  const controlRecovery = recoveryDescriptor(control?.handoff);
  const jobRecovery = recoveryDescriptor(job?.recoveryBinding);
  if (asNonemptyString(control?.handoff?.consumerAction) === THREADS_RECOVERY_ACTION) {
    for (const field of ["supersedesJobId", "recoveryEvidencePath", "recoveryEvidenceSha256"]) {
      if (controlRecovery[field] !== jobRecovery[field]) errors.push(`control_recovery_${field}_changed`);
    }
  } else if (job?.recoveryBinding !== undefined && job?.recoveryBinding !== null) {
    errors.push("control_recovery_binding_not_authorized");
  }
  return { passed: errors.length === 0, errors: [...new Set(errors)] };
}

function assertDate(dateValue) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateValue || ""))) {
    throw new Error("Use --date YYYY-MM-DD.");
  }
  const date = new Date(`${dateValue}T00:00:00Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== dateValue) {
    throw new Error("Use a real calendar date for --date.");
  }
  return dateValue;
}

function projectPath(inputPath) {
  return path.isAbsolute(inputPath) ? inputPath : path.resolve(PROJECT_ROOT, inputPath);
}

function displayProjectPath(filePath) {
  const relative = path.relative(PROJECT_ROOT, filePath);
  return relative && !relative.startsWith("..") ? relative.split(path.sep).join("/") : filePath;
}

function firstLower(value) {
  const text = String(value || "").trim();
  return text ? `${text.slice(0, 1).toLocaleLowerCase("en-US")}${text.slice(1)}` : "a real everyday situation";
}

function naturalEnglishMeaning(value) {
  const raw = String(value || "").trim();
  const override = ENGLISH_HINT_OVERRIDES.get(normalizeText(raw));
  if (override) return override;
  if (!raw) return "Use this line in that moment.";
  const sentence = `${raw.slice(0, 1).toLocaleUpperCase("en-US")}${raw.slice(1)}`;
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

function sourceReview(job, name) {
  return job?.workflow?.[name] || job?.[name] || null;
}

function reviewPassed(review) {
  return Boolean(review && (review.review === "passed" || review.status === "passed" || review.guidelineReview === "passed"));
}

function evidenceText(value, fallback) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object") return JSON.stringify(value);
  return fallback;
}

function sourceEligibilityErrors(carouselJob) {
  const errors = [];
  if (carouselJob?.workflow?.status !== "published") {
    errors.push("source_carousel_not_published");
  }
  for (const reviewName of ["naturalKoreanReview", "globalLearnerReview", "distributionReview"]) {
    if (!reviewPassed(sourceReview(carouselJob, reviewName))) {
      errors.push(`source_${reviewName}_not_passed`);
    }
  }
  const postPublishVerification = sourceReview(carouselJob, "postPublishVerification");
  const matchedMediaId = asNonemptyString(postPublishVerification?.matchedMediaId);
  const officialPermalink = asNonemptyString(postPublishVerification?.permalink);
  const publishedMediaId = asNonemptyString(carouselJob?.published?.mediaId);
  const publishedVerification = carouselJob?.published?.verification;
  if (postPublishVerification?.status !== "passed"
      || postPublishVerification?.review !== "passed"
      || postPublishVerification?.source !== "official_instagram_graph_api_recent_media"
      || postPublishVerification?.mediaIdMatchCount !== 1
      || postPublishVerification?.normalizedFullCaptionMatchCount !== 1
      || postPublishVerification?.sameHangulExpressionMatchCount !== 1
      || postPublishVerification?.exactOnePublishedJobConfirmed !== true) {
    errors.push("source_post_publish_verification_not_passed");
  }
  if (!matchedMediaId || !publishedMediaId || matchedMediaId !== publishedMediaId) {
    errors.push("source_official_media_id_mismatch");
  }
  if (!/^https:\/\/(?:www\.)?instagram\.com\/p\/[A-Za-z0-9_-]+\/?$/u.test(officialPermalink)) {
    errors.push("source_official_instagram_permalink_invalid");
  }
  if (postPublishVerification?.mediaType !== "CAROUSEL_ALBUM") {
    errors.push("source_official_media_type_not_carousel");
  }
  if (asNonemptyString(publishedVerification?.id) !== matchedMediaId
      || publishedVerification?.media_type !== "CAROUSEL_ALBUM"
      || asNonemptyString(publishedVerification?.permalink) !== officialPermalink) {
    errors.push("source_published_receipt_crosscheck_failed");
  }
  const source = carouselJob?.source || {};
  for (const field of ["expressionId", "expression", "englishHint", "scene"]) {
    if (!String(source[field] || "").trim()) errors.push(`source_missing_${field}`);
  }
  return errors;
}

function buildPrimaryPost({ expressionId, expression, englishHint, scene, linkTargetType, approvedLinkTarget, angle = DEFAULT_THREADS_ANGLE }) {
  if (angle !== DEFAULT_THREADS_ANGLE) {
    throw new Error(`Threads angle must use ${DEFAULT_THREADS_ANGLE}.`);
  }
  const useContext = firstLower(scene).replace(/[.!?]+$/, "");
  const learningUrl = linkTargetType === LINK_TARGET_OWNED_PRACTICE
    ? buildTrackedLearningUrl(approvedLinkTarget, expressionId)
    : asNonemptyString(approvedLinkTarget);
  return [
    `Imagine you're ${useContext}.`,
    "",
    "Try this Korean line:",
    expression,
    "",
    `It means: “${String(englishHint).trim()}”`,
    "",
    "Say it once for this situation. In 3 minutes, try again without looking.",
    "",
    `${LEARNING_EXTENSION_CTA} ${learningUrl}`
  ].join("\n");
}

function initialReviewEvidence(carouselJob) {
  const naturalKorean = sourceReview(carouselJob, "naturalKoreanReview");
  const globalLearner = sourceReview(carouselJob, "globalLearnerReview");
  const distribution = sourceReview(carouselJob, "distributionReview");
  const readback = sourceReview(carouselJob, "postPublishVerification");
  return {
    sourceNaturalKoreanEvidence: evidenceText(naturalKorean?.evidence, "The published carousel's Korean review is recorded as passed."),
    sourceGlobalLearnerEvidence: evidenceText(globalLearner?.evidence, "The published carousel's global learner review is recorded as passed."),
    sourceDistributionEvidence: evidenceText(distribution?.evidence, "The published carousel's distribution review is recorded as passed."),
    sourcePostPublishEvidence: readback?.permalink || carouselJob?.published?.verification?.permalink || carouselJob?.published?.permalink || "Official source post readback is recorded as passed."
  };
}

function createThreadsDraft({
  carouselJob,
  carouselJobPath,
  controlSnapshot,
  recoveryEvidenceSnapshot,
  date,
  angle = DEFAULT_THREADS_ANGLE,
  now = new Date(),
  expectedControlPath = DEFAULT_CONTROL_PATH
}) {
  const sourceErrors = sourceEligibilityErrors(carouselJob);
  if (sourceErrors.length) {
    throw new Error(`Source carousel is not eligible: ${sourceErrors.join(", ")}`);
  }
  const snapshotPath = asNonemptyString(controlSnapshot?.controlPath);
  const snapshotRaw = typeof controlSnapshot?.raw === "string" ? controlSnapshot.raw : "";
  const snapshotHash = asNonemptyString(controlSnapshot?.controlSha256);
  const calculatedHash = snapshotRaw ? sha256(snapshotRaw) : "";
  const controlErrors = controlReleaseErrors(controlSnapshot?.control, {
    sourceJobId: carouselJob?.id,
    sourceExpressionId: carouselJob?.source?.expressionId,
    targetExpression: carouselJob?.source?.expression,
    sourcePermalink: carouselJob?.workflow?.postPublishVerification?.permalink,
    now
  });
  if (!snapshotPath || !path.isAbsolute(snapshotPath)) controlErrors.push("control_snapshot_path_invalid");
  if (snapshotPath
      && path.resolve(snapshotPath).toLocaleLowerCase("en-US") !== path.resolve(expectedControlPath).toLocaleLowerCase("en-US")) {
    controlErrors.push("control_snapshot_path_not_canonical");
  }
  if (!snapshotRaw || !snapshotHash || calculatedHash !== snapshotHash) controlErrors.push("control_snapshot_hash_invalid");
  if (controlErrors.length) {
    throw new Error(`Learning-pair control is not eligible: ${[...new Set(controlErrors)].join(", ")}`);
  }
  if (angle !== DEFAULT_THREADS_ANGLE) {
    throw new Error(`Threads strategy ${THREADS_STRATEGY_VERSION} requires angle ${DEFAULT_THREADS_ANGLE}.`);
  }
  const source = carouselJob.source;
  const id = `${date}-expression-${String(source.expressionId).padStart(3, "0")}-threads-${angle}`;
  const consumerAction = asNonemptyString(controlSnapshot?.control?.handoff?.consumerAction);
  if (consumerAction === THREADS_RECOVERY_ACTION) {
    const recoveryErrors = recoveryEvidenceErrors({
      descriptor: controlSnapshot.control.handoff,
      evidenceSnapshot: recoveryEvidenceSnapshot,
      supersedingJobId: id,
      sourceCarouselJobId: carouselJob?.id,
      sourceExpressionId: source?.expressionId,
      targetExpression: source?.expression,
      instagramMediaId: carouselJob?.workflow?.postPublishVerification?.matchedMediaId,
      instagramPermalink: carouselJob?.workflow?.postPublishVerification?.permalink
    });
    if (recoveryErrors.length) {
      throw new Error(`Threads recovery evidence is not eligible: ${recoveryErrors.join(", ")}`);
    }
  } else if (recoveryEvidenceSnapshot) {
    throw new Error("Threads recovery evidence is forbidden for a normal learning-pair draft.");
  }
  const linkTargetType = asNonemptyString(controlSnapshot?.control?.strategy?.threadsLinkTargetType);
  const approvedLinkTarget = asNonemptyString(carouselJob?.workflow?.postPublishVerification?.permalink);
  const englishMeaning = naturalEnglishMeaning(source.englishHint);
  const primaryPost = buildPrimaryPost({
    expressionId: source.expressionId,
    expression: source.expression,
    englishHint: englishMeaning,
    scene: source.scene,
    linkTargetType,
    approvedLinkTarget,
    angle
  });
  const normalizedPrimaryPost = normalizeText(primaryPost);
  const normalizedSourceCaption = normalizeText(carouselJob?.instagram?.caption || "");
  const sourceEvidence = initialReviewEvidence(carouselJob);
  const recoveryBinding = createRecoveryBinding({ control: controlSnapshot.control, evidenceSnapshot: recoveryEvidenceSnapshot });

  return {
    schemaVersion: 5,
    strategyVersion: THREADS_STRATEGY_VERSION,
    controlBinding: createControlBinding({
      control: controlSnapshot.control,
      controlPath: snapshotPath,
      controlSha256: snapshotHash,
      sourceLinkTarget: approvedLinkTarget
    }),
    ...(recoveryBinding ? { recoveryBinding } : {}),
    channel: "threads",
    series: "Language Cafe Korean Conversation",
    id,
    title: `${source.expression} — ${String(source.scene).trim()}`,
    channelStrategy: {
      strategyVersion: THREADS_STRATEGY_VERSION,
      instagramRole: "canonical_full_korean_expression_lesson",
      threadsRole: "distinct_text_only_native_study_companion",
      instagramMustPublishAndPassOfficialReadbackFirst: true,
      sameExpressionSourceRequired: true,
      duplicateFullCaptionForbidden: true,
      siteTrafficObjective: false,
      sourceInstagramLessonLinkRequired: true
    },
    automation: {
      pipeline: "threads-learning-pair-pipeline-v3",
      generator: "content-queue/threads/prepare-threads-draft.cjs",
      publisher: "content-queue/threads/publish-threads.cjs",
      publisherDefaultMode: "dry_run",
      publisherRequiresExplicitFlag: "--publish",
      sessionPath: "C:\\Users\\earth\\.codex\\threads\\session.json",
      duplicateScope: ["source_carousel_job_id", "source_expression_id", "normalized_primary_post_hash"],
      createdAtKst: currentKstTimestamp(),
      sourceSelection: "published_carousel_job_read_only",
      sourcePath: displayProjectPath(carouselJobPath),
      googleSheetStatusMutation: "not_attempted",
      postToThreadsAttempted: false,
      postToThreadsCommandRun: false,
      automatedRepliesAllowed: false,
      automatedDirectMessagesAllowed: false,
      automaticThreadsPublication: true,
      preparationOnly: true,
      standingDirectPostAuthorizationSource: "user_authorized_threads_text_post_automation"
    },
    source: {
      expressionId: String(source.expressionId),
      expression: source.expression,
      englishHint: source.englishHint,
      englishMeaning,
      romanization: source.romanization || null,
      scene: source.scene,
      sourceCarouselJob: displayProjectPath(carouselJobPath),
      sourceCarouselJobId: carouselJob.id || null,
      sourceCarouselWorkflowStatus: carouselJob.workflow.status,
      sourceCarouselMediaId: carouselJob?.workflow?.postPublishVerification?.matchedMediaId || null,
      sourceCarouselPermalink: carouselJob?.workflow?.postPublishVerification?.permalink || null,
      sourceCarouselCaptionNormalizedHash: sha256(normalizedSourceCaption),
      sourceCarouselReadbackPassed: true,
      selectionReadOnly: true,
      distinctAngle: "A short native recall loop sourced from the complete Instagram lesson, followed by its exact official Instagram carousel permalink."
    },
    copy: {
      strategyVersion: THREADS_STRATEGY_VERSION,
      angle,
      languageOrder: ["en", "ko"],
      publicLanguageHeadingsForbidden: true,
      englishInstructionRequired: true,
      hangulAllowedOnlyFor: ["real_dialogue", "target_expression", "necessary_korean_components", "one_limited_pronunciation_line"],
      allowedHangulLines: [source.expression],
      primaryPost,
      normalizedPrimaryPostHash: sha256(normalizedPrimaryPost),
      primaryPostCharacterCount: countCharacters(primaryPost),
      hardCharacterLimit: HARD_CHARACTER_LIMIT,
      workingCharacterRange: { min: WORKING_CHARACTER_MINIMUM, max: WORKING_CHARACTER_MAXIMUM },
      optionalThreeMinuteSelfReply: null,
      learningExtensionCta: LEARNING_EXTENSION_CTA,
      cta: LEARNING_EXTENSION_CTA,
      externalLinkCount: 1,
      explicitLinkAttachmentRequested: false,
      linkPreviewPolicy: LINK_PREVIEW_POLICY,
      platformPreviewState: LINK_PREVIEW_OBSERVATION,
      link: {
        targetType: linkTargetType,
        approvedTarget: approvedLinkTarget,
        publicUrl: approvedLinkTarget,
        relationship: "official_instagram_visual_lesson_review",
        utm: null
      },
      productPriceOrSalesCopyAllowed: false,
      legacyExposureExperimentEnrollment: "retired"
    },
    workflow: {
      status: "approved",
      autoPublish: true,
      manualPostDecisionRequired: false,
      standingDirectPostAuthorization: true,
      standingDirectPostAuthorizationScope: "language_cafe_threads_text_post_only",
      automatedRepliesAllowed: false,
      automatedDirectMessagesAllowed: false,
      postToThreadsCommandRun: false
    },
    review: {
      status: "automated_learning_companion_checks_passed_standing_direct_post_authorized",
      sourceEligibility: {
        status: "passed",
        evidence: sourceEvidence
      },
      naturalKorean: {
        translationeseDetected: false,
        everydaySpeechConfirmed: true,
        readAloudConfirmed: true,
        inheritedFromPublishedCarousel: true,
        evidence: "The target Hangul line is copied verbatim from the paired officially published carousel. " + sourceEvidence.sourceNaturalKoreanEvidence
      },
      globalLearner: {
        englishBridgeConfirmed: true,
        instructionLanguageConfirmed: true,
        hangulUsageLimited: true,
        romanizationLimited: true,
        inheritedFromPublishedCarousel: true,
        evidence: `The draft uses English for the scene, meaning, recall instruction, and final Instagram visual-lesson review CTA. Hangul is limited to the source dialogue line, and the only public URL is the exact official carousel permalink. ${sourceEvidence.sourceGlobalLearnerEvidence}`
      },
      distribution: {
        originalityConfirmed: true,
        engagementBaitDetected: false,
        duplicateFullCaptionChecked: true,
        sourceExpressionDuplicateChecked: true,
        humanPostDecisionRecorded: false,
        standingAuthorizationRecorded: true,
        standingDirectPostAuthorization: true,
        externalLinkCount: 1,
        explicitLinkAttachmentRequested: false,
        platformPreviewState: LINK_PREVIEW_OBSERVATION,
        sourceInstagramPermalinkConfirmed: true,
        learningExtensionCtaLastConfirmed: true,
        strategyVersionConfirmed: true,
        evidence: `The draft has no image, watermark, explicit link attachment, product/price/sales copy, copied carousel caption, engagement demand, API action, reply, or DM. It ends with exactly one URL: the source carousel's official Instagram permalink, without UTM parameters. Platform-generated preview rendering is not exposed by this pre-publication check and remains ${LINK_PREVIEW_OBSERVATION}. ${sourceEvidence.sourceDistributionEvidence}`
      },
      qualityRubric: {
        accuracy: 4,
        completeness: 4,
        practicality: 4,
        revenueContribution: 4,
        total: 16,
        maximum: 16,
        result: "passed",
        evidence: "Automated source, copy, language, character-count, final visual-lesson CTA, exact official Instagram permalink, no explicit link attachment, strategy-version, and local duplicate checks passed. Keeping the learner in the verified Korean lesson loop protects brand trust before any future aligned offer; this is an indirect revenue contribution, not observed revenue. Preparation made no API request."
      }
    },
    measurement: {
      learningStage: "instagram_full_lesson_to_threads_native_recall_to_instagram_visual_review",
      evidenceStatus: "unverified_priority",
      metrics: {
        views: { value: null, status: "unavailable" },
        likes: { value: null, status: "unavailable" },
        replies: { value: null, status: "unavailable" },
        reposts: { value: null, status: "unavailable" },
        quotes: { value: null, status: "unavailable" },
        shares: { value: null, status: "unavailable" },
        profileVisits: { value: null, status: "unavailable" },
        linkClicks: { value: null, status: "unavailable" },
        instagramLessonVisits: { value: null, status: "unavailable" }
      }
    }
  };
}

async function readJson(filePath, label) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read ${label} JSON at ${filePath}: ${error.message}`);
  }
}

async function findLocalDuplicates({ job, jobsDir, ignoredPath, recoveryAllowance = null }) {
  let entries;
  try {
    entries = await fs.readdir(jobsDir, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === "ENOENT") return [];
    throw new Error(`Cannot inspect local Threads jobs: ${error.message}`);
  }
  const duplicates = [];
  const ignoredResolved = ignoredPath ? path.resolve(ignoredPath) : null;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const candidatePath = path.join(jobsDir, entry.name);
    if (ignoredResolved && path.resolve(candidatePath) === ignoredResolved) continue;
    let candidate;
    try {
      candidate = JSON.parse(await fs.readFile(candidatePath, "utf8"));
    } catch {
      continue;
    }
    if (candidate?.channel !== "threads") continue;
    const sameExpression = String(candidate?.source?.expressionId || "") === String(job?.source?.expressionId || "");
    const sameCopy = candidate?.copy?.normalizedPrimaryPostHash === job?.copy?.normalizedPrimaryPostHash;
    const actionId = asNonemptyString(job?.controlBinding?.actionId);
    const idempotencyKey = asNonemptyString(job?.controlBinding?.idempotencyKey);
    const sameAction = Boolean(actionId) && asNonemptyString(candidate?.controlBinding?.actionId) === actionId;
    const sameIdempotencyKey = Boolean(idempotencyKey)
      && asNonemptyString(candidate?.controlBinding?.idempotencyKey) === idempotencyKey;
    const exactRecoverableLegacyExpression = Boolean(recoveryAllowance)
      && sameExpression
      && !sameCopy
      && !sameAction
      && !sameIdempotencyKey
      && asNonemptyString(candidate?.id) === asNonemptyString(recoveryAllowance?.supersedesJobId)
      && path.resolve(candidatePath) === path.resolve(asNonemptyString(recoveryAllowance?.legacyJobResolvedPath));
    if (exactRecoverableLegacyExpression) continue;
    if (sameExpression || sameCopy || sameAction || sameIdempotencyKey) {
      duplicates.push({
        path: displayProjectPath(candidatePath),
        reason: sameExpression
          ? "duplicate_source_expression"
          : sameCopy
            ? "duplicate_normalized_primary_post"
            : sameAction
              ? "duplicate_control_action_id"
              : "duplicate_control_idempotency_key",
        id: candidate.id || null,
        workflowStatus: candidate?.workflow?.status || null
      });
    }
  }
  return duplicates;
}

function cohortJobId(value) {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object") return "";
  return String(value.jobId || value.id || "").trim();
}

async function inspectExposureExperiment({
  jobsDir = THREADS_JOBS_DIR,
  experimentPath = EXPOSURE_EXPERIMENT_PATH
} = {}) {
  let experiment;
  try {
    experiment = JSON.parse(await fs.readFile(experimentPath, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return { available: false, valid: true, status: "missing", enrolledJobIds: [], enrolledCount: 0 };
    }
    throw new Error(`Cannot read Threads exposure experiment: ${error.message}`);
  }

  const maximumPosts = Number(experiment?.scope?.maximumPosts);
  const valid = experiment?.id === EXPOSURE_EXPERIMENT_ID
    && experiment?.scope?.angle === EXPOSURE_EXPERIMENT_ANGLE
    && Number.isInteger(maximumPosts)
    && maximumPosts > 0;
  if (!valid) {
    return {
      available: true,
      valid: false,
      status: String(experiment?.status || "invalid"),
      maximumPosts: Number.isFinite(maximumPosts) ? maximumPosts : null,
      enrolledJobIds: [],
      enrolledCount: 0
    };
  }

  const enrolledJobIds = new Set(
    (Array.isArray(experiment?.scope?.cohortJobs) ? experiment.scope.cohortJobs : [])
      .map(cohortJobId)
      .filter(Boolean)
  );
  let entries = [];
  try {
    entries = await fs.readdir(jobsDir, { withFileTypes: true });
  } catch (error) {
    if (!error || error.code !== "ENOENT") {
      throw new Error(`Cannot inspect Threads experiment jobs: ${error.message}`);
    }
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    try {
      const candidate = JSON.parse(await fs.readFile(path.join(jobsDir, entry.name), "utf8"));
      if (candidate?.channel === "threads" && candidate?.copy?.experiment?.id === EXPOSURE_EXPERIMENT_ID) {
        enrolledJobIds.add(String(candidate.id || entry.name).trim());
      }
    } catch {
      // Invalid unrelated job files are ignored by the cohort counter; the draft validator handles its own job.
    }
  }

  return {
    available: true,
    valid: true,
    status: String(experiment.status || ""),
    maximumPosts,
    enrolledJobIds: [...enrolledJobIds].sort(),
    enrolledCount: enrolledJobIds.size,
    capacityRemaining: Math.max(0, maximumPosts - enrolledJobIds.size)
  };
}

async function resolveDraftAngle({
  requestedAngle,
  jobsDir = THREADS_JOBS_DIR,
  experimentPath = EXPOSURE_EXPERIMENT_PATH
} = {}) {
  const requested = String(requestedAngle || "").trim();
  void jobsDir;
  void experimentPath;
  if (requested && requested !== DEFAULT_THREADS_ANGLE) {
    throw new Error(`Threads angle ${requested} is retired or unsupported. Use ${DEFAULT_THREADS_ANGLE}.`);
  }
  return DEFAULT_THREADS_ANGLE;
}

function learningLinkErrors(job) {
  const errors = [];
  const primaryPost = String(job?.copy?.primaryPost || "");
  const sourcePermalink = asNonemptyString(job?.source?.sourceCarouselPermalink);
  const urls = httpUrls(primaryPost);
  if (urls.length !== 1 || job?.copy?.externalLinkCount !== 1) {
    errors.push("threads_external_link_count_must_be_one");
  }
  const publicUrl = asNonemptyString(urls[0]);
  let parsed;
  if (publicUrl) {
    try {
      parsed = new URL(publicUrl);
    } catch {
      errors.push("threads_link_url_invalid");
    }
  }
  if (parsed?.protocol !== "https:") errors.push("threads_link_must_use_https");
  if (job?.copy?.link?.targetType !== LINK_TARGET_SOURCE_INSTAGRAM) {
    errors.push("threads_link_target_type_must_be_source_instagram_permalink");
  }
  if (!sourcePermalink
      || publicUrl !== sourcePermalink
      || job?.copy?.link?.approvedTarget !== sourcePermalink
      || job?.copy?.link?.publicUrl !== sourcePermalink
      || job?.controlBinding?.sourceLinkTarget !== sourcePermalink) {
    errors.push("threads_link_must_match_exact_official_instagram_permalink");
  }
  if (parsed && (parsed.hostname !== "www.instagram.com"
      || !/^\/p\/[A-Za-z0-9_-]+\/?$/u.test(parsed.pathname)
      || parsed.search
      || parsed.hash
      || parsed.username
      || parsed.password)) {
    errors.push("threads_link_must_be_clean_instagram_carousel_permalink");
  }
  if (parsed?.search || job?.copy?.link?.utm !== null) {
    errors.push("threads_source_instagram_link_must_not_have_utm");
  }
  const postWithoutHttpUrls = primaryPost.replace(HTTP_URL_PATTERN, " ");
  if (BARE_WEB_ADDRESS_PATTERN.test(postWithoutHttpUrls)) {
    errors.push("additional_or_bare_site_address_forbidden");
  }
  const finalLine = `${LEARNING_EXTENSION_CTA} ${sourcePermalink}`;
  const lines = primaryPost.split(/\r?\n/u);
  if (lines.at(-1) !== finalLine
      || primaryPost.split(LEARNING_EXTENSION_CTA).length - 1 !== 1
      || job?.copy?.learningExtensionCta !== LEARNING_EXTENSION_CTA
      || job?.copy?.cta !== LEARNING_EXTENSION_CTA) {
    errors.push("threads_learning_extension_cta_and_link_must_be_final_line");
  }
  if (job?.copy?.explicitLinkAttachmentRequested !== false
      || job?.copy?.linkPreviewPolicy !== LINK_PREVIEW_POLICY
      || job?.copy?.platformPreviewState !== LINK_PREVIEW_OBSERVATION) {
    errors.push("threads_explicit_link_attachment_must_be_false_and_preview_platform_managed");
  }
  return errors;
}

async function validateThreadsJob(job, {
  jobsDir = THREADS_JOBS_DIR,
  ignoredPath,
  now = new Date(),
  expectedControlPath = DEFAULT_CONTROL_PATH,
  recoveryProjectRoot = PROJECT_ROOT
} = {}) {
  const errors = [];
  const primaryPost = String(job?.copy?.primaryPost || "");
  const normalizedPrimaryPost = normalizeText(primaryPost);
  const allowedHangul = new Set((job?.copy?.allowedHangulLines || []).flatMap(extractHangulRuns));
  const actualHangul = extractHangulRuns(primaryPost);
  const publicCopy = joinedStringValues(job?.copy || {});
  const sourceCarouselCaptionHash = String(job?.source?.sourceCarouselCaptionNormalizedHash || "");

  errors.push(...controlBindingErrors(job, { now, expectedControlPath }));
  errors.push(...learningLinkErrors(job));
  const recoveryReview = await validateRecoveryBinding(job, { projectRoot: recoveryProjectRoot });
  errors.push(...recoveryReview.errors);

  if (job?.schemaVersion !== 5) errors.push("threads_schema_version_mismatch");
  if (job?.strategyVersion !== THREADS_STRATEGY_VERSION
      || job?.channelStrategy?.strategyVersion !== THREADS_STRATEGY_VERSION
      || job?.copy?.strategyVersion !== THREADS_STRATEGY_VERSION) {
    errors.push("threads_strategy_version_mismatch");
  }
  if (job?.channel !== "threads") errors.push("channel_must_be_threads");
  if (job?.channelStrategy?.instagramRole !== "canonical_full_korean_expression_lesson"
      || job?.channelStrategy?.threadsRole !== "distinct_text_only_native_study_companion"
      || job?.channelStrategy?.instagramMustPublishAndPassOfficialReadbackFirst !== true
      || job?.channelStrategy?.siteTrafficObjective !== false
      || job?.channelStrategy?.sourceInstagramLessonLinkRequired !== true) {
    errors.push("instagram_first_channel_strategy_required");
  }
  if (job?.automation?.pipeline !== "threads-learning-pair-pipeline-v3") errors.push("threads_learning_pair_pipeline_required");
  if (job?.workflow?.status !== "approved") errors.push("workflow_must_be_approved");
  if (job?.workflow?.autoPublish !== true) errors.push("threads_auto_publish_must_be_true");
  if (job?.workflow?.manualPostDecisionRequired !== false) errors.push("manual_post_decision_must_be_false");
  if (job?.workflow?.standingDirectPostAuthorization !== true) errors.push("standing_direct_post_authorization_required");
  if (job?.workflow?.automatedRepliesAllowed !== false) errors.push("automated_replies_must_be_false");
  if (job?.workflow?.automatedDirectMessagesAllowed !== false) errors.push("automated_direct_messages_must_be_false");
  if (job?.workflow?.postToThreadsCommandRun !== false) errors.push("threads_command_must_not_run");
  if (job?.automation?.postToThreadsAttempted !== false) errors.push("threads_post_attempt_must_be_false");
  if (job?.automation?.automaticThreadsPublication !== true) errors.push("standing_threads_automation_not_recorded");
  if (job?.automation?.preparationOnly !== true) errors.push("draft_preparation_boundary_missing");
  if (job?.automation?.googleSheetStatusMutation !== "not_attempted") errors.push("google_sheet_status_mutation_forbidden");
  if (job?.source?.sourceCarouselWorkflowStatus !== "published" || job?.source?.sourceCarouselReadbackPassed !== true) {
    errors.push("source_carousel_must_be_published_and_read_back");
  }
  if (!primaryPost) errors.push("primary_post_missing");

  const characterCount = countCharacters(primaryPost);
  if (characterCount > HARD_CHARACTER_LIMIT) errors.push("character_limit_exceeded");
  if (characterCount < WORKING_CHARACTER_MINIMUM || characterCount > WORKING_CHARACTER_MAXIMUM) {
    errors.push("outside_working_character_range");
  }
  if (DISALLOWED_LANGUAGE_HEADINGS.test(primaryPost)) errors.push("language_heading_detected");
  if (ENGAGEMENT_BAIT_PATTERNS.some((pattern) => pattern.test(primaryPost))) errors.push("engagement_bait_detected");
  if (job?.copy?.productPriceOrSalesCopyAllowed !== false) errors.push("threads_commercial_copy_must_be_forbidden");
  if (COMMERCIAL_COPY_PATTERNS.some((pattern) => pattern.test(publicCopy))) errors.push("product_price_or_sales_copy_detected");
  if (job?.copy?.angle !== DEFAULT_THREADS_ANGLE) errors.push("threads_learning_companion_angle_required");
  const qualityRubric = job?.review?.qualityRubric;
  if (qualityRubric?.accuracy !== 4
      || qualityRubric?.completeness !== 4
      || qualityRubric?.practicality !== 4
      || qualityRubric?.revenueContribution !== 4
      || qualityRubric?.total !== 16
      || qualityRubric?.maximum !== 16
      || qualityRubric?.result !== "passed"
      || !/indirect revenue contribution, not observed revenue/iu.test(asNonemptyString(qualityRubric?.evidence))) {
    errors.push("quality_rubric_must_be_16_of_16_with_indirect_revenue_evidence");
  }
  if (!String(job?.source?.expression || "").trim() || !primaryPost.includes(job.source.expression)) {
    errors.push("target_expression_missing_from_post");
  }
  const sceneIndex = primaryPost.indexOf("Imagine you're ");
  const expressionIndex = primaryPost.indexOf(String(job?.source?.expression || ""));
  const meaningIndex = primaryPost.indexOf("It means:");
  const recallIndex = primaryPost.indexOf("In 3 minutes, try again without looking.");
  const ctaIndex = primaryPost.lastIndexOf(LEARNING_EXTENSION_CTA);
  if (sceneIndex !== 0
      || expressionIndex <= sceneIndex
      || meaningIndex <= expressionIndex
      || recallIndex <= meaningIndex
      || ctaIndex <= recallIndex) {
    errors.push("threads_learning_sequence_mismatch");
  }
  const visibleHangulLines = primaryPost
    .split(/\r?\n/u)
    .filter((line) => extractHangulRuns(line).length > 0)
    .map((line) => line.trim());
  if (visibleHangulLines.length !== 1 || visibleHangulLines[0] !== String(job?.source?.expression || "").trim()) {
    errors.push("visible_hangul_line_must_be_exactly_one_target");
  }
  if (!allowedHangul.size) errors.push("allowed_hangul_missing");
  if (actualHangul.some((run) => !allowedHangul.has(run))) errors.push("unapproved_hangul_detected");
  if (sourceCarouselCaptionHash && sourceCarouselCaptionHash === sha256(normalizedPrimaryPost)) {
    errors.push("duplicate_source_carousel_caption");
  }
  if (job?.copy?.normalizedPrimaryPostHash !== sha256(normalizedPrimaryPost)) {
    errors.push("primary_post_hash_mismatch");
  }
  if (job?.review?.status !== "automated_learning_companion_checks_passed_standing_direct_post_authorized") {
    errors.push("standing_authorization_review_missing");
  }
  if (job?.review?.naturalKorean?.translationeseDetected !== false || job?.review?.naturalKorean?.everydaySpeechConfirmed !== true || job?.review?.naturalKorean?.readAloudConfirmed !== true) {
    errors.push("draft_natural_korean_review_not_passed");
  }
  if (job?.review?.globalLearner?.englishBridgeConfirmed !== true || job?.review?.globalLearner?.instructionLanguageConfirmed !== true || job?.review?.globalLearner?.hangulUsageLimited !== true || job?.review?.globalLearner?.romanizationLimited !== true) {
    errors.push("draft_global_learner_review_not_passed");
  }
  if (job?.review?.distribution?.originalityConfirmed !== true
      || job?.review?.distribution?.engagementBaitDetected !== false
      || job?.review?.distribution?.duplicateFullCaptionChecked !== true
      || job?.review?.distribution?.sourceExpressionDuplicateChecked !== true
      || job?.review?.distribution?.standingDirectPostAuthorization !== true
      || job?.review?.distribution?.externalLinkCount !== 1
      || job?.review?.distribution?.explicitLinkAttachmentRequested !== false
      || job?.review?.distribution?.platformPreviewState !== LINK_PREVIEW_OBSERVATION
      || job?.review?.distribution?.sourceInstagramPermalinkConfirmed !== true
      || job?.review?.distribution?.learningExtensionCtaLastConfirmed !== true
      || job?.review?.distribution?.strategyVersionConfirmed !== true) {
    errors.push("draft_distribution_review_not_passed");
  }
  if (job?.review?.qualityRubric?.accuracy !== 4
      || job?.review?.qualityRubric?.completeness !== 4
      || job?.review?.qualityRubric?.practicality !== 4
      || job?.review?.qualityRubric?.revenueContribution !== 4
      || job?.review?.qualityRubric?.total !== 16
      || job?.review?.qualityRubric?.result !== "passed") {
    errors.push("quality_rubric_not_passed");
  }

  const duplicates = await findLocalDuplicates({
    job,
    jobsDir,
    ignoredPath,
    recoveryAllowance: recoveryReview.allowance
  });
  if (duplicates.length) errors.push("local_threads_duplicate_detected");

  return {
    passed: errors.length === 0,
    errors,
    duplicateMatches: duplicates,
    details: {
      characterCount,
      hardCharacterLimit: HARD_CHARACTER_LIMIT,
      workingCharacterRange: { min: WORKING_CHARACTER_MINIMUM, max: WORKING_CHARACTER_MAXIMUM },
      hangulRuns: actualHangul,
      strategyVersion: THREADS_STRATEGY_VERSION,
      linkTargetType: job?.copy?.link?.targetType,
      linkTarget: job?.copy?.link?.publicUrl,
      externalLinkCount: job?.copy?.externalLinkCount,
      explicitLinkAttachmentRequested: job?.copy?.explicitLinkAttachmentRequested,
      platformPreviewState: job?.copy?.platformPreviewState,
      recoveryConsumerAction: job?.controlBinding?.consumerAction,
      supersedesJobId: job?.recoveryBinding?.supersedesJobId || null,
      automaticPublication: false,
      externalPostAttempted: false
    }
  };
}

function defaultOutputPath({ date, expressionId, angle }) {
  return path.join(THREADS_JOBS_DIR, `${date}-expression-${String(expressionId).padStart(3, "0")}-threads-${angle}.json`);
}

async function writeNewJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
}

async function runCli(args) {
  if (hasArgument(args, "--publish")) {
    throw new Error("Threads publishing is intentionally unsupported. This command only prepares local review-ready jobs.");
  }
  if (hasArgument(args, "--control")) {
    throw new Error(`--control is not supported. Threads jobs must use the canonical control path: ${DEFAULT_CONTROL_PATH}`);
  }
  if (hasArgument(args, "--validate")) {
    const jobArg = argumentValue(args, "--job");
    if (!jobArg) throw new Error("Use --validate --job <threads-job.json>.");
    const jobPath = projectPath(jobArg);
    const job = await readJson(jobPath, "Threads job");
    const now = new Date();
    const review = await validateThreadsJob(job, { jobsDir: THREADS_JOBS_DIR, ignoredPath: jobPath, now });
    const controlSnapshot = await readControlSnapshot(DEFAULT_CONTROL_PATH);
    const controlReview = validateControlSnapshotForJob(job, controlSnapshot, { now });
    if (!controlReview.passed) {
      review.passed = false;
      review.errors = [...new Set([...review.errors, ...controlReview.errors])];
    }
    review.control = controlReview;
    console.log(JSON.stringify({ job: displayProjectPath(jobPath), review }, null, 2));
    if (!review.passed) process.exitCode = 1;
    return;
  }

  const sourceArg = argumentValue(args, "--source-carousel-job");
  if (!sourceArg) throw new Error("Use --source-carousel-job <published-carousel-job.json>.");
  const date = assertDate(argumentValue(args, "--date") || currentKstDate());
  const requestedAngle = argumentValue(args, "--angle");
  const angle = await resolveDraftAngle({ requestedAngle });
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(angle)) {
    throw new Error("Use a lowercase kebab-case value for --angle.");
  }
  const sourcePath = projectPath(sourceArg);
  const carouselJob = await readJson(sourcePath, "published carousel job");
  const controlSnapshot = await readControlSnapshot(DEFAULT_CONTROL_PATH);
  const recoveryEvidenceSnapshot = asNonemptyString(controlSnapshot?.control?.handoff?.consumerAction) === THREADS_RECOVERY_ACTION
    ? await readRecoveryEvidenceSnapshot(controlSnapshot.control)
    : null;
  const outputArg = argumentValue(args, "--out");
  const outputPath = outputArg
    ? projectPath(outputArg)
    : defaultOutputPath({ date, expressionId: carouselJob?.source?.expressionId, angle });
  const now = new Date();
  const job = createThreadsDraft({
    carouselJob,
    carouselJobPath: sourcePath,
    controlSnapshot,
    recoveryEvidenceSnapshot,
    date,
    angle,
    now
  });
  const review = await validateThreadsJob(job, { jobsDir: THREADS_JOBS_DIR, ignoredPath: outputPath, now });
  job.review.automationPreflight = review;
  if (!review.passed) {
    job.workflow.status = "blocked";
    job.review.status = "blocked";
    throw new Error(`Threads draft is blocked: ${review.errors.join(", ")}`);
  }
  if (hasArgument(args, "--dry-run")) {
    console.log(JSON.stringify({ dryRun: true, job, review }, null, 2));
    return;
  }
  await writeNewJson(outputPath, job);
  console.log(JSON.stringify({
    status: job.workflow.status,
    job: displayProjectPath(outputPath),
    expressionId: job.source.expressionId,
    expression: job.source.expression,
    characterCount: job.copy.primaryPostCharacterCount,
    automaticThreadsPublication: job.workflow.autoPublish,
    manualPostDecisionRequired: job.workflow.manualPostDecisionRequired,
    standingDirectPostAuthorization: job.workflow.standingDirectPostAuthorization
  }, null, 2));
}

if (require.main === module) {
  runCli(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  APPROVED_OWNED_SITE_HOST,
  CONTROL_SCHEMA_VERSION,
  DEFAULT_THREADS_ANGLE,
  DEFAULT_CONTROL_PATH,
  EXPOSURE_EXPERIMENT_ANGLE,
  EXPOSURE_EXPERIMENT_ID,
  EXPOSURE_EXPERIMENT_PATH,
  HARD_CHARACTER_LIMIT,
  HANDOFF_CONTRACT_VERSION,
  INSTAGRAM_ACCOUNT_HANDLE,
  LEARNING_EXTENSION_CTA,
  LEGACY_INSTAGRAM_STUDY_CUE,
  LINK_PREVIEW_OBSERVATION,
  LINK_PREVIEW_POLICY,
  LINK_TARGET_OWNED_PRACTICE,
  LINK_TARGET_SOURCE_INSTAGRAM,
  LEARNING_PAIR_ACTION,
  RECOVERY_EVIDENCE_TYPE,
  RECOVERY_RESOLUTION,
  THREADS_RECOVERY_ACTION,
  THREADS_JOBS_DIR,
  THREADS_LOCKS_DIR,
  THREADS_RECOVERY_EVIDENCE_DIR,
  THREADS_STRATEGY_VERSION,
  WORKING_CHARACTER_MAXIMUM,
  WORKING_CHARACTER_MINIMUM,
  buildPrimaryPost,
  buildTrackedLearningUrl,
  countCharacters,
  controlBindingErrors,
  controlReleaseErrors,
  createControlBinding,
  createRecoveryBinding,
  createThreadsDraft,
  extractHangulRuns,
  findLocalDuplicates,
  inspectExposureExperiment,
  naturalEnglishMeaning,
  learningLinkErrors,
  learningLinkUtm,
  resolveDraftAngle,
  normalizeText,
  readControlSnapshot,
  readRecoveryEvidenceSnapshot,
  recoveryEvidenceErrors,
  runCli,
  sha256,
  sourceEligibilityErrors,
  validateControlSnapshotForJob,
  validateRecoveryBinding,
  validateThreadsJob
};
