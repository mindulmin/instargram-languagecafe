# Instagram Content Studio — Opal build prompt

Use this as the first message in a new Google Opal app. It creates the planning and review workspace; Google Flow remains the manual visual-production surface.

```text
Build an app called “Language Cafe Instagram Content Studio”.

Purpose: turn one everyday Korean conversation line into a publish-ready Instagram carousel plan and a continuous 30-second speaking-practice Reel production pack for global learners. Hangul is reserved for the Korean the learner hears or says, the target phrase and its Korean components, and limited pronunciation practice. Natural English supplies every visible situation, meaning, confusion, rule, instruction, swipe reason, and CTA. This app does not publish to Instagram and does not call video-generation services directly.

Hard exclusions: never turn a Korean conversation line into a lifestyle philosophy, meditation script, resonance metaphor, luxury-brand campaign, or generic mood film. Do not use disconnected aesthetic still lifes unless they directly show the speaking situation. The output must make a learner understand and say the Korean line in a real conversation.

Inputs:
1. Korean line in Hangul plus English meaning and limited romanization
2. Target audience and speaking situation
3. Desired output: carousel, Reel, or both
4. Optional project-owned anchor image for recurring objects
5. Brand rules: Language Cafe, Studio mindulmin credit, no third-party watermark, no engagement bait

Workflow steps:
1. Select and validate the Korean line. Output the real-life situation, a concise hook, common confusion, natural English bridge, pronunciation cue, and a spoken Korean example.
2. Create an eight-card carousel blueprint: situation, common question, meaning contrast, simple rule, ready phrase, natural upgrade, repeat aloud, and Language Cafe CTA. Every card must include “Studio mindulmin” bottom-right.
3. Create a continuity pack for the Reel. Define every recurring object by name, silhouette, size, colors, face/features, key props, environment, lighting, camera direction, and forbidden changes. Require a project-owned anchor image.
4. Create a three-scene Flow shot list. Each scene has an 8-second target, an opening frame, a closing frame, exact object positions, camera instruction, motion, and subtitle beat. Scene 2 must start from Scene 1’s closing frame; Scene 3 must start from Scene 2’s closing frame.
5. Create a Flow handoff. For each scene, output a copyable Google Flow prompt that says to use the same anchor object, use the previous shot’s final frame or video extension, preserve all continuity-pack invariants, avoid text/logos/chat UI, and leave subtitle-safe space at the bottom.
6. Create the 30-second speaking script: 0-4 situation, 4-8 partner line, 8-12 target Korean reply, 12-17 Your turn pause, 17-23 full response, 23-28 role swap, 28-30 CTA. Use Hangul subtitles and short natural English support text.
7. Run a final review. Block the package if Korean is translation-like, learner-facing explanations appear in Korean, an object changes between scenes, a card misses Studio mindulmin, a third-party asset appears, or the CTA forces engagement.
8. Block the package if it turns the target expression into abstract philosophy, fails to include a partner line and target reply, or substitutes unrelated mood imagery for a real speaking situation.

Outputs:
- episode brief
- 8-card blueprint
- continuity-pack.json
- three Flow prompts with frame-to-frame continuity instructions
- 30-second subtitle and dialogue timeline
- Instagram caption and relevant hashtags
- publish checklist with status set to review_ready, never auto-publish a Reel

Use clear English support labels and compact copy. Do not create a generic marketing video. Focus on a global learner practicing one Korean response in a real situation.
```

## Workspace layout

| Opal node | Output | Why it exists |
| --- | --- | --- |
| Episode Input | expression, situation, audience | One source of truth |
| Lesson Architect | hook, Korean, script | Prevents textbook-like copy |
| Continuity Director | `continuity-pack.json` | Locks objects and camera grammar |
| Flow Shot Pack | Scene 1–3 prompts + frames | Carries the same objects forward |
| Subtitle & Voice | 30-second dialogue timeline | Preserves speaking practice |
| Brand/Policy QA | pass/block report | Stops missing credit or unsafe assets |
| Export Handoff | Flow pack + caption + review | Human creates clips, Codex assembles and reviews |

## In Google Flow

1. Create the anchor object once with **Ingredients to Video** or upload your own project-owned anchor image.
2. Make Scene 1 from the first Flow prompt.
3. Use Scene 1’s final frame or **Video extension** for Scene 2; do not retype a standalone prompt.
4. Repeat for Scene 3. Keep the `continuity-pack.json` visible while checking colors, props, framing, and object positions.
5. Export the three clips to the local Reel folder. Codex then adds the practice pause, original AAC dialogue, subtitles, and technical review.
