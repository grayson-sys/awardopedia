#!/bin/bash
# Watch opportunities pipeline progress

cd /Users/openclaw/awardopedia || exit 1

while true; do
    clear
    echo "═══════════════════════════════════════════════════════════════"
    echo "  OPPORTUNITIES PIPELINE WATCHER"
    echo "  $(date '+%Y-%m-%d %H:%M:%S')"
    echo "═══════════════════════════════════════════════════════════════"

    # Check if launchd job is loaded
    LOADED=$(launchctl list | grep fetchopps | awk '{print $1}')
    if [ "$LOADED" != "-" ] && [ -n "$LOADED" ]; then
        echo "  Status: RUNNING (PID $LOADED)"
    else
        echo "  Status: SCHEDULED (next run in ~2hrs)"
    fi
    echo ""

    # Batch progress
    echo "── BATCH PROGRESS ──────────────────────────────────────────────"
    if [ -f logs/batch_progress.json ]; then
        python3 -c "
import json
p = json.load(open('logs/batch_progress.json'))
done = p.get('batches_done', 0)
target = p.get('target_batches', 10)
total = p.get('total_records', 0)
print(f\"  Batches: {done}/{target} ({100*done//target}%)\")
print(f\"  Records fetched: {total:,}\")
print(f\"  Started: {p.get('started_at', 'not started')}\")
print(f\"  Last run: {p.get('last_run', 'never')}\")
" 2>/dev/null
    else
        echo "  (not started)"
    fi
    echo ""

    # Database stats
    echo "── DATABASE STATS ──────────────────────────────────────────────"
    python3 -c "
import os, psycopg2
for line in open('.env'):
    if '=' in line and not line.startswith('#'):
        k, v = line.split('=', 1)
        os.environ.setdefault(k.strip(), v.strip())
conn = psycopg2.connect(os.environ['DATABASE_URL'])
cur = conn.cursor()

cur.execute('SELECT COUNT(*) FROM opportunities')
total = cur.fetchone()[0]

cur.execute('SELECT COUNT(*) FROM opportunities WHERE llama_summary IS NOT NULL')
summaries = cur.fetchone()[0]

cur.execute('SELECT COUNT(*) FROM opportunity_intel WHERE pdf_enriched = true')
pdf = cur.fetchone()[0]

cur.execute('SELECT COUNT(*) FROM opportunity_intel WHERE size_standard IS NOT NULL')
intel = cur.fetchone()[0]

cur.execute('SELECT COUNT(*) FROM opportunity_intel WHERE congress_member_url IS NOT NULL')
congress = cur.fetchone()[0]

conn.close()

pct = lambda n: f'{100*n//max(1,total)}%'
print(f'  Total opportunities: {total:>8,}')
print(f'  With AI summary:     {summaries:>8,}  ({pct(summaries)})')
print(f'  PDF enriched:        {pdf:>8,}  ({pct(pdf)})')
print(f'  With intel extract:  {intel:>8,}  ({pct(intel)})')
print(f'  With congress URL:   {congress:>8,}  ({pct(congress)})')
" 2>/dev/null
    echo ""

    # Recent log lines
    echo "── RECENT LOG ──────────────────────────────────────────────────"
    tail -8 logs/fetchopps.log 2>/dev/null || echo "  (no log yet)"

    echo ""
    echo "Press Ctrl+C to exit. Refreshing in 30s..."
    sleep 30
done
