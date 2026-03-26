#!/usr/bin/env python3
"""
match_opportunities.py — Smart opportunity matching for members

Runs after pipeline ingestion to match new opportunities against member profiles.
Scores based on NAICS, location, set-asides, keywords, and value range.
Finally, a good use for an algorithm — serving you the right opportunities.

USAGE:
  python3 scripts/match_opportunities.py              # Match all active members
  python3 scripts/match_opportunities.py --send       # Match + send email notifications
  python3 scripts/match_opportunities.py --member 42  # Match for specific member
"""

import os, sys, json, argparse, smtplib
from pathlib import Path
from datetime import datetime, timedelta
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

# ── Load .env ────────────────────────────────────────────────────────────────
BASE_DIR = Path(__file__).parent.parent
ENV_PATH = BASE_DIR / '.env'
if ENV_PATH.exists():
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, v = line.split('=', 1)
            os.environ.setdefault(k.strip(), v.strip())

import psycopg2
from psycopg2.extras import RealDictCursor

DATABASE_URL = os.environ.get('DATABASE_URL', '')
SMTP_HOST = os.environ.get('SMTP_HOST', 'smtp.sendgrid.net')
SMTP_PORT = int(os.environ.get('SMTP_PORT', '587'))
SMTP_USER = os.environ.get('SMTP_USER', 'apikey')
SMTP_PASS = os.environ.get('SENDGRID_API_KEY', '')
FROM_EMAIL = os.environ.get('FROM_EMAIL', 'alerts@awardopedia.com')
BASE_URL = os.environ.get('BASE_URL', 'https://awardopedia.com')


def get_members_with_alerts(conn, member_id=None):
    """Get all members who have alerts enabled."""
    cur = conn.cursor(cursor_factory=RealDictCursor)
    query = """
        SELECT id, email, first_name, company_name,
               alert_naics, alert_states, alert_set_asides, alert_keywords,
               alert_min_value, alert_max_value, alert_frequency, last_alert_sent
        FROM members
        WHERE alerts_enabled = true AND is_active = true
    """
    if member_id:
        query += f" AND id = {int(member_id)}"
    cur.execute(query)
    return cur.fetchall()


def get_recent_opportunities(conn, since_hours=24):
    """Get opportunities added or updated in the last N hours."""
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute("""
        SELECT notice_id, title, agency_name, naics_code, naics_description,
               set_aside_type, place_of_performance_state, estimated_value_max,
               response_deadline, llama_summary,
               place_of_performance_city
        FROM opportunities
        WHERE response_deadline > NOW()
        AND (created_at > NOW() - INTERVAL '%s hours'
             OR updated_at > NOW() - INTERVAL '%s hours')
        ORDER BY created_at DESC
    """, (since_hours, since_hours))
    return cur.fetchall()


def calculate_match_score(member, opp):
    """
    Calculate match score (0-100) between a member profile and an opportunity.
    Returns (score, [reasons])
    """
    score = 0
    reasons = []

    # ── NAICS match (up to 40 points) ───────────────────────────────────────
    member_naics = member.get('alert_naics') or []
    if isinstance(member_naics, str):
        member_naics = json.loads(member_naics) if member_naics else []

    opp_naics = opp.get('naics_code', '')
    if opp_naics and member_naics:
        # Exact match = 40 points
        if opp_naics in member_naics:
            score += 40
            reasons.append(f"NAICS {opp_naics} exact match")
        # Same 2-digit sector = 20 points
        elif any(opp_naics[:2] == n[:2] for n in member_naics):
            score += 20
            reasons.append(f"Same industry sector ({opp_naics[:2]})")

    # ── State/location match (up to 25 points) ──────────────────────────────
    member_states = member.get('alert_states') or []
    if isinstance(member_states, str):
        member_states = json.loads(member_states) if member_states else []

    opp_state = opp.get('place_of_performance_state', '')
    if opp_state and member_states:
        if opp_state in member_states:
            score += 25
            reasons.append(f"Location match: {opp_state}")

    # ── Set-aside match (up to 20 points) ───────────────────────────────────
    member_setasides = member.get('alert_set_asides') or []
    if isinstance(member_setasides, str):
        member_setasides = json.loads(member_setasides) if member_setasides else []

    opp_setaside = opp.get('set_aside_type', '')
    if opp_setaside and member_setasides:
        if opp_setaside in member_setasides or any(sa in opp_setaside for sa in member_setasides):
            score += 20
            reasons.append(f"Set-aside: {opp_setaside}")

    # ── Keyword match (up to 15 points) ─────────────────────────────────────
    member_keywords = member.get('alert_keywords') or []
    if isinstance(member_keywords, str):
        member_keywords = json.loads(member_keywords) if member_keywords else []

    if member_keywords:
        title = (opp.get('title', '') or '').lower()
        summary = (opp.get('llama_summary', '') or '').lower()
        search_text = f"{title} {summary}"

        for kw in member_keywords:
            if kw.lower() in search_text:
                score += 5  # 5 points per keyword, max 3 keywords = 15
                reasons.append(f"Keyword: {kw}")
                if score >= 15:  # Cap keyword contribution
                    break

    # ── Value range check (bonus or penalty) ────────────────────────────────
    opp_value = opp.get('estimated_value_max')
    min_val = member.get('alert_min_value')
    max_val = member.get('alert_max_value')

    if opp_value:
        if min_val and opp_value < float(min_val):
            score -= 10  # Too small
            reasons.append("Below minimum value")
        elif max_val and opp_value > float(max_val):
            score -= 10  # Too large
            reasons.append("Above maximum value")
        else:
            score += 5  # In range bonus
            reasons.append("Value in target range")

    return max(0, min(100, score)), reasons


def save_matches(conn, matches):
    """Save match results to database."""
    cur = conn.cursor()
    for match in matches:
        cur.execute("""
            INSERT INTO opportunity_matches (member_id, notice_id, match_score, match_reasons)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (member_id, notice_id) DO UPDATE SET
                match_score = EXCLUDED.match_score,
                match_reasons = EXCLUDED.match_reasons,
                created_at = NOW()
        """, (match['member_id'], match['notice_id'], match['score'], json.dumps(match['reasons'])))
    conn.commit()


def generate_email_html(member, matches):
    """Generate HTML email with opportunity cards."""
    name = member.get('first_name') or member.get('company_name') or 'there'

    cards_html = ''
    for m in matches[:10]:  # Max 10 per email
        opp = m['opp']
        score = m['score']
        reasons = ', '.join(m['reasons'][:3])

        deadline = opp.get('response_deadline', '')
        if deadline:
            try:
                deadline = datetime.fromisoformat(str(deadline).replace('Z', '+00:00')).strftime('%b %d, %Y')
            except:
                pass

        summary = (opp.get('llama_summary', '') or '')[:200]
        if len(summary) == 200:
            summary += '...'

        cards_html += f'''
        <div style="background: #fff; border: 1px solid #E2E4E9; border-radius: 8px; padding: 16px; margin-bottom: 12px;">
            <div style="display: flex; justify-content: space-between; align-items: start;">
                <h3 style="margin: 0 0 8px; font-size: 16px; color: #1B3A6B;">{opp.get('title', 'Opportunity')[:80]}</h3>
                <span style="background: #E9A820; color: #1B3A6B; padding: 4px 8px; border-radius: 12px; font-size: 12px; font-weight: 600;">{score}% match</span>
            </div>
            <p style="margin: 0 0 8px; font-size: 13px; color: #6B7280;">{opp.get('agency_name', '')} | Due: {deadline}</p>
            <p style="margin: 0 0 12px; font-size: 14px; color: #374151;">{summary}</p>
            <p style="margin: 0 0 8px; font-size: 12px; color: #9CA3AF;">Match: {reasons}</p>
            <a href="{BASE_URL}/opportunity/{opp['notice_id']}" style="display: inline-block; background: #1B3A6B; color: #fff; padding: 8px 16px; border-radius: 6px; text-decoration: none; font-size: 13px;">View Details</a>
        </div>
        '''

    return f'''
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #F3F4F6; padding: 20px;">
        <div style="max-width: 600px; margin: 0 auto;">
            <div style="text-align: center; margin-bottom: 24px;">
                <h1 style="color: #1B3A6B; font-size: 24px; margin: 0;">Award<span style="color: #E9A820;">opedia</span></h1>
                <p style="color: #6B7280; margin: 8px 0 0;">Finally, a good use for an algorithm</p>
            </div>

            <div style="background: #fff; border-radius: 12px; padding: 24px; margin-bottom: 16px;">
                <h2 style="margin: 0 0 16px; color: #1B3A6B; font-size: 20px;">Hey {name}, we found {len(matches)} opportunities for you</h2>
                <p style="margin: 0 0 20px; color: #374151;">Based on your business profile and preferences, these look like good fits:</p>

                {cards_html}

                <div style="text-align: center; margin-top: 24px;">
                    <a href="{BASE_URL}/dashboard" style="display: inline-block; background: #E9A820; color: #1B3A6B; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;">View All Matches</a>
                </div>
            </div>

            <p style="text-align: center; font-size: 12px; color: #9CA3AF;">
                <a href="{BASE_URL}/settings" style="color: #6B7280;">Manage alert preferences</a> |
                <a href="{BASE_URL}/unsubscribe" style="color: #6B7280;">Unsubscribe</a>
            </p>
        </div>
    </body>
    </html>
    '''


def send_email(to_email, subject, html_body):
    """Send email via SMTP."""
    if not SMTP_PASS:
        print(f"  [SKIP] No SMTP credentials — would send to {to_email}")
        return False

    msg = MIMEMultipart('alternative')
    msg['Subject'] = subject
    msg['From'] = FROM_EMAIL
    msg['To'] = to_email

    msg.attach(MIMEText(html_body, 'html'))

    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.starttls()
            server.login(SMTP_USER, SMTP_PASS)
            server.send_message(msg)
        return True
    except Exception as e:
        print(f"  [ERROR] Failed to send email: {e}")
        return False


def run_matching(send_emails=False, member_id=None):
    """Main matching loop."""
    conn = psycopg2.connect(DATABASE_URL)

    members = get_members_with_alerts(conn, member_id)
    print(f"Found {len(members)} members with alerts enabled")

    opportunities = get_recent_opportunities(conn, since_hours=24)
    print(f"Found {len(opportunities)} recent opportunities to match")

    if not opportunities:
        print("No new opportunities to match")
        conn.close()
        return

    all_matches = []

    for member in members:
        member_matches = []

        for opp in opportunities:
            score, reasons = calculate_match_score(member, opp)

            if score >= 30:  # Minimum threshold
                member_matches.append({
                    'member_id': member['id'],
                    'notice_id': opp['notice_id'],
                    'score': score,
                    'reasons': reasons,
                    'opp': opp
                })
                all_matches.append({
                    'member_id': member['id'],
                    'notice_id': opp['notice_id'],
                    'score': score,
                    'reasons': reasons
                })

        member_matches.sort(key=lambda x: x['score'], reverse=True)

        if member_matches:
            print(f"  {member['email']}: {len(member_matches)} matches (top: {member_matches[0]['score']}%)")

            if send_emails and len(member_matches) >= 1:
                subject = f"{len(member_matches)} new opportunities match your profile"
                html = generate_email_html(member, member_matches)
                if send_email(member['email'], subject, html):
                    print(f"    → Email sent")
                    # Update last_alert_sent
                    cur = conn.cursor()
                    cur.execute("UPDATE members SET last_alert_sent = NOW() WHERE id = %s", (member['id'],))
                    conn.commit()

    # Save all matches to database
    if all_matches:
        save_matches(conn, all_matches)
        print(f"\nSaved {len(all_matches)} matches to database")

    conn.close()


def main():
    parser = argparse.ArgumentParser(description='Match opportunities to member profiles')
    parser.add_argument('--send', action='store_true', help='Send email notifications')
    parser.add_argument('--member', type=int, help='Match for specific member ID')
    args = parser.parse_args()

    print(f"Opportunity Matching — {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 50)

    run_matching(send_emails=args.send, member_id=args.member)


if __name__ == '__main__':
    main()
