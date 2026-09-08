const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");

const root = __dirname;
const args = process.argv.slice(2);

function option(name, fallback) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

function exec(command, commandArgs) {
  return new Promise((resolve, reject) => {
    execFile(command, commandArgs, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr.trim() || error.message));
      else resolve(stdout);
    });
  });
}

async function recordResult(status, result, reason) {
  const statePath = path.join(root, "status-memory.json");
  const state = JSON.parse(await fs.readFile(statePath, "utf8"));
  const at = new Date().toISOString();
  state.updatedAt = at;
  state.attempts = Array.isArray(state.attempts) ? state.attempts : [];
  state.attempts.push({ id: `attempt-${Date.now()}`, at, status, tried: option("label", "Local Reel prototype: meaning-switch-01"), result, reason });
  await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

(async () => {
  const reelPath = path.resolve(root, option("file", "reels/meaning-switch-01-test/meaning-switch-01-reel-test.mp4"));
const reportPath = path.resolve(root, option("report", "reels/meaning-switch-01-test/reel-review-report.json"));
const manifestPath = option("manifest", "");
  const maxDuration = Number(option("max-duration", "32"));
  const raw = await exec("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", reelPath]);
  const manifest = manifestPath ? JSON.parse(await fs.readFile(path.resolve(root, manifestPath), "utf8")) : null;
  const probe = JSON.parse(raw);
  const video = probe.streams.find((stream) => stream.codec_type === "video");
  const audio = probe.streams.find((stream) => stream.codec_type === "audio");
  const duration = Number(probe.format?.duration || 0);
  const [frameRateNumerator, frameRateDenominator] = String(video?.avg_frame_rate || "0/1").split("/").map(Number);
  const frameRate = frameRateDenominator ? frameRateNumerator / frameRateDenominator : 0;
  const minimumDuration = manifest ? 28 : 12;
  const isCardCarouselReel = manifest?.sourceType === "approved_carousel_card_reel";
  const isConversationReel = manifest?.sourceType === "independent_conversation_reel";
  const checks = {
    verticalFrame: video?.width === 1080 && video?.height === 1920,
    h264Video: video?.codec_name === "h264" && video?.pix_fmt === "yuv420p",
    aacAudio: audio?.codec_name === "aac",
    frameRate: frameRate >= 30,
    duration: duration >= minimumDuration && duration <= maxDuration,
    sourceType: !manifest || isCardCarouselReel || isConversationReel,
    cardCarouselSource: !manifest || !isCardCarouselReel || (manifest.reusesCarouselCards === true && manifest.approvedCardCount === 8 && manifest.cardsFullyVisible === true && manifest.motion?.gentleZoom === true && manifest.motion?.subtleDrift === true && manifest.motion?.sameCardBlurredBackground === true && manifest.motion?.shortFades === true && manifest.motion?.externalVisualsAdded === false),
    instagramMusicHandoff: !manifest || !isCardCarouselReel || (manifest.instagramMusicHandoff?.requested === true && manifest.instagramMusicHandoff?.status === "ready_for_instagram_app" && Array.isArray(manifest.instagramMusicHandoff?.searchIntentions) && manifest.instagramMusicHandoff.searchIntentions.length === 3),
    independentConversationVisuals: !manifest || !isConversationReel || manifest.reusesCarouselCards === false,
    speakingPractice: !manifest || !isConversationReel || (manifest.speakingPractice?.partnerLineIncluded === true && manifest.speakingPractice?.targetReplyIncluded === true && manifest.speakingPractice?.repeatPauseIncluded === true && manifest.speakingPractice?.roleSwapIncluded === true && manifest.speakingPractice?.spokenEnglishAudioIncluded === true && manifest.speakingPractice?.subtitlesChecked === true)
  };
  const status = Object.values(checks).every(Boolean) ? "passed" : "failed";
  const report = { checkedAt: new Date().toISOString(), status, reelPath, manifestPath: manifestPath || null, durationSeconds: Number(duration.toFixed(2)), durationRange: { minimum: minimumDuration, maximum: maxDuration }, checks, video: video ? { codec: video.codec_name, width: video.width, height: video.height, pixelFormat: video.pix_fmt, frameRate: Number(frameRate.toFixed(2)) } : null, audio: audio ? { codec: audio.codec_name, sampleRate: audio.sample_rate } : null };
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  await recordResult(status, status === "passed" ? "Vertical Reel test passed" : "Vertical Reel test failed", status === "passed" ? "Frame, codec, audio track, and duration meet the local upload test." : "Inspect reel-review-report.json before attempting a Reel upload.");
  console.log(JSON.stringify(report, null, 2));
  if (status !== "passed") process.exitCode = 1;
})().catch(async (error) => {
  await recordResult("failed", "Vertical Reel test failed", error.message).catch(() => undefined);
  console.error(JSON.stringify({ status: "failed", error: error.message }, null, 2));
  process.exitCode = 1;
});
