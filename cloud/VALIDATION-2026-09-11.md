# Hosted publishing acceptance — 2026-09-11

Verified against GitHub-hosted execution, encrypted state and fresh official Instagram/Threads readbacks. No account growth or revenue is claimed.

| Outcome | Evidence |
| --- | --- |
| Instagram 8-card Korean lesson, 정말요? | ID `18195493066348817`, [official post](https://www.instagram.com/p/DdI_Q0knT22/), 2026-09-11 17:31:56 KST; exact-one ID, full caption including hashtags and target-expression matches |
| Threads recall with the source lesson link | ID `18625937914049407`, [official post](https://www.threads.com/@mindulmin/post/DdI_XD1CGWP), 17:32:47 KST; exact-one ID/full-text match and one Instagram source link |
| Reviewed 1080×1920 Story | ID `18106335614602445`, 17:45:48 KST; one create, one publish and one official STORY match; JPEG SHA-256 `53d33be61da0ce36e8edb05135e712e9840ff6e1a601d33b8964833f2919a604` |
| Final cloud checkpoint | [Successful run 34580676903](https://github.com/mindulmin/instargram-languagecafe/actions/runs/34580676903); state `98bee18505a4171e511fe13b4e5505f859765b77`, pair and Story verified; unresolved global lock null |
| Next-run duplicate/cadence check | [Preview 34580801604](https://github.com/mindulmin/instargram-languagecafe/actions/runs/34580801604); `controller_cadence_not_due`, postDue false, zero social writes, 139 restored state files |
| Automated safety checks | 90 tests pass, including full-caption hashtags, encryption, claims, exact-once, Story review/intent, scoped Pages access and bounded incident resolution |

The daily hosted scheduler is active at 09:00 KST, subject to GitHub scheduling delays. It checks daily; it does not publish daily. The existing policy remains at least 72 hours between lessons and at most 3 carousels in a rolling 14-day period. Local learning controller, publisher and Reel automations are PAUSED to avoid two writers. The pipeline has no dependency on the owner's PC being on.

Execution incidents were preserved, not disguised as successful publishing: native CLI path, duplicate CLI flag, then full-caption verification formatting. The first two stopped before AI execution and had byte-identical publishing state plus unchanged official history. The actual lesson pair was never reposted during reconciliation. The first Story stop was before upload/API creation because `whoami` requested account-wide settings unavailable to the scoped Pages token; only that proven zero-attempt case was completed after a remote durable Story intent. Existing project GET validation now handles scoped credentials without expanding access.

## Remaining owner-dependent work

- Insights: official reach/saved/shares requests returned HTTP 400 / Meta code 10, application permission unavailable. The report preserves null/unavailable and a sanitized reason, not zero. Review the connected app's insights access and reauthorize the session through the existing secret workflow; never paste credentials into chat.
- Profile: the current English-speaking bio is inconsistent with Korean lessons. Proposed Korean-learning bio and representative-post pinning are in [GROWTH-PLAYBOOK.md](GROWTH-PLAYBOOK.md); neither the profile nor pins were changed.
- Story uses a plain profile cue. No clickable link, poll or quiz sticker is represented as automatically supported. No auto-like/follow/comment/DM, ad spend or new Reel was enabled.
