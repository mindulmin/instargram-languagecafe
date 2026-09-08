const path = require("node:path");
const fs = require("node:fs/promises");

const root = __dirname;
const args = process.argv.slice(2);

function option(name, fallback) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

function resolveFromRoot(value) {
  return path.resolve(root, value);
}

const htmlPath = resolveFromRoot(option("html", "index.html"));
const specPath = resolveFromRoot(option("spec", "copy-review-spec.json"));
const statePath = resolveFromRoot(option("state", "status-memory.json"));
const reportPath = resolveFromRoot(option("report", "exports/copy-review-report.json"));
const globalGatePath = path.join(root, "content-queue", "korean-copy-gate.json");

function includesAll(content, phrases) {
  return phrases.filter((phrase) => !content.includes(phrase));
}

function normalizeVisibleText(value) {
  return String(value || "")
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;/giu, "'")
    .replace(/<[^>]+>/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function visibleCardTexts(html) {
  return [...html.matchAll(/<section\b[^>]*class="[^"]*\bcard\b[^"]*"[^>]*>([\s\S]*?)<\/section>/giu)]
    .map((match) => normalizeVisibleText(match[1]));
}

function unexpectedHangul(text, allowedPhrases) {
  let remainder = normalizeVisibleText(text);
  const allowed = [...new Set(allowedPhrases || [])]
    .map(normalizeVisibleText)
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
  for (const phrase of allowed) remainder = remainder.split(phrase).join(" ");
  return [...new Set(remainder.match(/[\u3131-\u318e\uac00-\ud7a3]+/gu) || [])];
}

(async () => {
  const [html, spec, globalGate] = await Promise.all([
    fs.readFile(htmlPath, "utf8"),
    fs.readFile(specPath, "utf8").then(JSON.parse),
    fs.readFile(globalGatePath, "utf8").then(JSON.parse)
  ]);

  const bannedPhrases = [...new Set([...(globalGate.bannedPhrases || []), ...(spec.koreanBannedPhrases || [])])];
  const bannedHits = bannedPhrases.filter((phrase) => html.includes(phrase));
  const natural = spec.naturalKoreanReview || {};
  const naturalFailures = [];
  if (natural.translationeseDetected !== false) naturalFailures.push("translationeseDetected must be false");
  if (natural.everydaySpeechConfirmed !== true) naturalFailures.push("everydaySpeechConfirmed must be true");
  if (natural.oneSecondMeaningConfirmed !== true) naturalFailures.push("oneSecondMeaningConfirmed must be true");
  if (natural.readAloudConfirmed !== true) naturalFailures.push("readAloudConfirmed must be true");
  if (natural.review !== "passed") naturalFailures.push("review must be passed");
  if (typeof natural.evidence !== "string" || natural.evidence.trim().length < 30) naturalFailures.push("concrete evidence is required");
  const cardTexts = visibleCardTexts(html);
  const koreanCards = spec.koreanCards.map((card) => ({
    card: card.card,
    approved: card.approved,
    review: card.review,
    missingPhrases: includesAll(html, card.phrases)
  }));
  const spokenEnglish = spec.spokenEnglish.map((item) => ({
    expression: item.expression,
    purpose: item.purpose,
    source: item.source,
    missingContext: includesAll(html.toLowerCase(), item.requiredContext.map((phrase) => phrase.toLowerCase()))
  }));
  const globalLearner = spec.globalLearnerReview || {};
  const globalLearnerFailures = [];
  if (globalLearner.instructionLanguageConfirmed !== true) globalLearnerFailures.push("instructionLanguageConfirmed must be true");
  if (globalLearner.nonDialogueKoreanDetected !== false) globalLearnerFailures.push("nonDialogueKoreanDetected must be false");
  if (globalLearner.englishBridgeConfirmed !== true) globalLearnerFailures.push("englishBridgeConfirmed must be true");
  if (globalLearner.review !== "passed") globalLearnerFailures.push("review must be passed");
  if (typeof globalLearner.evidence !== "string" || globalLearner.evidence.trim().length < 30) globalLearnerFailures.push("concrete instruction-language evidence is required");
  if (cardTexts.length !== 8) globalLearnerFailures.push(`exactly 8 visible card sections are required; found ${cardTexts.length}`);
  if (!Array.isArray(spec.allowedKoreanTextByCard) || spec.allowedKoreanTextByCard.length !== 8) globalLearnerFailures.push("allowedKoreanTextByCard must cover all 8 cards");
  if (!Array.isArray(spec.englishCards) || spec.englishCards.length !== 8) globalLearnerFailures.push("englishCards must cover all 8 cards");

  const instructionalKorean = cardTexts.map((text, index) => {
    const card = index + 1;
    const allowed = spec.allowedKoreanTextByCard?.find((item) => item.card === card)?.phrases || [];
    return { card, allowedKoreanPhrases: allowed, unexpectedHangul: unexpectedHangul(text, allowed) };
  });
  const englishCards = (spec.englishCards || []).map((card) => ({
    card: card.card,
    missingPhrases: includesAll((cardTexts[card.card - 1] || "").toLowerCase(), card.phrases.map((phrase) => phrase.toLowerCase()))
  }));

  const failedCards = koreanCards.filter((card) => !card.approved || card.missingPhrases.length > 0);
  const failedEnglish = spokenEnglish.filter((item) => item.missingContext.length > 0);
  const failedInstructionalKorean = instructionalKorean.filter((card) => card.unexpectedHangul.length > 0);
  const failedEnglishCards = englishCards.filter((card) => card.missingPhrases.length > 0);
  const report = {
    checkedAt: new Date().toISOString(),
    status: bannedHits.length === 0 && naturalFailures.length === 0 && failedCards.length === 0 && failedEnglish.length === 0 && globalLearnerFailures.length === 0 && failedInstructionalKorean.length === 0 && failedEnglishCards.length === 0 ? "passed" : "failed",
    korean: { bannedHits, naturalKoreanReview: { ...natural, failures: naturalFailures }, cards: koreanCards },
    spokenEnglish,
    globalLearnerReview: { ...globalLearner, failures: globalLearnerFailures },
    instructionalKorean,
    englishCards,
    summary: {
      cardsChecked: koreanCards.length,
      koreanFailures: failedCards.length,
      spokenEnglishFailures: failedEnglish.length,
      bannedPhraseHits: bannedHits.length,
      naturalKoreanReviewFailures: naturalFailures.length,
      globalLearnerReviewFailures: globalLearnerFailures.length,
      instructionalKoreanFailures: failedInstructionalKorean.length,
      englishCardFailures: failedEnglishCards.length
    }
  };

  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  const state = JSON.parse(await fs.readFile(statePath, "utf8"));
  state.updatedAt = report.checkedAt;
  state.lastCopyReview = { status: report.status, at: report.checkedAt, ...report.summary };
  await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);

  console.log(JSON.stringify(report, null, 2));
  if (report.status !== "passed") process.exitCode = 1;
})();
