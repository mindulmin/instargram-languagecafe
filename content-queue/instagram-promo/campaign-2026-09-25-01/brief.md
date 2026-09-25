# Campaign 2026-09-25-01 — reviewed and hosted, not published

## Audience and one action

An English-speaking beginner who can read Hangul is about to order at a Korean café. The visual demonstrates one plausible second turn: a barista asks whether the order is for here or to go, and the learner answers “포장해 주세요.” The only requested action is to open the Instagram profile link and choose **Free Korean mission** on Language Cafe. The artwork is original editorial illustration, not a screenshot of the site or a depiction of an actual user result.

## Claim sources checked on 2026-09-25

- [Language Cafe homepage](https://languagestudio.uk/): free Korean café pilot, ordering a drink, stay/take-away follow-up, beginners who read Hangul and use English guidance, login required/no card. The homepage now leads with Korean practice, not the previously promoted English-conversation offer.
- [Free Korean café mission](https://languagestudio.uk/missions/korean-cafe/): try first, get help where needed, changed-order retry, login to start, no card required. This was read directly from the live page today.
- The poster's sample “포장해 주세요.” is a natural illustrative reply to “For here or to go?” It is **not** represented as exact site lesson text.
- The caption's profile-link instruction depends on `@mindulmin` continuing to point to `https://languagestudio.uk/`. Recheck that link and the destination immediately before any approval or posting.

Do not reuse old “free five-minute AI English conversation,” prices, testimonials, learning outcomes, or payment claims for this campaign. The exact hosted job is reviewed, but publication still requires the trusted remote claim and live checks.

## Assets

| File | Purpose |
| --- | --- |
| `artwork.svg` | Editable original 1080 × 1350 source |
| `render.cjs` | Repeatable SVG → JPEG render using the repository's Sharp installation |
| `artwork-feed-1080x1350.jpg` | Review-ready Instagram feed JPEG, 218,195 bytes |
| `caption-draft.md` | English caption draft and publishing caveat |
| `host-draft-assets.cjs` | One-time first-campaign Pages staging and public byte readback; no social API |
| `asset-hosting-evidence.json` | Immutable deployment URLs and verified JPEG hashes for both v3 draft campaigns |

On 2026-09-25, the feed JPEG and six Threads JPEGs were hosted together at
`https://d0c26c95.language-cafe-instagram-assets.pages.dev`. All seven public
GETs returned HTTP 200 JPEG at 1080 × 1350 with hashes identical to the local
reviewed bytes. The Instagram asset is
`https://d0c26c95.language-cafe-instagram-assets.pages.dev/instagram/ig-cafe-pilot-20260925-01.jpg`.
The reviewed job is `content-queue/instagram-promo/jobs/ig-cafe-pilot-20260925-01.json`;
its separate grant is `cloud/control/channel-split-v3-grants/ig-cafe-pilot-20260925-01.json`.
Neither file is a remote publish permit or a verified social post.

Run `node content-queue/instagram-promo/campaign-2026-09-25-01/render.cjs` from the repository root to recreate the JPEG. The current JPEG SHA-256 is `93099ddcf0b8c2fc12147497fe8559b6bcac188aeee552f4c630bc0a47cae844`; source SVG SHA-256 is `bfb24124d74e681fb6169aedf1ef1efa65bb89bc6adfb42748a6c2eee119522b`.

## Quality review

| Axis | Evidence / status |
| --- | --- |
| Accuracy | Current live pages support the free Korean café mission, English guidance, login and no-card claims. English-conversation promises were excluded. The example Korean reply is illustrative. **Draft pass; recheck live source before publish.** |
| Completeness | Hook, barista follow-up, learner's Korean answer, practice sequence, explicit free-mission CTA and caption are present. **Draft pass.** |
| Practicality | Rendered JPEG was visually inspected at its full 1080 × 1350 size: all text remains within the frame; Hangul and CTA are readable; no obscured words, external logos, mascot drift or screenshot implication. **Draft pass; mobile device review still required before approval.** |
| Revenue contribution | The CTA goes to the free product entry point, so it can test relevant traffic and first mission starts. There is no measured traffic, conversion or revenue yet. **Outcome unavailable.** |

The image was hosted and independently reviewed with the final caption, but
no Instagram media was created or published. The job and separate grant are
bound to exact bytes; the trusted runner must still pass live offer, identity,
duplicate, and exact-once controls. Rerunning the hosting script creates another unique
deployment; any replacement URL must be rebound and checked before review.
