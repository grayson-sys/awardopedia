#!/usr/bin/env python3
"""
lineage_linker.py — Link opportunities ↔ contracts for incumbent/competitive intel

Runs nightly AFTER usaspending_nightly.py. Completely deterministic.
Writes to contract_lineage table.

Matching strategy (by decreasing confidence):
  1. SOLICITATION_EXACT (0.99): opp.solicitation_number = contract.solicitation_number
  2. SOLICITATION_NORM  (0.95): same but after stripping spaces/dashes/case
  3. BASE_PIID          (0.90): contract is a modification of another contract we have
  4. FUZZY              (0.60-0.85): same agency + NAICS + title overlap + POP + value band

USAGE:
  python3 scripts/lineage_linker.py              # link all unlinked
  python3 scripts/lineage_linker.py --dry-run    # count only
  python3 scripts/lineage_linker.py --rebuild    # clear and rebuild all
"""

import os, sys, re, argparse, time, json
from pathlib import Path
from datetime import datetime

BASE_DIR = Path(__file__).parent.parent
ENV_PATH = BASE_DIR / '.env'
if ENV_PATH.exists():
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, v = line.split('=', 1)
            os.environ.setdefault(k.strip(), v.strip())

import psycopg2, psycopg2.extras

DATABASE_URL = os.environ['DATABASE_URL']


def log(msg):
    ts = datetime.now().strftime('%H:%M:%S')
    print(f"[{ts}] {msg}", flush=True)


def db_connect():
    for attempt in range(5):
        try:
            return psycopg2.connect(DATABASE_URL)
        except psycopg2.OperationalError as e:
            if attempt < 4 and 'could not translate host name' in str(e):
                log(f"DNS error, retry {attempt + 1}/5 in 30s...")
                time.sleep(30)
            else:
                raise


def normalize_sol(s: str) -> str:
    """Normalize solicitation number for fuzzy equality."""
    if not s:
        return ''
    return re.sub(r'[\s\-_/.]', '', s).upper()


def insert_link(cur, notice_id, piid, link_type, confidence, reasons):
    """Insert link, but only overwrite existing one if the new confidence is HIGHER."""
    cur.execute("""
        INSERT INTO contract_lineage (notice_id, piid, link_type, confidence, match_reasons)
        VALUES (%s, %s, %s, %s, %s::jsonb)
        ON CONFLICT (notice_id, piid) DO UPDATE SET
            link_type = EXCLUDED.link_type,
            confidence = EXCLUDED.confidence,
            match_reasons = EXCLUDED.match_reasons,
            created_at = NOW()
        WHERE contract_lineage.confidence < EXCLUDED.confidence
    """, [notice_id, piid, link_type, confidence, json.dumps(reasons)])


def pass_solicitation_exact(cur, dry_run=False):
    """Direct solicitation_number match. Strongest signal."""
    log("Pass 1: Exact solicitation_number match")
    cur.execute("""
        SELECT o.notice_id, c.piid
        FROM opportunities o
        JOIN contracts c ON c.solicitation_number = o.solicitation_number
        WHERE o.solicitation_number IS NOT NULL
          AND o.solicitation_number != ''
          AND NOT EXISTS (
              SELECT 1 FROM contract_lineage l
              WHERE l.notice_id = o.notice_id AND l.piid = c.piid
                AND l.link_type = 'solicitation_exact'
          )
    """)
    matches = cur.fetchall()
    log(f"  Found {len(matches)} new exact matches")
    if dry_run:
        return len(matches)
    for notice_id, piid in matches:
        insert_link(cur, notice_id, piid, 'solicitation_exact', 0.99, ['solicitation_number exact'])
    return len(matches)


def pass_solicitation_normalized(cur, dry_run=False):
    """Normalized solicitation_number (strip dashes/spaces)."""
    log("Pass 2: Normalized solicitation_number match")
    # Build opportunity lookup table in memory
    cur.execute("""
        SELECT notice_id, solicitation_number FROM opportunities
        WHERE solicitation_number IS NOT NULL AND solicitation_number != ''
    """)
    opp_by_norm = {}
    for nid, sol in cur.fetchall():
        n = normalize_sol(sol)
        if n and len(n) >= 6:  # skip too-short values
            opp_by_norm.setdefault(n, []).append(nid)

    cur.execute("""
        SELECT piid, solicitation_number FROM contracts
        WHERE solicitation_number IS NOT NULL AND solicitation_number != ''
    """)
    new = 0
    for piid, sol in cur.fetchall():
        n = normalize_sol(sol)
        if n in opp_by_norm:
            for nid in opp_by_norm[n]:
                if not dry_run:
                    insert_link(cur, nid, piid, 'solicitation_norm', 0.95,
                                [f"solicitation_number normalized match: {n}"])
                new += 1
    log(f"  Found {new} normalized matches")
    return new


def pass_base_piid(cur, dry_run=False):
    """Match via base_piid — contracts that are modifications of others we already linked."""
    log("Pass 3: Base PIID chains")
    cur.execute("""
        SELECT l.notice_id, c.piid
        FROM contracts c
        JOIN contract_lineage l ON l.piid = c.base_piid
        WHERE c.base_piid IS NOT NULL
          AND c.base_piid != c.piid
          AND NOT EXISTS (
              SELECT 1 FROM contract_lineage l2
              WHERE l2.notice_id = l.notice_id AND l2.piid = c.piid
          )
    """)
    matches = cur.fetchall()
    log(f"  Found {len(matches)} base_piid chain matches")
    if not dry_run:
        for notice_id, piid in matches:
            insert_link(cur, notice_id, piid, 'base_piid', 0.90, ['modification of linked contract'])
    return len(matches)


def title_similarity(a: str, b: str) -> float:
    """Return 0-1 similarity based on shared 4+ letter words."""
    if not a or not b:
        return 0.0
    wa = set(w.lower() for w in re.findall(r'[A-Za-z]{4,}', a))
    wb = set(w.lower() for w in re.findall(r'[A-Za-z]{4,}', b))
    # Filter out generic filler
    noise = {'service', 'services', 'solicitation', 'contract', 'notice', 'presolicitation',
             'awarded', 'purchase', 'procurement', 'base', 'year', 'option', 'support'}
    wa -= noise
    wb -= noise
    if not wa or not wb:
        return 0.0
    common = wa & wb
    return len(common) / min(len(wa), len(wb))


def pass_fuzzy(cur, dry_run=False, limit_opps=2000):
    """
    Fuzzy match for opportunities that have NO exact links yet.
    Score candidates by agency + NAICS + title overlap + POP + value.
    Only writes links with confidence >= 0.60.
    """
    log("Pass 4: Fuzzy scoring for unlinked opportunities")

    # Get opportunities with no lineage and NAICS
    cur.execute(f"""
        SELECT o.notice_id, o.title, o.agency_name, o.naics_code,
               o.place_of_performance_state, o.estimated_value_max,
               o.response_deadline
        FROM opportunities o
        LEFT JOIN opportunity_intel i USING (notice_id)
        WHERE o.naics_code IS NOT NULL
          AND (i.hidden IS NOT TRUE)
          AND (o.response_deadline >= CURRENT_DATE - INTERVAL '30 days' OR o.response_deadline IS NULL)
          AND NOT EXISTS (
              SELECT 1 FROM contract_lineage l WHERE l.notice_id = o.notice_id
          )
        LIMIT {limit_opps}
    """)
    opps = cur.fetchall()
    log(f"  Scoring {len(opps)} unlinked opportunities")

    total_matches = 0
    for opp in opps:
        notice_id, title, agency, naics, state, value_max, deadline = opp
        if not title or not agency:
            continue

        # Get top-level department for agency matching
        top_agency = agency.split(' > ')[0].strip() if agency else ''

        # Find candidate contracts: same NAICS, awarded within the retention window
        cur.execute("""
            SELECT c.piid, c.description, c.agency_name, c.naics_code,
                   c.pop_state, c.award_amount
            FROM contracts c
            WHERE c.naics_code = %s
              AND c.agency_name ILIKE %s
            LIMIT 100
        """, [naics, f"%{top_agency[:40]}%"])
        candidates = cur.fetchall()

        best_score = 0.0
        best_piid = None
        best_reasons = []
        for cand in candidates:
            piid, desc, c_agency, c_naics, c_state, c_amount = cand
            score = 0.0
            reasons = []

            # Same NAICS (we already filtered)
            score += 0.30
            reasons.append(f'naics:{naics}')

            # Agency alignment (top-level)
            if c_agency and top_agency and top_agency[:30].lower() in c_agency.lower():
                score += 0.20
                reasons.append('agency_match')

            # Title/description overlap
            sim = title_similarity(title, desc or '')
            if sim >= 0.5:
                score += 0.25
                reasons.append(f'title_overlap:{int(sim*100)}%')
            elif sim >= 0.3:
                score += 0.15
                reasons.append(f'title_overlap:{int(sim*100)}%')

            # Same state
            if state and c_state and state == c_state:
                score += 0.10
                reasons.append('same_state')

            # Value within 2x
            try:
                if value_max and c_amount:
                    v = float(value_max)
                    a = float(c_amount)
                    if v > 0 and a > 0:
                        ratio = min(v, a) / max(v, a)
                        if ratio >= 0.5:
                            score += 0.10
                            reasons.append(f'value_ratio:{int(ratio*100)}%')
            except (ValueError, TypeError):
                pass

            if score > best_score:
                best_score = score
                best_piid = piid
                best_reasons = reasons

        if best_piid and best_score >= 0.60:
            total_matches += 1
            if not dry_run:
                insert_link(cur, notice_id, best_piid, 'fuzzy', round(best_score, 2), best_reasons)

    log(f"  Found {total_matches} fuzzy matches (confidence >= 0.60)")
    return total_matches


def main():
    parser = argparse.ArgumentParser(description='Link opportunities to contracts')
    parser.add_argument('--dry-run', action='store_true', help='Count only, no writes')
    parser.add_argument('--rebuild', action='store_true', help='Clear all links and rebuild')
    args = parser.parse_args()

    log("=" * 60)
    log("LINEAGE LINKER")
    log(f"Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    log(f"Mode: {'DRY RUN' if args.dry_run else 'LIVE'}")
    log("=" * 60)

    conn = db_connect()
    conn.autocommit = True
    cur = conn.cursor()

    if args.rebuild:
        if args.dry_run:
            log("[DRY] Would clear contract_lineage table")
        else:
            cur.execute("DELETE FROM contract_lineage")
            log(f"Cleared {cur.rowcount} existing links")

    total = 0
    total += pass_solicitation_exact(cur, dry_run=args.dry_run)
    total += pass_solicitation_normalized(cur, dry_run=args.dry_run)
    total += pass_base_piid(cur, dry_run=args.dry_run)
    total += pass_fuzzy(cur, dry_run=args.dry_run)

    # Report
    cur.execute("SELECT link_type, COUNT(*), AVG(confidence) FROM contract_lineage GROUP BY link_type ORDER BY 1")
    log("\nContract lineage table totals:")
    for lt, cnt, avg_conf in cur.fetchall():
        log(f"  {lt:<25} {cnt:<8}  avg confidence {float(avg_conf):.2f}")

    conn.close()
    log("=" * 60)
    log(f"DONE: {total} new links added")


if __name__ == '__main__':
    main()
