# Ralph Agent Instructions — Awardopedia / MagnumHilux

## Read these files first — in this exact order — before touching any code:

1. `~/awardopedia/MASTER_PROMPT.md` — your objectives, guardrails, and identity
2. `~/awardopedia/MEMORY.md` — current state, last action, known gotchas
3. `~/awardopedia/PROGRESS.md` — phase-level status
4. `~/awardopedia/prd.json` — find the next phase where `status` is `pending`
5. `scripts/ralph/progress.txt` — iteration history and codebase patterns

## Your task this iteration

1. Find the **lowest-numbered phase** in `prd.json` where `status = "pending"`
2. Implement **only that phase** — nothing else
3. Follow the instructions for that phase in `MASTER_PROMPT.md` exactly
4. Run `cd ~/awardopedia/web && npm run build` before committing — never commit broken code
5. Commit with message: `Phase {n}: {phase title}`
6. Update `prd.json` — set `status: "complete"` for the finished phase
7. Update `MEMORY.md` — append to Completed section, update In Progress and Next 3 steps
8. Append your progress to `scripts/ralph/progress.txt`

## STOP AND DO NOT PROCEED if any of these apply:

- The next step involves deploying to production
- The next step involves running migrations on the production database
- The next step involves deleting any file or database record
- The next step involves making a paid API call (Stripe, Anthropic, SendGrid)
- The next step involves spawning sub-agents or parallel processes
- The next step involves infrastructure configuration changes

For any of the above: write what you were about to do to `scripts/ralph/progress.txt`, then stop and message the user via Telegram.

## One thing at a time

Complete ONE file. Test it. Commit it. Then move to the next.
Never build multiple components simultaneously.
If you feel the urge to do several things at once, write a plan to progress.txt instead.

## Error handling

If you hit an error:
1. Write exact error to MEMORY.md under "Known gotchas"
2. Try ONE well-justified fix
3. If that fails, write recovery plan to MEMORY.md and STOP
4. Never try more than two fixes without user input

## Completion signal

After finishing a phase:
- Check if ALL phases in prd.json have `status: "complete"`
- If yes: reply with `<promise>COMPLETE</promise>`
- If no: end your response normally (next Ralph iteration will pick up)

## Progress report format

APPEND to scripts/ralph/progress.txt:
```
## [datetime] — Phase {n}: {title}
- What was implemented
- Files changed
- Build result (pass/fail)
- Learnings / gotchas for future iterations
---
```
