#!/usr/bin/env node
"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { chromium } = require("playwright");
const sharp = require("sharp");

const root = __dirname;
const out = path.join(root, "rendered");

async function run() {
  await fs.mkdir(out, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
    await page.goto(`file:///${path.join(root, "cards.html").replace(/\\/gu, "/")}`);
    await page.evaluate(async () => { await document.fonts.ready; });
    const slides = page.locator(".card");
    const count = await slides.count();
    if (count !== 6) throw new Error(`Expected six cards; got ${count}.`);
    const manifest = [];
    for (let i = 0; i < count; i += 1) {
      const name = `card-${String(i + 1).padStart(2, "0")}`;
      const png = path.join(out, `${name}.png`);
      const jpg = path.join(out, `${name}.jpg`);
      await slides.nth(i).screenshot({ path: png });
      await sharp(png).jpeg({ quality: 93, chromaSubsampling: "4:4:4" }).toFile(jpg);
      const size = await sharp(jpg).metadata();
      if (size.width !== 1080 || size.height !== 1350) throw new Error(`Unexpected ${name} dimensions.`);
      const bytes = await fs.readFile(jpg);
      manifest.push({ file: path.relative(root, jpg).replace(/\\/gu, "/"), width: size.width, height: size.height,
        bytes: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex") });
    }
    const phoneWidth = 270;
    const phoneHeight = 338;
    const phoneTiles = [];
    for (let i = 0; i < count; i += 1) {
      const png = path.join(out, `card-${String(i + 1).padStart(2, "0")}.png`);
      const tile = await sharp(png).resize(phoneWidth, phoneHeight).png().toBuffer();
      phoneTiles.push({ input: tile, left: (i % 3) * phoneWidth, top: Math.floor(i / 3) * phoneHeight });
    }
    await sharp({ create: { width: phoneWidth * 3, height: phoneHeight * 2, channels: 4, background: "#ffffff" } })
      .composite(phoneTiles).png().toFile(path.join(out, "phone-preview.png"));
    await fs.writeFile(path.join(out, "render-manifest.json"), `${JSON.stringify({ status: "draft_only", cards: manifest }, null, 2)}\n`);
    console.log(`Rendered ${count} draft cards. No image was hosted or published.`);
  } finally {
    await browser.close();
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
