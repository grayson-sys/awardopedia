#!/bin/bash
# Watch contracts pipeline progress

cd /Users/openclaw/awardopedia || exit 1

while true; do
    clear
    echo "═══════════════════════════════════════════════════════════════"
    echo "  CONTRACTS PIPELINE WATCHER"
    echo "  $(date '+%Y-%m-%d %H:%M:%S')"
    echo "═══════════════════════════════════════════════════════════════"

    # Check if process is running
    PID=$(pgrep -f "bulk_fetch_contracts\|orchestrator" | head -1)
    if [ -n "$PID" ]; then
        echo "  Status: RUNNING (PID $PID)"
    else
        echo "  Status: NOT RUNNING"
    fi
    echo ""

    # Fetch checkpoint
    if [ -f logs/bulk_fetch_checkpoint.json ]; then
        echo "── FETCH PROGRESS ──────────────────────────────────────────────"
        python3 -c "
import json
c = json.load(open('logs/bulk_fetch_checkpoint.json'))
print(f\"  Total fetched: {c.get('total_fetched', 0):,}\")
print(f\"  Last updated: {c.get('last_updated', 'never')}\")
for y, s in sorted(c.get('years', {}).items(), reverse=True):
    status = s.get('status', 'pending')
    fetched = s.get('fetched', 0)
    print(f\"    FY{y}: {status} ({fetched:,} records)\")
" 2>/dev/null
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

cur.execute('SELECT COUNT(*) FROM contracts')
total = cur.fetchone()[0]

cur.execute('SELECT COUNT(*) FROM contracts WHERE llama_summary IS NOT NULL')
summaries = cur.fetchone()[0]

cur.execute('SELECT COUNT(*) FROM contracts WHERE naics_description IS NOT NULL')
naics = cur.fetchone()[0]

cur.execute('SELECT COUNT(*) FROM contracts WHERE successor_checked_at IS NOT NULL')
successors = cur.fetchone()[0]

cur.execute('SELECT COUNT(*) FROM contracts WHERE recipient_congress_url IS NOT NULL')
congress = cur.fetchone()[0]

cur.execute('SELECT COUNT(*) FROM recipients')
recipients = cur.fetchone()[0]

conn.close()

pct = lambda n: f'{100*n//max(1,total)}%'
print(f'  Total contracts:    {total:>8,}')
print(f'  With AI summary:    {summaries:>8,}  ({pct(summaries)})')
print(f'  With NAICS lookup:  {naics:>8,}  ({pct(naics)})')
print(f'  Successors checked: {successors:>8,}  ({pct(successors)})')
print(f'  With congress URL:  {congress:>8,}  ({pct(congress)})')
print(f'  Recipients:         {recipients:>8,}')
" 2>/dev/null
    echo ""

    # Recent log lines
    echo "── RECENT LOG ──────────────────────────────────────────────────"
    tail -8 logs/orchestrator.log 2>/dev/null || echo "  (no log yet)"

    echo ""
    echo "Press Ctrl+C to exit. Refreshing in 30s..."
    sleep 30
done
