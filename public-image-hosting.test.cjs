const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
const test = require("node:test");
const {
  deployCardsToCloudflarePages,
  parseDeploymentUrl,
  stageCards
} = require("./public-image-hosting.cjs");

async function makeCards(baseDir) {
  const cards = [];
  for (let index = 1; index <= 8; index += 1) {
    const filePath = path.join(baseDir, `source-${index}.png`);
    await sharp({ create: { width: 1080, height: 1350, channels: 3, background: { r: index, g: 128, b: 200 } } }).png().toFile(filePath);
    cards.push(filePath);
  }
  return cards;
}

test("parseDeploymentUrl extracts the unique Pages deployment", () => {
  const url = parseDeploymentUrl(
    "Deployment complete! https://a1b2c3.language-cafe-instagram-assets.pages.dev",
    "language-cafe-instagram-assets"
  );
  assert.equal(url, "https://a1b2c3.language-cafe-instagram-assets.pages.dev");
});

test("stageCards preserves PNG sources while creating eight ordered JPEG hosting files", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "language-cafe-hosting-test-"));
  try {
    const cards = await makeCards(tempDir);
    const { stageDir, publicPathPrefix, contentHash } = await stageCards(cards, "Example Job", path.join(tempDir, "stage"));
    const names = (await fs.readdir(stageDir)).sort();
    assert.deepEqual(names, ["_headers", publicPathPrefix].sort());
    assert.match(publicPathPrefix, /^example-job-[a-f0-9]{12}$/);
    assert.match(contentHash, /^[a-f0-9]{64}$/);
    assert.deepEqual((await fs.readdir(path.join(stageDir, publicPathPrefix))).sort(), ["card-01.jpg", "card-02.jpg", "card-03.jpg", "card-04.jpg", "card-05.jpg", "card-06.jpg", "card-07.jpg", "card-08.jpg"]);
    assert.equal((await sharp(path.join(stageDir, publicPathPrefix, "card-01.jpg")).metadata()).format, "jpeg");
    assert.match(await fs.readFile(path.join(stageDir, "_headers"), "utf8"), /immutable/);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("deployCardsToCloudflarePages verifies all eight public JPEG URLs", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "language-cafe-hosting-deploy-test-"));
  try {
    const cards = await makeCards(tempDir);
    const requested = [];
    const result = await deployCardsToCloudflarePages({
      jobId: "2026-07-14-expression-002-works-for-me",
      cards,
      stageBaseDir: path.join(tempDir, "stage"),
      runCommand: async () => ({ combined: "https://abc123.language-cafe-instagram-assets.pages.dev" }),
      fetchImpl: async (url) => {
        requested.push(url);
        const match = /card-(\d{2})\.jpg$/.exec(url);
        const card = cards[Number(match[1]) - 1];
        const jpeg = await sharp(card).flatten({ background: "#ffffff" }).jpeg({ quality: 92, chromaSubsampling: "4:4:4", progressive: false }).toBuffer();
        return new Response(jpeg, { status: 200, headers: { "content-type": "image/jpeg" } });
      }
    });
    assert.equal(result.provider, "cloudflare_pages");
    assert.equal(result.verifiedCount, 8);
    assert.equal(result.verifiedCards.length, 8);
    assert.equal(result.sourceFormat, "png");
    assert.equal(result.hostedFormat, "jpeg");
    assert.equal(result.verifiedCards[0].file, "card-01.jpg");
    assert.match(result.verifiedCards[0].sha256, /^[a-f0-9]{64}$/);
    assert.equal(requested.length, 8);
    assert.match(result.publicBaseUrl, /^https:\/\/abc123\.language-cafe-instagram-assets\.pages\.dev\/2026-07-14-expression-002-works-for-me-[a-f0-9]{12}$/);
    assert.equal(result.imageUrls[0], `${result.publicBaseUrl}/card-01.jpg`);
    assert.equal(result.imageUrls[7], `${result.publicBaseUrl}/card-08.jpg`);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
