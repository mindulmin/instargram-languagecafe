# Language Cafe Instagram-first learning-pair publisher contract

This path is retained for automation compatibility. The contract is no longer a conversion-post contract: it publishes one complete Instagram Korean-expression lesson and, only after official Instagram readback, one distinct text-only Threads study companion.

## Fixed channel roles

- **Instagram:** the canonical, full visual Korean-expression lesson for global learners.
- **Threads:** a short native recall companion for the same expression. It is not a landing-page or sales surface.
- **Strategy version:** `instagram-study-companion-link-v2`.
- **Publisher workspace:** `C:\Users\earth\OneDrive\Desktop\codex\instagram-card-test\meaning-switch-series-v1`.

The publisher reads only the controller's `strategy`, `publishing`, and `handoff` objects to consume a learning-pair release. Offer, price, checkout, landing, UTM, revenue metrics, revenue status, and product approval fields are outside this publisher's authority and **must not gate** a learning pair. Their absence, blocked state, or value cannot authorize or block this workflow.

## Mandatory start order

Cloud role clarification (owner request 2026-09-11): the trusted controller may read official history and the source Sheet/CSV and create an ephemeral metadata seed before issuing a release. This is source selection, not a passed copy/visual review. The restrictions below apply to the publishing agent consuming that release. The controller records no review approvals. The publisher must complete all production and review gates before posting. A separate trusted Story step may publish at most one reviewed Story only after this pair's two official readbacks; the pair publisher itself must not post Stories or new Reels.

1. Read this contract, `AUTOMATION.md`, the existing Instagram copy/visual gates, and `content-queue/threads/THREADS-KOREAN-CONVERSATION-TEMPLATE.md`.
2. Read `strategy`, `publishing`, and `handoff`, and validate only the learning-pair fields below. Do not import revenue or destination gates.
3. Acquire the per-`actionId` execution lock, then re-read and revalidate the same handoff. An unreadable or existing unresolved lock blocks the run.
4. Resolve exactly `handoff.requestedPostId`. Never choose a replacement source.
5. Run the Instagram source, copy, visual, duplicate, approval, hosting-byte, and exact-once checks before any Instagram container action.

No Google Sheet or CSV state, draft, render, upload, container, or publish action may occur before steps 1–4 pass.

At the paired Threads stage, the job must remain bound to the exact controller bytes that authorized it. Before reading a Threads session or creating any per-job lock, `publish-threads.cjs` re-reads the canonical control path and the source carousel job, verifies the control SHA-256 and every binding field, and reruns the release and official-source gates. It repeats both reads after the per-job lock and before any Threads API call. An arbitrary CLI `--control` path is forbidden.

## Learning-pair release gate

Every value below is required. Missing, malformed, contradictory, expired, or unknown values block the run.

| Gate | Required value |
| --- | --- |
| Contract | top-level `schemaVersion == "1.2"`, `handoff.contractVersion == "1.2"`, and `strategy.threadsStrategyVersion == "instagram-study-companion-link-v2"`. |
| Canonical control | Read exactly `C:\Users\earth\OneDrive\Desktop\codex\Koreanstudy_studio\my-app\docs\revenue-operations\current-test.json`; store and later match its SHA-256. Production jobs and CLI arguments cannot redirect this path. |
| Calendar | `timezone == "Asia/Seoul"`, `asOfDate` equals the current KST date, and that date is inclusively within `period.day1..period.day14`. |
| Channel strategy | `strategy.primaryChannel == "instagram"`, `strategy.primaryJob == "korean_expression_learning"`, `strategy.threadsRole == "native_study_companion_with_source_link"`, and `strategy.instagramRequiredBeforeThreads == true`. |
| Threads link contract | `threadsExternalLinkRequired == true`, `threadsExternalLinkCount == 1`, `threadsLinkTargetType == "source_instagram_permalink"`, `threadsApprovedLinkTarget` is null before Instagram publication, `threadsLinkTargetBinding == "derive_exactly_from_official_instagram_readback"`, `threadsLinkPosition == "final_line"`, and `threadsStudyCtaPrefix == "Review the full visual lesson on Instagram →"`. |
| Preview and sales safety | `threadsExplicitLinkAttachmentAllowed == false`, `threadsProductOrPriceCopyAllowed == false`, and `threadsSalesCtaAllowed == false`. A platform-generated preview remains unobserved unless an official surface reports it; do not record a false no-preview claim. |
| Publishing state | `publishing.status` is exactly `learning_ready` or `active`, and `publishing.postDue == true`. Revenue status is not consulted. |
| Learning-pair cap | `publishing.maxPosts` is an integer from 1 to 3, `publishing.publishedCount` is a non-negative integer, and `publishing.publishedCount < publishing.maxPosts`. The count reconciles against accepted exact-one Instagram learning-pair receipts. |
| Publishing approval | `publishing.approvalRequired == false` and `publishing.approvalItems` has no unresolved, pending, required, or blocked item. Revenue approval items are ignored. |
| Freshness | `handoff.issuedAt <= now <= handoff.validUntil`; both timestamps must parse and `issuedAt <= validUntil`. |
| One action | `handoff.consumerAction == "publish_one_learning_pair"`, `handoff.mayCreateMedia == true`, and `handoff.mayPublish == true`. |
| Idempotency | Non-empty `actionId` and `idempotencyKey`, unused in every job, lock, and learning-pair receipt. A repeated value returns its existing result without new work. |
| Requested source | `handoff.requestedPostId` and `handoff.targetExpression` are non-empty; the ID resolves to exactly one eligible, ready, unpublished Instagram source whose exact expression equals `targetExpression`. Published, correction, duplicate, missing, ambiguous, non-ready, or mismatched sources block. |
| Receipt destination | `handoff.receiptPathPattern` exactly equals `C:\Users\earth\OneDrive\Desktop\codex\instagram-card-test\meaning-switch-series-v1\operations\revenue-experiment\<testId>\publisher-receipts\<actionId>.json`. |
| Receipt capability | The publisher can record separate Instagram and Threads evidence, including `threadsStrategyVersion`, `threadsLinkTargetType`, `threadsLinkTarget`, `threadsExternalLinkCount`, `threadsExplicitLinkAttachmentRequested`, and `threadsPlatformPreviewState`. |

The gate does **not** read or require `revenue.offer`, `revenue.offer.price`, `revenue.checkoutGate`, `revenue.landing`, `revenue.utm`, revenue targets, revenue metrics, revenue approval items, or revenue status.

This contract is source-permalink-only. `owned_practice_landing` is blocked even when its URL appears allowlisted or contains four correct UTM values; the existing owned home has not supplied controller-bound Korean-learning alignment and official readback evidence, and this v2 strategy does not authorize it.

## One authorized execution

1. Resolve only the requested ready expression. Exact current-focus and duplicate rules remain binding; learner signals are evidence only.
2. If the Google Sheet returns `403 PERMISSION_DENIED`, record `unavailable_no_access`, use the documented CSV fallback, and do not claim a live Sheet read or write. The fallback must resolve the exact requested source.
3. Bind the Instagram job to `actionId`, `idempotencyKey`, requested source ID, and `instagram-study-companion-link-v2`. Do not bind offer, price, checkout, landing, or UTM data.
4. Build the complete Instagram lesson and pass every existing natural-Korean, global-learner, visual, character, dimensions, safe-area, originality, watermark, language-metadata, caption, recent-media, local-job, approval, and lock gate.
5. Publish at most one Instagram carousel through the existing exact-once route. Mark it published only when `workflow.postPublishVerification` has `status == "passed"`, `review == "passed"`, `source == "official_instagram_graph_api_recent_media"`, `mediaIdMatchCount == 1`, `normalizedFullCaptionMatchCount == 1`, `sameHangulExpressionMatchCount == 1`, `exactOnePublishedJobConfirmed == true`, non-empty `matchedMediaId`, an Instagram `/p/` permalink, and `mediaType == "CAROUSEL_ALBUM"`. Cross-check `published.mediaId`, plus `published.verification.id`, `media_type`, and `permalink`, against those exact values.
6. Only after that concrete Instagram receipt passes, prepare one Threads TEXT job from the same job ID and expression. Bind `testId`, `actionId`, `idempotencyKey`, canonical `controlPath`, exact `controlSha256`, `requestedPostId`, `targetExpression`, `validUntil`, `contractVersion`, `strategyVersion`, `linkTargetType`, and the derived `sourceLinkTarget`. The controller does not carry the future permalink; the generator derives it from the exact official source readback.
7. The Threads body order is one real scene, exactly one target Hangul line, a short English meaning, a three-minute recall cue, then one final line: `Review the full visual lesson on Instagram → <exact official source carousel permalink>`.
8. The body must contain exactly one URL. It must byte-match the source `workflow.postPublishVerification.permalink`, use HTTPS `www.instagram.com/p/...`, and contain no UTM, query, fragment, extra URL, or bare domain. Promotional course/product/cost/fee/free-trial/membership/subscription/buy/purchase/checkout/sale/discount/currency copy remains blocked. Legitimate lesson meanings such as “Of course.” and “It’s on sale.” remain valid when they contain no promotional intent.
9. Publish at most one paired Threads post through the atomic-lock exact-once route. Record success only after official media-ID and normalized-full-text readback each match exactly once.
10. Write one immutable learning-pair receipt. Metrics and revenue interpretation remain outside this publisher.

Instagram success does not authorize a second Instagram post. A blocked or ambiguous Threads result does not permit a replacement carousel or second Threads attempt. Preserve the lock and exact partial outcome.

## Reel boundary

- Do not create, render, regenerate, upload, schedule, or publish a new Reel through this learning-pair action.
- Never run `publish-reel.cjs`.
- Leave existing Reel artifacts unchanged at `review_ready` or `needs_human_review`, with `workflow.autoPublish=false`.

## Receipt

Store one JSON receipt at the handoff's compatibility path `operations/revenue-experiment/<testId>/publisher-receipts/<actionId>.json`. The directory name does not turn revenue data into a publication gate. `instagram` and `threads` are separate objects. Include:

- `contractVersion`, `strategyVersion`, `actionId`, `idempotencyKey`, handoff hash, first-read and locked re-read timestamps, and both gate results;
- source expression ID, Instagram job ID, review/preflight references, and the fact that revenue fields were not consulted as publication gates;
- `instagram`: status, container count, publish-call count, media ID, permalink, published time, normalized-caption match count, target-expression match count, and official readback time;
- `threads`: status, job ID, container count, publish-call count, media ID, permalink, published time, normalized-full-text match count, and official readback time;
- `threadsStrategyVersion: "instagram-study-companion-link-v2"`;
- `threadsLinkTargetType: "source_instagram_permalink"` and the exact derived `threadsLinkTarget`;
- `threadsExternalLinkCount: 1`;
- `threadsExplicitLinkAttachmentRequested: false`;
- `threadsPlatformPreviewState: "unavailable_platform_managed"`;
- Reel action count fixed at `0`;
- final status: `published_learning_pair_exactly_once`, `instagram_published_threads_blocked`, `blocked_preflight`, `blocked_duplicate`, or `blocked_ambiguous`.

A receipt cannot report success if the target, one-link count, explicit-attachment field, or platform-preview state is missing or differs from the required value. The API request contains TEXT and body text only; it does not request a link attachment. Threads may still auto-render the body URL, so preview absence is never inferred. Observed numeric zero is `0`; missing or uncollected measurements remain `unavailable`.

## Legacy exposure experiment

`threads-exposure-v1-20260830` accepts no new jobs. Preserve its existing cohort, receipts, permalinks, and 24/72-hour observations. Any remaining checkpoint activity is read-only and may update only the already enrolled historical entry; it cannot enroll a future learning-pair job.

## Explicitly prohibited

The publisher must not:

- interpret performance or revenue metrics, require checkout/landing/UTM readiness, or turn engagement into a conversion claim;
- add a site, affiliate, product, price, or sales link; add any URL other than the exact official source carousel permalink; request an explicit link attachment;
- change an offer, profile, app code, payment/authentication/database logic, Cloudflare configuration, Git state, or deployment;
- replace a blocked source, create a near-duplicate, delete or repost historical media, clear an unresolved lock, or enroll a new post in the retired exposure experiment;
- automatically like, save, follow, comment, reply, send a DM, or manipulate recommendations;
- convert `baseline_unavailable`, `unverified_priority`, `review_rule_pending`, `not_due`, or `unavailable` into zero, PASS, or success.

When no valid `publish_one_learning_pair` handoff exists, the correct result is a local block receipt and no external action.
