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

If a future Windows Scheduled Task is approved, configure **one daily run at
10:35 KST** with the repository as its working directory and the same Windows
user. Do not create a second independent publisher or run this concurrently
with another local scheduler. This launcher currently has no installed task;
therefore cloud publishing is the only executor while the PC is off.

The launcher prints only safe status, job ID, media ID, and permalink fields.
On a failed or uncertain child process it prints a generic readback-required
code and stops before the next channel; it never retries or clears a lock.
`not_due` is not a post, and a successful command is not revenue evidence.
