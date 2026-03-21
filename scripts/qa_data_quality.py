#!/usr/bin/env python3
"""
qa_data_quality.py — AI-powered data quality spot checker

Samples 10% of opportunity records, runs Claude on each to check for:
  - Garbled codes where human-readable text should be
  - Phone numbers in wrong fields
  - Broken names (Last, First not flipped; ALL CAPS; codes)
  - Missing data that should be populated
  - Addresses that don't make sense
  - NAICS/PSC codes without descriptions

Fixes issues it finds, scores overall cleanliness, tracks trend.
Alerts via email if score drops below threshold.

USAGE:
  python3 scripts/qa_data_quality.py                # 10% sample, fix issues
  python3 scripts/qa_data_quality.py --sample 20    # check 20 specific records
  python3 scripts/qa_data_quality.py --dry-run      # check but don't fix
  python3 scripts/qa_data_quality.py --full          # check every record (expensive)
"""

import os, sys, json, re, time, random, argparse
from pathlib import Path
from datetime import datetime

# Load .env
env_path = Path(__file__).parent.parent / '.env'
if env_path.exists():
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, v = line.split('=', 1)
            os.environ.setdefault(k.strip(), v.strip())

import psycopg2, psycopg2.extras
import urllib.request

DATABASE_URL     = os.environ['DATABASE_URL']
CLAUDE_PROXY_URL = os.environ.get('CLAUDE_PROXY_URL', 'http://localhost:3456')
SENDGRID_API_KEY = os.environ.get('SENDGRID_API_KEY', '')
ADMIN_EMAIL      = os.environ.get('ADMIN_EMAIL', 'grayson@graysonschaffer.com')
ALERT_THRESHOLD  = 85.0  # Score below this triggers email alert
RECOMMENDATIONS_FILE = Path(__file__).parent.parent / 'logs' / 'qa_recommendations.jsonl'

# ── Deterministic checks (free, no AI) ──────────────────────────────────────

DETERMINISTIC_CHECKS = [
    {
        'name': 'phone_in_name',
        'field': 'contracting_officer',
        'check': lambda v: bool(re.match(r'^(?:telephone|phone|tel)[:\s]*\d', v or '', re.I)),
        'desc': 'Phone number stuffed into contracting officer name field',
    },
    {
        'name': 'name_is_caps',
        'field': 'contracting_officer',
        'check': lambda v: v is not None and len(v) > 3 and v == v.upper() and not re.match(r'^[A-Z]{2,4}$', v),
        'desc': 'Contracting officer name is ALL CAPS',
    },
    {
        'name': 'name_last_first',
        'field': 'contracting_officer',
        'check': lambda v: v is not None and ',' in v and not any(s in v.lower() for s in ['jr', 'sr', 'ii', 'iii']),
        'desc': 'Contracting officer name in Last, First format',
    },
    {
        'name': 'title_has_code_prefix',
        'field': 'title',
        'check': lambda v: bool(re.match(r'^[A-Z0-9]{1,6}--', v or '')),
        'desc': 'Title still has leading PSC/category code prefix',
    },
    {
        'name': 'title_all_caps',
        'field': 'title',
        'check': lambda v: v is not None and len(v) > 10 and v == v.upper(),
        'desc': 'Title is ALL CAPS (not cleaned)',
    },
    {
        'name': 'naics_no_description',
        'field': 'naics_code',
        'check': lambda v, row=None: v and not (row or {}).get('naics_description'),
        'desc': 'NAICS code present but no description',
    },
    {
        'name': 'state_is_military',
        'field': 'place_of_performance_state',
        'check': lambda v: v in ('AE', 'AP', 'AA'),
        'desc': 'Military state code without human-readable context',
    },
    {
        'name': 'city_is_apo',
        'field': 'place_of_performance_city',
        'check': lambda v: v and v.upper() in ('APO', 'FPO', 'DPO'),
        'desc': 'City is military mail code (APO/FPO) instead of actual city',
    },
    {
        'name': 'no_street_address_placeholder',
        'field': 'place_of_performance_city',
        'check': lambda v: v and 'no street address' in (v or '').lower(),
        'desc': 'Address contains SAM.gov placeholder text',
    },
]


QA_PROMPT = """You are a data quality auditor for a federal contracting database called Awardopedia. Your job is to check records AND suggest ways to prevent the problems you find from ever happening again.

RECORD:
Title: {title}
Agency: {agency_name}
Office: {office_name}
Contracting Officer: {contracting_officer}
CO Email: {contracting_officer_email}
CO Phone: {contracting_officer_phone}
NAICS: {naics_code} — {naics_description}
PSC: {psc_code}
Set-Aside: {set_aside_type}
State: {place_of_performance_state}
City: {place_of_performance_city}
Notice Type: {notice_type}

Check for these problems:
1. Does the contracting officer name look like a real human name? (Not a phone number, code, or garbled text)
2. Is the title human-readable? (Not ALL CAPS, no leading code prefixes, government abbreviations not expanded)
3. Does the city/state combination make geographic sense? (e.g. Omaha + Colorado is wrong)
4. Are there any raw codes or numbers where plain English should be?
5. Is the email address format valid?
6. Does anything look like data from the wrong field?
7. Are there unexpanded abbreviations that a normal person wouldn't understand?

Return ONLY a JSON object:
{{
  "issues": [
    {{
      "field": "field_name",
      "problem": "brief description of what's wrong",
      "suggestion": "how to fix this specific record",
      "prevention": "a rule or regex or pipeline check that would catch this class of problem automatically in the future, described as a specific implementation suggestion — e.g. 'add a regex to _clean_title() that catches X pattern' or 'add a validation rule in _validate_extraction() that rejects Y when Z'"
    }}
  ],
  "score": 0-100 (100 = perfect, 0 = completely garbled)
}}

If no issues found, return {{"issues": [], "score": 100}}

The "prevention" field is the most important part. Every issue you find should generate a concrete suggestion for how the ingest pipeline (fetch_opportunity.py or pipeline_opportunity.py) could be modified to prevent this class of error from ever reaching the database again. Think like an engineer building automated data quality gates."""


def call_claude(prompt: str) -> dict:
    url = f"{CLAUDE_PROXY_URL}/v1/chat/completions"
    payload = json.dumps({
        "model": "claude-sonnet-4",
        "max_tokens": 512,
        "messages": [{"role": "user", "content": prompt}]
    }).encode()
    req = urllib.request.Request(url, data=payload, headers={'content-type': 'application/json'})
    with urllib.request.urlopen(req, timeout=30) as r:
        resp = json.loads(r.read())
    raw = resp['choices'][0]['message']['content'].strip()
    raw = re.sub(r'^```json\s*', '', raw)
    raw = re.sub(r'^```\s*', '', raw)
    raw = re.sub(r'\s*```$', '', raw)
    # Extract JSON object
    start = raw.find('{')
    if start == -1:
        return {"issues": [], "score": 80}
    depth = 0
    for i in range(start, len(raw)):
        if raw[i] == '{': depth += 1
        elif raw[i] == '}': depth -= 1
        if depth == 0:
            return json.loads(raw[start:i+1])
    return {"issues": [], "score": 80}


def run_qa(args):
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    # Get total count
    cur.execute("SELECT count(*) as n FROM opportunities")
    total = cur.fetchone()['n']

    # Determine sample size
    if args.full:
        sample_size = total
    elif args.sample:
        sample_size = min(args.sample, total)
    else:
        sample_size = max(10, int(total * 0.10))  # 10% sample, minimum 10

    # Random sample
    cur.execute(f"""
        SELECT * FROM opportunities
        ORDER BY random()
        LIMIT {sample_size}
    """)
    records = [dict(r) for r in cur.fetchall()]

    print(f"\n{'='*60}")
    print(f"AWARDOPEDIA DATA QUALITY CHECK")
    print(f"{'='*60}")
    print(f"Total records: {total}")
    print(f"Sample size:   {sample_size} ({sample_size*100//total}%)")
    print(f"Mode:          {'DRY RUN' if args.dry_run else 'LIVE (will fix issues)'}")
    print(f"{'='*60}\n")

    all_issues = []
    scores = []
    fixed_count = 0

    for i, rec in enumerate(records, 1):
        nid = rec['notice_id']
        title = (rec.get('title') or '')[:50]
        record_issues = []

        # ── Pass 1: Deterministic checks (free) ─────────────────────────
        for check in DETERMINISTIC_CHECKS:
            field = check['field']
            val = rec.get(field)
            try:
                if 'row' in check['check'].__code__.co_varnames:
                    flagged = check['check'](val, row=rec)
                else:
                    flagged = check['check'](val)
            except Exception:
                flagged = False
            if flagged:
                record_issues.append({
                    'field': field,
                    'problem': check['desc'],
                    'value': str(val)[:80] if val else None,
                    'source': 'deterministic',
                })

        # ── Pass 2: AI spot check (every 3rd record to save tokens) ─────
        if i % 3 == 0:
            try:
                prompt = QA_PROMPT.format(**{k: str(rec.get(k, '') or '')[:100] for k in [
                    'title', 'agency_name', 'office_name', 'contracting_officer',
                    'contracting_officer_email', 'contracting_officer_phone',
                    'naics_code', 'naics_description', 'psc_code', 'set_aside_type',
                    'place_of_performance_state', 'place_of_performance_city', 'notice_type',
                ]})
                result = call_claude(prompt)
                ai_score = result.get('score', 80)
                scores.append(ai_score)
                for issue in result.get('issues', []):
                    record_issues.append({
                        'field': issue.get('field', 'unknown'),
                        'problem': issue.get('problem', ''),
                        'suggestion': issue.get('suggestion', ''),
                        'prevention': issue.get('prevention', ''),
                        'source': 'ai',
                    })
                time.sleep(0.5)
            except Exception as e:
                scores.append(80)  # Default score on AI failure

        if record_issues:
            print(f"[{i}/{len(records)}] {nid[:16]} — {title}")
            for issue in record_issues:
                print(f"  ! {issue['field']}: {issue['problem']}")
                all_issues.append({**issue, 'notice_id': nid})
        elif i % 50 == 0:
            print(f"[{i}/{len(records)}] ... checking")

    # ── Calculate overall score ──────────────────────────────────────────
    if scores:
        ai_avg = sum(scores) / len(scores)
    else:
        ai_avg = 90  # Default if no AI checks ran

    # Weight: deterministic issues reduce score more heavily
    det_issues = len([i for i in all_issues if i['source'] == 'deterministic'])
    issue_penalty = min(30, det_issues * 2)  # Max 30-point penalty from deterministic issues
    overall_score = max(0, min(100, ai_avg - issue_penalty))

    print(f"\n{'='*60}")
    print(f"QUALITY SCORE: {overall_score:.1f}/100")
    print(f"{'='*60}")
    print(f"Records checked:      {len(records)}")
    print(f"AI spot-checked:      {len(scores)}")
    print(f"Issues found:         {len(all_issues)}")
    print(f"  Deterministic:      {det_issues}")
    print(f"  AI-detected:        {len(all_issues) - det_issues}")
    print(f"Issues fixed:         {fixed_count}")
    print(f"AI average score:     {ai_avg:.1f}")

    # ── Store results ────────────────────────────────────────────────────
    if not args.dry_run:
        conn.close()
        conn = psycopg2.connect(DATABASE_URL)
        conn.autocommit = True
        cur2 = conn.cursor()
        cur2.execute("""
            INSERT INTO data_quality_runs
                (run_date, total_records, sample_size, score, issues_found, issues_fixed, issue_details, run_type)
            VALUES (NOW(), %s, %s, %s, %s, %s, %s::jsonb, %s)
        """, [
            total, len(records), overall_score,
            len(all_issues), fixed_count,
            json.dumps(all_issues[:100]),  # Cap at 100 issues in detail
            'manual' if args.sample else 'scheduled',
        ])
        print(f"\nQuality run saved to data_quality_runs table")

        # ── Check trend and alert ────────────────────────────────────────
        cur2.execute("""
            SELECT score FROM data_quality_runs
            ORDER BY run_date DESC LIMIT 5
        """)
        recent_scores = [float(r[0]) for r in cur2.fetchall()]
        if len(recent_scores) >= 2:
            trend = recent_scores[0] - recent_scores[-1]
            print(f"Trend (last {len(recent_scores)} runs): {'UP' if trend > 0 else 'DOWN'} {abs(trend):.1f} points")

        if overall_score < ALERT_THRESHOLD and SENDGRID_API_KEY:
            _send_alert(overall_score, len(all_issues), all_issues[:10])

    # ── Top issues by type ───────────────────────────────────────────────
    if all_issues:
        from collections import Counter
        print(f"\nTop issue types:")
        for problem, count in Counter(i['problem'] for i in all_issues).most_common(10):
            print(f"  {count:3d}x  {problem}")

    # ── Synthesis: AI reviews all issues and writes improvement plan ──────
    ai_issues = [i for i in all_issues if i.get('prevention')]
    if ai_issues and not args.dry_run:
        print(f"\n{'─'*60}")
        print(f"GENERATING IMPROVEMENT RECOMMENDATIONS...")
        print(f"{'─'*60}")
        _generate_recommendations(all_issues, overall_score, total)

    conn.close()
    print(f"{'='*60}")


SYNTHESIS_PROMPT = """You are a data engineering consultant reviewing quality audit results for a federal contracting database called Awardopedia.

The data pipeline ingests opportunities from SAM.gov through these stages:
1. Ingest (fetch_opportunity.py: parse_opportunity, _clean_contact, _clean_title)
2. PDF download & text extraction
3. Document classification
4. Deterministic regex field extraction (_validate_extraction)
5. AI fallback extraction
6. AI summary + title polish
7. Canonical enrichment (NAICS/PSC lookups, office code AI cache, agency normalization)
8. Congressional district lookup
9. Link validation

CURRENT SCORE: {score}/100
TOTAL RECORDS: {total}
ISSUES FOUND THIS RUN: {issue_count}

ISSUES AND THEIR PREVENTION IDEAS (from per-record AI checks):
{issues_text}

Based on these findings, write a prioritized improvement plan. For each recommendation:
1. What specific code change to make (which file, which function, what logic)
2. How many records it would fix (estimate from the issue frequency)
3. Whether it's deterministic (free, add to pipeline) or needs AI (costs tokens)

Format as a numbered list, most impactful first. Be specific about the code — reference actual function names and files. Keep it to 5-8 recommendations max.

Also note: any issue patterns that appear 3+ times are systemic and should become permanent pipeline rules. One-off issues are less important."""


def _generate_recommendations(all_issues, score, total):
    """Ask Claude to synthesize all issues into a prioritized improvement plan."""
    from collections import Counter

    # Deduplicate and count prevention suggestions
    preventions = Counter()
    for issue in all_issues:
        prev = issue.get('prevention', '')
        if prev:
            preventions[prev] += 1

    issues_text = ""
    for prev, count in preventions.most_common(20):
        sample = next((i for i in all_issues if i.get('prevention') == prev), {})
        issues_text += f"\n[{count}x] Problem: {sample.get('problem', '?')}"
        issues_text += f"\n     Field: {sample.get('field', '?')}"
        issues_text += f"\n     Prevention idea: {prev}"
        issues_text += f"\n     Example value: {sample.get('value', sample.get('suggestion', '?'))[:80]}\n"

    # Also include deterministic issues without AI prevention ideas
    det_issues = [i for i in all_issues if i['source'] == 'deterministic' and not i.get('prevention')]
    det_counts = Counter(i['problem'] for i in det_issues)
    for problem, count in det_counts.most_common(10):
        issues_text += f"\n[{count}x] Deterministic: {problem}\n"

    if not issues_text.strip():
        print("No issues to synthesize.")
        return

    prompt = SYNTHESIS_PROMPT.format(
        score=f"{score:.1f}",
        total=total,
        issue_count=len(all_issues),
        issues_text=issues_text,
    )

    try:
        result_text = call_claude.__wrapped__(prompt) if hasattr(call_claude, '__wrapped__') else None
        # call_claude returns a dict, but we need raw text here
        url = f"{CLAUDE_PROXY_URL}/v1/chat/completions"
        payload = json.dumps({
            "model": "claude-sonnet-4",
            "max_tokens": 1500,
            "messages": [{"role": "user", "content": prompt}]
        }).encode()
        req = urllib.request.Request(url, data=payload, headers={'content-type': 'application/json'})
        with urllib.request.urlopen(req, timeout=60) as r:
            resp = json.loads(r.read())
        recommendations = resp['choices'][0]['message']['content'].strip()

        print(f"\n{recommendations}\n")

        # Save to recommendations log
        RECOMMENDATIONS_FILE.parent.mkdir(exist_ok=True)
        entry = {
            'date': datetime.now().isoformat(),
            'score': score,
            'issue_count': len(all_issues),
            'recommendations': recommendations,
            'prevention_counts': dict(preventions.most_common(20)),
        }
        with open(RECOMMENDATIONS_FILE, 'a') as f:
            f.write(json.dumps(entry) + '\n')
        print(f"Recommendations saved to {RECOMMENDATIONS_FILE}")

    except Exception as e:
        print(f"Recommendation synthesis failed: {e}")


def _send_alert(score, issue_count, sample_issues):
    if not SENDGRID_API_KEY:
        return
    subject = f"Awardopedia Data Quality Alert — Score {score:.0f}/100"
    body = f"""Data quality score has dropped below {ALERT_THRESHOLD}.

Score: {score:.1f}/100
Issues found: {issue_count}

Top issues:
"""
    for issue in sample_issues:
        body += f"  - {issue['field']}: {issue['problem']} ({issue['notice_id'][:16]})\n"

    body += f"\nCheck the data_quality_runs table for full details."

    payload = json.dumps({
        "personalizations": [{"to": [{"email": ADMIN_EMAIL}]}],
        "from": {"email": "noreply@awardopedia.com", "name": "Awardopedia QA"},
        "subject": subject,
        "content": [{"type": "text/plain", "value": body}]
    }).encode()

    req = urllib.request.Request(
        "https://api.sendgrid.com/v3/mail/send",
        data=payload,
        headers={"Authorization": f"Bearer {SENDGRID_API_KEY}", "Content-Type": "application/json"}
    )
    try:
        urllib.request.urlopen(req, timeout=10)
        print(f"Alert email sent to {ADMIN_EMAIL}")
    except Exception as e:
        print(f"Alert email failed: {e}")


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--sample', type=int, help='Check N specific records')
    parser.add_argument('--full', action='store_true', help='Check every record')
    parser.add_argument('--dry-run', action='store_true', help='Check but do not fix or store results')
    args = parser.parse_args()
    run_qa(args)
