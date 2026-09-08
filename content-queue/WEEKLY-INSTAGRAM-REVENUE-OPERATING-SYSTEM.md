# Language Cafe weekly Instagram revenue operating system

This adapts the supplied commerce workflow to Language Cafe. It keeps the useful process—setup, reference collection, demand validation, conversion preparation, planning, production, and analysis—without pretending Korean-learning content is a cosmetics shop.

The current static carousel schedule remains unchanged until the owner explicitly changes publishing frequency. This is an operating overlay, not a replacement calendar: apply the relevant checkpoint to every scheduled carousel job and never delay a ready scheduled job merely to wait for Saturday. Video is a later format. Weekly work strengthens the evidence and conversion path behind each carousel.

Store each weekly record under `operations/instagram-weekly/YYYY-Www/`. Store expression-specific evidence under `operations/instagram-weekly/YYYY-Www/<expression-id>/` so a later run cannot overwrite a prior week or expression.

## Weekly outcome

Choose one real Korean conversation scene, one learner problem, and one measurable conversion hypothesis. Produce one publishable carousel card set at a time, lead learners to `Free 5-minute Korean conversation → save your sentence`, and decide one item each to keep, modify, and stop for the next week.

## Monday — account, funnel, and weekly focus

Goal: define this week’s audience, scene, and conversion action.

- Confirm the connected account and current profile promise, link, and CTA destination.
- Review the latest available 30-day account and funnel evidence. Missing metrics remain `unavailable`, never `0`.
- Compare up to three learner scenes and choose one primary scene.
- Write one hypothesis connecting the scene to `first Korean reply → saved sentence`.

Output: `weekly-focus.json` with one scene, one target expression cluster, one CTA, one metric, and evidence status.

## Tuesday — reference and learner-language collection

Goal: collect reusable patterns without copying another account.

- Search five scene/problem keywords.
- Save up to 20 references and classify only the pattern: first-slide hook, dialogue-first, confusion, comparison, proof, or CTA.
- Record repeated learner questions and words used by global beginners.
- Do not copy layouts, characters, screenshots, logos, captions, or watermarks.
- Do not automate likes, follows, comments, saves, or viewing behavior to manipulate recommendations. Reference collection is read-only or manual.

Output: `reference-bank.json` with source links, observed pattern, learner problem, originality note, and reuse decision.

## Comment feedback — scheduled-input boundary

Goal: turn useful learner feedback into evidence for a future expression without turning comments into an automatic-posting or automatic-reply system.

- Before candidate selection, inspect the comment-feedback signals file. Read official comments only when read-only access is available; otherwise retain comment-feedback collection as unavailable rather than zero.
- Store only a short paraphrase, a source reference, the situation, expression IDs, classification, and selection decision. Do not store a commenter identity or full raw comment text.
- A signal can be one of next expression, real-scene request, confusion or correction, or non-actionable praise. Only the first two can add evidence to a candidate.
- A related phrase may appear once as a contrast inside the selected lesson, but each carousel retains exactly one core expression.
- Two distinct accepted learner requests for the same ready expression can make it a feedback-priority candidate. One request remains evidence but does not replace normal selection.
- A published, duplicate, blocked, or non-ready expression is excluded even when feedback mentions it. Corrections about an already published carousel are retained for a human handoff; do not edit, repost, or reply automatically.
- For the learner-question scoring axis, unavailable feedback remains unavailable, one accepted direct request can support a score of 1, and two distinct accepted requests for the same ready expression can support a score of 2. This is evidence within the existing five axes, not a new sixth axis.
- Comment evidence never bypasses the exact current-focus match, the ready-source requirement, the 7/10 demand threshold, language and visual gates, duplicate checks, lock checks, or exact-once publication rule.

Output: comment-feedback-review.json with collection status, accepted and excluded signal IDs, selection eligibility, and a no-automatic-reply confirmation.

## Wednesday — expression demand validation

Goal: select one or two expressions with evidence, not intuition alone.

Score each candidate `0–2` on five axes:

1. observed learner question;
2. real-life urgency and immediate usefulness;
3. save-and-repeat potential;
4. fit with the free five-minute conversation and saved-sentence action;
5. uniqueness against recent `@mindulmin` media.

Select only candidates scoring at least `7/10`. The official Sheet must still be `ready`, and the normal duplicate gate remains decisive.

Each candidate record must contain the five named axis scores, `totalScore`, Sheet status and observed range/row, recent-media duplicate result and evidence, and a selection reason. Output: `<expression-id>/expression-validation.json` with candidates, evidence, score, duplicate status, and selected expression.

## Thursday — conversion readiness

Goal: ensure a learner can understand the offer and take the next step.

- Confirm the profile link and landing destination are available.
- Confirm the carousel CTA and landing copy describe the same action.
- Confirm the planned path: `korean_landing_view → korean_conversation_first_reply → sentence_saved`.
- Record unavailable production analytics or launch alignment honestly.
- Do not change authentication, database, Stripe, pricing, production code, or deployment without explicit approval.

Output: `conversion-readiness.json` with CTA parity, event plan, blockers, and allowed low-risk copy actions.

## Friday — content plan and hook variants

Goal: finish a production-ready static carousel plan.

- Break down ten relevant references by first-slide hook, progression, proof, and CTA.
- Write five first-slide hook options across problem, result, question, comparison, and reversal types.
- Choose one hook and retain two alternates as internal test drafts.
- Finish the eight-card dialogue-first script and visual cue list.
- Attach the canonical mascot reference path and hash. Character identity is never a creative variable.

Output: `content-plan.json` with five hooks, one selected hook, two alternates, eight-card copy, visual cues, and identity-lock evidence.

## Saturday — production and controlled publication

Goal: make one verified carousel set and preserve useful variants.

- Render eight 1080x1920 masters and eight 1080x1350 feed derivatives.
- Render up to three Card 01 hook drafts, select one, then rebuild the single final eight-card set.
- Publish at most one carousel for the selected expression after every existing language, character, duplicate, job, and lock gate passes.
- Archive the two unselected hooks; do not publish near-duplicate carousel variants.
- A card Reel may be prepared from approved cards but remains `review_ready`, `autoPublish=false`. Video-first production remains a later phase.

Output: final carousel job, two archived hook alternatives, publication or block evidence, and optional review-only Reel.

## Sunday — performance and next-week decision

Goal: find the bottleneck and choose the next action.

- Check unresolved learner conversation starts, sentence-save problems, support questions, and correction feedback. Record the count and prepare a handoff; do not send automated DMs, comments, or replies.
- Record only available Instagram and product-funnel metrics: reach, impressions, carousel engagement, saves, profile activity, website taps, first Korean replies, and saved sentences.
- Identify the weakest observed step: exposure → card consumption → profile action → landing → first reply → saved sentence.
- Explain one success cause and one failure cause with evidence.
- Decide exactly one item to keep, one to modify, and one to stop.
- Choose next week’s scene or state why evidence is insufficient.

For every metric, store `value`, `status` (`available` or `unavailable`), `source`, and `observedAtKst`. Never replace an unavailable value with zero. Record `successCauseEvidence` and `failureCauseEvidence` separately from the conclusions.

Output: `weekly-performance-review.json`, `learner-follow-up-handoff.json`, and the next `weekly-focus.json` draft.

## Revenue decision rule

High reach without profile or landing action is not revenue progress. Saves without a first Korean reply are learning interest, not conversion proof. The operational priority is the earliest measured break in the path to a saved sentence; when evidence is missing, the status is `baseline_unavailable` or `unverified_priority` rather than a guessed bottleneck.
