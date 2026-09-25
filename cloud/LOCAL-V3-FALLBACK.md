# Channel-split v3 local fallback launcher

Cloud GitHub Actions remains the 09:00 KST primary publisher. This file describes
`cloud/local-v3-fallback.cjs`, a **single-run** Windows takeover launcher. It
does not install a scheduled task, generate posts, or retry a social API call.
The existing v3 publisher retains the final remote claim and exact-once gate.

## Preconditions

- The PC must be on and the same Windows user must have Git Credential Manager
  access to `mindulmin/instargram-languagecafe` with Actions read and repository
  contents write access. The launcher reads the credential in-process without
  printing it. Do not paste a GitHub token into a command or task definition.
- Run from a **clean `main` checkout** at the current GitHub `main` commit.
  Untracked source files also block the launcher; ignored `cloud/local/` files
  do not. The v3 publisher checks the reviewed job, grant, and policy again.
- `cloud/local/state.key` must contain the existing 64-character state key;
  the enabled channels use the existing
  `%USERPROFILE%\.codex\instagram\session.json` and
  `%USERPROFILE%\.codex\threads\session.json`. These files are read into
  process memory only and are never copied into Git or an output file.
- Shared `cloud-state` must be reachable and authenticated. All v2/v3 locks
  must be clear. A missing, active, successful, or uncertain cloud run is
  interpreted by the existing 90-minute takeover rule; a successful or active
  run blocks local publication.

## Commands and scheduling boundary

```powershell
node cloud/local-v3-fallback.cjs
node cloud/local-v3-fallback.cjs --publish
```

The first command is read-only preflight; it never marks an attempt or calls a
social API. The second can publish only between **10:35 and 23:59 KST on that
day**, after checking GitHub's complete relevant Action history, current
`main`, local credentials, and authenticated remote state. It creates one
ignored, non-secret `cloud/local/v3-fallback-YYYYMMDD.attempt.json` file before
starting the existing publisher. A second launch that day is blocked, even if
the first process stopped early. Never delete that marker to force a retry;
review the Action, remote state, and official account media first.

On 2026-09-25, one Windows Scheduled Task named
`LanguageCafe-v3-local-fallback` was installed for **10:35 KST daily**, using
the same logged-in Windows user's interactive token and this repository as
its working directory. Its action invokes this launcher with `--publish`;
the task definition contains no GitHub or social token. The installation was
read back from Task Scheduler. A manual test run on 2026-09-25 at 23:20 KST
returned `LastTaskResult=0` while the official cloud run had succeeded; no
attempt marker, new remote action, or new social receipt appeared. This proves
the installed task can safely decline a takeover in that tested state. It
does **not** prove a future failed-cloud takeover will publish successfully.

This task requires the PC **on and the user logged in** because an interactive
token is used; Windows will not run it while that user has no session. The
current checkout must also remain clean and at remote `main`; the launcher
fails closed instead of updating a dirty or stale checkout. Do not create a
second local scheduler or run this one concurrently with another publisher.
While the PC is off, only GitHub Actions can run.

The launcher prints only safe status, job ID, media ID, and permalink fields.
On a failed or uncertain child process it prints a generic readback-required
code and stops before the next channel; it never retries or clears a lock.
`not_due` is not a post, and a successful command is not revenue evidence.
