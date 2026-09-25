# Language Cafe learner-value baseline — 2026-09-25

This is an observed baseline and a measurement plan, not a finding that learners rejected the offer or that a post generated revenue. The new Instagram promotion was published only at 13:46 UTC on 2026-09-25; the GA4 window below ends on 2026-09-24 and cannot evaluate that promotion.

## Observed

- Official Instagram Graph API exact account `@mindulmin`: 5 followers; profile website `https://languagestudio.uk/`; bio still says `Speak Engilsh | Studio mindulmin` (including the typo), while the new promotion offers a free Korean café mission.
- Earlier Instagram English-lesson carousels, not the new promotion: 2026-09-15 reach 4/saves 0/shares 0; 2026-09-11 reach 3/saves 0/shares 0; 2026-09-04 reach 0/saves 0/shares 0. These are tiny exposure counts and cannot establish whether the educational value was good or bad. The just-published 2026-09-25 promotion initially returned reach 0/saves 0/shares 0; it is too early to interpret.
- Official account daily reach for 2026-09-18 through 2026-09-24 was `[0, 0, 0, 0, 0, 1, 1]`. `profile_views` and `website_clicks` requests each returned Graph API HTTP 400/code 100, so those metrics are unavailable, not zero.
- GA4 property `524963421`, last seven complete property-timezone days 2026-09-18 through 2026-09-24 (`America/Los_Angeles`): 6 active users, 4 new users, 11 sessions, 62 page views and 147 events. Read-only report receipt `8b4d13c3-a485-459f-b26b-79c55bb2aacc` at 2026-09-25 13:48 UTC.
- The same GA4 period has `menu_view` 16 events/4 users, `menu_select` 11/3, `order_start` 16/4, `order_confirm` 6/1. Read-only receipt `a44c72ad-e644-47f7-ad3a-9c54ce343749`. These are independent event totals across the property, not a sequential Korean-mission funnel. An `order_confirm` event is not proof that the Korean café mission was completed.
- `talk_start`, `talk_end`, `takeout_view`, and `feedback_submit` had no returned GA4 rows. Their counts are **unavailable/not observed**, not zero; the read-only tool reports instrumentation as not verified. IG profile views, website clicks, source-attributed visits, Korean-mission starts, first replies, improved retries, mission completion, payment and revenue were not established by these reads.

## Decision

The leading observed constraint is very low measured Instagram distribution. The leading **measurement gap** is more important than any claim of low learner value: current property totals do not reveal whether a Korean learner answers once, receives useful help, answers again more naturally, and finishes the mission. The profile's English-focused wording is a concrete message mismatch with the Korean promotion, but its effect on clicks has not been measured.

## Next measurement, before claiming value or conversion

1. Keep the Instagram profile link and Threads direct link pointed to the actual free Korean mission, with channel-specific campaign tags where technically supported. Verify attribution at the mission route, not from overall property totals.
2. Instrument privacy-safe, mission-specific aggregate steps: `mission_open`, `first_answer_submitted`, `help_viewed`, `retry_answer_submitted`, `mission_complete`. Attach a non-personal mission identifier and channel/campaign source; do not log answer text or individual learner identity. Verify each event in a non-production test and then the live GA4 property before calculating any step rate.
3. Compare mission starts and completed retries by source against the post's observed reach and link activity after a real observation window. Treat small samples and missing Meta metrics as inconclusive. Do not route Korean learners into the separate paid English plan as if it were a verified upgrade, and do not count free pilot activity as revenue.
