#!/usr/bin/env node
"use strict";

// A shorter, independently reviewed pilot using original never-published art
// from campaign 01. It does not create a Threads container or publish a post.
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { chromium } = require("playwright");
const sharp = require("sharp");

const root = __dirname;
const source = path.resolve(root, "..", "campaign-2026-09-25-01", "cards.html");
const out = path.join(root, "rendered");
const sourceIndexes = [0, 2, 5]; // Situation, real exchange, three-minute recall + honest offer.

async function run() {
  await fs.mkdir(out, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
    await page.goto(`file:///${source.replace(/\\/gu, "/")}`);
    await page.evaluate(async (indexes) => {
      await document.fonts.ready;
      const cards = [...document.querySelectorAll(".card")];
      cards.forEach((card, index) => { if (!indexes.includes(index)) card.remove(); });
      [...document.querySelectorAll(".card")].forEach((card, index) => {
        card.querySelector(".number").textContent = `${String(index + 1).padStart(2, "0")} / 03`;
      });
    }, sourceIndexes);
    const slides = page.locator(".card");
    if (await slides.count() !== 3) throw new Error("Three-card render selection failed.");
    const manifest = [];
    const phoneTiles = [];
    for (let index = 0; index < 3; index += 1) {
      const name = `card-${String(index + 1).padStart(2, "0")}`;
      const png = path.join(out, `${name}.png`);
      const jpg = path.join(out, `${name}.jpg`);
      await slides.nth(index).screenshot({ path: png });
      await sharp(png).jpeg({ quality: 93, chromaSubsampling: "4:4:4" }).toFile(jpg);
      const metadata = await sharp(jpg).metadata();
      if (metadata.width !== 1080 || metadata.height !== 1350) throw new Error("Incorrect card dimensions.");
      const bytes = await fs.readFile(jpg);
      manifest.push({ file: path.relative(root, jpg).replace(/\\/gu, "/"), width: metadata.width,
        height: metadata.height, bytes: bytes.length,
        sha256: crypto.createHash("sha256").update(bytes).digest("hex") });
      const tile = await sharp(png).resize(270, 338).png().toBuffer();
      phoneTiles.push({ input: tile, left: index * 270, top: 0 });
    }
    await sharp({ create: { width: 810, height: 338, channels: 4, background: "#ffffff" } })
      .composite(phoneTiles).png().toFile(path.join(out, "phone-preview.png"));
    await fs.writeFile(path.join(out, "render-manifest.json"),
      `${JSON.stringify({ status: "draft_only", sourceIndexes, cards: manifest }, null, 2)}\n`);
    console.log("Rendered three draft cards. No asset was hosted or posted.");
  } finally {
    await browser.close();
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
