const { chromium } = require("playwright");
const fs = require("node:fs/promises");
const path = require("node:path");

const root = __dirname;
const sourcePath = path.join(root, "reels", "motion-card-reel-v4", "index.html");
const outDir = path.join(root, "reels", "motion-card-reel-v4", "frames");
const fps = 30;
const durationSeconds = 30;
const frameCount = Math.round(fps * durationSeconds);

(async () => {
  await fs.mkdir(outDir, { recursive: true });
  const stale = await fs.readdir(outDir);
  await Promise.all(stale.filter((name) => /^frame-\d{4}\.png$/.test(name)).map((name) => fs.unlink(path.join(outDir, name))));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
    await page.goto(`file:///${sourcePath.replace(/\\/g, "/")}`);
    const stage = page.locator("#stage");
    for (let index = 0; index < frameCount; index += 1) {
      await page.evaluate((time) => window.setFrame(time), index / fps);
      await stage.screenshot({ path: path.join(outDir, `frame-${String(index + 1).padStart(4, "0")}.png`) });
    }
    const report = { checkedAt: new Date().toISOString(), status: "passed", fps, durationSeconds, frameCount, width: 1080, height: 1920 };
    await fs.writeFile(path.join(root, "reels", "motion-card-reel-v4", "frame-render-report.json"), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
  } finally { await browser.close(); }
})().catch((error) => { console.error(JSON.stringify({ status: "failed", error: error.message }, null, 2)); process.exitCode = 1; });
