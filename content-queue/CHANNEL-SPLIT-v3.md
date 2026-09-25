# Language Cafe channel split (2026-09-25)

This is the strategy for **new** posts. Historical Instagram lessons, Threads
recall posts, receipts, and their locks remain evidence of the earlier v2
strategy. Do not rewrite or republish them.

## Channel roles

| Channel | Reader promise | Post format | Next action |
| --- | --- | --- | --- |
| Instagram `@mindulmin` | Discover Language Cafe's current free Korean café-ordering pilot | Original product-led image for a beginner who reads Hangul and follows English guidance | Use the existing profile link, then open the free Korean mission |
| Threads `@mindulmin` | Learn one Korean expression through clear English explanations, as in the former Instagram lessons | Original 2–8-card English-language card-news carousel, with a short native caption | Open the final-line direct link to the free Korean café mission |

The two channels have independent jobs, publication receipts, cadence, and
duplicate checks. A Threads card is complete without an Instagram source post;
an Instagram promotion is complete without a Threads reply. A post on either
platform does not authorize a second post on the other.

The first reviewed, hosted queue items are
[`Instagram café promotion`](instagram-promo/campaign-2026-09-25-01/brief.md)
and [`Threads takeaway expression cards`](threads/campaign-2026-09-25-01/README.md).
Their exact jobs and separate source-controlled editorial grants were bound
on 2026-09-25. This is a queued-content decision, not a cloud claim, social
API permit, or proof of a live post. The grant writer was separate from the
draft asset producer for this initial queue; the repository format alone does
not cryptographically enforce that separation for future AI-generated jobs.

## Instagram promotion

- Choose one real Korean café-ordering problem (for example, answering whether
  an order is for here or to go). Show one action the visitor can take in the
  free Korean café pilot.
- The live homepage and `/missions/korean-cafe/` were checked on 2026-09-25:
  the pilot is for beginners who read Hangul and follow English guidance;
  it asks for login, needs no card, and is separate from paid English plans.
  Recheck both pages immediately before approval and publication. Do not use
  the retired English five-minute conversation claim to promote this pilot.
- The post should give useful context even to someone who does not visit the
  site. Use clear English for foreign Korean learners, accurate Korean for the
  example, and no fabricated testimonials or outcome claims.
- End with one specific profile-link action. Check that the profile website is
  `https://languagestudio.uk/` and the root homepage currently links to the
  mission before using that instruction. An Instagram
  caption URL is not the tracked click path.
- Review original artwork, text legibility, brand identity, and the match
  between the post's promise and the landing page. Keep Reels and Story
  publishing outside this new post action until they have their own review.

## Threads English-language cards

- Keep the former Instagram lesson's direction: teach **one Korean expression
  in English** for a real everyday scene. Keep one expression and one scene
  per carousel. Do not republish an old Instagram image as a new Threads post
  or publish an Instagram screenshot.
- Suggested cards: (1) situation and Korean target line, (2) natural meaning
  in English, (3) short dialogue, (4) usage distinction, (5) say it yourself,
  (6) recall after three minutes and the site's honest offer.
  Use 2–8 cards when fewer are enough. Each card must stand on a phone screen.
- Explain the Korean expression before the invitation to visit. The verified
  free Korean café mission asks learners to try an order, use targeted help,
  then handle a changed order. It does not guarantee rehearsal of the exact
  card expression. Keep that distinction truthful in the CTA.
  The caption ends
  with exactly one HTTPS `languagestudio.uk/missions/korean-cafe/` URL. Optional tracking parameters
  are limited to `utm_source=threads`, `utm_medium=organic`,
  `utm_campaign=language_cafe`, and a bounded post-specific `utm_content`.
  No Instagram permalink is required.
- The image URLs must be immutable public deployment URLs and checked against
  the reviewed image bytes. The Threads API uses IMAGE children and one
  CAROUSEL parent. Do not use a TEXT-only post or claim that an explicit
  `link_attachment` works for a carousel. Confirm how the site URL renders on
  the first live post. Give every card unique reviewed alternative text and
  read back the public cards in order; if order cannot be confirmed, retain
  the publish lock and do not retry the same job.
- Keep the caption within the Threads 500-character limit. Check the Korean
  expression and English explanation for correctness, and avoid engagement
  demands or unverified product claims.

## Release and measurement

The owner authorized automatic publication without a separate approval click
for each new post on 2026-09-25. This waives the owner's per-post decision,
not the content, identity, offer, duplicate, hosting, and exact-once gates.
The publishing process must use an independent trusted review record bound
to the final job bytes and image hashes; a job's own `approved` field or a
generator's self-attestation is not that record. If independent review or
fresh live offer evidence is unavailable, stop without posting.

1. Select an unused source for each channel, produce the final image and
   caption, and complete the independent quality review before any API write.
2. Use distinct v3 job IDs and durable pre-API locks. One create/publish
   attempt per job; an uncertain API outcome stays blocked until official
   readback resolves it.
3. Before unattended scheduling, verify each channel's dry run and one
   controlled live post, including the exact published text and media ID.
   Preserve all v2 encrypted state and unresolved locks during cutover.
4. Record reach/engagement separately from `languagestudio.uk` visits with
   source tracking, Korean mission starts, first replies, saved expressions,
   and paid conversion only when a relevant paid path exists and attribution
   is verified. A missing measurement is `unavailable`, never zero. Site
   visits and engagement are not revenue; the current free Korean pilot is
   not itself a paid offer, and the separate English plans are not a presumed
   upgrade for these Korean learners.

The old v2 cloud publisher must stop issuing learning-pair releases before
this v3 strategy is activated. Do not relabel a v2 receipt as a v3 post.

Cloud is the primary executor. A local fallback may use the same encrypted
remote state and atomic claims only after it can prove the cloud run stopped
before a social API intent. An uncertain cloud outcome, an unreachable state
branch, or an unresolved channel intent blocks the local fallback; it is not
permission to retry. Never run two independent publishing schedulers.

## Current activation state (2026-09-25)

- `cloud/control/policy.json` disables new v2 learning-pair releases, and its
  old GitHub Actions schedule is removed. Historical v2 jobs, receipts and
  unresolved per-job evidence are preserved; never retry a v2 social call.
- `cloud/control/channel-split-v3-policy.json` enables Instagram and Threads
  independently. The v3 scheduled Action runs at 09:00 Asia/Seoul; manual
  `preview` has no platform or remote-state credentials.
- The first Instagram promotion was published by cloud run `36142919425` as
  official IMAGE `17910040623524634` at
  `https://www.instagram.com/p/DdtmV9RjJfF/`. Its remote v3 receipt is
  `published_verified`, its Instagram lock is clear, and a fresh official
  account media list contained exactly one matching ID and caption. This is
  post verification, not reach, mission completion, or revenue evidence.
- Threads run `36141543126` stopped at a fourth child IMAGE create intent,
  before any carousel parent or publish intent. Its original job was retired,
  and an exact-action official-readback-backed transition closed only that
  remote lock as `abandoned_before_publish_intent`. The unknown fourth child
  may exist; never repeat that API call or relabel the old job as published.
  A separately reviewed three-card job then published in cloud run
  `36145951320` as official `CAROUSEL_ALBUM` `18226021297332298` at
  `https://www.threads.com/@mindulmin/post/Ddtpt44EZNr`. Fresh official API
  readback found exactly one matching caption and all three IMAGE cards in
  the reviewed order with matching alt text. This is not evidence of link
  clicks, learning, or revenue.
- The runner's source-controlled grant, current-main check, durable remote
  CAS and independent readback gate each social API intent. These gates do
  not cryptographically prove that future grants came from a separate human
  or model. Until a trusted independent reviewer creates more grants, the
  daily schedule can only consume the existing finite queue. Both first
  approved v3 jobs now have verified receipts; no additional approved content
  is currently queued. Do not describe this as unlimited autonomous content
  production.
- A local fallback launcher and fail-closed takeover gate are implemented,
  but no Windows fallback schedule has been installed or tested yet. It
  requires a completed failed/missing cloud run, 90 minutes of grace,
  reachable shared state, no unresolved v3 locks, and the exact current main
  commit. Cloud execution remains primary.
- Missing insight metrics are unavailable, never zero. Site visits and
  engagement are not revenue; a stale English-conversation CTA is a release
  blocker for new Korean-learning promotions.
