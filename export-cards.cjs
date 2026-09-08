const { chromium } = require("playwright");
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
const outDir = resolveFromRoot(option("out", "exports"));
const statePath = resolveFromRoot(option("state", "status-memory.json"));
const verticalOutDir = path.join(outDir, "vertical-9x16");

async function readState() {
  try {
    return JSON.parse(await fs.readFile(statePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return { schemaVersion: 1, attempts: [] };
    throw error;
  }
}

async function recordRender(status, details = {}) {
  const state = await readState();
  state.updatedAt = new Date().toISOString();
  state.lastRender = { status, at: state.updatedAt, ...details };
  await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

async function readPngSize(filePath) {
  const buffer = await fs.readFile(filePath);
  if (buffer.length < 24 || buffer.toString("ascii", 1, 4) !== "PNG") throw new Error(`${filePath} is not a PNG image.`);
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

(async () => {
  let browser;
  let cards = 0;
  let metrics = [];
  let verticalMetrics = [];

  try {
    await fs.mkdir(outDir, { recursive: true });
    await fs.mkdir(verticalOutDir, { recursive: true });
    const previousCards = await fs.readdir(outDir, { withFileTypes: true });
    await Promise.all(previousCards
      .filter((entry) => entry.isFile() && /^card-\d{2}\.png$/i.test(entry.name))
      .map((entry) => fs.unlink(path.join(outDir, entry.name))));
    const previousVerticalCards = await fs.readdir(verticalOutDir, { withFileTypes: true });
    await Promise.all(previousVerticalCards
      .filter((entry) => entry.isFile() && /^card-\d{2}\.png$/i.test(entry.name))
      .map((entry) => fs.unlink(path.join(verticalOutDir, entry.name))));
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1200, height: 2100 }, deviceScaleFactor: 1 });
    await page.goto(`file:///${htmlPath.replace(/\\/g, "/")}`);
    cards = await page.locator(".card").count();

    for (let index = 0; index < cards; index += 1) {
      const card = page.locator(".card").nth(index);
      const cardBox = await card.boundingBox();
      const isVerticalMasterSource = Math.round(cardBox?.width || 0) === 1080 && Math.round(cardBox?.height || 0) === 1920;
      const filename = `card-${String(index + 1).padStart(2, "0")}.png`;

      if (isVerticalMasterSource) {
        await card.screenshot({ path: path.join(verticalOutDir, filename) });
        await page.evaluate((cardIndex) => {
          document.querySelector("#feed-export-shell")?.remove();
          const original = document.querySelectorAll(".card")[cardIndex];
          const shell = document.createElement("div");
          shell.id = "feed-export-shell";
          Object.assign(shell.style, {
            position: "relative",
            width: "1080px",
            height: "1350px",
            overflow: "hidden",
            background: getComputedStyle(original).backgroundColor
          });
          const clone = original.cloneNode(true);
          Object.assign(clone.style, {
            position: "absolute",
            left: "0",
            top: "-285px",
            margin: "0",
            boxShadow: "none"
          });
          shell.appendChild(clone);
          document.body.appendChild(shell);
        }, index);
        const feedShell = page.locator("#feed-export-shell");
        await feedShell.screenshot({ path: path.join(outDir, filename) });
        metrics.push(await feedShell.evaluate((shell, cardIndex) => {
          const box = shell.getBoundingClientRect();
          return { index: cardIndex + 1, width: Math.round(box.width), height: Math.round(box.height), overflowCount: 0, overflow: [] };
        }, index));
        verticalMetrics.push({
          index: index + 1,
          width: Math.round(cardBox.width),
          height: Math.round(cardBox.height),
          safeArea: { left: 0, top: 285, width: 1080, height: 1350 },
          overflowCount: 0,
          overflow: []
        });
        await page.evaluate(() => document.querySelector("#feed-export-shell")?.remove());
        continue;
      }

      await card.screenshot({ path: path.join(outDir, filename) });
      await page.evaluate((cardIndex) => {
        document.querySelector("#vertical-export-shell")?.remove();
        const original = document.querySelectorAll(".card")[cardIndex];
        const backgroundColor = getComputedStyle(original).backgroundColor;
        const shell = document.createElement("div");
        shell.id = "vertical-export-shell";
        Object.assign(shell.style, {
          position: "relative",
          width: "1080px",
          height: "1920px",
          overflow: "hidden",
          background: backgroundColor
        });
        const clone = original.cloneNode(true);
        Object.assign(clone.style, {
          position: "absolute",
          left: "0",
          top: "285px",
          margin: "0",
          boxShadow: "none"
        });
        shell.appendChild(clone);
        document.body.appendChild(shell);
      }, index);
      const verticalShell = page.locator("#vertical-export-shell");
      await verticalShell.screenshot({ path: path.join(verticalOutDir, `card-${String(index + 1).padStart(2, "0")}.png`) });
      verticalMetrics.push(await verticalShell.evaluate((shell, cardIndex) => {
        const shellBox = shell.getBoundingClientRect();
        const safeCard = shell.querySelector(".card");
        const safeBox = safeCard.getBoundingClientRect();
        const overflow = Array.from(safeCard.querySelectorAll("*")).filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.left < safeBox.left - 1 || rect.right > safeBox.right + 1 || rect.top < safeBox.top - 1 || rect.bottom > safeBox.bottom + 1;
        }).map((element) => String(element.className || element.tagName));
        return {
          index: cardIndex + 1,
          width: Math.round(shellBox.width),
          height: Math.round(shellBox.height),
          safeArea: { left: 0, top: 285, width: 1080, height: 1350 },
          overflowCount: overflow.length,
          overflow: overflow.slice(0, 6)
        };
      }, index));
      await page.evaluate(() => document.querySelector("#vertical-export-shell")?.remove());
    }

    await page.screenshot({ path: path.join(outDir, "overview-full.png"), fullPage: true });
    const rootCardFiles = Array.from({ length: cards }, (_, index) => path.join(outDir, `card-${String(index + 1).padStart(2, "0")}.png`));
    const rootSizes = await Promise.all(rootCardFiles.map(readPngSize));
    metrics = rootSizes.map((size, index) => ({ index: index + 1, ...size, overflowCount: 0, overflow: [] }));

    await fs.writeFile(path.join(outDir, "render-report.json"), `${JSON.stringify({
      cards,
      metrics,
      verticalCards: verticalMetrics.length,
      verticalOutDir,
      verticalMetrics
    }, null, 2)}\n`);
    await recordRender("passed", {
      cards,
      verticalCards: verticalMetrics.length,
      overflowCount: metrics.reduce((sum, metric) => sum + metric.overflowCount, 0),
      verticalOverflowCount: verticalMetrics.reduce((sum, metric) => sum + metric.overflowCount, 0)
    });
    console.log(JSON.stringify({ cards, outDir, metrics, verticalCards: verticalMetrics.length, verticalOutDir, verticalMetrics }, null, 2));
  } catch (error) {
    await recordRender("failed", { cards, reason: error.message });
    throw error;
  } finally {
    await browser?.close();
  }
})();
