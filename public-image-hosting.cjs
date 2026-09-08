const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");

const DEFAULT_PROJECT_NAME = "language-cafe-instagram-assets";
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stripAnsi(value) {
  return String(value).replace(/\u001b\[[0-9;]*m/g, "");
}

function safeJobId(value) {
  const safe = String(value || "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!safe) throw new Error("A safe job id is required for public image hosting.");
  return safe;
}

function wranglerBin() {
  const packagePath = require.resolve("wrangler/package.json");
  return path.join(path.dirname(packagePath), "bin", "wrangler.js");
}

function runWrangler(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [wranglerBin(), ...args], {
      cwd: options.cwd || __dirname,
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => {
      const combined = stripAnsi(`${stdout}\n${stderr}`).trim();
      if (code === 0) {
        resolve({ code, stdout: stripAnsi(stdout), stderr: stripAnsi(stderr), combined });
        return;
      }
      if (/not logged in|auth token has expired|could not be refreshed|CLOUDFLARE_API_TOKEN/i.test(combined)) {
        reject(new Error("Cloudflare authentication is required. Run `npm.cmd run hosting:login`, finish the browser login, then run `npm.cmd run hosting:status`."));
        return;
      }
      if (/project.*not found|could not find.*project|pages project.*does not exist/i.test(combined)) {
        reject(new Error(`Cloudflare Pages project '${DEFAULT_PROJECT_NAME}' is missing. Run \`npm.cmd run hosting:create\` once.`));
        return;
      }
      reject(new Error(`Cloudflare Pages deployment failed: ${combined.slice(-600) || `wrangler exited with code ${code}`}`));
    });
  });
}

function parseDeploymentUrl(output, projectName = DEFAULT_PROJECT_NAME) {
  const matches = stripAnsi(output).match(/https:\/\/[a-z0-9.-]+\.pages\.dev\/?/gi) || [];
  const normalizedProject = String(projectName).toLowerCase();
  const selected = matches.find((value) => new URL(value).hostname.toLowerCase().includes(normalizedProject)) || matches[0];
  if (!selected) throw new Error("Cloudflare Pages deployment completed without a public pages.dev URL.");
  const url = new URL(selected);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".pages.dev")) {
    throw new Error("Cloudflare Pages returned an invalid public deployment URL.");
  }
  return url.toString().replace(/\/$/, "");
}

async function stageCards(cards, jobId, stageBaseDir = path.join(os.tmpdir(), "language-cafe-instagram-assets")) {
  if (!Array.isArray(cards) || cards.length !== 8) throw new Error("Exactly eight carousel cards are required for public hosting.");
  const cardBuffers = await Promise.all(cards.map((card) => fs.readFile(card)));
  const sourceContentHash = sha256(Buffer.concat(cardBuffers));
  const hostedCardBuffers = await Promise.all(cardBuffers.map((buffer) => sharp(buffer)
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 92, chromaSubsampling: "4:4:4", progressive: false })
    .toBuffer()));
  const contentHash = sha256(Buffer.concat(hostedCardBuffers));
  const publicPathPrefix = `${safeJobId(jobId)}-${contentHash.slice(0, 12)}`;
  const stageDir = path.join(stageBaseDir, publicPathPrefix);
  const cardsDir = path.join(stageDir, publicPathPrefix);
  await fs.rm(stageDir, { recursive: true, force: true });
  await fs.mkdir(cardsDir, { recursive: true });
  for (let index = 0; index < hostedCardBuffers.length; index += 1) {
    const targetName = `card-${String(index + 1).padStart(2, "0")}.jpg`;
    await fs.writeFile(path.join(cardsDir, targetName), hostedCardBuffers[index]);
  }
  await fs.writeFile(
    path.join(stageDir, "_headers"),
    `/${publicPathPrefix}/*.jpg\n  Cache-Control: public, max-age=31536000, immutable\n  X-Content-Type-Options: nosniff\n`,
    "utf8"
  );
  return {
    stageDir,
    publicPathPrefix,
    contentHash,
    sourceContentHash,
    hostedCardHashes: hostedCardBuffers.map(sha256)
  };
}

async function verifyPublicPng(url, fetchImpl = fetch, attempts = 30, retryDelayMs = 2000, expectedSha256 = "") {
  let lastError = "unknown response";
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, { method: "GET", cache: "no-store" });
      const contentType = response.headers?.get?.("content-type") || "";
      if (!response.ok) {
        lastError = `HTTP ${response.status}`;
      } else if (!contentType.toLowerCase().includes("image/png")) {
        lastError = `unexpected content type '${contentType || "missing"}'`;
      } else {
        const bytes = Buffer.from(await response.arrayBuffer());
        if (!bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
          lastError = "response did not contain a PNG signature";
        } else {
          const actualSha256 = sha256(bytes);
          if (expectedSha256 && actualSha256 !== expectedSha256) {
            lastError = "public PNG hash did not match the approved local card";
          } else {
            return { bytes: bytes.length, sha256: actualSha256 };
          }
        }
      }
    } catch (error) {
      lastError = error.message;
    }
    if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }
  throw new Error(`Public image verification failed for ${url}: ${lastError}`);
}

async function verifyPublicJpeg(url, fetchImpl = fetch, attempts = 30, retryDelayMs = 2000, expectedSha256 = "") {
  let lastError = "unknown response";
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, { method: "GET", cache: "no-store" });
      const contentType = response.headers?.get?.("content-type") || "";
      if (!response.ok) {
        lastError = `HTTP ${response.status}`;
      } else if (!contentType.toLowerCase().includes("image/jpeg")) {
        lastError = `unexpected content type '${contentType || "missing"}'`;
      } else {
        const bytes = Buffer.from(await response.arrayBuffer());
        if (!bytes.subarray(0, JPEG_SIGNATURE.length).equals(JPEG_SIGNATURE)) {
          lastError = "response did not contain a JPEG signature";
        } else {
          const actualSha256 = sha256(bytes);
          if (expectedSha256 && actualSha256 !== expectedSha256) {
            lastError = "public JPEG hash did not match the staged carousel card";
          } else {
            return { bytes: bytes.length, sha256: actualSha256 };
          }
        }
      }
    } catch (error) {
      lastError = error.message;
    }
    if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }
  throw new Error(`Public image verification failed for ${url}: ${lastError}`);
}

async function deployCardsToCloudflarePages(options) {
  const {
    jobId,
    cards,
    projectName = process.env.CLOUDFLARE_PAGES_PROJECT || DEFAULT_PROJECT_NAME,
    branch = "main",
    runCommand = runWrangler,
    fetchImpl = fetch,
    stageBaseDir
  } = options;
  const { stageDir, publicPathPrefix, contentHash, sourceContentHash, hostedCardHashes } = await stageCards(cards, jobId, stageBaseDir);
  try {
    const deployment = await runCommand([
      "pages",
      "deploy",
      stageDir,
      `--project-name=${projectName}`,
      `--branch=${branch}`,
      `--commit-message=Instagram carousel assets: ${safeJobId(jobId)}`,
      "--commit-dirty=true"
    ]);
    const deploymentUrl = parseDeploymentUrl(deployment.combined || `${deployment.stdout || ""}\n${deployment.stderr || ""}`, projectName);
    const publicBaseUrl = `${deploymentUrl}/${publicPathPrefix}`;
    const imageUrls = cards.map((_, index) => `${publicBaseUrl}/card-${String(index + 1).padStart(2, "0")}.jpg`);
    const verifiedCards = [];
    for (let index = 0; index < imageUrls.length; index += 1) {
      const verified = await verifyPublicJpeg(imageUrls[index], fetchImpl, 30, 2000, hostedCardHashes[index]);
      verifiedCards.push({
        file: `card-${String(index + 1).padStart(2, "0")}.jpg`,
        url: imageUrls[index],
        sha256: verified.sha256,
        bytes: verified.bytes
      });
    }
    return {
      status: "passed",
      provider: "cloudflare_pages",
      projectName,
      deploymentUrl,
      publicBaseUrl,
      contentHash,
      sourceContentHash,
      sourceFormat: "png",
      hostedFormat: "jpeg",
      imageUrls,
      verifiedCount: imageUrls.length,
      verifiedCards,
      checkedAt: new Date().toISOString()
    };
  } finally {
    await fs.rm(stageDir, { recursive: true, force: true });
  }
}

module.exports = {
  DEFAULT_PROJECT_NAME,
  deployCardsToCloudflarePages,
  parseDeploymentUrl,
  runWrangler,
  safeJobId,
  sha256,
  stageCards,
  verifyPublicPng,
  verifyPublicJpeg
};
