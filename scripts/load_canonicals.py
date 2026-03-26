#!/usr/bin/env python3
"""
load_canonicals.py — Populate canonical lookup tables

Loads:
  1. Geographies (states, territories, counties, places, military bases)
  2. Competition types (FAR 6.302)
  3. Set-aside types (SBA)
  4. Extent competed
  5. Solicitation procedures
  6. Commercial items (FAR Part 12)
  7. Subcontracting plans

USAGE:
  python3 scripts/load_canonicals.py --all
  python3 scripts/load_canonicals.py --geographies
  python3 scripts/load_canonicals.py --competition
"""

import os, sys, json, urllib.request, argparse
from pathlib import Path

# Load .env
ENV_PATH = Path(__file__).parent.parent / '.env'
if ENV_PATH.exists():
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, v = line.split('=', 1)
            os.environ.setdefault(k.strip(), v.strip())

import psycopg2
import psycopg2.extras

DATABASE_URL = os.environ.get('DATABASE_URL', '')

def db_connect():
    return psycopg2.connect(DATABASE_URL)


# ═══════════════════════════════════════════════════════════════════════════════
# GEOGRAPHIES
# ═══════════════════════════════════════════════════════════════════════════════

# US States and territories with FIPS codes
STATES = [
    ('01', 'AL', 'Alabama'),
    ('02', 'AK', 'Alaska'),
    ('04', 'AZ', 'Arizona'),
    ('05', 'AR', 'Arkansas'),
    ('06', 'CA', 'California'),
    ('08', 'CO', 'Colorado'),
    ('09', 'CT', 'Connecticut'),
    ('10', 'DE', 'Delaware'),
    ('11', 'DC', 'District of Columbia'),
    ('12', 'FL', 'Florida'),
    ('13', 'GA', 'Georgia'),
    ('15', 'HI', 'Hawaii'),
    ('16', 'ID', 'Idaho'),
    ('17', 'IL', 'Illinois'),
    ('18', 'IN', 'Indiana'),
    ('19', 'IA', 'Iowa'),
    ('20', 'KS', 'Kansas'),
    ('21', 'KY', 'Kentucky'),
    ('22', 'LA', 'Louisiana'),
    ('23', 'ME', 'Maine'),
    ('24', 'MD', 'Maryland'),
    ('25', 'MA', 'Massachusetts'),
    ('26', 'MI', 'Michigan'),
    ('27', 'MN', 'Minnesota'),
    ('28', 'MS', 'Mississippi'),
    ('29', 'MO', 'Missouri'),
    ('30', 'MT', 'Montana'),
    ('31', 'NE', 'Nebraska'),
    ('32', 'NV', 'Nevada'),
    ('33', 'NH', 'New Hampshire'),
    ('34', 'NJ', 'New Jersey'),
    ('35', 'NM', 'New Mexico'),
    ('36', 'NY', 'New York'),
    ('37', 'NC', 'North Carolina'),
    ('38', 'ND', 'North Dakota'),
    ('39', 'OH', 'Ohio'),
    ('40', 'OK', 'Oklahoma'),
    ('41', 'OR', 'Oregon'),
    ('42', 'PA', 'Pennsylvania'),
    ('44', 'RI', 'Rhode Island'),
    ('45', 'SC', 'South Carolina'),
    ('46', 'SD', 'South Dakota'),
    ('47', 'TN', 'Tennessee'),
    ('48', 'TX', 'Texas'),
    ('49', 'UT', 'Utah'),
    ('50', 'VT', 'Vermont'),
    ('51', 'VA', 'Virginia'),
    ('53', 'WA', 'Washington'),
    ('54', 'WV', 'West Virginia'),
    ('55', 'WI', 'Wisconsin'),
    ('56', 'WY', 'Wyoming'),
    # Territories
    ('60', 'AS', 'American Samoa'),
    ('66', 'GU', 'Guam'),
    ('69', 'MP', 'Northern Mariana Islands'),
    ('72', 'PR', 'Puerto Rico'),
    ('78', 'VI', 'U.S. Virgin Islands'),
]

# Major military installations (subset - top bases by personnel)
MILITARY_BASES = [
    ('mil-ftliberty', 'NC', 'Fort Liberty', 35.139, -79.006),  # Formerly Fort Bragg
    ('mil-fthood', 'TX', 'Fort Cavazos', 31.138, -97.775),  # Formerly Fort Hood
    ('mil-jblewis', 'WA', 'Joint Base Lewis-McChord', 47.107, -122.553),
    ('mil-ftcampbell', 'KY', 'Fort Campbell', 36.663, -87.475),
    ('mil-ftbenning', 'GA', 'Fort Moore', 32.359, -84.955),  # Formerly Fort Benning
    ('mil-ftcarson', 'CO', 'Fort Carson', 38.737, -104.788),
    ('mil-ftbliss', 'TX', 'Fort Bliss', 31.842, -106.380),
    ('mil-ftsill', 'OK', 'Fort Sill', 34.650, -98.400),
    ('mil-ftdrum', 'NY', 'Fort Drum', 44.055, -75.758),
    ('mil-ftstewart', 'GA', 'Fort Stewart', 31.869, -81.612),
    ('mil-norfolk', 'VA', 'Naval Station Norfolk', 36.946, -76.303),
    ('mil-sandiego', 'CA', 'Naval Base San Diego', 32.684, -117.129),
    ('mil-pendleton', 'CA', 'Camp Pendleton', 33.388, -117.565),
    ('mil-lejeune', 'NC', 'Camp Lejeune', 34.733, -77.440),
    ('mil-twentynine', 'CA', 'Twentynine Palms', 34.238, -116.051),
    ('mil-lackland', 'TX', 'Joint Base San Antonio-Lackland', 29.384, -98.618),
    ('mil-wright', 'OH', 'Wright-Patterson AFB', 39.826, -84.048),
    ('mil-eglin', 'FL', 'Eglin AFB', 30.464, -86.525),
    ('mil-hill', 'UT', 'Hill AFB', 41.124, -111.966),
    ('mil-travis', 'CA', 'Travis AFB', 38.263, -121.927),
    ('mil-tinker', 'OK', 'Tinker AFB', 35.415, -97.396),
    ('mil-robins', 'GA', 'Robins AFB', 32.640, -83.592),
    ('mil-andrews', 'MD', 'Joint Base Andrews', 38.811, -76.867),
    ('mil-bolling', 'DC', 'Joint Base Anacostia-Bolling', 38.842, -77.013),
    ('mil-pentagon', 'VA', 'The Pentagon', 38.871, -77.056),
    ('mil-quantico', 'VA', 'Marine Corps Base Quantico', 38.522, -77.318),
    ('mil-coronado', 'CA', 'Naval Amphibious Base Coronado', 32.677, -117.170),
    ('mil-kings', 'GA', 'Naval Submarine Base Kings Bay', 30.796, -81.515),
    ('mil-groton', 'CT', 'Naval Submarine Base New London', 41.388, -72.090),
    ('mil-pearl', 'HI', 'Joint Base Pearl Harbor-Hickam', 21.347, -157.943),
]


def load_geographies():
    """Load states, territories, and military bases."""
    print("\n=== Loading Geographies ===")

    conn = db_connect()
    cur = conn.cursor()

    # Load states and territories
    for fips, abbr, name in STATES:
        geo_type = 'territory' if fips in ('60', '66', '69', '72', '78') else 'state'
        if fips == '11':
            geo_type = 'district'  # DC
        cur.execute("""
            INSERT INTO geographies (fips_code, name, type, state_abbr, state_fips)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (fips_code) DO UPDATE SET
                name = EXCLUDED.name,
                type = EXCLUDED.type,
                state_abbr = EXCLUDED.state_abbr
        """, [fips, name, geo_type, abbr, fips])

    print(f"  Loaded {len(STATES)} states/territories")

    # Load military bases
    for fips, state, name, lat, lng in MILITARY_BASES:
        cur.execute("""
            INSERT INTO geographies (fips_code, name, type, state_abbr, lat, lng)
            VALUES (%s, %s, 'military_base', %s, %s, %s)
            ON CONFLICT (fips_code) DO UPDATE SET
                name = EXCLUDED.name,
                state_abbr = EXCLUDED.state_abbr,
                lat = EXCLUDED.lat,
                lng = EXCLUDED.lng
        """, [fips, name, state, lat, lng])

    print(f"  Loaded {len(MILITARY_BASES)} military bases")

    conn.commit()

    # Fetch counties from Census API
    print("  Fetching counties from Census Bureau...")
    try:
        url = 'https://api.census.gov/data/2020/dec/pl?get=NAME&for=county:*'
        req = urllib.request.Request(url, headers={'User-Agent': 'Awardopedia/1.0'})
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.loads(r.read())

        # Skip header row
        counties = data[1:]
        for row in counties:
            name, state_fips, county_fips = row[0], row[1], row[2]
            fips_code = f"{state_fips}{county_fips}"
            # Find state abbr
            state_abbr = next((s[1] for s in STATES if s[0] == state_fips), None)

            cur.execute("""
                INSERT INTO geographies (fips_code, name, type, parent_fips, state_abbr, state_fips)
                VALUES (%s, %s, 'county', %s, %s, %s)
                ON CONFLICT (fips_code) DO UPDATE SET
                    name = EXCLUDED.name,
                    parent_fips = EXCLUDED.parent_fips,
                    state_abbr = EXCLUDED.state_abbr
            """, [fips_code, name, state_fips, state_abbr, state_fips])

        print(f"  Loaded {len(counties)} counties")
    except Exception as e:
        print(f"  Warning: Could not fetch counties: {e}")

    conn.commit()
    conn.close()
    print("  Geographies complete")


# ═══════════════════════════════════════════════════════════════════════════════
# COMPETITION CANONICALS
# ═══════════════════════════════════════════════════════════════════════════════

SET_ASIDE_TYPES = [
    ('NO SET ASIDE USED.', 'No Set-Aside',
     'Open competition — any business, large or small, can bid on this contract.', 1),
    ('SMALL BUSINESS SET ASIDE - TOTAL', 'Small Business Set-Aside (Total)',
     'Only small businesses can compete. The entire contract is reserved for small business.', 10),
    ('SMALL BUSINESS SET ASIDE - PARTIAL', 'Small Business Set-Aside (Partial)',
     'Part of this contract is reserved for small businesses; the rest is open.', 11),
    ('8(A) SOLE SOURCE', '8(a) Sole Source',
     'Awarded directly to an 8(a) certified minority-owned business without competition. The 8(a) program helps socially and economically disadvantaged entrepreneurs.', 20),
    ('8A COMPETED', '8(a) Competed',
     'Competition limited to 8(a) certified minority-owned businesses only.', 21),
    ('SERVICE DISABLED VETERAN OWNED SMALL BUSINESS SET-ASIDE', 'SDVOSB Set-Aside',
     'Reserved for service-disabled veteran-owned small businesses. Veterans with service-connected disabilities of 10% or more.', 30),
    ('SDVOSB SOLE SOURCE', 'SDVOSB Sole Source',
     'Awarded directly to a service-disabled veteran-owned business without competition.', 31),
    ('HUBZONE SET-ASIDE', 'HUBZone Set-Aside',
     'Reserved for businesses in Historically Underutilized Business Zones — economically distressed areas the government wants to help develop.', 40),
    ('WOMEN OWNED SMALL BUSINESS', 'Women-Owned Small Business',
     'Reserved for women-owned small businesses (at least 51% owned/controlled by women).', 50),
    ('WOMEN OWNED SMALL BUSINESS SOLE SOURCE', 'WOSB Sole Source',
     'Awarded directly to a women-owned small business without competition.', 51),
]

COMPETITION_TYPES = [
    ('ONLY ONE SOURCE-OTHER (FAR 6.302-1 OTHER)', 'Only One Source',
     'No other supplier can provide this item or service. Used for unique patents, proprietary technology, or exclusive capabilities that only one company has.',
     'FAR 6.302-1', 10),
    ('UNIQUE SOURCE (FAR 6.302-1(B)(1))', 'Unique Source',
     'Only one company has the unique expertise, equipment, or capability to do this work.',
     'FAR 6.302-1(b)(1)', 11),
    ('PATENT OR DATA RIGHTS (FAR 6.302-1(B)(2))', 'Patent/Data Rights',
     'Only one company holds the patents or proprietary data rights needed for this work.',
     'FAR 6.302-1(b)(2)', 12),
    ('UTILITIES (FAR 6.302-1(B)(3))', 'Utilities',
     'Utility services (power, water, gas) where only one provider serves the location.',
     'FAR 6.302-1(b)(3)', 13),
    ('BRAND NAME DESCRIPTION (FAR 6.302-1(C))', 'Brand Name Only',
     'A specific brand is required for compatibility or standardization — but you may still compete if you can supply that brand.',
     'FAR 6.302-1(c)', 14),
    ('FOLLOW-ON CONTRACT (FAR 6.302-1(A)(2)(II/III))', 'Follow-On Contract',
     'Continuation of existing work where switching contractors would cause unacceptable delays or costs.',
     'FAR 6.302-1(a)(2)', 15),
    ('URGENCY (FAR 6.302-2)', 'Urgency',
     'An unusual and compelling emergency won\'t allow time for competitive bidding. Common during disasters, military operations, or critical system failures.',
     'FAR 6.302-2', 20),
    ('MOBILIZATION, ESSENTIAL R&D (FAR 6.302-3)', 'Industrial Mobilization',
     'Needed to keep essential suppliers in business for national defense, or for critical R&D capabilities.',
     'FAR 6.302-3', 30),
    ('INTERNATIONAL AGREEMENT (FAR 6.302-4)', 'International Agreement',
     'Required by treaty or agreement with another country.',
     'FAR 6.302-4', 40),
    ('AUTHORIZED BY STATUTE (FAR 6.302-5(A)(2)(I))', 'Authorized by Statute',
     'Congress specifically authorized this sole-source award in legislation.',
     'FAR 6.302-5', 50),
    ('AUTHORIZED RESALE (FAR 6.302-5(A)(2)(II))', 'Authorized Resale',
     'Purchase from an authorized reseller as required by statute.',
     'FAR 6.302-5(a)(2)(ii)', 51),
    ('NATIONAL SECURITY (FAR 6.302-6)', 'National Security',
     'Disclosure of the agency\'s needs would compromise national security.',
     'FAR 6.302-6', 60),
    ('PUBLIC INTEREST (FAR 6.302-7)', 'Public Interest',
     'The head of the agency has determined that full competition is not in the public interest. Rarely used; requires high-level approval.',
     'FAR 6.302-7', 70),
    ('SAP NON-COMPETITION (FAR 13)', 'Simplified Acquisition',
     'Under the simplified acquisition threshold (~$250K), agencies can use streamlined procedures.',
     'FAR 13', 80),
]

EXTENT_COMPETED = [
    ('FULL AND OPEN COMPETITION', 'Full & Open Competition',
     'Anyone can bid — the most competitive type of procurement. Best chance for new vendors.', 1),
    ('FULL AND OPEN COMPETITION AFTER EXCLUSION OF SOURCES', 'Full & Open (After Exclusions)',
     'Open competition, but certain sources were excluded (e.g., for security reasons or because they were previously found non-responsible).', 2),
    ('NOT COMPETED', 'Not Competed',
     'No competition — awarded to a single source. Usually requires special justification under FAR 6.302.', 10),
    ('NOT AVAILABLE FOR COMPETITION', 'Not Available for Competition',
     'Competition is not possible due to the nature of the requirement (e.g., utilities, international agreements).', 11),
    ('COMPETED UNDER SAP', 'Competed (Simplified)',
     'Competed using simplified acquisition procedures — typically for smaller purchases under ~$250K.', 20),
    ('NOT COMPETED UNDER SAP', 'Not Competed (Simplified)',
     'Not competed, but used simplified acquisition procedures for a small purchase.', 21),
]

SOLICITATION_PROCEDURES = [
    ('NEGOTIATED PROPOSAL/QUOTE', 'Negotiated',
     'The government evaluates proposals based on multiple factors (price, technical approach, past performance) and may negotiate with offerors. Most common for complex services.', 1),
    ('SEALED BID', 'Sealed Bid',
     'Lowest price wins. Bids are opened publicly at a set time. Used when requirements are clear and price is the main factor.', 2),
    ('SUBJECT TO MULTIPLE AWARD FAIR OPPORTUNITY', 'Multiple Award Fair Opportunity',
     'Competition among holders of an existing contract vehicle (like an IDIQ or GSA Schedule). If you\'re not already on the vehicle, you can\'t compete.', 10),
    ('ONLY ONE SOURCE', 'Only One Source',
     'Sole source — no solicitation procedures because only one vendor was invited.', 20),
    ('SIMPLIFIED ACQUISITION', 'Simplified Acquisition',
     'Streamlined procedures for purchases under ~$250K. Less paperwork, faster awards.', 30),
    ('TWO STEP', 'Two-Step',
     'First step evaluates technical proposals (no price), second step gets prices from technically acceptable offerors.', 40),
    ('BASIC RESEARCH', 'Basic Research',
     'Special procedures for fundamental research contracts, often with universities.', 50),
    ('ARCHITECT-ENGINEER FAR 6.102', 'Architect-Engineer',
     'Special qualification-based selection for architecture and engineering services. Price is negotiated after selection.', 60),
    ('ALTERNATIVE SOURCES', 'Alternative Sources',
     'Seeking multiple sources for items that currently have only one supplier.', 70),
]

COMMERCIAL_ITEMS = [
    ('COMMERCIAL PRODUCTS/SERVICES', 'Commercial',
     'Commercially available products or services sold to the general public. Streamlined acquisition rules apply — less government-specific paperwork.', 1),
    ('COMMERCIAL ITEM', 'Commercial Item',
     'Same as Commercial Products/Services — older terminology.', 2),
    ('COMMERCIAL PRODUCTS/SERVICES PROCEDURES NOT USED', 'Not Commercial',
     'Custom-built for the government, not commercially available. More complex acquisition rules apply.', 10),
    ('COMMERCIAL ITEM PROCEDURES NOT USED', 'Not Commercial (Legacy)',
     'Same as above — older terminology.', 11),
    ('PRODUCTS OR SERVICES PURSUANT TO FAR 12.102(F)', 'Commercial (12.102(f))',
     'Treated as commercial under special authority in FAR 12.102(f).', 20),
    ('SERVICES PURSUANT TO FAR 12.102(G)', 'Services (12.102(g))',
     'Non-commercial services acquired using commercial procedures under FAR 12.102(g).', 21),
    ('DOD - SECTION 803 CSO PROCEDURES', 'DoD Commercial Solutions',
     'Defense Department special commercial procurement authority under Section 803.', 30),
]

SUBCONTRACTING_PLANS = [
    ('PLAN NOT REQUIRED', 'Not Required',
     'Subcontracting plan not required — typically because the prime contractor is a small business or the contract is below the threshold.', 1),
    ('PLAN NOT INCLUDED - NO SUBCONTRACTING POSSIBILITIES', 'No Subcontracting',
     'The contractor will perform all work themselves with no subcontractors.', 2),
    ('INDIVIDUAL SUBCONTRACT PLAN', 'Individual Plan',
     'The contractor submitted a plan showing what portion of work will go to small business subcontractors. Standard for large contracts.', 10),
    ('DOD COMPREHENSIVE SUBCONTRACT PLAN', 'DoD Comprehensive Plan',
     'A company-wide subcontracting plan approved by DoD, covering all their defense contracts.', 11),
    ('COMMERCIAL SUBCONTRACT PLAN', 'Commercial Plan',
     'A company-wide plan covering all government and commercial contracts — approved for companies doing mostly commercial work.', 12),
    ('PLAN REQUIRED - INCENTIVE NOT INCLUDED', 'Required (No Incentive)',
     'Subcontracting plan is required but there\'s no financial incentive tied to meeting small business goals.', 20),
    ('PLAN REQUIRED - INCENTIVE INCLUDED', 'Required (With Incentive)',
     'Subcontracting plan required with financial incentives for exceeding small business subcontracting goals.', 21),
]


def load_competition_canonicals():
    """Load all competition-related canonical tables."""
    print("\n=== Loading Competition Canonicals ===")

    conn = db_connect()
    cur = conn.cursor()

    # Set-Aside Types
    for code, display, desc, sort in SET_ASIDE_TYPES:
        cur.execute("""
            INSERT INTO set_aside_types (code, display_name, description, sort_order)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (code) DO UPDATE SET
                display_name = EXCLUDED.display_name,
                description = EXCLUDED.description,
                sort_order = EXCLUDED.sort_order
        """, [code, display, desc, sort])
    print(f"  Loaded {len(SET_ASIDE_TYPES)} set-aside types")

    # Competition Types
    for code, display, desc, far, sort in COMPETITION_TYPES:
        cur.execute("""
            INSERT INTO competition_types (code, display_name, description, far_reference, sort_order)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (code) DO UPDATE SET
                display_name = EXCLUDED.display_name,
                description = EXCLUDED.description,
                far_reference = EXCLUDED.far_reference,
                sort_order = EXCLUDED.sort_order
        """, [code, display, desc, far, sort])
    print(f"  Loaded {len(COMPETITION_TYPES)} competition types")

    # Extent Competed
    for code, display, desc, sort in EXTENT_COMPETED:
        cur.execute("""
            INSERT INTO extent_competed (code, display_name, description, sort_order)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (code) DO UPDATE SET
                display_name = EXCLUDED.display_name,
                description = EXCLUDED.description,
                sort_order = EXCLUDED.sort_order
        """, [code, display, desc, sort])
    print(f"  Loaded {len(EXTENT_COMPETED)} extent competed values")

    # Solicitation Procedures
    for code, display, desc, sort in SOLICITATION_PROCEDURES:
        cur.execute("""
            INSERT INTO solicitation_procedures (code, display_name, description, sort_order)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (code) DO UPDATE SET
                display_name = EXCLUDED.display_name,
                description = EXCLUDED.description,
                sort_order = EXCLUDED.sort_order
        """, [code, display, desc, sort])
    print(f"  Loaded {len(SOLICITATION_PROCEDURES)} solicitation procedures")

    # Commercial Items
    for code, display, desc, sort in COMMERCIAL_ITEMS:
        cur.execute("""
            INSERT INTO commercial_items (code, display_name, description, sort_order)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (code) DO UPDATE SET
                display_name = EXCLUDED.display_name,
                description = EXCLUDED.description,
                sort_order = EXCLUDED.sort_order
        """, [code, display, desc, sort])
    print(f"  Loaded {len(COMMERCIAL_ITEMS)} commercial item types")

    # Subcontracting Plans
    for code, display, desc, sort in SUBCONTRACTING_PLANS:
        cur.execute("""
            INSERT INTO subcontracting_plans (code, display_name, description, sort_order)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (code) DO UPDATE SET
                display_name = EXCLUDED.display_name,
                description = EXCLUDED.description,
                sort_order = EXCLUDED.sort_order
        """, [code, display, desc, sort])
    print(f"  Loaded {len(SUBCONTRACTING_PLANS)} subcontracting plan types")

    conn.commit()
    conn.close()
    print("  Competition canonicals complete")


# ═══════════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(description='Load canonical lookup tables')
    parser.add_argument('--all', action='store_true', help='Load all canonicals')
    parser.add_argument('--geographies', action='store_true', help='Load geographies only')
    parser.add_argument('--competition', action='store_true', help='Load competition tables only')
    args = parser.parse_args()

    if args.all or args.geographies:
        load_geographies()

    if args.all or args.competition:
        load_competition_canonicals()

    if not any([args.all, args.geographies, args.competition]):
        print("Usage: python3 load_canonicals.py --all|--geographies|--competition")
        sys.exit(1)

    print("\n=== CANONICAL LOAD COMPLETE ===")


if __name__ == '__main__':
    main()
