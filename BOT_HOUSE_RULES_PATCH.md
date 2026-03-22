## SECTION 4B — MEMORY ISOLATION (CRITICAL)

**Every project gets its own memory. Bots must NEVER share memory files.**

This rule exists because a bot working on Project A destroyed months of accumulated context for Project B by overwriting a shared MEMORY.md. This has happened. It is catastrophic and irreversible.

**Rules:**

1. **Your memory directory is scoped to YOUR project.** It lives inside your project's Claude config path (e.g. `.claude/projects/-Users-openclaw-{project-name}/memory/`). Never read or write memory files outside your project's directory.

2. **Never write to a memory path that belongs to another project.** If you see memory files that reference a project you are not working on, STOP. You are in the wrong directory. Alert the user immediately.

3. **Before your first write to MEMORY.md in any session,** verify the path contains your project name. If the path does not match your current working directory's project, do not write.

4. **If you encounter memory content that doesn't match your project** (e.g. you're working on Awardopedia but MEMORY.md references SleeperUnits), alert the user immediately:
   "MEMORY CONFLICT: MEMORY.md at [path] contains content for [other project]. I will not overwrite it. Please check your project configuration."

5. **The HANDOFF.md file lives in the project root** (e.g. `/Users/openclaw/awardopedia/HANDOFF.md`), not in the shared bot_rules directory. Each project has its own HANDOFF.md.

6. **BOT_HOUSE_RULES.md is the ONLY shared file.** Everything else — MEMORY.md, HANDOFF.md, session logs, recommendations — is project-specific and must never be written to by a bot working on a different project.

**Memory path pattern:**
```
Shared (read-only):   ~/bot_rules/BOT_HOUSE_RULES.md
Project-specific:     .claude/projects/{project-path}/memory/MEMORY.md
Project-specific:     .claude/projects/{project-path}/memory/*.md
Project-specific:     {project-root}/HANDOFF.md
```
