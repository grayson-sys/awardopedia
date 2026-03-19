#!/bin/bash
# Ralph — Awardopedia autonomous coding loop
# Faithfully implements snarktank/ralph (https://github.com/snarktank/ralph)
# Based on Geoffrey Huntley's Ralph pattern: https://ghuntley.com/ralph/
#
# Usage:
#   ./ralph.sh                    # runs up to 3 iterations (default — safety cap)
#   ./ralph.sh 1                  # run exactly 1 iteration (recommended when watching)
#   ./ralph.sh --tool amp 3       # use amp instead of claude
#
# SAFETY: max 3 iterations per session (hard cap — override with caution)
# Always run with a human watching. Never run overnight or unattended.
# Each iteration = fresh Claude Code context. Memory persists via git, progress.txt, prd.json.

set -e

# ── Parse arguments ───────────────────────────────────────────────────────────
TOOL="claude"
MAX_ITERATIONS=3   # Hard safety cap. Real Ralph default is 10; we cap at 3.

while [[ $# -gt 0 ]]; do
  case $1 in
    --tool)       TOOL="$2"; shift 2 ;;
    --tool=*)     TOOL="${1#*=}"; shift ;;
    *)            if [[ "$1" =~ ^[0-9]+$ ]]; then MAX_ITERATIONS="$1"; fi; shift ;;
  esac
done

if [ "$MAX_ITERATIONS" -gt 3 ]; then
  echo "⚠️  Capping at 3 iterations (safety rule). Pass a number ≤ 3."
  MAX_ITERATIONS=3
fi

if [[ "$TOOL" != "amp" && "$TOOL" != "claude" ]]; then
  echo "Error: Invalid tool '$TOOL'. Must be 'amp' or 'claude'."
  exit 1
fi

# ── Paths ─────────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PRD_FILE="$PROJECT_ROOT/prd.json"
PROGRESS_FILE="$SCRIPT_DIR/progress.txt"
CLAUDE_MD="$SCRIPT_DIR/CLAUDE.md"

# ── Require jq ────────────────────────────────────────────────────────────────
if ! command -v jq &>/dev/null; then
  echo "Error: jq is required. Install with: brew install jq"
  exit 1
fi

# ── Init progress file ────────────────────────────────────────────────────────
if [ ! -f "$PROGRESS_FILE" ]; then
  echo "# Ralph Progress Log — Awardopedia" > "$PROGRESS_FILE"
  echo "Started: $(date)" >> "$PROGRESS_FILE"
  echo "---" >> "$PROGRESS_FILE"
fi

echo ""
echo "╔═══════════════════════════════════════════╗"
echo "║   MagnumHilux / Ralph — Awardopedia       ║"
echo "║   Tool: $TOOL  |  Max iterations: $MAX_ITERATIONS          ║"
echo "╚═══════════════════════════════════════════╝"
echo ""
echo "Project root: $PROJECT_ROOT"
echo "PRD file:     $PRD_FILE"
echo "Progress:     $PROGRESS_FILE"
echo ""

# ── Check for remaining work ──────────────────────────────────────────────────
REMAINING=$(jq '[.[] | select(.passes == false)] | length' "$PRD_FILE")
if [ "$REMAINING" -eq 0 ]; then
  echo "✅ All PRD items have passes: true. Nothing to do."
  exit 0
fi

echo "📋 Incomplete tasks: $REMAINING"
NEXT_TITLE=$(jq -r '[.[] | select(.passes == false)][0].title' "$PRD_FILE")
NEXT_BRANCH=$(jq -r '[.[] | select(.passes == false)][0].branchName // "ralph-work"' "$PRD_FILE")
echo "🎯 Next: $NEXT_TITLE"
echo "🌿 Branch: $NEXT_BRANCH"
echo ""

# ── Feature branch ────────────────────────────────────────────────────────────
# Real Ralph creates a feature branch per PRD item. Commits stay off main
# until a human reviews and merges. This is the critical safety difference
# from "Ralph in spirit" (which committed directly to main).
cd "$PROJECT_ROOT"
CURRENT_BRANCH=$(git branch --show-current)

if [ "$CURRENT_BRANCH" != "$NEXT_BRANCH" ]; then
  echo "🌿 Switching to feature branch: $NEXT_BRANCH"
  git checkout -b "$NEXT_BRANCH" 2>/dev/null || git checkout "$NEXT_BRANCH"
  echo ""
fi

# ── Main loop ─────────────────────────────────────────────────────────────────
for i in $(seq 1 $MAX_ITERATIONS); do
  echo "═══════════════════════════════════════════"
  echo "  Iteration $i of $MAX_ITERATIONS  —  $(date)"
  echo "  Branch: $(git branch --show-current)"
  echo "═══════════════════════════════════════════"

  if [[ "$TOOL" == "amp" ]]; then
    OUTPUT=$(cat "$CLAUDE_MD" | amp --dangerously-allow-all 2>&1 | tee /dev/stderr) || true
  else
    OUTPUT=$(claude --dangerously-skip-permissions --print < "$CLAUDE_MD" 2>&1 | tee /dev/stderr) || true
  fi

  # Check for completion signal
  if echo "$OUTPUT" | grep -q "<promise>COMPLETE</promise>"; then
    echo ""
    echo "✅ Ralph: Task complete!"
    echo "   Branch '$(git branch --show-current)' is ready for review."
    echo "   Review changes, then: git checkout main && git merge $(git branch --show-current)"
    exit 0
  fi

  # Check if prd updated (any new passes: true)
  REMAINING_NOW=$(jq '[.[] | select(.passes == false)] | length' "$PRD_FILE")
  if [ "$REMAINING_NOW" -lt "$REMAINING" ]; then
    echo ""
    echo "✅ Progress made — one more task marked passes: true"
    echo "   Branch '$(git branch --show-current)' is ready for review."
    echo "   Review changes, then: git checkout main && git merge $(git branch --show-current)"
    exit 0
  fi

  echo ""
  echo "Iteration $i done. Pausing 2s before next..."
  sleep 2
done

echo ""
echo "⏹  Ralph reached max iterations ($MAX_ITERATIONS)."
echo "   Branch: $(git branch --show-current)"
echo "   Review: git diff main..$(git branch --show-current)"
echo "   Check $PROGRESS_FILE for status."
echo "   To continue: run ralph.sh again."
exit 0
