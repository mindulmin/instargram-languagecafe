const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const args = process.argv.slice(2);
const value = (name, fallback = "") => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

async function hashFile(file) {
  return crypto.createHash("sha256").update(await fs.readFile(file)).digest("hex");
}

(async () => {
  const cardsDir = path.resolve(value("cards"));
  const outputDir = path.resolve(value("output"));
  const expression = value("expression");
  if (!value("cards") || !value("output") || !expression) {
    throw new Error("Use --cards <approved-card-folder> --output <reel-folder> --expression <expression>.");
  }
  const cards = await Promise.all(Array.from({ length: 8 }, async (_, index) => {
    const filename = `card-${String(index + 1).padStart(2, "0")}.png`;
    const file = path.join(cardsDir, filename);
    await fs.access(file);
    return { filename, sha256: await hashFile(file) };
  }));
  const searchIntentions = [
    "calm warm instrumental with no lyrics",
    "light daytime acoustic background",
    "gentle positive study ambience"
  ];
  const manifest = {
    sourceType: "approved_carousel_card_reel",
    expression,
    reusesCarouselCards: true,
    approvedCardCount: 8,
    cardsFullyVisible: true,
    cards,
    motion: {
      gentleZoom: true,
      subtleDrift: true,
      sameCardBlurredBackground: true,
      shortFades: true,
      externalVisualsAdded: false
    },
    instagramMusicHandoff: {
      requested: true,
      status: "ready_for_instagram_app",
      searchIntentions,
      trackSelection: "account_owner_in_instagram_app_only",
      volumeGuidance: "If Instagram shows a volume or mix control, start at 5-10%. Play the complete Reel with text visible; reduce or remove music if it distracts from reading. If no control is available, share silent."
    },
    autoPublish: false
  };
  const handoff = `# Instagram music handoff\n\nExpression: **${expression}**\n\nUse Instagram's in-app music picker immediately before sharing. Track availability changes by account, region, and licensing, so select only a track the account can actually use.\n\nSearch intentions:\n${searchIntentions.map((item) => `- ${item}`).join("\n")}\n\nListening check:\n\n- If a volume or mix control appears, begin at 5-10%.\n- Watch the complete Reel with the card text visible.\n- If music competes with reading, lower it or share the Reel silent.\n- Do not download, extract, or embed an Instagram-library track into the MP4.\n`;
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, "source-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await fs.writeFile(path.join(outputDir, "instagram-music-handoff.md"), handoff);
  console.log(JSON.stringify({ status: "ready", outputDir, approvedCardCount: cards.length, searchIntentions }, null, 2));
})().catch((error) => {
  console.error(JSON.stringify({ status: "failed", error: error.message }, null, 2));
  process.exitCode = 1;
});
