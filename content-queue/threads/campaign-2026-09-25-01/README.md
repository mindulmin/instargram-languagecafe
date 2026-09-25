# Threads card draft — 포장해 주세요. (2026-09-25)

Status: **draft / needs human editorial review**, not an approved publisher job. Nothing here is hosted, scheduled, or published.

## Editorial choice

- One new everyday expression: **포장해 주세요.** Natural polite reply to a café staff member asking whether the order is for here. English bridge: **“To go, please.”**
- Source search: `content-queue/korean-conversation-library.csv`, local `jobs/`, `content-queue/threads/jobs/`, and `operations/` had no exact `포장해 주세요` match on 2026-09-25. It is **not** yet a `ready` source row; see `source-draft.md`. A read-only official history scan on 2026-09-25 found no match among 53 Instagram and 15 Threads media, but this is not a durable publish approval. **Repeat a complete official live-history duplicate check** immediately before any publication.
- The Korean mission landing returned HTTP 200 on 2026-09-25 at `https://languagestudio.uk/missions/korean-cafe/`. Its rendered public copy states a free pilot for beginners who read Hangul, ordering a drink and answering whether to stay or take it to go, login to start, and no card required. The card/caption does **not** claim this mission teaches or tests this exact phrase.
- The mission's current offer supersedes older documentation that described the site only as English conversation practice. Recheck the live destination immediately before publication; do not reuse stale offer wording.

## Assets and production

- Editable layout: `cards.html`; deterministic renderer: `render.cjs`; local generated scene: `assets/mascot-takeaway-scene.png` (SHA-256 `bf81393c80b714401d4be94dd57a14f4e3c56ad30147f28f25918032adf66bb8`).
- Render with `node content-queue/threads/campaign-2026-09-25-01/render.cjs`. It produces six 1080×1350 PNG and JPEG files, a JPEG SHA-256 manifest, and a 270px-per-card phone-size contact sheet in `rendered/`. Neither the renderer nor this folder accesses the publishing API or Cloudflare.
- The illustration alone used built-in image generation, with the canonical `brand/language-cafe-mascot-v1/language-cafe-mascot-reference-sheet-v1.png` as the **sole identity reference**. All Korean and English copy is deterministic HTML/CSS text, not generated lettering. No CLI flags were used. Prompt summary: one text-free portrait café scene, fixed mint mascot with two short oval sprouts and glossy brown eyes, politely gesturing toward a lidded takeaway cup and paper bag, warm restrained lighting, no other character, no logo/UI/text, and upper-left negative space for typography. The full submitted prompt is in `image-prompt.txt`.
- Side-by-side preliminary identity check: final render has two soft oval sprouts, large warm-brown glossy eyes, mint pebbled surface, round head/body, and no clothing. The scene only changes gesture and café environment. This is **not** a publishing character-review approval; recheck the reference and final 1080px card before approval.

## Six-card story

1. Café question + the line + takeaway scene.
2. Meaning bridge, cup-to-bag movement.
3. Real two-turn dialogue: `매장에서 드시나요?` / `포장해 주세요.`
4. When to use it: after ordering, when asked if staying.
5. Speak the answer from memory for an actual latte order.
6. Three-minute retrieval cue and an honest invitation to the **free Korean café mission**, with the direct URL only in the caption.

The English sentence and Korean line are short enough to read at 270px-width phone preview. Visual check of all six full-size cards and `rendered/phone-preview.png` found no truncated words, obscured Hangul, or clipped credit. This is an internal draft check, not an external device test.

## Alt text (six distinct descriptions)

1. `At a warm café counter, the mint mascot gestures toward a takeaway cup and bag. The card teaches 포장해 주세요. as “To go, please.”`
2. `A cup points toward a takeaway bag on a mint card; 포장해 주세요. means “To go, please.”`
3. `Two speech bubbles show a café exchange: staff asks 매장에서 드시나요? and customer answers 포장해 주세요.`
4. `A drink moves from the counter toward a takeaway bag; use 포장해 주세요. when you want the ordered drink to go.`
5. `A latte order and the prompt “For here?” leave a blank space for the learner to say the Korean takeaway answer aloud.`
6. `A three-minute recall path leads to a separate free Korean café mission; the direct link appears in the Threads caption.`

## Editorial/publishing gates still open

| Axis | Draft check | Remaining before approval |
| --- | --- | --- |
| Accuracy | Korean sentence and English meaning read naturally for the stated café question. | Native-speaking editorial confirmation and official live duplicate scan. |
| Completeness | Six cards, dialogue, recall, unique alt text, caption under 500 characters, mission CTA. | Bind final hosted JPEG URLs and hashes to a reviewed v3 job. |
| Practicality | 1080×1350 card renders and 270px phone contact sheet inspected. | Check on an actual phone or platform preview and confirm URL rendering. |
| Revenue contribution | Site invitation targets the verified free Korean mission and leaves traffic attribution parameters. | Measure source visits, mission starts, and eventual paid conversion separately; no revenue is claimed. |

Do not promote this folder to `workflow.status=approved` or set review `passed` automatically. There is no live URL or cloud permit here. If the site's offer or Threads publisher schema changes, update and rerender the copy before publication.
