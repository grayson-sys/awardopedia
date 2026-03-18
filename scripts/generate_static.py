#!/usr/bin/env python3
"""
generate_static.py — SEO static HTML page generation for Awardopedia

Generates one HTML file per contract and opportunity record.
Uploads to DO Spaces for Cloudflare CDN delivery.
Generates sitemap.xml listing all static page URLs.

USAGE:
  python3 scripts/generate_static.py                  # generate all + upload
  python3 scripts/generate_static.py --new-only       # only records without static_page_generated
  python3 scripts/generate_static.py --local-only     # generate HTML locally, skip upload
  python3 scripts/generate_static.py --dry-run        # show what would be generated

OUTPUT:
  ~/awardopedia/static/contracts/{piid}.html
  ~/awardopedia/static/opportunities/{notice_id}.html
  ~/awardopedia/static/sitemap.xml

PREREQUISITES:
  - DATABASE_URL in .env
  - DO_SPACES_KEY, DO_SPACES_SECRET, DO_SPACES_BUCKET, DO_SPACES_ENDPOINT, DO_SPACES_REGION in .env
  - boto3 (install: python3 -m pip install boto3, or use venv)
"""

import os, sys, json, argparse, hashlib, hmac, re
from pathlib import Path
from datetime import datetime, timezone
from html import escape as html_escape
from urllib.parse import quote as url_quote

# ── Load .env ─────────────────────────────────────────────────────────────────

env_path = Path(__file__).parent.parent / '.env'
if env_path.exists():
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, v = line.split('=', 1)
            os.environ.setdefault(k.strip(), v.strip())

import psycopg2, psycopg2.extras

DATABASE_URL = os.environ['DATABASE_URL']

# ── Paths ─────────────────────────────────────────────────────────────────────

BASE_DIR = Path(__file__).parent.parent
STATIC_DIR = BASE_DIR / 'static'
CONTRACTS_DIR = STATIC_DIR / 'contracts'
OPPORTUNITIES_DIR = STATIC_DIR / 'opportunities'

SITE_URL = 'https://awardopedia.com'

# ── HTML helpers ──────────────────────────────────────────────────────────────

def esc(val):
    """HTML-escape a value, return '—' for None/empty."""
    if val is None or val == '':
        return '&mdash;'
    return html_escape(str(val))

def fmt_money(val):
    """Format a numeric value as USD."""
    if val is None:
        return '&mdash;'
    return f'${val:,.0f}'

def fmt_date(val):
    """Format a date value."""
    if val is None:
        return '&mdash;'
    if hasattr(val, 'strftime'):
        return val.strftime('%B %d, %Y')
    return str(val)

def safe_filename(s):
    """Make a string safe for use as a filename."""
    return re.sub(r'[^a-zA-Z0-9_\-.]', '_', str(s))


# ── CSS (inline for single-file static pages) ────────────────────────────────

PAGE_CSS = """
:root {
  --color-navy: #1B3A6B;
  --color-amber: #E9A820;
  --color-navy-light: #EEF2F9;
  --color-bg: #FAFAF8;
  --color-text: #1A1A2E;
  --color-muted: #6B7280;
  --color-success: #0D7A55;
  --color-border: #E2E4E9;
  --color-white: #FFFFFF;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  background: var(--color-bg);
  color: var(--color-text);
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}
.header {
  background: var(--color-navy);
  color: var(--color-white);
  padding: 16px 24px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.header a { color: var(--color-white); text-decoration: none; font-weight: 700; font-size: 18px; }
.header svg { width: 22px; height: 22px; }
.container { max-width: 860px; margin: 0 auto; padding: 24px 16px 48px; }
h1 { font-size: 22px; font-weight: 700; color: var(--color-navy); margin-bottom: 4px; }
.subtitle { font-size: 14px; color: var(--color-muted); margin-bottom: 20px; }
.summary-box {
  background: var(--color-navy-light);
  border-left: 3px solid var(--color-navy);
  padding: 14px 18px;
  margin-bottom: 24px;
  font-size: 14px;
  line-height: 1.6;
}
.section { margin-bottom: 24px; }
.section-title {
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--color-muted);
  margin-bottom: 10px;
  border-bottom: 1px solid var(--color-border);
  padding-bottom: 6px;
}
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; }
@media (max-width: 600px) { .grid { grid-template-columns: 1fr; } }
.field { font-size: 13px; padding: 4px 0; }
.field-label { font-weight: 600; color: var(--color-muted); }
.field-value { color: var(--color-text); }
.badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
}
.badge-navy { background: var(--color-navy); color: var(--color-white); }
.badge-amber { background: var(--color-amber); color: var(--color-text); }
.badge-success { background: #D1FAE5; color: var(--color-success); }
.trust-box {
  background: var(--color-white);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 16px;
  margin-top: 24px;
  font-size: 12px;
  color: var(--color-muted);
}
.trust-box strong { color: var(--color-text); }
.cta {
  display: inline-block;
  background: var(--color-navy);
  color: var(--color-white);
  padding: 10px 20px;
  border-radius: 6px;
  text-decoration: none;
  font-weight: 600;
  font-size: 14px;
  margin-top: 16px;
}
.cta:hover { opacity: 0.9; }
.footer {
  text-align: center;
  padding: 24px;
  font-size: 12px;
  color: var(--color-muted);
  border-top: 1px solid var(--color-border);
  margin-top: 32px;
}
.footer a { color: var(--color-navy); text-decoration: none; }
"""

# ── BookOpen SVG icon (matches Nav.jsx) ───────────────────────────────────────

BOOK_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>'

# ── Header + Footer (shared) ─────────────────────────────────────────────────

def page_header():
    return f'''<div class="header">
  {BOOK_ICON}
  <a href="{SITE_URL}">Awardopedia</a>
</div>'''

def page_footer():
    year = datetime.now().year
    return f'''<div class="footer">
  <p>&copy; {year} <a href="{SITE_URL}">Awardopedia</a> &mdash; Free federal contract intelligence</p>
  <p style="margin-top:4px"><a href="{SITE_URL}/terms">Terms of Service</a> &middot; <a href="{SITE_URL}/api">API Access</a></p>
</div>'''

# ── Contract HTML ─────────────────────────────────────────────────────────────

def generate_contract_html(c):
    """Generate a static HTML page for a contract record (dict)."""
    piid = c['piid']
    recipient = c.get('recipient_name') or 'Unknown Contractor'
    agency = c.get('agency_name') or 'Unknown Agency'
    year = ''
    if c.get('fiscal_year'):
        year = str(c['fiscal_year'])
    elif c.get('start_date'):
        year = str(c['start_date'].year) if hasattr(c['start_date'], 'year') else str(c['start_date'])[:4]

    title = f"{esc(recipient)} — {esc(agency)} Contract {year}"
    summary = c.get('llama_summary') or c.get('description') or 'Federal contract record.'
    canonical = f"{SITE_URL}/contracts/{url_quote(piid)}"

    # JSON-LD structured data
    jsonld = {
        "@context": "https://schema.org",
        "@type": "GovernmentService",
        "name": f"Contract {piid}",
        "description": summary,
        "provider": {
            "@type": "GovernmentOrganization",
            "name": agency
        },
        "areaServed": {
            "@type": "Country",
            "name": "United States"
        },
        "url": canonical
    }
    if c.get('award_amount'):
        jsonld["offers"] = {
            "@type": "Offer",
            "price": str(c['award_amount']),
            "priceCurrency": "USD"
        }

    html = f'''<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{title}</title>
  <meta name="description" content="{html_escape(summary[:160])}">
  <link rel="canonical" href="{canonical}">
  <meta property="og:title" content="{title}">
  <meta property="og:description" content="{html_escape(summary[:160])}">
  <meta property="og:url" content="{canonical}">
  <meta property="og:type" content="website">
  <meta name="robots" content="index, follow">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <script type="application/ld+json">{json.dumps(jsonld)}</script>
  <style>{PAGE_CSS}</style>
</head>
<body>
  {page_header()}
  <div class="container">
    <h1>{esc(recipient)}</h1>
    <div class="subtitle">{esc(agency)} &middot; PIID: {esc(piid)} &middot; {year}</div>

    {f'<div class="summary-box">{esc(c["llama_summary"])}</div>' if c.get('llama_summary') else ''}

    <div class="section">
      <div class="section-title">Contract Overview</div>
      <div class="grid">
        <div class="field"><span class="field-label">PIID:</span> <span class="field-value">{esc(piid)}</span></div>
        <div class="field"><span class="field-label">Award Amount:</span> <span class="field-value">{fmt_money(c.get('award_amount'))}</span></div>
        <div class="field"><span class="field-label">Base Value:</span> <span class="field-value">{fmt_money(c.get('base_amount'))}</span></div>
        <div class="field"><span class="field-label">Ceiling Value:</span> <span class="field-value">{fmt_money(c.get('ceiling_amount'))}</span></div>
        <div class="field"><span class="field-label">Federal Obligation:</span> <span class="field-value">{fmt_money(c.get('federal_obligation'))}</span></div>
        <div class="field"><span class="field-label">Total Outlayed:</span> <span class="field-value">{fmt_money(c.get('total_outlayed'))}</span></div>
        <div class="field"><span class="field-label">Contract Type:</span> <span class="field-value">{esc(c.get('contract_type'))}</span></div>
        <div class="field"><span class="field-label">Award Type:</span> <span class="field-value">{esc(c.get('award_type'))}</span></div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Parties</div>
      <div class="grid">
        <div class="field"><span class="field-label">Agency:</span> <span class="field-value">{esc(c.get('agency_name'))}</span></div>
        <div class="field"><span class="field-label">Sub-Agency:</span> <span class="field-value">{esc(c.get('sub_agency_name'))}</span></div>
        <div class="field"><span class="field-label">Office:</span> <span class="field-value">{esc(c.get('office_name'))}</span></div>
        <div class="field"><span class="field-label">Contracting Officer:</span> <span class="field-value">{esc(c.get('contracting_officer'))}</span></div>
        <div class="field"><span class="field-label">Recipient:</span> <span class="field-value">{esc(c.get('recipient_name'))}</span></div>
        <div class="field"><span class="field-label">UEI:</span> <span class="field-value">{esc(c.get('recipient_uei'))}</span></div>
        <div class="field"><span class="field-label">Location:</span> <span class="field-value">{esc(c.get('recipient_city'))}, {esc(c.get('recipient_state'))} {esc(c.get('recipient_zip'))}</span></div>
        <div class="field"><span class="field-label">Small Business:</span> <span class="field-value">{'Yes' if c.get('is_small_business') else 'No' if c.get('is_small_business') is not None else '&mdash;'}</span></div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Classification</div>
      <div class="grid">
        <div class="field"><span class="field-label">NAICS:</span> <span class="field-value">{esc(c.get('naics_code'))} &mdash; {esc(c.get('naics_description'))}</span></div>
        <div class="field"><span class="field-label">PSC:</span> <span class="field-value">{esc(c.get('psc_code'))} &mdash; {esc(c.get('psc_description'))}</span></div>
        <div class="field"><span class="field-label">Set-Aside:</span> <span class="field-value">{esc(c.get('set_aside_type'))}</span></div>
        <div class="field"><span class="field-label">Competition:</span> <span class="field-value">{esc(c.get('competition_type'))}</span></div>
        <div class="field"><span class="field-label">Extent Competed:</span> <span class="field-value">{esc(c.get('extent_competed'))}</span></div>
        <div class="field"><span class="field-label">Number of Offers:</span> <span class="field-value">{esc(c.get('number_of_offers'))}</span></div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Period of Performance</div>
      <div class="grid">
        <div class="field"><span class="field-label">Start Date:</span> <span class="field-value">{fmt_date(c.get('start_date'))}</span></div>
        <div class="field"><span class="field-label">End Date:</span> <span class="field-value">{fmt_date(c.get('end_date'))}</span></div>
        <div class="field"><span class="field-label">Fiscal Year:</span> <span class="field-value">{esc(c.get('fiscal_year'))}</span></div>
      </div>
    </div>

    {f'<div class="section"><div class="section-title">Description</div><p style="font-size:14px">{esc(c.get("description"))}</p></div>' if c.get('description') else ''}

    <a class="cta" href="{SITE_URL}/#contract/{url_quote(piid)}">View Interactive Details &amp; Generate Report &rarr;</a>

    <div class="trust-box">
      <strong>Data Sources</strong><br>
      Contract data sourced from <a href="https://www.usaspending.gov" rel="noopener">USASpending.gov</a>
      and <a href="https://sam.gov" rel="noopener">SAM.gov</a>.
      {f'<a href="{html_escape(c["usaspending_url"])}" rel="noopener">View on USASpending.gov</a>' if c.get('usaspending_url') else ''}
      <br>AI-generated summary by Llama 3.2. Last synced: {fmt_date(c.get('last_synced'))}.
    </div>
  </div>
  {page_footer()}
</body>
</html>'''
    return html


# ── Opportunity HTML ──────────────────────────────────────────────────────────

def generate_opportunity_html(o):
    """Generate a static HTML page for an opportunity record (dict)."""
    notice_id = o['notice_id']
    title = o.get('title') or 'Federal Solicitation'
    agency = o.get('agency_name') or 'Unknown Agency'
    summary = o.get('llama_summary') or o.get('description') or 'Federal solicitation opportunity.'
    canonical = f"{SITE_URL}/opportunities/{url_quote(notice_id)}"

    page_title = f"{esc(title)} — {esc(agency)} Solicitation"

    # JSON-LD
    jsonld = {
        "@context": "https://schema.org",
        "@type": "GovernmentService",
        "name": title,
        "description": summary,
        "provider": {
            "@type": "GovernmentOrganization",
            "name": agency
        },
        "areaServed": {
            "@type": "Country",
            "name": "United States"
        },
        "url": canonical
    }

    recompete_badge = ''
    if o.get('is_recompete'):
        recompete_badge = ' <span class="badge badge-amber">Recompete</span>'

    est_value = '&mdash;'
    if o.get('estimated_value_min') and o.get('estimated_value_max'):
        est_value = f"{fmt_money(o['estimated_value_min'])} &ndash; {fmt_money(o['estimated_value_max'])}"
    elif o.get('estimated_value_max'):
        est_value = f"Up to {fmt_money(o['estimated_value_max'])}"
    elif o.get('estimated_value_min'):
        est_value = f"From {fmt_money(o['estimated_value_min'])}"

    html = f'''<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{page_title}</title>
  <meta name="description" content="{html_escape(summary[:160])}">
  <link rel="canonical" href="{canonical}">
  <meta property="og:title" content="{page_title}">
  <meta property="og:description" content="{html_escape(summary[:160])}">
  <meta property="og:url" content="{canonical}">
  <meta property="og:type" content="website">
  <meta name="robots" content="index, follow">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <script type="application/ld+json">{json.dumps(jsonld)}</script>
  <style>{PAGE_CSS}</style>
</head>
<body>
  {page_header()}
  <div class="container">
    <h1>{esc(title)}{recompete_badge}</h1>
    <div class="subtitle">{esc(agency)} &middot; Notice: {esc(notice_id)}</div>

    {f'<div class="summary-box">{esc(o["llama_summary"])}</div>' if o.get('llama_summary') else ''}

    <div class="section">
      <div class="section-title">Solicitation Overview</div>
      <div class="grid">
        <div class="field"><span class="field-label">Notice ID:</span> <span class="field-value">{esc(notice_id)}</span></div>
        <div class="field"><span class="field-label">Solicitation #:</span> <span class="field-value">{esc(o.get('solicitation_number'))}</span></div>
        <div class="field"><span class="field-label">Notice Type:</span> <span class="field-value">{esc(o.get('notice_type'))}</span></div>
        <div class="field"><span class="field-label">Estimated Value:</span> <span class="field-value">{est_value}</span></div>
        <div class="field"><span class="field-label">Set-Aside:</span> <span class="field-value">{esc(o.get('set_aside_type'))}</span></div>
        <div class="field"><span class="field-label">Contract Type:</span> <span class="field-value">{esc(o.get('contract_type'))}</span></div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Agency</div>
      <div class="grid">
        <div class="field"><span class="field-label">Agency:</span> <span class="field-value">{esc(o.get('agency_name'))}</span></div>
        <div class="field"><span class="field-label">Sub-Agency:</span> <span class="field-value">{esc(o.get('sub_agency_name'))}</span></div>
        <div class="field"><span class="field-label">Office:</span> <span class="field-value">{esc(o.get('office_name'))}</span></div>
        <div class="field"><span class="field-label">Contracting Officer:</span> <span class="field-value">{esc(o.get('contracting_officer'))}</span></div>
        <div class="field"><span class="field-label">CO Email:</span> <span class="field-value">{esc(o.get('contracting_officer_email'))}</span></div>
        <div class="field"><span class="field-label">CO Phone:</span> <span class="field-value">{esc(o.get('contracting_officer_phone'))}</span></div>
      </div>
    </div>

    {f"""<div class="section">
      <div class="section-title">Incumbent</div>
      <div class="grid">
        <div class="field"><span class="field-label">Incumbent:</span> <span class="field-value">{esc(o.get('incumbent_name'))}</span></div>
        <div class="field"><span class="field-label">Incumbent UEI:</span> <span class="field-value">{esc(o.get('incumbent_uei'))}</span></div>
        <div class="field"><span class="field-label">Related PIID:</span> <span class="field-value">{esc(o.get('related_piid'))}</span></div>
      </div>
    </div>""" if o.get('is_recompete') or o.get('incumbent_name') else ''}

    <div class="section">
      <div class="section-title">Classification</div>
      <div class="grid">
        <div class="field"><span class="field-label">NAICS:</span> <span class="field-value">{esc(o.get('naics_code'))} &mdash; {esc(o.get('naics_description'))}</span></div>
        <div class="field"><span class="field-label">PSC:</span> <span class="field-value">{esc(o.get('psc_code'))}</span></div>
        <div class="field"><span class="field-label">Place of Performance:</span> <span class="field-value">{esc(o.get('place_of_performance_city'))}, {esc(o.get('place_of_performance_state'))}</span></div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Key Dates</div>
      <div class="grid">
        <div class="field"><span class="field-label">Posted:</span> <span class="field-value">{fmt_date(o.get('posted_date'))}</span></div>
        <div class="field"><span class="field-label">Response Deadline:</span> <span class="field-value">{fmt_date(o.get('response_deadline'))}</span></div>
        <div class="field"><span class="field-label">Archive Date:</span> <span class="field-value">{fmt_date(o.get('archive_date'))}</span></div>
      </div>
    </div>

    {f'<div class="section"><div class="section-title">Description</div><p style="font-size:14px">{esc(o.get("description"))}</p></div>' if o.get('description') else ''}

    <a class="cta" href="{SITE_URL}/#opportunity/{url_quote(notice_id)}">View Interactive Details &amp; Generate Report &rarr;</a>

    <div class="trust-box">
      <strong>Data Sources</strong><br>
      Solicitation data sourced from <a href="https://sam.gov" rel="noopener">SAM.gov</a>.
      {f'<a href="{html_escape(o["sam_url"])}" rel="noopener">View on SAM.gov</a>' if o.get('sam_url') else ''}
      <br>AI-generated summary by Llama 3.2. Last synced: {fmt_date(o.get('last_synced'))}.
    </div>
  </div>
  {page_footer()}
</body>
</html>'''
    return html


# ── Sitemap ───────────────────────────────────────────────────────────────────

def generate_sitemap(contract_ids, opportunity_ids):
    """Generate sitemap.xml content."""
    now = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    urls = []

    # Homepage
    urls.append(f'''  <url>
    <loc>{SITE_URL}</loc>
    <lastmod>{now}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>''')

    # Contract pages
    for piid in contract_ids:
        urls.append(f'''  <url>
    <loc>{SITE_URL}/contracts/{url_quote(piid)}</loc>
    <lastmod>{now}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>''')

    # Opportunity pages
    for nid in opportunity_ids:
        urls.append(f'''  <url>
    <loc>{SITE_URL}/opportunities/{url_quote(nid)}</loc>
    <lastmod>{now}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.8</priority>
  </url>''')

    return f'''<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
{chr(10).join(urls)}
</urlset>'''


# ── DO Spaces Upload (boto3) ─────────────────────────────────────────────────

def get_s3_client():
    """Create a boto3 S3 client for DO Spaces."""
    try:
        import boto3
    except ImportError:
        print("ERROR: boto3 not installed. Install with: python3 -m pip install boto3")
        print("  Or use a venv: python3 -m venv /tmp/s3venv && /tmp/s3venv/bin/pip install boto3")
        sys.exit(1)

    session = boto3.session.Session()
    return session.client(
        's3',
        region_name=os.environ['DO_SPACES_REGION'],
        endpoint_url=os.environ['DO_SPACES_ENDPOINT'],
        aws_access_key_id=os.environ['DO_SPACES_KEY'],
        aws_secret_access_key=os.environ['DO_SPACES_SECRET'],
    )


def upload_file(s3, local_path, remote_key, content_type='text/html'):
    """Upload a single file to DO Spaces."""
    bucket = os.environ['DO_SPACES_BUCKET']
    s3.upload_file(
        str(local_path),
        bucket,
        remote_key,
        ExtraArgs={
            'ContentType': content_type,
            'CacheControl': 'public, max-age=86400',
            'ACL': 'public-read',
        }
    )


# ── DB: update static_page tracking ──────────────────────────────────────────

def mark_static_generated(conn, table, id_col, record_id, static_url):
    """Update static_page_url and static_page_generated for a record."""
    cur = conn.cursor()
    try:
        cur.execute(
            f"UPDATE {table} SET static_page_url = %s, static_page_generated = NOW() WHERE {id_col} = %s",
            (static_url, record_id)
        )
        conn.commit()
    except Exception:
        conn.rollback()
    finally:
        cur.close()


# ── Main ──────────────────────────────────────────────────────────────────────

def generate_page_for_piid(piid: str) -> bool:
    """
    Generate and upload a static page for a single contract.
    Called from the ingest pipeline after Ollama summary is written.
    Returns True on success, False on failure (never raises).
    """
    try:
        conn = psycopg2.connect(os.environ['DATABASE_URL'])
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT * FROM contracts WHERE piid = %s", [piid])
        row = cur.fetchone()
        if not row:
            print(f"  [static] {piid} not found in DB — skipping")
            conn.close()
            return False

        c = dict(row)
        html = generate_contract_html(c)
        CONTRACTS_DIR.mkdir(parents=True, exist_ok=True)
        fpath = CONTRACTS_DIR / f"{piid}.html"
        fpath.write_text(html, encoding='utf-8')

        s3 = make_s3_client()
        remote_key = f"contracts/{piid}.html"
        bucket = os.environ.get('DO_SPACES_BUCKET', 'awardopedia-static')
        region = os.environ.get('DO_SPACES_REGION', 'nyc3')
        static_url = f"https://{bucket}.{region}.digitaloceanspaces.com/{remote_key}"

        if s3:
            upload_file(s3, fpath, remote_key)
            mark_static_generated(conn, 'contracts', 'piid', piid, static_url)
            print(f"  [static] {piid} → uploaded ✓")
        else:
            print(f"  [static] {piid} → {fpath} (no S3 client)")

        conn.close()
        return True
    except Exception as e:
        print(f"  [static] {piid} failed: {e}")
        return False


def generate_page_for_opportunity(notice_id: str) -> bool:
    """
    Generate and upload a static page for a single opportunity.
    Called from the ingest pipeline after Ollama summary is written.
    Returns True on success, False on failure (never raises).
    """
    try:
        conn = psycopg2.connect(os.environ['DATABASE_URL'])
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT * FROM opportunities WHERE notice_id = %s", [notice_id])
        row = cur.fetchone()
        if not row:
            print(f"  [static] {notice_id} not found in DB — skipping")
            conn.close()
            return False

        o = dict(row)
        html = generate_opportunity_html(o)
        OPPORTUNITIES_DIR.mkdir(parents=True, exist_ok=True)
        fpath = OPPORTUNITIES_DIR / f"{notice_id}.html"
        fpath.write_text(html, encoding='utf-8')

        s3 = make_s3_client()
        remote_key = f"opportunities/{notice_id}.html"
        bucket = os.environ.get('DO_SPACES_BUCKET', 'awardopedia-static')
        region = os.environ.get('DO_SPACES_REGION', 'nyc3')
        static_url = f"https://{bucket}.{region}.digitaloceanspaces.com/{remote_key}"

        if s3:
            upload_file(s3, fpath, remote_key)
            mark_static_generated(conn, 'opportunities', 'notice_id', notice_id, static_url)
            print(f"  [static] {notice_id} → uploaded ✓")
        else:
            print(f"  [static] {notice_id} → {fpath} (no S3 client)")

        conn.close()
        return True
    except Exception as e:
        print(f"  [static] {notice_id} failed: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(description='Generate static HTML pages for Awardopedia SEO')
    parser.add_argument('--new-only', action='store_true', help='Only generate for records without static_page_generated')
    parser.add_argument('--local-only', action='store_true', help='Generate HTML locally, skip DO Spaces upload')
    parser.add_argument('--dry-run', action='store_true', help='Show what would be generated without writing files')
    args = parser.parse_args()

    # Ensure output directories exist
    CONTRACTS_DIR.mkdir(parents=True, exist_ok=True)
    OPPORTUNITIES_DIR.mkdir(parents=True, exist_ok=True)

    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    # ── Fetch contracts ──
    where = "WHERE static_page_generated IS NULL" if args.new_only else ""
    cur.execute(f"SELECT * FROM contracts {where} ORDER BY piid")
    contracts = cur.fetchall()

    # ── Fetch opportunities ──
    cur.execute(f"SELECT * FROM opportunities {where} ORDER BY notice_id")
    opportunities = cur.fetchall()

    cur.close()

    total = len(contracts) + len(opportunities)
    print(f"Found {len(contracts)} contracts and {len(opportunities)} opportunities to process ({total} total)")

    if args.dry_run:
        for c in contracts:
            print(f"  [contract] {c['piid']}")
        for o in opportunities:
            print(f"  [opportunity] {o['notice_id']}")
        print("Dry run — no files written.")
        conn.close()
        return

    # S3 client (only if uploading)
    s3 = None
    if not args.local_only:
        s3 = get_s3_client()

    contract_ids = []
    opportunity_ids = []
    generated = 0
    errors = 0

    # ── Generate contract pages ──
    for c in contracts:
        piid = c['piid']
        fname = safe_filename(piid) + '.html'
        fpath = CONTRACTS_DIR / fname
        remote_key = f"contracts/{fname}"
        static_url = f"https://{os.environ.get('DO_SPACES_BUCKET', 'awardopedia-static')}.{os.environ.get('DO_SPACES_REGION', 'nyc3')}.digitaloceanspaces.com/{remote_key}"

        try:
            html = generate_contract_html(c)
            fpath.write_text(html, encoding='utf-8')
            contract_ids.append(piid)

            if s3:
                upload_file(s3, fpath, remote_key)
                mark_static_generated(conn, 'contracts', 'piid', piid, static_url)
                print(f"  [contract] {piid} -> uploaded")
            else:
                print(f"  [contract] {piid} -> {fpath}")

            generated += 1
        except Exception as e:
            print(f"  [ERROR] contract {piid}: {e}")
            errors += 1

    # ── Generate opportunity pages ──
    for o in opportunities:
        nid = o['notice_id']
        fname = safe_filename(nid) + '.html'
        fpath = OPPORTUNITIES_DIR / fname
        remote_key = f"opportunities/{fname}"
        static_url = f"https://{os.environ.get('DO_SPACES_BUCKET', 'awardopedia-static')}.{os.environ.get('DO_SPACES_REGION', 'nyc3')}.digitaloceanspaces.com/{remote_key}"

        try:
            html = generate_opportunity_html(o)
            fpath.write_text(html, encoding='utf-8')
            opportunity_ids.append(nid)

            if s3:
                upload_file(s3, fpath, remote_key)
                mark_static_generated(conn, 'opportunities', 'notice_id', nid, static_url)
                print(f"  [opportunity] {nid} -> uploaded")
            else:
                print(f"  [opportunity] {nid} -> {fpath}")

            generated += 1
        except Exception as e:
            print(f"  [ERROR] opportunity {nid}: {e}")
            errors += 1

    # ── Generate sitemap ──
    sitemap_path = STATIC_DIR / 'sitemap.xml'
    sitemap_content = generate_sitemap(contract_ids, opportunity_ids)
    sitemap_path.write_text(sitemap_content, encoding='utf-8')
    print(f"\nSitemap generated: {sitemap_path} ({len(contract_ids) + len(opportunity_ids) + 1} URLs)")

    if s3:
        upload_file(s3, sitemap_path, 'sitemap.xml', content_type='application/xml')
        print("Sitemap uploaded to DO Spaces")

    conn.close()

    print(f"\nDone: {generated} pages generated, {errors} errors")
    if errors:
        sys.exit(1)


if __name__ == '__main__':
    main()
