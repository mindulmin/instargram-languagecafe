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

The first review-only drafts are
[`Instagram café promotion`](instagram-promo/campaign-2026-09-25-01/brief.md)
and [`Threads takeaway expression cards`](threads/campaign-2026-09-25-01/README.md).
They are not approved jobs, live assets, or publishing permits.

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

1. Select and review an unused source for each channel. Review the finished
   image and final caption before any API write.
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

## Current activation state

- `cloud/control/policy.json` disables new v2 learning-pair releases. The old
  GitHub Actions schedule may still run checks, but must not publish a new pair.
- `cloud/control/channel-split-v3-policy.json` is disabled. The dedicated
  channel publishers, read-only candidate selector, and pure claim/checkpoint
  state machine are implemented, but the state machine is **not connected**
  to a trusted GitHub Actions publisher or remote CAS/readback. No approved
  hosted creative job or scheduled v3 publisher is active.
  `channel-split-v3-preflight.yml` is manual and
  test-only; it does not need social credentials or publish.
- The publisher transport's job-embedded `approved` fields and callback-shaped
  permits are not independent approval or durable remote authorization. Direct
  v3 publish entry points must remain closed until one trusted controller
  verifies a separate approval record and commits/reads back the claim and
  each create/publish intent before making a social API call. Local locks on
  an ephemeral GitHub runner do not replace this remote checkpoint.
- A v2 global lock from run `34928034257` remains
  `needs_official_readback`: the Instagram media was published, while its
  Threads companion publish returned HTTP 400 and has no verified media ID.
  Do not reuse that action, retry the Threads call, or clear the lock just
  because a later full history contains no matching post. Preserve the
  original receipt and require an incident-specific, audited resolution
  with fresh complete official histories and remote state readback before
  activating v3. `cloud/resolve-34928034257-ig-only.cjs` is read-only and
  does **not** unlock or write remote state.
- Run `npm run test:channel-split` in the repository before any release. The
  pass result proves the local contract, not public posting. Both new
  `--publish` entry points are intentionally fail-closed until the state
  machine is wired to trusted remote CAS, a separate approval record, and
  pre-API intent readback. Assets and CTA still need final review; only then
  can a controlled live post be authorized and checked through official
  readback.
- The landing page recently changed. A stale English-conversation CTA is a
  release blocker. Do not treat Threads clicks as payment or as proof that
  learners completed the Korean mission.
