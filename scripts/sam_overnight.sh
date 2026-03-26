#!/bin/bash
# SAM.gov overnight fetch - runs at 1AM, fetches all 10 batches
# Each batch = 1000 records, fetch-only mode (no pipeline processing)

set -e  # Exit on any error

LOG="/Users/openclaw/awardopedia/logs/sam_overnight.log"
LOCKFILE="/tmp/sam_overnight.lock"

# Prevent multiple runs
if [ -f "$LOCKFILE" ]; then
    echo "$(date): Another instance running. Exiting." >> "$LOG"
    exit 1
fi
trap "rm -f $LOCKFILE" EXIT
touch "$LOCKFILE"

cd /Users/openclaw/awardopedia
source .venv/bin/activate

echo "========================================" >> "$LOG"
echo "SAM.gov Overnight Fetch" >> "$LOG"
echo "Started: $(date)" >> "$LOG"
echo "========================================" >> "$LOG"

# Reset progress for fresh start (10 new API calls)
cat > logs/batch_progress.json << 'EOF'
{
  "current_offset": 0,
  "batches_done": 0,
  "target_batches": 10,
  "started_at": null,
  "last_run": null,
  "total_records": 0
}
EOF

echo "Progress reset. Starting fetch..." >> "$LOG"

# Run all 10 batches in fetch-only mode
python3 -u scripts/fetch_opportunities_batch.py --all --fetch-only >> "$LOG" 2>&1

echo "========================================" >> "$LOG"
echo "Completed: $(date)" >> "$LOG"
echo "$(cat logs/batch_progress.json)" >> "$LOG"
echo "========================================" >> "$LOG"
