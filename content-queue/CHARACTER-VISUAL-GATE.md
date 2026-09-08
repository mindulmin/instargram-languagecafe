# Language Cafe Character Visual Gate

Run this gate for every carousel before rendering and publishing.

## 1. Map meaning to a visible reaction

Write four items before generating the image:

- emotion: what the speaker feels
- face: eyes, brows, and mouth that show that feeling
- pose: the body or hand gesture that supports the meaning
- scene: the time, place, and objects that make the speaking situation obvious

## 2. Generate for the current expression

- Read `brand/language-cafe-mascot-v1/IDENTITY-LOCK.md` and verify the hash in `brand/language-cafe-mascot-v1/manifest.json`.
- Attach `brand/language-cafe-mascot-v1/language-cafe-mascot-reference-sheet-v1.png` as the sole identity image input. Text-only mascot generation is prohibited.
- Keep the exact same mint Language Cafe mascot. Change only expression, gesture, pose, camera angle, props, lighting, and scene.
- Create or edit a new expression-specific scene for the selected phrase without redesigning the character.
- Do not reuse a convenient older asset when its face, pose, lighting, or setting belongs to another lesson.
- Do not use an older expression scene as the next identity reference. Chaining scenes creates cumulative drift.
- Use the character on one large situation card only.

## 3. One-second visual test

Hide the card text and inspect the image alone. A reviewer must be able to identify the intended reaction within one second.

Block the job when any answer is no:

- Does the face match the expression's emotion?
- Does the pose support the intended response?
- Does the scene match the real-life speaking situation?
- Is the character free of an older lesson's conflicting emotion?
- Is the asset original, watermark-free, and free of external logos?

## 4. Side-by-side identity test

Open the canonical reference sheet and the final scene together at readable size. Block the job when any answer is no:

- Are there exactly two short, soft oval sprouts with the locked spacing and shape?
- Do the large warm-brown glossy eyes retain the same geometry, scale, whites, and highlight pattern?
- Do the round head-and-body silhouette, compact torso, short limbs, and small rounded hands match?
- Does the pale-mint, fine pebbled silicone-clay surface match?
- Is every visible difference explained only by the lesson's expression, gesture, pose, camera angle, prop, light, or scene?

Long botanical leaves, leaf veins, a smooth plastic surface, small human-like eyes, stretched proportions, a new hand style, extra sprouts, clothing, or a changed mint color are blocking identity drift.

## 5. Required job record

```json
{
  "workflow": {
    "characterReview": {
      "meaningMapped": true,
      "customAssetConfirmed": true,
      "facialExpressionMatchConfirmed": true,
      "poseMatchConfirmed": true,
      "sceneMatchConfirmed": true,
      "identityLockVersion": "language-cafe-mascot-v1",
      "identityReference": "brand/language-cafe-mascot-v1/language-cafe-mascot-reference-sheet-v1.png",
      "identityReferenceSha256": "b050d011021c7a57665c0d81deeba39f5e26b84da5feb42ed72c602918649411",
      "identityLockConfirmed": true,
      "identityDriftDetected": false,
      "sceneVariationOnlyConfirmed": true,
      "sproutCount": 2,
      "sproutShapeMatchConfirmed": true,
      "eyeGeometryMatchConfirmed": true,
      "bodyProportionsMatchConfirmed": true,
      "surfaceMaterialMatchConfirmed": true,
      "sideBySideIdentityReview": "passed",
      "review": "passed",
      "asset": "assets/expression-specific-character.png",
      "evidence": "Explain both how the face, pose, and scene express this phrase and how the final image matches the canonical identity."
    }
  }
}
```

Never set passed values without inspecting the final source image and rendered character card side by side with the canonical reference.
