# Language Cafe Daily Content Rules

## Audience

Language Cafe helps people around the world start real Korean conversations. Everyday Korean in Hangul is the lesson core. Natural English gives only the short situation and meaning bridge; romanization supports pronunciation but never replaces Hangul.

## Card Carousel

- Before writing or rendering, read `content-queue/VISUAL-SYSTEM-v2.md`. The V2 speaking-scene visual review is a required gate, not an optional styling reference.
- Read `content-queue/WEEKLY-INSTAGRAM-REVENUE-OPERATING-SYSTEM.md` as the revenue-operation overlay. It adds evidence and conversion checkpoints without changing the existing scheduled carousel cadence.
- Master deliverable: eight `1080x1920` (`9:16`) images under `vertical-9x16/`. Keep every essential word, character cue, and the `Studio mindulmin` credit inside the centered `1080x1350` feed-safe area.
- Design the 9:16 master as a full speaking scene. Do not center a finished 4:5 card inside empty top and bottom bands; those bands must add non-essential but meaningful time, place, dialogue-direction, or speaking-rhythm cues.
- Reject a card whose dominant structure is a flat background plus one centered white rectangle. Use a scene cue and a speaking/action cue that remain original project graphics; never use another account's screenshots, UI, logo, or watermark.
- Across the eight cards, use at least five distinct compositions from V2. Each card needs at least two meaning-bearing visual cues, while keeping the character on exactly one scene card.
- Feed derivative: retain eight `1080x1350` (`4:5`) images for Instagram carousel API publishing. A 9:16 photo is cropped in the feed, so the Graph API must receive the feed derivative rather than the 9:16 master.
- Caption: write natural English first and natural Korean second, but never show language headings such as `[한국어]`, `[영어]`, `[Korean]`, or `[English]` in the public caption. English gives a global learner the scene and intent; Korean is the real line to say. Both passages cover the same scene, meaning contrast, example, and CTA without word-for-word translation.
- Caption limit: keep the complete bilingual caption and one shared hashtag block within 2,200 characters. Do not repeat hashtags in each language section.
- Structure: real Korean conversation / common confusion / meaning contrast / simple polite-use rule / ready Korean line / natural upgrade / repeat aloud / Language Cafe CTA.
- On-card language split: Hangul is reserved for the Korean that the learner hears or says, the exact target phrase and its Korean components, and limited pronunciation practice. Write every explanation, meaning note, usage rule, practice instruction, swipe reason, and CTA guidance in natural global English. A Korean explanation such as `지금 가리키는 거예요` is a blocking error even when English appears elsewhere on the card.
- Character: show the same locked mint mascot in one large situation card. Use `brand/language-cafe-mascot-v1/language-cafe-mascot-reference-sheet-v1.png` as the sole identity reference for every expression scene. Never redesign the mascot or chain identity from an older expression scene.
- Before image generation, write a short character brief that maps the expression to the required emotion, facial expression, pose, and scene. The face and pose must communicate the meaning without relying on the card text.
- Reject and regenerate any mascot image whose emotion, facial expression, pose, time of day, or setting conflicts with the speaking situation. For example, an agreeing expression needs an attentive, pleased face and an open agreeing gesture, not a bored hand-on-cheek pose.
- Preserve the exact locked Language Cafe character identity. Only expression, gesture, pose, camera angle, and scene may vary. Two short oval sprouts, eye geometry, body proportions, mint color, and pebbled material are immutable. Do not repeat the character image on the other seven cards.
- Brand credit: show the exact text `Studio mindulmin` once on the bottom-right of every one of the eight cards. It is the project creator credit, not a third-party logo or watermark. If any card lacks it, the job fails before publishing.
- Music: never bake BGM into static card PNGs or a Graph API carousel upload. The default carousel is published plain after its content and distribution gates pass; any later in-app music action is outside this automation.
- Publishing: a completed carousel can auto-publish only when its job explicitly sets `workflow.autoPublish` to `true`. It still must pass the eight-card visual gate, natural Korean gate, and global-learner English-bridge gate first.
- Distribution gate: confirm original assets, no third-party watermark, no engagement bait, a passed guideline review, and a clear first-slide hook before auto-publishing.

### Carousel audio: no automated audio

- A carousel job defaults to `workflow.carouselMusicReview.requested=false`; it may use `carousel-pipeline.cjs --publish` after all normal gates pass.
- Do not search, select, scrape, download, embed, or mix Instagram-library music for a carousel. If the account later exposes an in-app post-edit music feature, the account owner makes that action independently after publishing.
- Record only whether the automation published without embedded or API-selected audio. Do not block the plain carousel for an optional later app action.

### Korean authenticity and global one-second test

- Korean copy must show what a person would actually say in the scene before explaining the category or grammar. Use polite everyday Korean as the default unless the card explicitly teaches a register contrast.
- A reader must understand the situation and intended meaning on the first read. If the sentence requires mental translation or a second reading, rewrite it.
- Prefer direct mappings such as `Sounds good. = 좋아, 그렇게 하자.` over labels such as `제안에 동의`.
- Prefer concrete scene language such as `사진 잘 나왔다` over abstract labels such as `눈으로 보고 평가`.
- Remove dictionary-style explanations when the example already makes the meaning clear.
- Keep one idea per sentence and use short spoken Korean.
- Before rendering, read every Korean line aloud. Replace anything that does not sound like something a person would naturally say.
- The copy spec must record `translationeseDetected=false`, `everydaySpeechConfirmed=true`, `oneSecondMeaningConfirmed=true`, and `readAloudConfirmed=true` with concrete evidence. It must also record `globalLearnerReview` with `hangulFirstConfirmed=true`, `englishBridgeConfirmed=true`, `instructionLanguageConfirmed=true`, `nonDialogueKoreanDetected=false`, `romanizationLimited=true`, and `pronunciationGuidanceConfirmed=true`. The card-specific copy spec must list the only allowed visible Korean phrases for each of all eight cards; the validator rejects any other Hangul. Missing or unsupported values block publishing.

### Character meaning gate

- The job must record `workflow.characterReview` before rendering.
- Required passed values: `meaningMapped=true`, `customAssetConfirmed=true`, `facialExpressionMatchConfirmed=true`, `poseMatchConfirmed=true`, `sceneMatchConfirmed=true`, `identityLockConfirmed=true`, `identityDriftDetected=false`, `sceneVariationOnlyConfirmed=true`, `sproutCount=2`, `sproutShapeMatchConfirmed=true`, `eyeGeometryMatchConfirmed=true`, `bodyProportionsMatchConfirmed=true`, `surfaceMaterialMatchConfirmed=true`, `sideBySideIdentityReview="passed"`, and `review="passed"`.
- `workflow.characterReview.asset` must point to the expression-specific project asset, and `evidence` must state why the face, pose, and setting match the phrase.
- A previous lesson's character image is not identity evidence. The job must record the canonical reference path and SHA-256 from `brand/language-cafe-mascot-v1/manifest.json`. If the current scene drifts from the locked identity or the expression does not match on first inspection, the job is blocked and the scene must be corrected from the canonical reference.

## Card Carousel Reel

- Deliverable: one `1080x1920` thirty-second video at `30 fps` or higher, made only from the eight approved carousel PNGs.
- Visual source: cards stay fully visible. Use gentle alternating zoom, small pan, blurred same-card parallax background, and short fades; do not add external video, screenshots, chat UI, third-party marks, or logos.
- Audio: export a technically valid silent AAC track. Do not bake, scrape, download, or select Instagram-library music in the MP4.
- Instagram music: create an `instagram-music-handoff.md` with three non-song-specific search intentions derived from the expression. The account owner chooses an eligible track in the Instagram app. If the app exposes a volume or mix control, start at 5-10% and confirm all card copy remains easy to read; otherwise share it silent.
- Review: verify 30 seconds, 1080x1920, H.264/yuv420p, at least 30 fps, complete approved-card manifest, no watermark, full-card readability, motion restraint, and the music handoff. A Reel job is always `review_ready` with `autoPublish=false`.
- Never run `publish-reel.cjs`. The account owner makes the final in-app music and publishing decision.

## Publishing Guard

Carousel automation may publish only after the explicit per-job auto-publish rule above passes every preflight gate. Card Carousel Reel automation never publishes and always requires human review plus an in-app music choice.

- Before creating any Instagram container, compare the complete normalized caption with recent account carousels. If an identical caption exists, block the job and report the existing permalink.
- Use one atomic publish lock per job. A concurrent retry must stop. If an attempt fails after Instagram container creation begins, keep the lock until recent account media is checked and the outcome is resolved.
