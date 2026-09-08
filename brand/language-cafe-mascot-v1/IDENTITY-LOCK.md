# Language Cafe mascot identity lock — v1

The mascot is one continuing character. A new lesson may change only the facial expression, gesture, pose, camera angle, and surrounding scene. It must never redesign the character.

## Sole identity authority

- Reference: `brand/language-cafe-mascot-v1/language-cafe-mascot-reference-sheet-v1.png`
- SHA-256: `b050d011021c7a57665c0d81deeba39f5e26b84da5feb42ed72c602918649411`
- Lock version: `language-cafe-mascot-v1`
- Effective lock date: `2026-08-02`
- Lineage: the reference sheet was created on `2026-07-31` from `assets/language-cafe-mascot-hwajangsiri-eodiyeyo-station-v1.png` (SHA-256 `50b0b1cbe028d9ee19782dca96eb0125554db970d788a17b8f954a74802c9e43`). That source appeared in the single verified carousel `18022369790853372` at `https://www.instagram.com/p/Dbcl1_hEodg/`. The formal reference review passed two sprouts, eye shape and color, texture, proportions, four body views, five expressions, and three hand poses. The sheet predates and is not derived from the rejected 2026-08-02 first-meeting drift.

Do not use a previous expression scene as the next identity reference. That creates cumulative drift. Every new scene starts from the sole reference above.

## Immutable identity

- exactly two short, soft oval sprouts with the same spacing, tilt, scale, and pebbled surface;
- pale mint body near `#BFE8CF`;
- large glossy warm-brown eyes with the same eye-to-head ratio and highlight pattern;
- curved charcoal eyebrows and a tiny friendly mouth;
- round head-and-body silhouette, compact torso, very short rounded legs, short rounded arms, and small hands;
- soft matte silicone-clay material with a fine organic pebbled texture;
- no clothing, accessories, logo, or alternate character variant.

Long botanical leaves, a smooth plastic surface, smaller eyes, a stretched body, extra sprouts, altered color, or a different hand style are identity drift and block the job.

## Allowed scene variation

Emotion, eyebrow position, mouth state, eye direction, gesture, pose, props, lighting, location, and composition may change only when they support the Korean expression. The character remains the same individual.

## Required production method

1. Load the sole reference sheet as the identity reference.
2. Create or edit the expression scene with an identity-preserve instruction. Text-only generation is prohibited.
3. Compare the final scene side by side with the reference sheet.
4. Record the reference path and hash in `workflow.characterReview`.
5. Block the job if any immutable identity item differs. Do not excuse drift because the scene or expression is attractive.
