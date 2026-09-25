# Language Cafe channel split (2026-09-25)

This is the strategy for **new** posts. Historical Instagram lessons, Threads
recall posts, receipts, and their locks remain evidence of the earlier v2
strategy. Do not rewrite or republish them.

## Channel roles

| Channel | Reader promise | Post format | Next action |
| --- | --- | --- | --- |
| Instagram `@mindulmin` | See how Language Cafe helps someone practise spoken English | Original product-led image, with a concrete English-speaking situation and a truthful demonstration of the site | Use the existing profile link to open Language Cafe and choose an English conversation menu |
| Threads `@mindulmin` | Learn one Korean expression through clear English explanations, as in the former Instagram lessons | Original 2–8-card English-language card-news carousel, with a short native caption | Use the final-line Language Cafe site link only for the site's actual English conversation offer |

The two channels have independent jobs, publication receipts, cadence, and
duplicate checks. A Threads card is complete without an Instagram source post;
an Instagram promotion is complete without a Threads reply. A post on either
platform does not authorize a second post on the other.

## Instagram promotion

- Choose one real English-speaking problem (for example, freezing before a
  cafe order or a work call). Show the site's relevant path and one action the
  visitor can take.
- Public claims may describe what the live homepage currently offers: choose a
  daily/travel/work English menu, log in for a free five-minute AI conversation,
  then save an expression and practise it again. Verify any new offer, price,
  feature, or duration against the live destination before publishing.
- The post should give useful context even to someone who does not visit the
  site. Use natural Korean for the Korean-speaking English learner. Show the
  English example accurately and avoid fabricated testimonials or outcome
  claims.
- End with one specific profile-link action. Check that the profile website is
  `https://languagestudio.uk/` before using that instruction. An Instagram
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
- Explain the Korean expression before the invitation to visit. Language Cafe's
  verified public offer is **English conversation practice**, not a Korean
  lesson. Do not say that the site will drill the Korean card's expression.
  This audience/offer mismatch is a conversion risk to measure, not conceal.
  The caption ends
  with exactly one HTTPS `languagestudio.uk` URL. Optional tracking parameters
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
   source tracking, first conversation replies, saved expressions, and paid
   conversion. A missing measurement is `unavailable`, never zero. Site
   visits and engagement are not revenue.

The old v2 cloud publisher must stop issuing learning-pair releases before
this v3 strategy is activated. Do not relabel a v2 receipt as a v3 post.

## Current activation state

- `cloud/control/policy.json` disables new v2 learning-pair releases. The old
  GitHub Actions schedule may still run checks, but must not publish a new pair.
- `cloud/control/channel-split-v3-policy.json` is disabled. The dedicated
  channel publishers and read-only candidate selector are implemented, but
  no unattended v3 claim/checkpoint, reviewed v3 creative job, or scheduled
  v3 publisher is active. `channel-split-v3-preflight.yml` is manual and
  test-only; it does not need social credentials or publish.
- Run `npm run test:channel-split` in the repository before any release. The
  pass result proves the local contract, not public posting. Do not use either
  `--publish` flag until a durable v3 claim is implemented, assets and CTA are
  reviewed, and a controlled live post passes official readback.
- The Threads audience-to-offer mismatch needs a measured decision before
  unattended publishing. Do not treat Threads clicks as payment or as proof
  that Korean learners wanted English conversation practice.
