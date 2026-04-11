#!/usr/bin/env python3
"""
backfill_pipeline.py — Process existing records that missed pipeline stages

Handles three tiers of backfill work:
  1. NAICS descriptions  — instant SQL update, no AI (9,000+ records)
  2. Missing summaries    — stages 2-10 via Claude proxy (1,300+ records)
  3. Low-quality summaries — re-run stage 6 only (~100 records)

Progress is tracked in logs/backfill_progress.json so the script can
resume after interruptions.

USAGE:
  python3 scripts/backfill_pipeline.py                    # resume from checkpoint
  python3 scripts/backfill_pipeline.py --batch-size 25    # smaller batches
  python3 scripts/backfill_pipeline.py --dry-run           # count only, no writes
  python3 scripts/backfill_pipeline.py --reset             # restart from scratch
  python3 scripts/backfill_pipeline.py --naics-only        # just fix NAICS descriptions
  python3 scripts/backfill_pipeline.py --summaries-only    # just fix missing summaries
  python3 scripts/backfill_pipeline.py --quality-only      # just fix low-quality summaries
"""

import os, sys, json, time, argparse
from pathlib import Path
from datetime import datetime

# ── Load .env ────────────────────────────────────────────────────────────────
BASE_DIR = Path(__file__).parent.parent
ENV_PATH = BASE_DIR / '.env'
if ENV_PATH.exists():
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, v = line.split('=', 1)
            os.environ.setdefault(k.strip(), v.strip())

import psycopg2, psycopg2.extras

DATABASE_URL = os.environ.get('DATABASE_URL', '')
LOG_DIR = BASE_DIR / 'logs'
LOG_DIR.mkdir(exist_ok=True)
PROGRESS_FILE = LOG_DIR / 'backfill_progress.json'


def db_connect():
    """Connect to DB with retry on transient DNS/network errors."""
    for attempt in range(5):
        try:
            return psycopg2.connect(DATABASE_URL)
        except psycopg2.OperationalError as e:
            if attempt < 4 and 'could not translate host name' in str(e):
                log(f"DNS error, retry {attempt + 1}/5 in 30s...")
                time.sleep(30)
            else:
                raise


def log(msg: str):
    ts = datetime.now().strftime('%H:%M:%S')
    print(f"  [{ts}] {msg}")


def load_progress() -> dict:
    if PROGRESS_FILE.exists():
        return json.loads(PROGRESS_FILE.read_text())
    return {
        'naics_fixed': False,
        'summaries_offset': 0,
        'summaries_done': 0,
        'summaries_failed': 0,
        'quality_offset': 0,
        'quality_done': 0,
        'started_at': datetime.now().isoformat(),
        'last_run': None,
    }


def save_progress(progress: dict):
    progress['last_run'] = datetime.now().isoformat()
    PROGRESS_FILE.write_text(json.dumps(progress, indent=2))


# ═════════════════════════════════════════════════════════════════════════════
# TIER 1: NAICS DESCRIPTIONS (instant, deterministic, free)
# ═════════════════════════════════════════════════════════════════════════════

def fix_naics_descriptions(dry_run: bool = False) -> int:
    """
    Fill in naics_description from the naics_codes lookup table.
    Uses parent-code fallback: 6-digit → 5+0 → 4-digit → 3-digit → 2-digit.
    """
    print("\n" + "=" * 60)
    print("TIER 1: NAICS DESCRIPTIONS (deterministic, instant)")
    print("=" * 60)

    conn = db_connect()
    conn.autocommit = True
    cur = conn.cursor()

    # Count the gap
    cur.execute("""
        SELECT COUNT(*) FROM opportunities
        WHERE naics_code IS NOT NULL
          AND (naics_description IS NULL OR naics_description = '')
    """)
    gap = cur.fetchone()[0]
    print(f"  Records needing NAICS description: {gap}")

    if gap == 0 or dry_run:
        conn.close()
        return gap

    # Direct match (most records)
    cur.execute("""
        UPDATE opportunities o
        SET naics_description = n.description
        FROM naics_codes n
        WHERE o.naics_code = n.code
          AND (o.naics_description IS NULL OR o.naics_description = '')
    """)
    direct = cur.rowcount
    log(f"Direct match: {direct} records updated")

    # 5-digit code → try appending '0' for 6-digit match
    cur.execute("""
        UPDATE opportunities o
        SET naics_description = n.description
        FROM naics_codes n
        WHERE LENGTH(o.naics_code) = 5
          AND n.code = o.naics_code || '0'
          AND (o.naics_description IS NULL OR o.naics_description = '')
    """)
    padded = cur.rowcount
    log(f"5-digit + '0' match: {padded} records updated")

    # Parent code fallback: try 4-digit, 3-digit, 2-digit prefixes
    for prefix_len in [4, 3, 2]:
        cur.execute(f"""
            UPDATE opportunities o
            SET naics_description = n.description
            FROM naics_codes n
            WHERE n.code = LEFT(o.naics_code, {prefix_len})
              AND (o.naics_description IS NULL OR o.naics_description = '')
              AND o.naics_code IS NOT NULL
        """)
        parent = cur.rowcount
        if parent > 0:
            log(f"{prefix_len}-digit parent match: {parent} records updated")

    # Final count
    cur.execute("""
        SELECT COUNT(*) FROM opportunities
        WHERE naics_code IS NOT NULL
          AND (naics_description IS NULL OR naics_description = '')
    """)
    remaining = cur.fetchone()[0]
    fixed = gap - remaining

    conn.close()
    log(f"NAICS fix complete: {fixed} fixed, {remaining} still missing (codes not in lookup table)")
    return fixed


# ═════════════════════════════════════════════════════════════════════════════
# TIER 2: MISSING SUMMARIES (AI via Claude proxy, batched)
# ═════════════════════════════════════════════════════════════════════════════

def fix_missing_summaries(batch_size: int = 50, dry_run: bool = False,
                          progress: dict = None) -> dict:
    """
    Process records missing AI summaries through pipeline stages 2-10.
    Batched with progress tracking for resume-on-restart.
    """
    print("\n" + "=" * 60)
    print("TIER 2: MISSING SUMMARIES (AI enrichment, batched)")
    print("=" * 60)

    # Import pipeline machinery
    sys.path.insert(0, str(Path(__file__).parent))
    from pipeline_opportunity import (
        STAGE_FUNCTIONS, flush_to_db, _rehydrate_pdf_text, db_connect as pipe_db,
        log as pipe_log,
    )

    conn = db_connect()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    # Find records that need summaries — only BIDDABLE and NOT EXPIRED.
    # Users can't bid on closed opportunities, so there's no point enriching them.
    cur.execute("""
        SELECT o.notice_id, o.title, o.notice_type
        FROM opportunities o
        LEFT JOIN opportunity_intel i USING (notice_id)
        WHERE o.llama_summary IS NULL
          AND (i.hidden IS NOT TRUE)
          AND (o.response_deadline >= CURRENT_DATE OR o.response_deadline IS NULL)
          AND o.notice_type IN (
              'Combined Synopsis/Solicitation',
              'Solicitation',
              'Presolicitation',
              'Sale of Surplus Property',
              'Consolidate/(Substantially) Bundle'
          )
        ORDER BY o.response_deadline ASC NULLS LAST
    """)
    all_records = cur.fetchall()
    conn.close()

    total = len(all_records)
    # Don't use stale offset — the query returns "still missing" so we always
    # process from the start of the current queue. New records added since the
    # last run will be at the end of the queue and naturally get processed.
    remaining = all_records

    print(f"  Total needing summaries: {total}")
    print(f"  Remaining: {len(remaining)}")

    if not remaining or dry_run:
        return progress or {}

    # Process in batches
    batch_num = 0
    for batch_start in range(0, len(remaining), batch_size):
        batch = remaining[batch_start:batch_start + batch_size]
        batch_num += 1
        print(f"\n  --- Batch {batch_num} ({len(batch)} records) ---")

        for i, row in enumerate(batch, 1):
            notice_id = row['notice_id']
            title = (row.get('title') or '')[:55]
            print(f"  [{batch_start + i}/{total}] {title}")

            # Build pipeline record from DB
            rec = _build_pipeline_record(notice_id)
            if not rec:
                log(f"Could not load {notice_id} — skipping")
                progress['summaries_failed'] += 1
                continue

            try:
                # Rehydrate PDFs from disk if available
                rec = _rehydrate_pdf_text(rec)

                # Run stages 2-10
                for stage_num in sorted(STAGE_FUNCTIONS.keys()):
                    if stage_num < 2:
                        continue
                    func = STAGE_FUNCTIONS.get(stage_num)
                    if func:
                        rec = func(rec, dry_run=False)

                # Flush to DB
                flush_to_db(rec, dry_run=False)
                progress['summaries_done'] += 1

            except Exception as e:
                log(f"ERROR on {notice_id}: {e}")
                progress['summaries_failed'] += 1

            # QC spot-check: every 100th record gets a Sonnet audit
            record_num = batch_start + i
            if record_num % 100 == 0 and progress['summaries_done'] > 0:
                qc_score = _qc_spot_check(notice_id)
                if qc_score is not None:
                    progress.setdefault('qc_scores', []).append(qc_score)
                    avg_qc = sum(progress['qc_scores']) / len(progress['qc_scores'])
                    log(f"QC spot-check #{len(progress['qc_scores'])}: {qc_score}/100 (running avg: {avg_qc:.1f})")

            # Be gentle
            time.sleep(0.5)

        # Checkpoint after each batch (counter only, no offset)
        save_progress(progress)
        log(f"Checkpoint saved: {progress['summaries_done']} done, {progress['summaries_failed']} failed")

        # Pause between batches
        time.sleep(2)

    return progress


def _build_pipeline_record(notice_id: str) -> dict:
    """Load a DB row into pipeline record format."""
    conn = db_connect()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("SELECT * FROM opportunities WHERE notice_id = %s", [notice_id])
    row = cur.fetchone()
    conn.close()

    if not row:
        return None

    return {
        'notice_id':      notice_id,
        'fields':         dict(row),
        'raw':            {},
        'resource_links': [],
        'pdfs':           [],
        'doc_types':      [],
        'det_extract':    {},
        'ai_extract':     {},
        'ai_summary':     {},
        'enrichment':     {},
        'congress':       {},
        'link_check':     {},
        'static_page':    None,
        'combined_text':  '',
    }


# ═════════════════════════════════════════════════════════════════════════════
# TIER 3: LOW-QUALITY SUMMARIES (re-run stage 6 only)
# ═════════════════════════════════════════════════════════════════════════════

def fix_low_quality_summaries(batch_size: int = 50, dry_run: bool = False,
                               progress: dict = None) -> dict:
    """
    Find and re-process summaries that are too short, have bad openers,
    or are otherwise low quality. Only re-runs stage 6 (AI summary).
    """
    print("\n" + "=" * 60)
    print("TIER 3: LOW-QUALITY SUMMARIES (re-run stage 6)")
    print("=" * 60)

    sys.path.insert(0, str(Path(__file__).parent))
    from pipeline_opportunity import (
        stage_6_ai_summary, flush_to_db, _rehydrate_pdf_text,
        log as pipe_log,
    )

    conn = db_connect()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    # Find low-quality summaries
    cur.execute("""
        SELECT o.notice_id, o.title, o.llama_summary, o.summary_model
        FROM opportunities o
        LEFT JOIN opportunity_intel i USING (notice_id)
        WHERE o.llama_summary IS NOT NULL
          AND (i.hidden IS NOT TRUE)
          AND (
              LENGTH(o.llama_summary) < 50
              OR o.llama_summary LIKE 'Here is%%'
              OR o.llama_summary LIKE 'The following%%'
              OR o.llama_summary LIKE 'Location:%%'
          )
        ORDER BY o.response_deadline ASC NULLS LAST
    """)
    bad_records = cur.fetchall()
    conn.close()

    offset = progress.get('quality_offset', 0) if progress else 0
    remaining = bad_records[offset:]

    print(f"  Low-quality summaries found: {len(bad_records)}")
    print(f"  Already fixed (prior runs): {offset}")
    print(f"  Remaining: {len(remaining)}")

    if not remaining or dry_run:
        return progress or {}

    for i, row in enumerate(remaining, 1):
        notice_id = row['notice_id']
        old_summary = (row.get('llama_summary') or '')[:80]
        log(f"[{offset + i}/{len(bad_records)}] {notice_id[:16]} — old: {old_summary}")

        rec = _build_pipeline_record(notice_id)
        if not rec:
            continue

        try:
            rec = _rehydrate_pdf_text(rec)
            rec = stage_6_ai_summary(rec, dry_run=False)
            flush_to_db(rec, dry_run=False)
            progress['quality_done'] += 1
        except Exception as e:
            log(f"ERROR: {e}")

        time.sleep(0.5)

        # Checkpoint every batch_size records
        if i % batch_size == 0:
            progress['quality_offset'] = offset + i
            save_progress(progress)

    progress['quality_offset'] = offset + len(remaining)
    save_progress(progress)
    return progress


# ═════════════════════════════════════════════════════════════════════════════
# QC SPOT-CHECK (Sonnet audits every 100th record)
# ═════════════════════════════════════════════════════════════════════════════

QC_PROMPT = """You are auditing a federal contracting opportunity record for data quality.

RECORD:
Title: {title}
Summary: {summary}
Agency: {agency_name}
NAICS: {naics_code} — {naics_description}
Set-Aside: {set_aside_type}
State: {state}, City: {city}
Contracting Officer: {co}
Notice Type: {notice_type}
Has PDFs: {has_pdfs}

YOUR JOB — grade this record as "the best version of itself given available inputs."

Do NOT penalize a record for missing data that SAM.gov never provided.
If there are no PDFs, the record can't have a detailed scope of work.
If SAM.gov gave us only metadata, a metadata-level summary is correct.
If the title was a cryptic federal abbreviation and we decoded it to plain English, that's a WIN.

ONLY penalize for things we control and got wrong:
1. Raw codes or garbled text left in the title that COULD have been cleaned ("SCR CAP SLFLKG" is bad, "N00019-26-R-0018" prefix is bad)
2. Summary has AI artifacts ("Here is the edited text:", "The following opportunity:", etc.)
3. Agency still in ALL CAPS or raw SAM format when it should be normalized
4. Summary mentions dates/deadlines (it should be timeless)
5. NAICS code present but description missing (we have the lookup table)
6. Summary mentions the wrong state or location that contradicts the agency
7. Summary is a literal dump of the address or a single non-sentence fragment

Do NOT penalize for:
- Short summaries when the opportunity is genuinely simple (parts buys, routine maintenance)
- No PDFs (not our fault)
- Place of performance being the contracting office when no PDFs exist to extract the real location
- Missing extraction fields (size_standard, wage_floor, etc.) when there are no PDFs
- Generic language when the opportunity is generic

Return ONLY a JSON object:
{{"score": 0-100, "issues": ["specific thing we got wrong", ...], "pass": true/false}}

A record that's "the best version of itself" scores 95+. Score <95 means WE made a mistake that could be fixed by running the pipeline again or changing the code."""


def _qc_spot_check(notice_id: str) -> int:
    """Run a Sonnet QC audit on a single record. Returns score 0-100 or None on failure."""
    import urllib.request

    CLAUDE_PROXY_URL = os.environ.get('CLAUDE_PROXY_URL', 'http://localhost:3456')

    conn = db_connect()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("""
        SELECT o.*, i.doc_count, i.pdf_enriched
        FROM opportunities o
        LEFT JOIN opportunity_intel i USING (notice_id)
        WHERE o.notice_id = %s
    """, [notice_id])
    row = cur.fetchone()
    conn.close()

    if not row:
        return None

    doc_count = row.get('doc_count') or 0
    has_pdfs = "Yes" if doc_count > 0 else "No (metadata-only record)"

    prompt = QC_PROMPT.format(
        title=row.get('title') or 'N/A',
        summary=(row.get('llama_summary') or 'MISSING')[:500],
        agency_name=row.get('agency_name') or 'N/A',
        naics_code=row.get('naics_code') or 'N/A',
        naics_description=row.get('naics_description') or 'MISSING',
        set_aside_type=row.get('set_aside_type') or 'N/A',
        state=row.get('place_of_performance_state') or 'N/A',
        city=row.get('place_of_performance_city') or 'N/A',
        co=row.get('contracting_officer') or 'N/A',
        notice_type=row.get('notice_type') or 'N/A',
        has_pdfs=has_pdfs,
    )

    try:
        payload = json.dumps({
            "model": "claude-sonnet-4",
            "max_tokens": 256,
            "messages": [{"role": "user", "content": prompt}]
        }).encode()
        req = urllib.request.Request(
            f"{CLAUDE_PROXY_URL}/v1/chat/completions",
            data=payload,
            headers={'content-type': 'application/json'}
        )
        with urllib.request.urlopen(req, timeout=30) as r:
            resp = json.loads(r.read())
        raw = resp['choices'][0]['message']['content'].strip()
        # Extract JSON
        import re
        raw = re.sub(r'^```json\s*', '', raw)
        raw = re.sub(r'\s*```$', '', raw)
        start = raw.find('{')
        if start >= 0:
            depth = 0
            for i in range(start, len(raw)):
                if raw[i] == '{': depth += 1
                elif raw[i] == '}': depth -= 1
                if depth == 0:
                    result = json.loads(raw[start:i+1])
                    return result.get('score', 80)
    except Exception as e:
        log(f"QC spot-check failed for {notice_id[:16]}: {e}")

    return None


def run_final_qc(dry_run: bool = False) -> float:
    """
    Run a final QC pass on a random sample of 50 records.
    Returns the average score. If >= 95, triggers static page generation.
    """
    import urllib.request, random

    print("\n" + "=" * 60)
    print("FINAL QC PASS (Sonnet auditing 50 random records)")
    print("=" * 60)

    conn = db_connect()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("""
        SELECT o.notice_id FROM opportunities o
        LEFT JOIN opportunity_intel i USING (notice_id)
        WHERE o.llama_summary IS NOT NULL
          AND (i.hidden IS NOT TRUE)
        ORDER BY random()
        LIMIT 50
    """)
    sample = [r['notice_id'] for r in cur.fetchall()]
    conn.close()

    print(f"  Sampling {len(sample)} records for QC...")

    if dry_run:
        print("  [DRY RUN] Would QC 50 records with Sonnet")
        return 0.0

    scores = []
    for i, notice_id in enumerate(sample, 1):
        score = _qc_spot_check(notice_id)
        if score is not None:
            scores.append(score)
            if i % 10 == 0:
                avg = sum(scores) / len(scores)
                log(f"QC progress: {i}/{len(sample)} checked, running avg: {avg:.1f}")
        time.sleep(0.3)

    if not scores:
        log("No QC scores collected — proxy may be down")
        return 0.0

    avg_score = sum(scores) / len(scores)
    passing = len([s for s in scores if s >= 95])
    failing = len(scores) - passing

    print(f"\n  QC Results:")
    print(f"    Average score:  {avg_score:.1f}/100")
    print(f"    Passing (>=95): {passing}/{len(scores)}")
    print(f"    Failing (<95):  {failing}/{len(scores)}")

    # Save to data_quality_runs
    conn = db_connect()
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO data_quality_runs
            (run_date, total_records, sample_size, score, issues_found, issues_fixed, issue_details, run_type)
        VALUES (NOW(), (SELECT COUNT(*) FROM opportunities), %s, %s, %s, 0, '[]'::jsonb, 'backfill_qc')
    """, [len(scores), avg_score, failing])
    conn.close()

    return avg_score


def generate_all_static_pages(dry_run: bool = False):
    """Generate static HTML pages for all non-hidden opportunities with summaries."""
    print("\n" + "=" * 60)
    print("STATIC PAGE GENERATION (score >= 95 — green light!)")
    print("=" * 60)

    if dry_run:
        print("  [DRY RUN] Would generate static pages")
        return

    sys.path.insert(0, str(Path(__file__).parent))
    try:
        from generate_static import generate_page_for_opportunity
    except ImportError:
        log("generate_static.py not found — skipping")
        return

    conn = db_connect()
    cur = conn.cursor()
    cur.execute("""
        SELECT o.notice_id FROM opportunities o
        LEFT JOIN opportunity_intel i USING (notice_id)
        WHERE o.llama_summary IS NOT NULL
          AND (i.hidden IS NOT TRUE)
        ORDER BY o.response_deadline DESC NULLS LAST
    """)
    notice_ids = [r[0] for r in cur.fetchall()]
    conn.close()

    print(f"  Generating pages for {len(notice_ids)} opportunities...")

    generated, failed = 0, 0
    for i, nid in enumerate(notice_ids, 1):
        try:
            ok = generate_page_for_opportunity(nid)
            if ok:
                generated += 1
            else:
                failed += 1
        except Exception as e:
            failed += 1

        if i % 100 == 0:
            log(f"Progress: {i}/{len(notice_ids)} ({generated} generated, {failed} failed)")

        time.sleep(0.1)

    print(f"  Static pages: {generated} generated, {failed} failed out of {len(notice_ids)}")


# ═════════════════════════════════════════════════════════════════════════════
# MAIN
# ═════════════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(
        description='Backfill pipeline — fix existing records missing data',
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument('--batch-size', type=int, default=50,
                        help='Records per batch for AI stages (default: 50)')
    parser.add_argument('--dry-run', action='store_true',
                        help='Count records only, no writes')
    parser.add_argument('--reset', action='store_true',
                        help='Clear progress and start from scratch')
    parser.add_argument('--naics-only', action='store_true',
                        help='Only fix NAICS descriptions')
    parser.add_argument('--summaries-only', action='store_true',
                        help='Only fix missing summaries')
    parser.add_argument('--quality-only', action='store_true',
                        help='Only fix low-quality summaries')
    args = parser.parse_args()

    print("=" * 60)
    print("AWARDOPEDIA BACKFILL PIPELINE")
    print(f"Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Mode: {'DRY RUN' if args.dry_run else 'LIVE'}")
    print("=" * 60)

    # Load or reset progress
    if args.reset and PROGRESS_FILE.exists():
        PROGRESS_FILE.unlink()
        print("  Progress reset.")
    progress = load_progress()

    run_all = not (args.naics_only or args.summaries_only or args.quality_only)

    # Tier 1: NAICS (always run first — instant, free)
    if run_all or args.naics_only:
        if not progress.get('naics_fixed'):
            fixed = fix_naics_descriptions(dry_run=args.dry_run)
            if not args.dry_run:
                progress['naics_fixed'] = True
                save_progress(progress)

    # Tier 2: Missing summaries (AI, batched)
    if run_all or args.summaries_only:
        progress = fix_missing_summaries(
            batch_size=args.batch_size,
            dry_run=args.dry_run,
            progress=progress,
        )

    # Tier 3: Low-quality summaries (AI, re-run stage 6)
    if run_all or args.quality_only:
        progress = fix_low_quality_summaries(
            batch_size=args.batch_size,
            dry_run=args.dry_run,
            progress=progress,
        )

    # Tier 4: Final QC pass — Sonnet audits 50 random records
    # If score >= 95%, auto-generate static HTML pages for all records
    if run_all and not args.dry_run:
        qc_score = run_final_qc(dry_run=args.dry_run)
        progress['last_qc_score'] = qc_score
        save_progress(progress)

        if qc_score >= 95.0:
            log(f"QC score {qc_score:.1f} >= 95 — generating static pages!")
            generate_all_static_pages(dry_run=args.dry_run)
            progress['static_pages_generated'] = True
            save_progress(progress)
        else:
            log(f"QC score {qc_score:.1f} < 95 — static pages deferred until quality improves")

    # Final report
    print("\n" + "=" * 60)
    print("BACKFILL COMPLETE")
    print(f"Finished: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"NAICS fixed: {progress.get('naics_fixed', False)}")
    print(f"Summaries done: {progress.get('summaries_done', 0)}")
    print(f"Summaries failed: {progress.get('summaries_failed', 0)}")
    print(f"Quality fixes: {progress.get('quality_done', 0)}")
    qc = progress.get('last_qc_score')
    if qc is not None:
        print(f"QC score: {qc:.1f}/100 {'— PASSED' if qc >= 95 else '— needs work'}")
    if progress.get('static_pages_generated'):
        print(f"Static pages: GENERATED")
    print("=" * 60)


if __name__ == '__main__':
    main()
