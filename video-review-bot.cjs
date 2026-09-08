const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");

const root = __dirname;
const args = process.argv.slice(2);

function option(name, fallback) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

function run(command, commandArgs) {
  return new Promise((resolve, reject) => {
    execFile(command, commandArgs, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr.trim() || error.message));
      else resolve(stdout);
    });
  });
}

async function readPngSize(filePath) {
  const buffer = await fs.readFile(filePath);
  if (buffer.length < 24 || buffer.toString("ascii", 1, 4) !== "PNG") return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function parseFrameRate(value) {
  const [numerator, denominator] = String(value || "0/1").split("/").map(Number);
  return denominator ? numerator / denominator : 0;
}

(async () => {
  const file = path.resolve(root, option("file", ""));
  if (!file || !file.endsWith(".mp4")) throw new Error("Use --file reels/<job>/<video>.mp4.");
  const reportPath = path.resolve(root, option("report", "reels/video-review-report.json"));
  const frameDir = path.resolve(root, option("frames", path.join(path.dirname(path.relative(root, reportPath)), "review-frames")));
  const raw = await run("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", file]);
  const probe = JSON.parse(raw);
  const video = probe.streams.find((stream) => stream.codec_type === "video");
  const audio = probe.streams.find((stream) => stream.codec_type === "audio");
  const duration = Number(probe.format?.duration || 0);
  const frameRate = parseFrameRate(video?.avg_frame_rate || video?.r_frame_rate);
  const manifestPath = path.join(path.dirname(file), "source-manifest.json");
  const trendAudioPath = path.join(path.dirname(file), "trend-audio-shortlist.json");
  let sourceManifest = null;
  let trendAudioShortlist = null;
  try { sourceManifest = JSON.parse(await fs.readFile(manifestPath, "utf8")); } catch { sourceManifest = null; }
  try { trendAudioShortlist = JSON.parse(await fs.readFile(trendAudioPath, "utf8")); } catch { trendAudioShortlist = null; }
  const sampleTimes = [3, 9, 15, 21, 27].filter((second) => second < duration - 0.25);
  await fs.mkdir(frameDir, { recursive: true });
  const samples = [];

  for (const second of sampleTimes) {
    const framePath = path.join(frameDir, `frame-${String(second).padStart(2, "0")}s.png`);
    await run("ffmpeg", ["-y", "-ss", String(second), "-i", file, "-frames:v", "1", "-q:v", "2", framePath]);
    const size = await readPngSize(framePath);
    samples.push({ second, file: path.relative(root, framePath).replace(/\\/g, "/"), size });
  }

  const checks = {
    duration: duration >= 28 && duration <= 32,
    verticalFrame: video?.width === 1080 && video?.height === 1920,
    h264Video: video?.codec_name === "h264" && video?.pix_fmt === "yuv420p",
    frameRateAtLeast30: frameRate >= 30,
    sampleFrames: samples.length === 5 && samples.every((sample) => sample.size?.width === 1080 && sample.size?.height === 1920),
    audioRecorded: Boolean(audio),
    originalityConfirmed: sourceManifest?.originalityConfirmed === true,
    noThirdPartyWatermark: sourceManifest?.thirdPartyWatermarkDetected === false,
    noEngagementBait: sourceManifest?.engagementBaitDetected === false,
    guidelineReviewPassed: sourceManifest?.guidelineReview === "passed",
    trendAudioCandidatesReady: Array.isArray(trendAudioShortlist?.candidates) && trendAudioShortlist.candidates.length >= 3
  };
  const hardPass = checks.duration && checks.verticalFrame && checks.h264Video && checks.frameRateAtLeast30 && checks.sampleFrames && checks.originalityConfirmed && checks.noThirdPartyWatermark && checks.noEngagementBait && checks.guidelineReviewPassed;
  const report = {
    checkedAt: new Date().toISOString(),
    status: hardPass ? "needs_human_review" : "failed",
    manualReviewRequired: true,
    reelPath: path.relative(root, file).replace(/\\/g, "/"),
    durationSeconds: Number(duration.toFixed(2)),
    checks,
    audioStatus: audio ? "present" : "pending_bgm_or_voice",
    video: video ? { codec: video.codec_name, width: video.width, height: video.height, pixelFormat: video.pix_fmt, frameRate: Number(frameRate.toFixed(2)) } : null,
    sampleFrames: samples,
    sourceManifest: sourceManifest ? { path: path.relative(root, manifestPath).replace(/\\/g, "/"), audioSource: sourceManifest.audioSource || "pending" } : null,
    trendAudioShortlist: trendAudioShortlist ? {
      path: path.relative(root, trendAudioPath).replace(/\\/g, "/"),
      status: trendAudioShortlist.status || "unknown",
      candidateCount: Array.isArray(trendAudioShortlist.candidates) ? trendAudioShortlist.candidates.length : 0,
      finalAttachmentStatus: trendAudioShortlist.finalAttachment?.status || "unknown"
    } : { status: "not_prepared", candidateCount: 0, finalAttachmentStatus: "not_prepared" },
    humanChecklist: [
      "Does the first three seconds establish a real speaking situation?",
      "Is the taught English phrase readable without pausing?",
      "Does the Korean localized note sound natural and concise?",
      "Do the correction and CTA remain on screen long enough to read?",
      "Is there no third-party watermark or copied visual asset?",
      "Is the CTA free from engagement bait, forced likes, shares, or comments?",
      "Are three music candidates recorded, and does the chosen candidate still appear in the Instagram app?",
      "If music is present, is it soft enough not to compete with reading?"
    ],
    publishingPolicy: "Reels remain unpublished until a person explicitly approves the reviewed draft."
  };
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (!hardPass) process.exitCode = 1;
})().catch((error) => {
  console.error(JSON.stringify({ status: "failed", error: error.message }, null, 2));
  process.exitCode = 1;
});
