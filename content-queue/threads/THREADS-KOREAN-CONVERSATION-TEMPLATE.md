# Language Cafe Instagram-first Threads study-companion template

## Channel role

Instagram `@mindulmin` is the canonical lesson surface. Each carousel must teach the complete Korean expression through a visual scene, meaning, usage guidance, and recall structure for global learners.

Threads is a distinct text-only study companion published after that exact Instagram carousel passes official readback. It gives the learner one short retrieval-practice moment and ends with the exact official carousel permalink so the learner can review the full visual lesson. It is not a product, pricing, checkout, or sales surface.

The two posts share one verified expression source, but never duplicate the full caption or become one cross-posted asset.

## Required strategy

- `strategyVersion`: `instagram-study-companion-link-v2`
- `angle`: `instagram-lesson-recall-v2`
- Working length: 180–480 characters; hard maximum: 500.
- One natural English situation.
- Exactly one visible Hangul line: the target expression copied from the officially published Instagram lesson.
- One short natural English meaning.
- One three-minute recall instruction.
- Exactly one final-line learning CTA: `Review the full visual lesson on Instagram → <exact official source carousel permalink>`
- `externalLinkCount`: `1`.
- `linkTargetType`: `source_instagram_permalink`.
- `explicitLinkAttachmentRequested`: `false`.
- `platformPreviewState`: `unavailable_platform_managed`.

Any missing or mismatched strategy field blocks preparation and publication.

## Non-negotiable public-copy rules

- Keep explanations and instructions in natural global English; reserve Hangul for the exact target line.
- Do not use `[Korean]`, `[English]`, `[한국어]`, or `[영어]` headings.
- Use polite everyday Korean unless the Instagram lesson explicitly teaches a register contrast.
- Do not ask for likes, shares, comments, follows, replies, or DMs.
- Include only the one exact HTTPS `www.instagram.com/p/...` permalink from the source carousel's official readback. Do not add UTM parameters, a query, fragment, second URL, bare domain, or shortened/rewritten link.
- Do not include promotional course/product/cost/fee/free-trial/membership/subscription/buy/purchase/checkout/sale/discount/currency or affiliate copy. A lesson may still explain a legitimate phrase such as “Of course.” or “It’s on sale.” when there is no promotional intent.
- Do not write `Continue with Language Cafe`.
- Do not paste or lightly rewrite the Instagram caption. Threads must stand alone as a brief recall exercise while Instagram remains the full lesson.
- Do not infer learning, traffic, or revenue outcomes from views, likes, or replies.

## Reusable public-post template

```text
Imagine you're [one concrete real-world situation].

Try this Korean line:
[exact target Hangul expression]

It means: “[short natural English meaning]”

Say it once for this situation. In 3 minutes, try again without looking.

Review the full visual lesson on Instagram → [exact official source carousel permalink]
```

This is the only default angle for future standard Threads posts. Do not attach an image or explicitly request a link attachment. Threads may automatically render a preview from the body URL; record that platform-managed state as unavailable unless an official readback surface exposes it.

## Cross-channel learning pair

| Instagram canonical lesson | Threads native study companion |
| --- | --- |
| Complete eight-card visual lesson | Short text-only retrieval practice |
| Scene, expression, meaning, usage, contrast, and visual recall | One scene, one Hangul target, one meaning, and one three-minute recall |
| Must publish and pass exact-one official readback first | May be created only from that read-back source |
| Full branded visual asset and caption | No copied caption or image; exactly one final source-carousel permalink; no product, price, or sales CTA |
| Primary learning destination | Secondary recall prompt that returns to the exact visual lesson |

## Pre-publication quality gate

Publish-ready requires all four checks and every blocking rule to pass.

| Axis | Required evidence |
| --- | --- |
| Accuracy | The exact source Hangul line and English meaning match the officially read-back Instagram lesson. |
| Completeness | Scene, target line, meaning, recall step, final visual-lesson CTA, exact source permalink, source ID, and character count are present. |
| Practicality | A global learner can say the expression after one read; copy is 180–480 characters and never exceeds 500. |
| Revenue contribution | Protect Korean-learning brand trust by keeping the full lesson on Instagram and avoiding a mismatched English-landing advertisement. This is an indirect contribution, not observed revenue. |

Blocking checks include:

- Instagram source not published or official readback not passed;
- wrong or missing `instagram-study-companion-link-v2` strategy version, including any v1 job;
- zero URLs, two or more URLs, HTTP, a non-Instagram host, non-`/p/` path, query/UTM/fragment, bare domain, or any URL that differs from the exact official source permalink;
- `externalLinkCount` missing or not exactly `1`;
- `explicitLinkAttachmentRequested` missing or not exactly `false`, or `platformPreviewState` other than `unavailable_platform_managed`;
- product, price, checkout, subscription, affiliate, or sales copy;
- `Continue with Language Cafe`;
- missing or repeated final Instagram learning CTA;
- Korean explanation outside the exact target line;
- copied caption, engagement bait, local/official duplicate, unresolved lock, or publication outside the exact-once publisher.

Revenue, checkout, landing, CTA, and UTM fields are not part of this gate.

The current v2 strategy does not allow `owned_practice_landing`. The existing owned home is not approved as a Korean-learning destination. Future owned-practice support would require an HTTPS allowlist, Korean-learning alignment plus official readback approval, and exactly four UTM values (`threads`, `organic`, `language_cafe`, `<expression-id>-instagram-lesson-recall-v2`); even a URL that appears to satisfy those fields remains blocked until the strategy contract is explicitly revised.

## Draft automation contract

The automation may prepare one Threads draft only after its paired Instagram carousel has:

1. `workflow.status == "published"`;
2. passed `naturalKoreanReview`, `globalLearnerReview`, and `distributionReview`;
3. passed concrete `workflow.postPublishVerification`: `status` and `review` are `passed`, `source` is `official_instagram_graph_api_recent_media`, the media-ID/full-caption/Hangul-expression match counts are each exactly `1`, `exactOnePublishedJobConfirmed` is `true`, `matchedMediaId` and the Instagram `/p/` permalink are non-empty, and `mediaType` is `CAROUSEL_ALBUM`;
4. resolved to exactly one source expression with no local duplicate.

The source receipt must also match `published.mediaId` and `published.verification.id`, `media_type`, and `permalink`. A marker-only `passed` value, fake permalink, missing count, or mismatched receipt blocks the draft.

Every generated job binds the current controller's `testId`, `actionId`, `idempotencyKey`, canonical `controlPath`, exact byte SHA-256, `requestedPostId`, `targetExpression`, `validUntil`, `contractVersion`, `strategyVersion`, `linkTargetType`, and the derived `sourceLinkTarget`. The controller is schema `1.2`, uses `Asia/Seoul`, has an `asOfDate` equal to the current KST date within `period.day1..period.day14`, and releases the exact source through `publish_one_learning_pair`. Because the controller handoff precedes Instagram publication, it keeps `threadsApprovedLinkTarget` null and requires `threadsLinkTargetBinding=derive_exactly_from_official_instagram_readback`. The production CLI cannot accept an alternate `--control` path.

```powershell
npm.cmd run prepare-threads-draft -- --source-carousel-job jobs/<officially-published-carousel-job>.json
npm.cmd run prepare-threads-draft -- --source-carousel-job jobs/<officially-published-carousel-job>.json --dry-run
npm.cmd run review-threads-draft -- --job content-queue/threads/jobs/<threads-job>.json
npm.cmd run test:threads-draft
```

The generator writes only a new local job under `content-queue/threads/jobs/`. It does not mutate the source carousel, Google Sheet/CSV state, historical Threads jobs, or historical experiment evidence. It never reads a Threads session or calls an external API. `prepare-threads-draft.cjs --publish` remains unsupported.

## Official Threads publisher contract

`publish-threads.cjs` is the sole component allowed to call the Threads publishing API. It defaults to dry-run, reuses the same fail-closed validator, and requires an explicit `--publish` flag for an approved future job.

Before it reads a Threads session or creates the per-job lock, the publisher re-reads the canonical controller and source carousel from disk, matches the control SHA-256 and all handoff fields, and verifies that the current official source permalink still equals `sourceLinkTarget` and the one URL in the post. After acquiring the lock, it repeats those reads before the first Threads API request. It also rechecks the v2 strategy, final-link position, `externalLinkCount=1`, explicit-attachment prohibition, commercial-copy ban, local and official duplicates, and unpublished state. Success requires exact-one media-ID and normalized-full-text official readback. The receipt records the link type and target, count `1`, explicit attachment `false`, and platform preview `unavailable_platform_managed`.

An ambiguous result is never retried automatically. Preserve the lock and block for human inspection. Do not reply, DM, change a profile, or trigger Instagram/Reel actions.

## Historical exposure experiment

`threads-exposure-v1-20260830` is retired from new enrollment. Its existing cohort entries, receipts, permalinks, and observed 24/72-hour values remain historical evidence. A due checkpoint may update only an already enrolled historical entry through the read-only collector. No future standard job may use `scene-question-recall-v1` or join that cohort.

Numeric API zero remains observed zero. Missing, null, uncollected, or non-numeric metrics remain `unavailable`.
