const { chromium } = require("playwright");
const fs = require("node:fs/promises");
const path = require("node:path");

const root = __dirname;
const outPath = path.join(root, "reels", "card-reel-v3", "pop-ed-badge.png");

(async () => {
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 270, height: 154 }, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><style>*{box-sizing:border-box}body{margin:0;background:transparent;font-family:Arial,"Apple SD Gothic Neo","Malgun Gothic",sans-serif}.badge{width:270px;height:154px;display:grid;place-items:center;background:#246bdb;color:white;font-size:104px;line-height:1;font-weight:950}</style><div class="badge">-ed</div>`);
    await page.locator(".badge").screenshot({ path: outPath, omitBackground: true });
    console.log(outPath);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
