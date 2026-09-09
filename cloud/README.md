# Cloud operations

## Execution and authority

`main` contains reviewed source and `cloud/control/current-test.json`. The daily schedule is 00:00 UTC / 09:00 Asia/Seoul. GitHub can delay a scheduled run; an expired release must still stop. Manual runs default to **preflight**, which never injects platform sessions, calls social APIs, invokes the AI agent, or claims a publish action.

The Windows runner reconstructs the old canonical paths in its own fresh VM. This preserves the fixed-path, hash-bound publication guards. It never connects back to the owner's PC. Updating the old local sibling `current-test.json` alone does not update the cloud release: the controller owner must publish its reviewed learning release to this repository's fixed `cloud/control/current-test.json`. Never advance a date, clear an approval, or invent a requested source merely to make an unattended run post.

The initial migrated release is intentionally preserved as not due. The controller remains an upstream responsibility. Cloud scheduling is not a new authorization to choose and publish arbitrary lessons.

## Required repository secrets

Set these in Settings → Secrets and variables → Actions:

| Name | Contents |
| --- | --- |
| `LANGUAGE_CAFE_STATE_KEY` | 64 lowercase hex characters, generated once and retained securely. Losing it makes the state unreadable. |
| `OPENAI_API_KEY` | API key for the cloud Codex run and reference-image generation. |
| `INSTAGRAM_SESSION_JSON` | Existing verified session JSON, including accountId, accessToken and graphVersion. |
| `THREADS_SESSION_JSON` | Existing verified session JSON, including user ID, token, expiry and required scopes. |
| `CLOUDFLARE_API_TOKEN` | Token authorized for uploads to the existing language-cafe-instagram-assets Pages project. |
| `CLOUDFLARE_ACCOUNT_ID` | Account containing that existing Pages project. |

Do not copy the whole local Codex auth directory or a personal GitHub token into the runtime. The workflow uses its short-lived `github.token` only during state read/write steps. Session renewals must be reflected in the repository secrets before they expire. The snapshot does not include private credentials.

## Read-only Cloudflare connection check

The workflow first calls the official Cloudflare Pages project GET endpoint using the repository secrets. `project_read_verified` proves authenticated read access to the existing project, not deployment success or write permission. The check never deploys and does not output API response bodies or credentials. A failed connection check stops the run before any publication claim.

## State and interruption handling

`cloud-state` contains `ledger.json` and authenticated encrypted `publisher-state.enc`. State restoration fails closed if the branch, ciphertext, key or expected files are missing or invalid. Publication claims are committed atomically to the state branch and verified before platform credentials are written or an agent starts. Concurrent commits cannot overwrite one another.

One concurrency group serializes scheduled and manual runs. A rerun with an already claimed action/idempotency key cannot publish again. Cancellation, timeout, missing receipt, token failure or ambiguous API result retains the remote lock. A post-run checkpoint includes encrypted jobs, queue status, receipts, per-platform locks, and generated lesson files. Only a complete two-platform receipt cross-checked against both jobs releases the global lock. Checkpoints larger than 90 MiB fail closed; archive older verified artifacts deliberately before reaching that limit.

To recover, first inspect the exact affected jobs, per-platform locks, official recent media and containers. Reconcile and preserve their evidence. Never delete a remote lock or rerun a publishing command speculatively. This migration does not enable automatic recovery or new Reels.

The local Codex schedule must be paused after the first hosted preflight is confirmed, so there is one active scheduler. Local jobs and the original parent repository remain intact for review.

## Quality and verification

Run `npm ci --ignore-scripts` and `npm run test:cloud`. The tests cover encryption/tamper rejection, unsafe restored paths, release gates, durable claim conflicts, and existing Instagram/Threads publishing guards. Then use Actions → Language Cafe scheduled publisher → Run workflow → preflight and read its summary. A green preflight with `blocked_preflight` is a confirmed safe stop, not proof of a live publication.

Live acceptance additionally requires a current authorized release, the exact unique ready source, all six secrets, a full render and visual review, and official exact-one readbacks on both platforms. Each new release must reconcile the accepted receipt count. No revenue, checkout, offer or price field grants or blocks publication.

The image API helper is copied unchanged from the locally installed OpenAI imagegen CLI. No image generation occurs in infrastructure preflight. The paid API path is used only by an authorized content run.
