# AI Team Playbook

## Role Map

- Codex owns planning, coding, refactors, shell execution, integration, and final implementation.
- Claude owns writing-heavy work: specs, documentation, PR descriptions, release notes, summaries, onboarding docs, UX copy, issue updates, requirement refinement, and stakeholder-facing explanation.
- Gemini owns review-heavy work: code review, regression hunting, edge-case checks, alternative approaches, test ideas, bug triage, and bounded support coding.

## When To Use Which

- Start with Codex when the output should end in code changes.
- Move to Claude when the code direction is clear and the next step is explanation, documentation, or polished writing.
- Move to Gemini after a patch exists, or when you need a second opinion before touching code.

## Handoff Rules

- Give one tool clear ownership per task.
- Keep prompts short and structured: objective, constraints, deliverable.
- Ask Claude to optimize clarity and tone.
- Ask Gemini to optimize skepticism and coverage.
- Ask Codex to optimize execution and completion.

## Default Workflow

1. Codex plans and implements.
2. Claude turns outcomes into docs or communication.
3. Gemini critiques the result and looks for misses.

## Example Split

- Feature request: Codex implements, Claude writes release notes, Gemini reviews risk and tests.
- Bug fix: Codex patches, Gemini validates edge cases, Claude writes incident summary if needed.
- New project idea: Codex drafts plan, Claude expands the spec, Gemini challenges assumptions.
