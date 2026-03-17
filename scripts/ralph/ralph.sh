#!/bin/bash
# Ralph — Awardopedia autonomous coding loop
# Adapted from snarktank/ralph for MagnumHilux / Awardopedia
#
# Usage:
#   ./ralph.sh                    # runs up to 3 iterations (default)
#   ./ralph.sh 1                  # run exactly 1 iteration (recommended when watching)
#   ./ralph.sh --tool amp 3       # use amp instead of claude
#
# SAFETY: max 3 iterations per session per MASTER_PROMPT.md
# Always run with a human watching the terminal.
# Never run overnight or unattended.

set -e

# Parse arguments
TOOL="claude"      # Default: claude code
MAX_ITERATIONS=3   # Hard cap per MASTER_PROMPT.md

while [[ $# -gt 0 ]]; do
  case $1 in
    --tool)
      TOOL="$2"
      shift 2
      ;;
    --tool=*)
      TOOL="${1#*=}"
      shift
      ;;
    *)
      if [[ "$1" =~ ^[0-9]+$ ]]; then
        MAX_ITERATIONS="$1"
      fi
      shift
      ;;
  esac
done

# Safety cap — never exceed 3 per MASTER_PROMPT
if [ "$MAX_ITERATIONS" -gt 3 ]; then
  echo "⚠️  Capping at 3 iterations per MASTER_PROMPT.md safety rules."
  MAX_ITERATIONS=3
fi

# Validate tool
if [[ "$TOOL" != "amp" && "$TOOL" != "claude" ]]; then
  echo "Error: Invalid tool '$TOOL'. Must be 'amp' or 'claude'."
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PRD_FILE="$PROJECT_ROOT/prd.json"
PROGRESS_FILE="$SCRIPT_DIR/progress.txt"
ARCHIVE_DIR="$SCRIPT_DIR/archive"
CLAUDE_MD="$SCRIPT_DIR/CLAUDE.md"

# Initialize progress file if it doesn't exist
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

for i in $(seq 1 $MAX_ITERATIONS); do
  echo ""
  echo "═══════════════════════════════════════════"
  echo "  Iteration $i of $MAX_ITERATIONS"
  echo "  $(date)"
  echo "═══════════════════════════════════════════"

  if [[ "$TOOL" == "amp" ]]; then
    OUTPUT=$(cat "$CLAUDE_MD" | amp --dangerously-allow-all 2>&1 | tee /dev/stderr) || true
  else
    # Claude Code: pipe CLAUDE.md as the task prompt
    OUTPUT=$(claude --dangerously-skip-permissions --print < "$CLAUDE_MD" 2>&1 | tee /dev/stderr) || true
  fi

  # Check for completion signal
  if echo "$OUTPUT" | grep -q "<promise>COMPLETE</promise>"; then
    echo ""
    echo "✅ Ralph: All tasks complete!"
    echo "   Finished at iteration $i of $MAX_ITERATIONS"
    exit 0
  fi

  echo ""
  echo "Iteration $i done. Pausing 2s before next..."
  sleep 2
done

echo ""
echo "⏹  Ralph reached max iterations ($MAX_ITERATIONS)."
echo "   Check $PROGRESS_FILE for status."
echo "   To continue: run ralph.sh again after reviewing progress."
exit 0
