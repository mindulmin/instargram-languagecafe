# Language Cafe Card Carousel Reel Gate

## Core rule

A Card Carousel Reel is a mobile-first motion version of the approved eight-card carousel.

- Use only the final eight approved `1080x1920` carousel masters from `vertical-9x16/`. Older jobs may use approved `1080x1350` feed derivatives only when no vertical masters exist.
- Keep every card completely visible. Do not crop, rewrite, or cover card copy.
- Motion is restrained: gentle alternating zoom, small drift, blurred background made from the same card, and short fades only.
- Do not add external images, stock footage, chat UI, conversation screenshots, third-party marks, new logos, or visual material from another account.

## Required review record

```json
{
  "sourceType": "approved_carousel_card_reel",
  "reusesCarouselCards": true,
  "approvedCardCount": 8,
  "cardsFullyVisible": true,
  "motion": {
    "gentleZoom": true,
    "subtleDrift": true,
    "sameCardBlurredBackground": true,
    "shortFades": true,
    "externalVisualsAdded": false
  },
  "durationSeconds": 30,
  "review": "passed"
}
```

Block the Reel if a card is cropped, the source count is not eight, a card failed its original carousel review, or the movement makes the text hard to read.

## Instagram music handoff

- The exported MP4 contains a valid silent AAC track. It never contains an Instagram-library track.
- Save `instagram-music-handoff.md` next to the Reel. It must include the selected expression, three mood-and-search intentions, a reminder that track eligibility is account-specific, and the readability check.
- The account owner chooses and attaches a track only in the Instagram app immediately before publishing. The automation must not search, scrape, download, extract, select, or embed a particular Instagram track.
- If the app provides volume or mix control, begin at 5-10%, play the whole Reel with its text visible, and lower or remove the music if it distracts from reading. If the control is unavailable, keep the text-first Reel silent.

## Publishing boundary

- A Card Carousel Reel is always `review_ready` and `autoPublish=false`.
- This automation has no Reel publishing authority and must never run `publish-reel.cjs`.
