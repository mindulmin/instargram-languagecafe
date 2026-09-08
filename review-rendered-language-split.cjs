const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require("playwright");

const root = __dirname;
const args = process.argv.slice(2);

function option(name, fallback = "") {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

function resolveFromRoot(value) {
  const resolved = path.resolve(root, value);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("Review paths must stay inside the carousel project.");
  }
  return resolved;
}

function normalize(value) {
  return String(value || "").replace(/\s+/gu, " ").trim();
}

function unexpectedHangul(text, allowedPhrases) {
  let remainder = normalize(text);
  const allowed = [...new Set(allowedPhrases || [])]
    .map(normalize)
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
  for (const phrase of allowed) remainder = remainder.split(phrase).join(" ");
  return [...new Set(remainder.match(/[\u3131-\u318e\uac00-\ud7a3]+/gu) || [])];
}

async function sha256(file) {
  return crypto.createHash("sha256").update(await fs.readFile(file)).digest("hex");
}

async function pngSize(file) {
  const buffer = await fs.readFile(file);
  if (buffer.length < 24 || buffer.toString("ascii", 1, 4) !== "PNG") {
    throw new Error(`${file} is not a PNG.`);
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

(async () => {
  const htmlPath = resolveFromRoot(option("html"));
  const specPath = resolveFromRoot(option("spec"));
  const exportsDir = resolveFromRoot(option("exports"));
  const reportPath = resolveFromRoot(option("report"));
  if (!option("html") || !option("spec") || !option("exports") || !option("report")) {
    throw new Error("Use --html <file> --spec <file> --exports <folder> --report <file>.");
  }

  const spec = JSON.parse(await fs.readFile(specPath, "utf8"));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 2100 }, deviceScaleFactor: 1 });
    await page.goto(`file:///${htmlPath.replace(/\\/g, "/")}`);
    await page.waitForLoadState("load");
    const cardCount = await page.locator(".card").count();
    const cards = [];

    for (let index = 0; index < cardCount; index += 1) {
      const cardNumber = index + 1;
      const renderedText = normalize(await page.locator(".card").nth(index).innerText());
      const allowedKorean = spec.allowedKoreanTextByCard?.find((item) => item.card === cardNumber)?.phrases || [];
      const requiredEnglish = spec.englishCards?.find((item) => item.card === cardNumber)?.phrases || [];
      const verticalFile = path.join(exportsDir, "vertical-9x16", `card-${String(cardNumber).padStart(2, "0")}.png`);
      const feedFile = path.join(exportsDir, `card-${String(cardNumber).padStart(2, "0")}.png`);
      const unexpected = unexpectedHangul(renderedText, allowedKorean);
      const missingEnglish = requiredEnglish.filter((phrase) => !renderedText.toLowerCase().includes(phrase.toLowerCase()));
      const visibleHangul = [...new Set(renderedText.match(/[\u3131-\u318e\uac00-\ud7a3]+/gu) || [])];
      const [verticalSize, feedSize, verticalSha256, feedSha256] = await Promise.all([
        pngSize(verticalFile),
        pngSize(feedFile),
        sha256(verticalFile),
        sha256(feedFile)
      ]);
      cards.push({
        card: cardNumber,
        allowedKoreanTextByCard: allowedKorean,
        englishCards: requiredEnglish,
        visibleHangul,
        unexpectedHangul: unexpected,
        missingEnglish,
        vertical: { file: path.relative(root, verticalFile).replace(/\\/g, "/"), ...verticalSize, sha256: verticalSha256 },
        feed: { file: path.relative(root, feedFile).replace(/\\/g, "/"), ...feedSize, sha256: feedSha256 },
        passed: unexpected.length === 0 && missingEnglish.length === 0 &&
          verticalSize.width === 1080 && verticalSize.height === 1920 &&
          feedSize.width === 1080 && feedSize.height === 1350
      });
    }

    const passed = cardCount === 8 && cards.every((card) => card.passed);
    const report = {
      checkedAt: new Date().toISOString(),
      renderSource: "Playwright computed visible text plus exported PNG dimension and SHA-256 readback",
      cardsChecked: cardCount,
      allowedKoreanTextByCard: spec.allowedKoreanTextByCard,
      englishCards: spec.englishCards,
      instructionLanguageConfirmed: passed,
      nonDialogueKoreanDetected: cards.some((card) => card.unexpectedHangul.length > 0),
      unexpectedHangulCards: cards.filter((card) => card.unexpectedHangul.length > 0).length,
      missingEnglishCards: cards.filter((card) => card.missingEnglish.length > 0).length,
      cards,
      review: passed ? "passed" : "failed"
    };
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({
      review: report.review,
      cardsChecked: report.cardsChecked,
      instructionLanguageConfirmed: report.instructionLanguageConfirmed,
      nonDialogueKoreanDetected: report.nonDialogueKoreanDetected,
      unexpectedHangulCards: report.unexpectedHangulCards,
      missingEnglishCards: report.missingEnglishCards
    }, null, 2));
    if (!passed) process.exitCode = 1;
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(JSON.stringify({ review: "failed", error: error.message }, null, 2));
  process.exitCode = 1;
});
