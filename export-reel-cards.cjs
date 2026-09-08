const { chromium } = require("playwright");
const fs = require("node:fs/promises");
const path = require("node:path");

const root = __dirname;
const sourcePath = path.join(root, "reels", "card-reel-v2", "index.html");
const outDir = path.join(root, "reels", "card-reel-v2", "exports");

(async () => {
  await fs.mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
    await page.goto(`file:///${sourcePath.replace(/\\/g, "/")}`);
    const cards = page.locator(".reel-card");
    const count = await cards.count();
    const metrics = [];
    for (let index = 0; index < count; index += 1) {
      const card = cards.nth(index);
      await card.screenshot({ path: path.join(outDir, `reel-card-${String(index + 1).padStart(2, "0")}.png`) });
      metrics.push(await card.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const overflow = Array.from(element.querySelectorAll("*")).filter((child) => {
          const rect = child.getBoundingClientRect();
          return rect.left < box.left - 1 || rect.right > box.right + 1 || rect.top < box.top - 1 || rect.bottom > box.bottom + 1;
        }).length;
        return { width: Math.round(box.width), height: Math.round(box.height), overflowCount: overflow };
      }));
    }
    const status = count === 5 && metrics.every((metric) => metric.width === 1080 && metric.height === 1920 && metric.overflowCount === 0) ? "passed" : "failed";
    const report = { checkedAt: new Date().toISOString(), status, cards: count, metrics };
    await fs.writeFile(path.join(outDir, "render-report.json"), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
    if (status !== "passed") process.exitCode = 1;
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(JSON.stringify({ status: "failed", error: error.message }, null, 2));
  process.exitCode = 1;
});
