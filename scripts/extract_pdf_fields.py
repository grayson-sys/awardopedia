"""
extract_pdf_fields.py — Deterministic field extraction from solicitation PDF text

All functions take raw combined PDF text and return typed Python values.
No LLM. No guessing. Either the pattern matches or it returns None.

Extraction confidence levels:
  HIGH   — structured field with labeled value, near-certain
  MEDIUM — pattern-matched from prose, may have edge cases
  LOW    — keyword inference, boolean only

Each extractor is a standalone function so it can be tested and improved independently.
"""

import re
from typing import Optional

# ─────────────────────────────────────────────────────────────────
# SIZE STANDARD
# Confidence: HIGH — always in a labeled field on the SF-1449 form
# Example patterns:
#   "SIZE STANDARD: $22.5 million"
#   "Size Standard:  1,250 employees"
#   "SIZE STANDARD (EMPLOYEES): 1250"
#   "(NAICS): 561720  SIZE STANDARD: $22"   ← abbreviated on form
# ─────────────────────────────────────────────────────────────────

SIZE_STD_PATTERNS = [
    # Full labeled with unit: "Size Standard: $22.5 million" / "1,250 employees"
    re.compile(
        r'size\s+standard[:\s]+\$?([\d,\.]+)\s*(million|billion|employees|M\b)',
        re.IGNORECASE
    ),
    # Abbreviated SF-1449 form field: "SIZE STANDARD: $22" (always dollars, usually millions)
    re.compile(
        r'SIZE\s+STANDARD[:\s]*\n?\s*\$\s*([\d,\.]+)',
        re.IGNORECASE | re.MULTILINE
    ),
    # Bare labeled with employees explicit
    re.compile(
        r'size\s+standard[:\s]+([\d,]+)\s+employees',
        re.IGNORECASE
    ),
]

def extract_size_standard(text: str) -> Optional[str]:
    for i, pat in enumerate(SIZE_STD_PATTERNS):
        m = pat.search(text)
        if not m:
            continue
        val = m.group(1).replace(',', '').strip()
        groups = m.groups()
        unit = (groups[1] if len(groups) > 1 else '').lower().strip() if len(groups) > 1 else ''

        if i == 2:  # employees pattern
            return f"{int(float(val)):,} employees"
        if 'employee' in unit:
            return f"{int(float(val)):,} employees"
        if unit in ('million', 'm'):
            return f"${val} million"
        if unit == 'billion':
            return f"${val} billion"

        # Bare dollar value (SF-1449 abbreviated form):
        # Revenue-based size standards are always whole or half dollar-millions
        # e.g. "$22" = $22 million, never $22 employees
        try:
            n = float(val)
            if i == 1:  # dollar-prefixed pattern — always millions
                return f"${int(n) if n == int(n) else n} million"
            # General: large numbers (500+) are employees, small numbers are millions
            if n >= 100:
                return f"{int(n):,} employees"
            else:
                return f"${int(n) if n == int(n) else n} million"
        except ValueError:
            return val
    return None


# ─────────────────────────────────────────────────────────────────
# PREVAILING WAGE (Davis-Bacon / Service Contract Act)
# Confidence: HIGH — wage determinations have a fixed columnar format
# Example: "11150 - Janitor    18.27"
#          "CLEANER    $21.43"
#          "Custodian / Janitor    $19.50/hr"
# ─────────────────────────────────────────────────────────────────

# SCA wage determination table format: "23311 - Janitor    18.27    4.54"
# Davis-Bacon format: "Laborer (Common/General)    $35.58"
# We match: optional code, then occupation name, whitespace, then the dollar amount
# The amount follows AT LEAST 3 spaces (distinguishes it from inline mentions)

SCA_WAGE_LINE = re.compile(
    r'(?:\d{5}\s*[-–]\s*)?'                          # optional occupation code "23311 - "
    r'(janitor|custodian|building\s+(?:cleaner|service)|floor\s+(?:waxer|maintenance)|'
    r'window\s+cleaner|housekeeper|maid)'            # specific building service occupations
    r'[^$\n]{0,50}'                                  # description text
    r'\s{2,}'                                        # 2+ spaces (column separator in WD)
    r'\$?\s*([\d]{2,3}(?:\.\d{2})?)',                # dollar amount (must be 2+ digits)
    re.IGNORECASE
)

# Davis-Bacon laborer line (construction contracts)
DB_LABORER_LINE = re.compile(
    r'Laborer\s+\((?:Common|General|Unskilled)\)'
    r'[^$\n]{0,20}'
    r'\s{2,}\$?\s*([\d]{2,3}(?:\.\d{2})?)',
    re.IGNORECASE
)

# Federal contractor minimum wage floor for sanity check
FEDERAL_CONTRACTOR_MIN_WAGE = 17.20  # EO 14026, 2025 rate

def extract_wage_floor(text: str) -> Optional[str]:
    """
    Find the prevailing wage rate for building service or laborer occupations
    from a formal SCA wage determination or Davis-Bacon wage table.
    
    Uses strict pattern matching: requires the WD column format (occupation name
    followed by 2+ spaces then the rate) to avoid false positives from inline
    mentions of dollar amounts near the word "cleaner" or "janitor".
    """
    # Try SCA building service pattern first
    for m in SCA_WAGE_LINE.finditer(text):
        try:
            wage = float(m.group(2))
            if FEDERAL_CONTRACTOR_MIN_WAGE <= wage <= 80.0:
                occ = m.group(1).strip().title()
                return f"${wage:.2f}/hr for {occ}"
        except (ValueError, IndexError):
            pass

    # Try Davis-Bacon Laborer pattern (construction contracts)
    for m in DB_LABORER_LINE.finditer(text):
        try:
            wage = float(m.group(1))
            if FEDERAL_CONTRACTOR_MIN_WAGE <= wage <= 80.0:
                return f"${wage:.2f}/hr for Laborer (Davis-Bacon)"
        except (ValueError, IndexError):
            pass

    return None


# ─────────────────────────────────────────────────────────────────
# PERFORMANCE ADDRESS
# Confidence: MEDIUM — address-shaped text near location keywords in SOW
# ─────────────────────────────────────────────────────────────────

# Match "123 Main Street, Anytown, ST 12345"
# Requires ≥ 3-digit street number to eliminate document section numbers (0., 3., 11.)
ADDRESS_PATTERN = re.compile(
    r'\b(\d{3,5}\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3}\s+'
    r'(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Court|Ct|Place|Pl|Circle|Cir)\.?'
    r'(?:[,\s]+[A-Za-z\s]+)?'
    r'(?:[,\s]+[A-Z]{2}\s+\d{5}(?:-\d{4})?)?)',
    re.IGNORECASE
)

# Words that indicate the "address" is actually a document section title, not a location.
# If any of these appear in a candidate match, discard it.
ADDRESS_BLACKLIST = re.compile(
    r'\b(performance|work\s+statement|table\s+of\s+contents|contract\s+draw|surveillance\s+plan|'
    r'quality\s+assurance|progress\s+plan|sustainability|statement\s+of\s+work|drawings|magnetic|'
    r'united\s+states|weeks?\s+aro|section\s+\d|article\s+\d)\b',
    re.IGNORECASE
)

LOCATION_CONTEXT = re.compile(
    r'(?:located\s+at|location\s*:|place\s+of\s+performance|work\s+will\s+be\s+performed|'
    r'services\s+(?:will\s+be|are)\s+(?:provided|performed)|project\s+(?:location|site)|'
    r'facility\s+(?:is\s+)?located)',
    re.IGNORECASE
)

def extract_performance_address(text: str) -> Optional[str]:
    def is_valid(addr: str) -> bool:
        """Return False if the candidate matches known document-structure patterns."""
        return not ADDRESS_BLACKLIST.search(addr)

    # First: look for address near a location keyword
    for m in LOCATION_CONTEXT.finditer(text):
        nearby = text[m.start():m.start() + 300]
        addr_m = ADDRESS_PATTERN.search(nearby)
        if addr_m:
            candidate = addr_m.group(0).strip().rstrip(',')
            if is_valid(candidate):
                return candidate
    # Fallback: any address-shaped string in the document
    for candidate in ADDRESS_PATTERN.findall(text):
        candidate = candidate.strip().rstrip(',')
        if is_valid(candidate):
            return candidate
    return None


# ─────────────────────────────────────────────────────────────────
# SECURITY CLEARANCE REQUIRED
# Confidence: HIGH — explicit required/required language
# ─────────────────────────────────────────────────────────────────

# TRUE clearance = SECRET, TOP SECRET, TS/SCI, Confidential (classification level)
# NOT clearance = background investigation, HSPD-12, suitability, public trust
# (background checks are routine on federal facilities — not a bid barrier)

CLEARANCE_REQUIRED = re.compile(
    r'(?:require[sd]?|must\s+hold|must\s+possess|must\s+obtain|'
    r'clearance\s+(?:is\s+)?required|hold\s+(?:a\s+)?(?:current|active|valid))'
    r'.{0,100}'
    r'\b(?:SECRET|TOP\s+SECRET|TS(?:/SCI)?|Confidential)\b',
    re.IGNORECASE | re.DOTALL
)

CLEARANCE_LEVEL = re.compile(
    r'\b(?:SECRET|TOP\s+SECRET|TS/SCI)\b'
    r'(?!\s+(?:for\s+Official\s+Use|information|document|marking))',  # exclude "SECRET for Official Use" etc.
    re.IGNORECASE
)

def extract_clearance_required(text: str) -> bool:
    if CLEARANCE_REQUIRED.search(text):
        return True
    # Secondary: explicit mention of clearance level
    return bool(CLEARANCE_LEVEL.search(text))


# ─────────────────────────────────────────────────────────────────
# SOLE SOURCE / BRAND NAME ONLY
# Confidence: HIGH — always explicit in the solicitation
# ─────────────────────────────────────────────────────────────────

SOLE_SOURCE_PATTERN = re.compile(
    r'(?:brand\s*[-\s]?name\s+only|'                         # "brand name only"
    r'brand\s+name\s+or\s+equal|'                           # "brand name or equal" (still restricted)
    r'sole\s+(?:source|qualified\s+(?:manufacturer|source|vendor|supplier))|'
    r'only\s+(?:one|1|a\s+single)\s+(?:qualified|known|acceptable)\s+(?:manufacturer|source|supplier|vendor)|'
    r'restricted\s+to\s+(?:a\s+)?single\s+(?:manufacturer|source)|'
    r'no\s+(?:approved\s+)?substitute[s]?\s+(?:will\s+be\s+)?(?:accepted|allowed)\s+for\s+(?:this\s+)?(?:product|item|supply|material))',
    re.IGNORECASE
)

# Explicitly exclude personnel substitution clauses — "no substitutes will be allowed"
# for KEY PERSONNEL is different from product sole-source
PERSONNEL_CONTEXT = re.compile(
    r'(?:key\s+personnel|proposed\s+personnel|named\s+(?:individual|person)|'
    r'staffing|evaluation|at\s+(?:time\s+of\s+)?award)',
    re.IGNORECASE
)

# Context indicating brand-name applies to a specific COMPONENT, not the whole contract.
# "Brand name only" for a fire alarm brand ≠ the whole solicitation is sole source.
COMPONENT_CONTEXT = re.compile(
    r'(?:component|item|equipment|system|product|material|supply|part|unit|model|'
    r'manufacturer|brand|specification|justification\s+and\s+approval|J&A|'
    r'JOFOC|limited\s+source)',
    re.IGNORECASE
)

def extract_sole_source(text: str) -> bool:
    """
    Detect true sole-source / brand-name-only restrictions.
    Returns True only if the restriction appears to apply to the WHOLE contract,
    not just a specific component or equipment item within a competitive solicitation.
    """
    m = SOLE_SOURCE_PATTERN.search(text)
    if not m:
        return False
    # Check if the match is in a personnel context (false positive)
    context = text[max(0, m.start()-200):m.end()+200]
    if PERSONNEL_CONTEXT.search(context):
        return False
    # Check if this is a component-level restriction (J&A for specific equipment)
    # If brand-name language appears near component/equipment/item words,
    # it's likely a component restriction, not a whole-contract sole source
    if COMPONENT_CONTEXT.search(context):
        # Count how many brand-name matches there are in the WHOLE document.
        # If there's only 1-2 mentions and they're near component words, it's a component restriction.
        # If brand-name language appears repeatedly throughout, it's more likely contract-level.
        all_matches = list(SOLE_SOURCE_PATTERN.finditer(text))
        if len(all_matches) <= 3:
            return False  # Likely component-level, not contract-level
    return True


# ─────────────────────────────────────────────────────────────────
# AWARD BASIS (evaluation method)
# Confidence: HIGH — standard terms with near-exact phrasing in every solicitation
# ─────────────────────────────────────────────────────────────────

def extract_award_basis(text: str) -> Optional[str]:
    text_upper = text.upper()
    if 'LOWEST PRICE TECHNICALLY ACCEPTABLE' in text_upper or 'LPTA' in text_upper:
        return 'Lowest Price Technically Acceptable (LPTA)'
    if 'BEST VALUE' in text_upper:
        return 'Best Value'
    if 'LOWEST PRICE' in text_upper:
        return 'Lowest Price'
    if 'TECHNICALLY ACCEPTABLE' in text_upper:
        return 'Technically Acceptable'
    return None


# ─────────────────────────────────────────────────────────────────
# CONTRACT STRUCTURE (base + option years)
# Confidence: MEDIUM-HIGH — option year structure is highly standardized
# ─────────────────────────────────────────────────────────────────

WORD_TO_NUM = {'one':1,'two':2,'three':3,'four':4,'five':5,'six':6,'seven':7,'eight':8,'nine':9,'ten':10}

# Match "Option Year One", "Option Year 1", "Option Period 3" etc.
OPTION_YEAR_PATTERN = re.compile(
    r'option\s+(?:year|period)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)',
    re.IGNORECASE
)

# Match "4 additional one-year options" or "up to 4 option years"
OPTION_COUNT_PATTERN = re.compile(
    r'(?:up\s+to\s+|with\s+)?(\d+|one|two|three|four|five)\s+(?:additional\s+)?(?:one-year\s+)?option(?:\s+year)?s?',
    re.IGNORECASE
)

# Base period date range: "Base Year: April 1, 2026 to March 31, 2027"
DATE_RANGE_PATTERN = re.compile(
    r'(?:base\s+(?:year|period|contract)[:\s]+|period\s+of\s+performance[:\s]+)'
    r'([A-Za-z]+\s+\d{1,2},?\s+\d{4})\s*(?:through|to|-)\s*([A-Za-z]+\s+\d{1,2},?\s+\d{4})',
    re.IGNORECASE
)

def extract_contract_structure(text: str) -> Optional[str]:
    # Method 1: collect DISTINCT option year numbers from "Option Year X" references
    option_nums = set()
    for m in OPTION_YEAR_PATTERN.finditer(text):
        raw = m.group(1).lower()
        n = WORD_TO_NUM.get(raw) or (int(raw) if raw.isdigit() else None)
        if n:
            option_nums.add(n)
    num_options = max(option_nums) if option_nums else 0

    # Method 2: fallback — "X one-year options" in prose
    if num_options == 0:
        m = OPTION_COUNT_PATTERN.search(text)
        if m:
            raw = m.group(1).lower()
            num_options = WORD_TO_NUM.get(raw) or (int(raw) if raw.isdigit() else 0)

    date_match = DATE_RANGE_PATTERN.search(text)

    if num_options > 0:
        total = 1 + num_options
        result = f"1 base year + {num_options} option year{'s' if num_options > 1 else ''} ({total} years total)"
        if date_match:
            result += f"; base: {date_match.group(1)} – {date_match.group(2)}"
        return result
    elif date_match:
        return f"Base period: {date_match.group(1)} – {date_match.group(2)}"
    return None


# ─────────────────────────────────────────────────────────────────
# ESTIMATED VALUE (dollar amount)
# Confidence: LOW-MEDIUM — often not published; regex when present
# ─────────────────────────────────────────────────────────────────

DOLLAR_AMOUNT_PATTERNS = [
    # "not to exceed $X,XXX,XXX" or "ceiling of $X,XXX,XXX"
    re.compile(
        r'(?:not\s+to\s+exceed|ceiling|maximum\s+(?:contract\s+)?value|'
        r'total\s+(?:contract\s+)?(?:value|amount)|estimated\s+(?:value|cost|amount))'
        r'\s*(?:of\s+|is\s+|:?\s*)\$\s*([\d,]+(?:\.\d{2})?)\s*(?:million|M|billion|B)?',
        re.IGNORECASE
    ),
    # Price schedule "Total Base Year $XXX,XXX" — last dollar amount in a totals row
    re.compile(
        r'Total\s+(?:Base\s+Year|All\s+(?:Option\s+)?Years?|CLIN[S]?)\s+\$\s*([\d,]+)',
        re.IGNORECASE
    ),
]

def extract_estimated_value(text: str) -> Optional[str]:
    for pat in DOLLAR_AMOUNT_PATTERNS:
        m = pat.search(text)
        if m:
            raw = m.group(1).replace(',', '')
            try:
                val = float(raw)
                if val > 1_000:  # sanity: must be >$1,000
                    return f"${val:,.0f}"
            except ValueError:
                pass
    return None


# ─────────────────────────────────────────────────────────────────
# WORK HOURS / HOURS OF OPERATION
# Confidence: MEDIUM — explicit in services contracts, absent in supply/construction
# ─────────────────────────────────────────────────────────────────

WORK_HOURS_PATTERN = re.compile(
    r'(?:all\s+(?:work|services?)\s+shall\s+be\s+performed|hours?\s+of\s+(?:operation|performance|work)|'
    r'performance\s+(?:hours?|schedule)|work\s+shall\s+be\s+(?:performed|conducted|completed))'
    r'[^.]{0,200}?'
    r'(?:(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?))\s*(?:and|to|-)\s*'
    r'(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?))|'
    r'(after\s+\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)|'
    r'outside\s+(?:of\s+)?(?:normal|regular|core)\s+(?:business\s+)?hours?|'
    r'between\s+\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\s*(?:and|-)\s*\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)))',
    re.IGNORECASE | re.DOTALL
)

def extract_work_hours(text: str) -> Optional[str]:
    m = WORK_HOURS_PATTERN.search(text)
    if m:
        # Return the matched context, cleaned up
        raw = m.group(0)
        # Trim to just the hours part
        hours_match = re.search(
            r'(?:after\s+\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)|'
            r'outside\s+(?:of\s+)?(?:normal|regular|core)\s+(?:business\s+)?hours?|'
            r'\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\s*(?:and|to|-)\s*'
            r'\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?))',
            raw, re.IGNORECASE
        )
        if hours_match:
            return hours_match.group(0).strip()
    return None


# ─────────────────────────────────────────────────────────────────
# DOCUMENT TYPE IDENTIFIER
# Confidence: HIGH — based on first non-empty line of each PDF
# ─────────────────────────────────────────────────────────────────

DOC_TYPE_PATTERNS = [
    (re.compile(r'performance\s+work\s+statement|statement\s+of\s+work|PWS|SOW', re.IGNORECASE), 'Statement of Work'),
    (re.compile(r'wage\s+determination|service\s+contract\s+act|davis.bacon', re.IGNORECASE), 'Wage Determination'),
    (re.compile(r'schedule\s+of\s+(?:items|prices)|price\s+schedule|bid\s+schedule', re.IGNORECASE), 'Price Schedule'),
    (re.compile(r'past\s+performance', re.IGNORECASE), 'Past Performance Form'),
    (re.compile(r'SOLICITATION.OFFER|SF.1449|REQUEST\s+FOR\s+(?:QUOTATION|PROPOSAL)', re.IGNORECASE), 'Solicitation Form (SF-1449)'),
    (re.compile(r'AMENDMENT\s+OF\s+SOLICITATION|MODIFICATION', re.IGNORECASE), 'Amendment/Modification'),
    (re.compile(r'QUALITY\s+ASSURANCE|QASP|surveillance\s+plan', re.IGNORECASE), 'Quality Assurance Plan'),
    (re.compile(r'section\s+[A-Z]\b', re.IGNORECASE), 'Contract Section'),
]

def identify_doc_type(first_text: str) -> str:
    for pattern, label in DOC_TYPE_PATTERNS:
        if pattern.search(first_text[:500]):
            return label
    return 'Solicitation Document'


# ─────────────────────────────────────────────────────────────────
# MASTER EXTRACTOR — run all extractors on combined PDF text
# Returns a dict of all deterministically-extracted fields
# ─────────────────────────────────────────────────────────────────

def extract_all(combined_pdf_text: str) -> dict:
    """
    Run all deterministic extractors on the combined text of all PDFs.
    Returns a dict — None values mean the pattern wasn't found.
    """
    return {
        'size_standard':       extract_size_standard(combined_pdf_text),
        'wage_floor':          extract_wage_floor(combined_pdf_text),
        'performance_address': extract_performance_address(combined_pdf_text),
        'clearance_required':  extract_clearance_required(combined_pdf_text),
        'sole_source':         extract_sole_source(combined_pdf_text),
        'award_basis':         extract_award_basis(combined_pdf_text),
        'contract_structure':  extract_contract_structure(combined_pdf_text),
        'estimated_value':     extract_estimated_value(combined_pdf_text),
        'work_hours':          extract_work_hours(combined_pdf_text),
    }


# ─────────────────────────────────────────────────────────────────
# QUICK TEST
# ─────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    import subprocess, sys

    # Test on a PDF we already downloaded
    test_pdfs = [
        '/tmp/wrnf_janitorial/doc_3.pdf',  # SF-1449
        '/tmp/wrnf_janitorial/doc_4.pdf',  # Wage determination
        '/tmp/wrnf_janitorial/doc_5.pdf',  # Statement of Work
        '/tmp/wrnf_janitorial/doc_6.pdf',  # Price Schedule
    ]
    combined = ''
    for p in test_pdfs:
        result = subprocess.run(['pdftotext', p, '-'], capture_output=True, text=True)
        if result.returncode == 0:
            combined += result.stdout

    print('=== DETERMINISTIC EXTRACTION TEST: WRNF Janitorial ===\n')
    results = extract_all(combined)
    for field, value in results.items():
        status = '✓' if value is not None and value is not False else '✗'
        print(f'  {status} {field}: {value}')

    print('\n=== DOC TYPE IDENTIFICATION ===')
    for p in test_pdfs:
        result = subprocess.run(['pdftotext', p, '-'], capture_output=True, text=True)
        first = (result.stdout or '').strip()[:200]
        print(f'  {p.split("/")[-1]}: {identify_doc_type(first)}')
