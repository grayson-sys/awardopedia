import { useState, useEffect } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LabelList } from 'recharts'
import InfoIcon from '../components/InfoIcon'

// Subcontracting info for major prime contractors
// Research source: official company supplier/subcontractor portals (verified March 2026)
const SUBCONTRACTING_INFO = {
  'OPTUM PUBLIC SECTOR SOLUTIONS, INC.': {
    description: "America's largest healthcare services company, delivering technology and data solutions that help federal agencies serve millions of beneficiaries.",
    url: 'https://www.unitedhealthgroup.com/suppliers.html',
    portal: 'UnitedHealth Group Supplier Portal',
    email: null,
    tips: [
      'Register via UnitedHealth Group supplier portal',
      'Healthcare IT and analytics focus',
      'CMS and VA are major customers',
      'Technology and services subcontracting opportunities',
    ]
  },
  'MCKESSON CORPORATION': {
    description: "The nation's leading pharmaceutical distributor, ensuring critical medications reach VA hospitals, military bases, and federal health facilities nationwide.",
    url: 'https://www.mckesson.com/supplierdiversity/',
    portal: 'STARS Supplier Portal',
    email: null,
    tips: [
      'Register in STARS portal at mckesson.starssmp.com',
      'Healthcare and pharmaceutical distribution focus',
      'VA and DoD health contracts',
      'Supplier diversity program for small businesses',
    ]
  },
  'THE BOEING COMPANY': {
    description: "An American icon in aerospace, Boeing builds the aircraft, satellites, and defense systems that project American power and connect the world.",
    url: 'https://www.boeingsuppliers.com/become',
    portal: 'Boeing Supplier Portal (via Exostar)',
    email: 'boeingassessment@boeing.com',
    tips: [
      'Email boeingassessment@boeing.com for supplier assessment',
      'Requires Exostar MAG account and OTP token',
      'ISO 9001/AS9100 certification required for most work',
      'Strong supplier diversity program for SDB/WOSB/VOSB',
    ]
  },
  'TRIWEST HEALTHCARE ALLIANCE CORP': {
    description: "A veteran-focused healthcare administrator that connects millions of military families and veterans with quality care through the TRICARE program.",
    url: 'https://www.triwest.com/en/about-us/',
    portal: 'TriWest Provider Portal',
    email: null,
    tips: [
      'Healthcare administration and network management',
      'TRICARE West Region administrator',
      'Provider network and claims processing focus',
    ]
  },
  'RAYTHEON COMPANY': {
    description: "A defense technology powerhouse delivering the precision missiles, radar systems, and cybersecurity solutions that keep America safe.",
    url: 'https://www.rtx.com/suppliers',
    portal: 'RTX Supplier Portal',
    email: null,
    tips: [
      'Register in RTX Supplier Portal',
      'Mentor-Protege program for qualified small businesses',
      'Regional supplier development events throughout year',
    ]
  },
  'RTX CORPORATION': {
    description: "The aerospace and defense giant formed from Raytheon and UTC, powering everything from jet engines to missile defense systems.",
    url: 'https://www.rtx.com/suppliers',
    portal: 'RTX Supplier Portal',
    email: null,
    tips: [
      'Register in RTX Supplier Portal',
      'Combined Raytheon + Collins + Pratt & Whitney opportunities',
    ]
  },
  'LOCKHEED MARTIN CORPORATION': {
    description: "The world's largest defense contractor, building the F-35, space systems, and advanced technologies that define American military superiority.",
    url: 'https://www.lockheedmartin.com/en-us/suppliers.html',
    portal: 'Exostar Partner Network',
    email: 'supplier.council@lmco.com',
    tips: [
      'Register in Exostar portal (required for all suppliers)',
      'Must have CAGE code and active SAM registration',
      'Small Business Liaison Officers in each business area',
      'Annual Small Business Conference — watch for invites',
    ]
  },
  'LOCKHEED MARTIN CORP': {
    description: "The world's largest defense contractor, building the F-35, space systems, and advanced technologies that define American military superiority.",
    url: 'https://www.lockheedmartin.com/en-us/suppliers.html',
    portal: 'Exostar Partner Network',
    email: 'supplier.council@lmco.com',
    tips: [
      'Register in Exostar portal (required for all suppliers)',
      'Must have CAGE code and active SAM registration',
    ]
  },
  'NORTHROP GRUMMAN SYSTEMS CORPORATION': {
    description: "A leader in autonomous systems, cyber, and space technology, building the B-21 stealth bomber and next-generation defense capabilities.",
    url: 'https://www.northropgrumman.com/suppliers',
    portal: 'Supplier Portal',
    email: 'supplierdiversity@ngc.com',
    tips: [
      'Register in Northrop Grumman Supplier Portal',
      'Strong small business goals — actively recruiting',
      'Focus areas: cybersecurity, space systems, autonomous',
    ]
  },
  'NORTHROP GRUMMAN SYSTEMS CORP': {
    description: "A leader in autonomous systems, cyber, and space technology, building the B-21 stealth bomber and next-generation defense capabilities.",
    url: 'https://www.northropgrumman.com/suppliers',
    portal: 'Supplier Portal',
    email: 'supplierdiversity@ngc.com',
    tips: [
      'Register in Northrop Grumman Supplier Portal',
      'Strong small business goals — actively recruiting',
    ]
  },
  'BOOZ ALLEN HAMILTON INC': {
    description: "The trusted advisor to government agencies for over a century, delivering management consulting, technology, and analytics that solve the nation's toughest challenges.",
    url: 'https://www.boozallen.com/menu/suppliers-and-small-businesses.html',
    portal: 'Booz Allen Supplier Portal',
    email: null,
    tips: [
      'Over $1B subcontracted annually, 66%+ to small business',
      'IT services, consulting, analytics focus',
      'Teaming arrangements common on large task orders',
      'Check GovWin for recompetes where BAH is incumbent',
    ]
  },
  'LEIDOS, INC.': {
    description: "A science and technology leader delivering IT, engineering, and biomedical solutions that advance national security and improve lives.",
    url: 'https://www.leidos.com/suppliers',
    portal: 'Leidos Supplier Portal',
    email: null,
    tips: [
      '$2.8B dedicated to small and diverse suppliers',
      'Health, defense, and civil markets',
      'Matchmaking forums connect you to program managers',
      'Subcontracting opportunities on major IDIQ vehicles',
    ]
  },
  'GENERAL DYNAMICS INFORMATION TECHNOLOGY, INC.': {
    description: "A leading IT services provider transforming how federal agencies operate through cloud, AI, and next-generation infrastructure.",
    url: 'https://www.gdit.com/suppliers/',
    portal: 'GDIT Supplier Portal',
    email: 'smallbusiness@gdit.com',
    tips: [
      'IT services focus — cloud, cyber, AI',
      'Small business goals on all major contracts',
      'Supplier diversity events and matchmaking sessions',
    ]
  },
  'SCIENCE APPLICATIONS INTERNATIONAL CORPORATION': {
    description: "SAIC brings bold ideas to life, delivering IT modernization and engineering solutions that help agencies achieve their missions.",
    url: 'https://www.saic.com/who-we-are/small-business',
    portal: 'SAIC Supplier Portal',
    email: 'smallbusiness@saic.com',
    tips: [
      'Defense, space, and civilian IT services',
      'Active mentor-protege program',
      'Subcontracting on major task orders',
    ]
  },
  'ACCENTURE FEDERAL SERVICES LLC': {
    description: "A global consulting powerhouse helping federal agencies modernize operations, embrace cloud, and harness the power of AI.",
    url: 'https://www.accenture.com/us-en/about/company/supplier-inclusion-diversity',
    portal: 'Accenture Supplier Portal',
    email: null,
    tips: [
      'IT modernization and consulting focus',
      'Cloud and AI transformation projects',
      'Diverse supplier program',
    ]
  },
  'DELOITTE CONSULTING LLP': {
    description: "One of the Big Four, Deloitte brings world-class consulting expertise to help federal agencies transform and deliver results.",
    url: 'https://www2.deloitte.com/us/en/pages/about-deloitte/articles/supplier-diversity.html',
    portal: 'Ariba Network',
    email: null,
    tips: [
      'Consulting and IT services',
      'Teaming on large advisory contracts',
      'Supplier diversity initiatives',
    ]
  },
}

// Defense Tech Startup info - researched March 2026
// Keys use consolidated names that match the server query (PALANTIR, ANDURIL, etc.)
const DEFENSE_TECH_INFO = {
  'ANDURIL': {
    description: "The fastest-growing defense startup in history, Anduril is building the autonomous systems and AI-powered weapons that will define 21st-century warfare.",
    isPublic: false,
    valuation: '$60 billion (March 2026)',
    revenue: '$2.1B (2025), projecting $4.3B (2026)',
    focus: 'Autonomous systems, counter-drone, AI/ML defense',
    products: 'Lattice AI platform, Ghost drones, Roadrunner, Sentry Towers',
    hq: 'Costa Mesa, CA',
    founded: 2017,
    url: 'https://www.anduril.com/careers/',
    tips: [
      'Anduril builds most hardware in-house but needs component suppliers',
      'Focus on: sensors, propulsion, communications, power systems',
      'Check their Arsenal-1 Ohio facility for manufacturing partnerships',
      'Software integration partners for Lattice ecosystem',
      'Attend AUSA and SOF Week where they exhibit',
    ]
  },
  'PALANTIR': {
    description: "The data company that helped find Bin Laden, Palantir's AI platforms are transforming how government agencies make decisions and fight adversaries.",
    isPublic: true,
    ticker: 'PLTR',
    stockPrice: '$157 (March 2026)',
    marketCap: '$350B+',
    revenue: '$2.9B (2025), guiding $7.2B (2026)',
    focus: 'AI/ML platforms, data analytics, decision support',
    products: 'Gotham (government), Foundry (commercial), AIP (AI platform)',
    hq: 'Denver, CO',
    founded: 2003,
    url: 'https://www.palantir.com/partnerships/',
    tips: [
      'Palantir integrates with existing systems — they need data connectors',
      'Implementation partners for specific agency deployments',
      'Training and support subcontractors for field deployments',
      'Domain expertise partners (healthcare, logistics, intel)',
      'Check their Forward Deployed Engineers program',
    ]
  },
  'SHIELD AI': {
    description: "Building the world's best AI pilot, Shield AI is creating autonomous aircraft that can fly and fight without GPS or human control.",
    isPublic: false,
    valuation: '$5.6 billion (2025)',
    revenue: '$300M (2025)',
    focus: 'Autonomous drones, AI pilots',
    products: 'Hivemind AI, V-BAT drone, Nova quadcopter',
    hq: 'San Diego, CA',
    founded: 2015,
    url: 'https://shield.ai/careers/',
    tips: [
      'Shield AI needs avionics and sensor suppliers',
      'Manufacturing partners for drone production scale-up',
      'AI/ML training data and simulation partners',
      'Field service and maintenance support',
      'Attend AUVSI XPONENTIAL where they present',
    ]
  },
  'SKYDIO': {
    description: "America's leading drone manufacturer, Skydio builds the autonomous aircraft trusted by every branch of the military and hundreds of public safety agencies.",
    isPublic: false,
    valuation: '$2.2 billion',
    revenue: '$1.2B in bookings (defense focus since 2023)',
    focus: 'Autonomous drones, computer vision',
    products: 'Skydio X10, Skydio 3D Scan, Autonomy Enterprise',
    hq: 'San Mateo, CA',
    founded: 2014,
    url: 'https://pages.skydio.com/partner-contact-us.html',
    tips: [
      'Skydio has a formal partner program with 44+ integrations',
      'Integration partners for enterprise software',
      'Reseller/distribution opportunities',
      'Training and certification partners',
      'Inspection and survey workflow partners',
    ]
  },
  'EPIRUS': {
    isPublic: false,
    valuation: '$1.35 billion',
    focus: 'Directed energy weapons, counter-drone',
    products: 'Leonidas HPM (high-power microwave)',
    hq: 'Torrance, CA',
    founded: 2018,
    url: 'https://www.epirusinc.com/',
    tips: [
      'Epirus needs power systems and thermal management',
      'Electronics and RF component suppliers',
      'System integration partners',
      'Field deployment and maintenance support',
    ]
  },
  'HERMEUS': {
    isPublic: false,
    valuation: 'Undisclosed (backed by Khosla, a]6z)',
    focus: 'Hypersonic aircraft',
    products: 'Quarterhorse (Mach 5+ aircraft)',
    hq: 'Atlanta, GA',
    founded: 2018,
    url: 'https://www.hermeus.com/',
    tips: [
      'Hypersonic propulsion component suppliers',
      'Advanced materials (thermal protection)',
      'Avionics and flight control systems',
      'Test and simulation partners',
    ]
  },
  'SARONIC': {
    isPublic: false,
    valuation: '$4 billion (seeking $7.5B at next round)',
    revenue: '$400M projected (2025)',
    focus: 'Autonomous maritime vessels',
    products: 'Corsair USV, autonomous surface vessels',
    hq: 'Austin, TX',
    founded: 2022,
    url: 'https://saronic.com/',
    tips: [
      'Naval systems and maritime sensors',
      'Propulsion and power systems',
      'Communications and C2 integration',
      'Manufacturing and shipyard partnerships',
    ]
  },
  'CHAOS': {
    isPublic: false,
    valuation: '$4.5 billion (2025)',
    focus: 'Counter-drone radar systems',
    products: 'Vanquish radar (detects small UAS)',
    hq: 'Not disclosed',
    founded: 2022,
    url: null,
    tips: [
      'Radar and RF technology suppliers',
      'Signal processing and AI/ML partners',
      'Integration with existing air defense systems',
      'Field deployment support',
    ]
  },
}

// Default subcontracting info for companies not in our database
const DEFAULT_SUBCONTRACTING = {
  tips: [
    'Search for company name + "supplier portal" or "small business"',
    'Look up their recent contract awards to understand their work',
    'Attend industry days where they present as prime',
    'Network at NCMA, NDIA, and PSC events',
  ]
}

// Normalize company name for matching (strip suffixes, uppercase)
function normalizeCompanyName(name) {
  if (!name) return ''
  return name.toUpperCase()
    .replace(/,?\s*(INC\.?|LLC|CORP\.?|CORPORATION|COMPANY|CO\.?|LTD\.?|L\.?L\.?C\.?|INCORPORATED)\.?\s*$/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Find best match in SUBCONTRACTING_INFO
function findSubcontractInfo(company) {
  if (!company) return DEFAULT_SUBCONTRACTING

  // Try exact match first
  if (SUBCONTRACTING_INFO[company]) return SUBCONTRACTING_INFO[company]

  // Try normalized match
  const normalized = normalizeCompanyName(company)
  for (const [key, info] of Object.entries(SUBCONTRACTING_INFO)) {
    if (normalizeCompanyName(key) === normalized) return info
  }

  // Try partial match (company name contains key or vice versa)
  for (const [key, info] of Object.entries(SUBCONTRACTING_INFO)) {
    const keyNorm = normalizeCompanyName(key)
    if (normalized.includes(keyNorm) || keyNorm.includes(normalized)) return info
  }

  return DEFAULT_SUBCONTRACTING
}

// Find best match in DEFENSE_TECH_INFO
function findDefenseTechInfo(company) {
  if (!company) return {}

  // Try exact match first
  if (DEFENSE_TECH_INFO[company]) return DEFENSE_TECH_INFO[company]

  // Try case-insensitive match
  const upper = company.toUpperCase()
  for (const [key, info] of Object.entries(DEFENSE_TECH_INFO)) {
    if (key.toUpperCase() === upper) return info
  }

  // Try partial match
  for (const [key, info] of Object.entries(DEFENSE_TECH_INFO)) {
    if (upper.includes(key.toUpperCase()) || key.toUpperCase().includes(upper)) return info
  }

  return {}
}

function formatDollars(n) {
  if (n >= 1e12) return `$${(n/1e12).toFixed(1)} trillion`
  if (n >= 1e9) return `$${(n/1e9).toFixed(1)} billion`
  if (n >= 1e6) return `$${Math.round(n/1e6)} million`
  if (n >= 1e3) return `$${Math.round(n/1e3)}K`
  return `$${n.toLocaleString()}`
}

function truncateName(name, max = 30) {
  if (!name) return ''
  if (name.length <= max) return name
  return name.slice(0, max-1) + '…'
}

const CHART_COLORS = ['#1B3A6B', '#2D5A9B', '#4A7CC7', '#6B9BE0', '#8DBBF5', '#AFD4FF', '#C5E1FF', '#DDEEFF', '#EEF6FF', '#F5FAFF']
const SMALL_BIZ_COLORS = ['#E9A820', '#F0B840', '#F5C860', '#F8D880', '#FAE8A0', '#FCF2C0', '#FEF9E0', '#FFFCF0']
const DEFENSE_TECH_COLORS = ['#10B981', '#34D399', '#6EE7B7', '#A7F3D0', '#D1FAE5']

function SubcontractingModal({ company, onClose }) {
  const info = findSubcontractInfo(company)

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: '#fff', borderRadius: 12, padding: 24, maxWidth: 500, width: '90%', maxHeight: '80vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 16 }}>
          <h3 style={{ margin: 0, color: '#1B3A6B', fontSize: 18 }}>How to Subcontract With</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', color: '#6B7280' }}>×</button>
        </div>

        <h4 style={{ margin: '0 0 8px', color: '#374151', fontSize: 16 }}>{company}</h4>

        {info.description && (
          <p style={{ margin: '0 0 16px', color: '#6B7280', fontSize: 14, fontStyle: 'italic' }}>{info.description}</p>
        )}

        {info.url && (
          <div style={{ marginBottom: 16 }}>
            <strong style={{ color: '#1B3A6B' }}>Supplier Portal:</strong>{' '}
            <a href={info.url} target="_blank" rel="noopener noreferrer" style={{ color: '#2D5A9B' }}>
              {info.portal || 'Visit Portal'}
            </a>
          </div>
        )}

        {info.email && (
          <div style={{ marginBottom: 16 }}>
            <strong style={{ color: '#1B3A6B' }}>Contact:</strong>{' '}
            <a href={`mailto:${info.email}`} style={{ color: '#2D5A9B' }}>{info.email}</a>
          </div>
        )}

        <div style={{ background: '#F8F9FB', borderRadius: 8, padding: 16, marginBottom: 16 }}>
          <strong style={{ color: '#1B3A6B', display: 'block', marginBottom: 8 }}>Tips for Small Businesses:</strong>
          <ul style={{ margin: 0, paddingLeft: 20, color: '#374151' }}>
            {info.tips.map((tip, i) => (
              <li key={i} style={{ marginBottom: 6 }}>{tip}</li>
            ))}
          </ul>
        </div>

        <div style={{ background: '#FFFBEB', border: '1px solid #F59E0B', borderRadius: 8, padding: 12 }}>
          <strong style={{ color: '#92400E' }}>Before You Reach Out:</strong>
          <ul style={{ margin: '8px 0 0', paddingLeft: 20, color: '#92400E', fontSize: 14 }}>
            <li>Have your CAGE code and SAM.gov UEI ready</li>
            <li>Know your NAICS codes and past performance</li>
            <li>Prepare a capability statement (1-2 pages)</li>
            <li>Research their current contracts to show relevance</li>
          </ul>
        </div>

        <button
          onClick={onClose}
          className="btn btn-navy"
          style={{ width: '100%', marginTop: 16 }}
        >
          Got It
        </button>
      </div>
    </div>
  )
}

function DefenseTechModal({ company, onClose }) {
  const info = findDefenseTechInfo(company)

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: '#fff', borderRadius: 12, padding: 24, maxWidth: 550, width: '90%', maxHeight: '85vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 16 }}>
          <h3 style={{ margin: 0, color: '#10B981', fontSize: 18 }}>Defense Tech Startup Profile</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', color: '#6B7280' }}>×</button>
        </div>

        <h4 style={{ margin: '0 0 16px', color: '#374151', fontSize: 16 }}>{company}</h4>

        {/* Company Overview */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
          {info.isPublic !== undefined && (
            <div style={{ background: info.isPublic ? '#DBEAFE' : '#F3E8FF', padding: 12, borderRadius: 8 }}>
              <strong style={{ color: info.isPublic ? '#1D4ED8' : '#7C3AED', fontSize: 12 }}>
                {info.isPublic ? 'PUBLIC COMPANY' : 'PRIVATE COMPANY'}
              </strong>
              {info.isPublic && info.ticker && (
                <div style={{ marginTop: 4 }}>
                  <span style={{ fontWeight: 600, color: '#1D4ED8' }}>{info.ticker}</span>
                  <span style={{ color: '#6B7280', fontSize: 13 }}> — {info.stockPrice}</span>
                </div>
              )}
              {!info.isPublic && info.valuation && (
                <div style={{ marginTop: 4, color: '#7C3AED', fontSize: 13 }}>
                  Valuation: {info.valuation}
                </div>
              )}
            </div>
          )}
          {info.hq && (
            <div style={{ background: '#F3F4F6', padding: 12, borderRadius: 8 }}>
              <strong style={{ color: '#6B7280', fontSize: 12 }}>HEADQUARTERS</strong>
              <div style={{ marginTop: 4, color: '#374151' }}>{info.hq}</div>
              {info.founded && <div style={{ color: '#9CA3AF', fontSize: 12 }}>Founded {info.founded}</div>}
            </div>
          )}
        </div>

        {info.focus && (
          <div style={{ marginBottom: 16 }}>
            <strong style={{ color: '#1B3A6B' }}>Focus:</strong>{' '}
            <span style={{ color: '#374151' }}>{info.focus}</span>
          </div>
        )}

        {info.products && (
          <div style={{ marginBottom: 16 }}>
            <strong style={{ color: '#1B3A6B' }}>Key Products:</strong>{' '}
            <span style={{ color: '#374151' }}>{info.products}</span>
          </div>
        )}

        {info.revenue && (
          <div style={{ marginBottom: 16 }}>
            <strong style={{ color: '#1B3A6B' }}>Revenue:</strong>{' '}
            <span style={{ color: '#374151' }}>{info.revenue}</span>
          </div>
        )}

        {info.url && (
          <div style={{ marginBottom: 16 }}>
            <a href={info.url} target="_blank" rel="noopener noreferrer" className="btn btn-sm btn-navy">
              Visit Company Website
            </a>
          </div>
        )}

        {/* Subcontracting Tips */}
        <div style={{ background: '#ECFDF5', border: '1px solid #10B981', borderRadius: 8, padding: 16, marginBottom: 16 }}>
          <strong style={{ color: '#065F46', display: 'block', marginBottom: 8 }}>How to Become a Supplier/Partner:</strong>
          <ul style={{ margin: 0, paddingLeft: 20, color: '#065F46' }}>
            {(info.tips || []).map((tip, i) => (
              <li key={i} style={{ marginBottom: 6 }}>{tip}</li>
            ))}
          </ul>
        </div>

        {/* Stock info for public companies */}
        {info.isPublic && info.ticker && (
          <div style={{ background: '#EFF6FF', border: '1px solid #3B82F6', borderRadius: 8, padding: 12, marginBottom: 16 }}>
            <strong style={{ color: '#1D4ED8' }}>Stock Info ({info.ticker}):</strong>
            <p style={{ margin: '8px 0 0', color: '#1E40AF', fontSize: 14 }}>
              View real-time stock data on{' '}
              <a href={`https://finance.yahoo.com/quote/${info.ticker}/`} target="_blank" rel="noopener noreferrer" style={{ color: '#2563EB', fontWeight: 500 }}>
                Yahoo Finance
              </a>
              {' '}or{' '}
              <a href={`https://www.google.com/finance/quote/${info.ticker}:NASDAQ`} target="_blank" rel="noopener noreferrer" style={{ color: '#2563EB', fontWeight: 500 }}>
                Google Finance
              </a>
            </p>
          </div>
        )}

        <button
          onClick={onClose}
          className="btn btn-navy"
          style={{ width: '100%', marginTop: 8 }}
        >
          Got It
        </button>
      </div>
    </div>
  )
}

export default function Leaderboard({ onBack, onSearchContracts }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [selectedCompany, setSelectedCompany] = useState(null)
  const [selectedDefenseTech, setSelectedDefenseTech] = useState(null)
  const [activeTab, setActiveTab] = useState('biggest')

  // Navigate to contracts search filtered by company name
  const searchContracts = (companyName) => {
    if (onSearchContracts) {
      onSearchContracts(companyName)
    }
  }

  useEffect(() => {
    fetch('/api/leaderboard')
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="container" style={{ padding: 40, textAlign: 'center' }}>
        Loading leaderboard data...
      </div>
    )
  }

  if (!data) {
    return (
      <div className="container" style={{ padding: 40 }}>
        <p>Could not load leaderboard data.</p>
        <button className="btn btn-navy" onClick={onBack}>Back</button>
      </div>
    )
  }

  const topByValue = data.topByValue || []
  const topSmallBiz = data.topSmallBusiness || []
  const defenseTech = data.defenseTech || []

  return (
    <div className="container" style={{ padding: '24px 24px 60px', maxWidth: 1100 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1B3A6B', margin: 0 }}>
          Contract Leaderboard
        </h1>
        <button className="btn btn-ghost" onClick={onBack}>Back to Search</button>
      </div>

      <p style={{ color: '#6B7280', marginBottom: 24, fontSize: 15 }}>
        See which companies are winning federal contracts. Click any company to learn how small businesses can pursue subcontracting opportunities with them.
      </p>

      {/* Tabs */}
      <div className="tabs" style={{ marginBottom: 24 }}>
        <button className={`tab ${activeTab === 'biggest' ? 'active' : ''}`} onClick={() => setActiveTab('biggest')}>
          Biggest Contracts <InfoIcon text="Companies ranked by total contract value. These prime contractors often subcontract portions of their work to small businesses." />
        </button>
        <button className={`tab ${activeTab === 'smallbiz' ? 'active' : ''}`} onClick={() => setActiveTab('smallbiz')}>
          Top Small Businesses <InfoIcon text="Small businesses winning the most federal contracts. Great examples of small business success — and potential teaming partners." />
        </button>
        <button className={`tab ${activeTab === 'defensetech' ? 'active' : ''}`} onClick={() => setActiveTab('defensetech')}>
          Defense Tech Startups <InfoIcon text="Hot defense tech companies like Anduril, Palantir, Shield AI winning government contracts. Includes stock info for public companies." />
        </button>
      </div>

      {activeTab === 'biggest' && (
        <div>
          <div className="card" style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, color: '#1B3A6B', marginBottom: 4 }}>
              Top 10 Prime Contractors by Total Value
            </h2>
            <p style={{ color: '#6B7280', fontSize: 13, marginBottom: 16 }}>Trailing 12 months</p>
            <div style={{ height: 400 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topByValue.slice(0, 10)} layout="vertical" margin={{ left: 10, right: 40 }}>
                  <XAxis type="number" tickFormatter={formatDollars} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={240}
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v) => truncateName(v, 35)}
                  />
                  <Tooltip
                    formatter={(v) => formatDollars(v)}
                    labelFormatter={(name) => name}
                  />
                  <Bar dataKey="total_value" radius={[0, 4, 4, 0]}>
                    {topByValue.slice(0, 10).map((entry, index) => (
                      <Cell key={entry.name} fill={CHART_COLORS[index]} cursor="pointer" onClick={() => searchContracts(entry.name)} />
                    ))}
                    <LabelList
                      dataKey="contract_count"
                      position="insideRight"
                      formatter={(v) => `${v} contracts`}
                      style={{ fill: '#fff', fontSize: 11, fontWeight: 500 }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="card">
            <h3 style={{ fontSize: 16, fontWeight: 600, color: '#1B3A6B', marginBottom: 16 }}>
              Details — Click to Learn About Subcontracting
            </h3>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #E2E4E9' }}>
                  <th style={{ textAlign: 'left', padding: '12px 8px', color: '#6B7280', fontWeight: 500 }}>Rank</th>
                  <th style={{ textAlign: 'left', padding: '12px 8px', color: '#6B7280', fontWeight: 500 }}>Company</th>
                  <th style={{ textAlign: 'right', padding: '12px 8px', color: '#6B7280', fontWeight: 500 }}>Contracts</th>
                  <th style={{ textAlign: 'right', padding: '12px 8px', color: '#6B7280', fontWeight: 500 }}>Total Value</th>
                  <th style={{ textAlign: 'center', padding: '12px 8px', color: '#6B7280', fontWeight: 500 }}>Subcontract</th>
                </tr>
              </thead>
              <tbody>
                {topByValue.slice(0, 10).map((row, i) => (
                  <tr key={row.name} style={{ borderBottom: '1px solid #E2E4E9' }}>
                    <td style={{ padding: '12px 8px', fontWeight: 600, color: '#1B3A6B' }}>{i + 1}</td>
                    <td style={{ padding: '12px 8px', color: '#374151' }}>{row.name}</td>
                    <td style={{ padding: '12px 8px', textAlign: 'right', color: '#6B7280' }}>{row.contract_count.toLocaleString()}</td>
                    <td style={{ padding: '12px 8px', textAlign: 'right', fontWeight: 500, color: '#1B3A6B' }}>{formatDollars(row.total_value)}</td>
                    <td style={{ padding: '12px 8px', textAlign: 'center' }}>
                      <button
                        className="btn btn-sm btn-navy"
                        onClick={() => setSelectedCompany(row.name)}
                      >
                        How to Subcontract
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'smallbiz' && (
        <div>
          <div className="card" style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, color: '#1B3A6B', marginBottom: 4 }}>
              Top 10 Small Businesses by Total Value
            </h2>
            <p style={{ color: '#6B7280', fontSize: 13, marginBottom: 8 }}>Trailing 12 months</p>
            <p style={{ color: '#6B7280', marginBottom: 12, fontSize: 14 }}>
              These companies won contracts that were set aside for small businesses. They could be teaming partners or mentors.
            </p>
            <p style={{ color: '#9CA3AF', marginBottom: 16, fontSize: 12, fontStyle: 'italic' }}>
              Note: "Small business" status is based on contract set-aside tags at time of award. Fast-growing companies may appear here even if they've since exceeded SBA size standards.
            </p>
            <div style={{ height: 400 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topSmallBiz.slice(0, 10)} layout="vertical" margin={{ left: 10, right: 40 }}>
                  <XAxis type="number" tickFormatter={formatDollars} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={240}
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v) => truncateName(v, 35)}
                  />
                  <Tooltip
                    formatter={(v) => formatDollars(v)}
                    labelFormatter={(name) => name}
                  />
                  <Bar dataKey="total_value" radius={[0, 4, 4, 0]}>
                    {topSmallBiz.slice(0, 10).map((entry, index) => (
                      <Cell key={entry.name} fill={SMALL_BIZ_COLORS[index % SMALL_BIZ_COLORS.length]} cursor="pointer" onClick={() => searchContracts(entry.name)} />
                    ))}
                    <LabelList
                      dataKey="contract_count"
                      position="insideRight"
                      formatter={(v) => `${v} contracts`}
                      style={{ fill: '#1B3A6B', fontSize: 11, fontWeight: 500 }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="card">
            <h3 style={{ fontSize: 16, fontWeight: 600, color: '#1B3A6B', marginBottom: 16 }}>
              Small Business Leaders
            </h3>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #E2E4E9' }}>
                  <th style={{ textAlign: 'left', padding: '12px 8px', color: '#6B7280', fontWeight: 500 }}>Rank</th>
                  <th style={{ textAlign: 'left', padding: '12px 8px', color: '#6B7280', fontWeight: 500 }}>Company</th>
                  <th style={{ textAlign: 'right', padding: '12px 8px', color: '#6B7280', fontWeight: 500 }}>Contracts Won</th>
                  <th style={{ textAlign: 'right', padding: '12px 8px', color: '#6B7280', fontWeight: 500 }}>Total Value</th>
                </tr>
              </thead>
              <tbody>
                {topSmallBiz.slice(0, 10).map((row, i) => (
                  <tr key={row.name} style={{ borderBottom: '1px solid #E2E4E9' }}>
                    <td style={{ padding: '12px 8px', fontWeight: 600, color: '#E9A820' }}>{i + 1}</td>
                    <td style={{ padding: '12px 8px', color: '#374151' }}>{row.name}</td>
                    <td style={{ padding: '12px 8px', textAlign: 'right', fontWeight: 500, color: '#1B3A6B' }}>{row.contract_count.toLocaleString()}</td>
                    <td style={{ padding: '12px 8px', textAlign: 'right', color: '#6B7280' }}>{formatDollars(row.total_value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Defense Tech Startups */}
      {activeTab === 'defensetech' && (
        <div>
          <div className="card" style={{ marginBottom: 24, background: 'linear-gradient(135deg, #ECFDF5 0%, #D1FAE5 100%)' }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, color: '#065F46', marginBottom: 8 }}>
              Hot Defense Tech Startups
            </h2>
            <p style={{ color: '#047857', margin: 0, fontSize: 14 }}>
              The new wave of defense technology companies winning government contracts — autonomous drones, AI platforms, directed energy, and more.
              These "neoprimes" are disrupting legacy defense contractors.
            </p>
          </div>

          <div className="card" style={{ marginBottom: 24 }}>
            <h3 style={{ fontSize: 16, fontWeight: 600, color: '#1B3A6B', marginBottom: 16 }}>
              Federal Contracts (Trailing 12 Months)
            </h3>
            {defenseTech.length > 0 ? (
              <>
                <div style={{ height: 300 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={defenseTech} layout="vertical" margin={{ left: 10, right: 40 }}>
                      <XAxis type="number" tickFormatter={formatDollars} />
                      <YAxis
                        type="category"
                        dataKey="name"
                        width={200}
                        tick={{ fontSize: 11 }}
                        tickFormatter={(v) => truncateName(v, 30)}
                      />
                      <Tooltip
                        formatter={(v) => formatDollars(v)}
                        labelFormatter={(name) => name}
                      />
                      <Bar dataKey="total_value" radius={[0, 4, 4, 0]}>
                        {defenseTech.map((entry, index) => (
                          <Cell key={entry.name} fill={DEFENSE_TECH_COLORS[index % DEFENSE_TECH_COLORS.length]} cursor="pointer" onClick={() => searchContracts(entry.name)} />
                        ))}
                        <LabelList
                          dataKey="contract_count"
                          position="insideRight"
                          formatter={(v) => `${v} contracts`}
                          style={{ fill: '#065F46', fontSize: 11, fontWeight: 500 }}
                        />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 24 }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #E2E4E9' }}>
                      <th style={{ textAlign: 'left', padding: '12px 8px', color: '#6B7280', fontWeight: 500 }}>Company</th>
                      <th style={{ textAlign: 'center', padding: '12px 8px', color: '#6B7280', fontWeight: 500 }}>Status</th>
                      <th style={{ textAlign: 'right', padding: '12px 8px', color: '#6B7280', fontWeight: 500 }}>Contracts</th>
                      <th style={{ textAlign: 'right', padding: '12px 8px', color: '#6B7280', fontWeight: 500 }}>Value</th>
                      <th style={{ textAlign: 'center', padding: '12px 8px', color: '#6B7280', fontWeight: 500 }}>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {defenseTech.map((row) => {
                      const info = findDefenseTechInfo(row.name)
                      return (
                        <tr key={row.name} style={{ borderBottom: '1px solid #E2E4E9' }}>
                          <td style={{ padding: '12px 8px', color: '#374151', fontWeight: 500 }}>{row.name}</td>
                          <td style={{ padding: '12px 8px', textAlign: 'center' }}>
                            {info.isPublic ? (
                              <span style={{ background: '#DBEAFE', color: '#1D4ED8', padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600 }}>
                                {info.ticker}
                              </span>
                            ) : (
                              <span style={{ background: '#F3E8FF', color: '#7C3AED', padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600 }}>
                                Private
                              </span>
                            )}
                          </td>
                          <td style={{ padding: '12px 8px', textAlign: 'right', color: '#6B7280' }}>{row.contract_count}</td>
                          <td style={{ padding: '12px 8px', textAlign: 'right', fontWeight: 500, color: '#10B981' }}>{formatDollars(row.total_value)}</td>
                          <td style={{ padding: '12px 8px', textAlign: 'center' }}>
                            <button
                              className="btn btn-sm"
                              style={{ background: '#10B981', color: '#fff' }}
                              onClick={() => setSelectedDefenseTech(row.name)}
                            >
                              Profile
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </>
            ) : (
              <p style={{ color: '#6B7280' }}>No defense tech startup contracts found in the trailing 12 months.</p>
            )}
          </div>

          {/* Data Source Note */}
          <div className="card" style={{ background: '#F8FAFC', borderLeft: '4px solid #6B7280' }}>
            <p style={{ margin: 0, color: '#475569', fontSize: 13 }}>
              <strong>Note:</strong> This data comes from FPDS (Federal Procurement Data System) contract awards.
              Some defense tech companies win significant funding through OTAs (Other Transaction Authorities)
              and R&D agreements that don't appear in standard contract databases — companies like Saronic,
              Chaos Industries, and others may have major government deals not reflected here.
            </p>
          </div>
        </div>
      )}

      {/* Subcontracting Modal */}
      {selectedCompany && (
        <SubcontractingModal
          company={selectedCompany}
          onClose={() => setSelectedCompany(null)}
        />
      )}

      {/* Defense Tech Modal */}
      {selectedDefenseTech && (
        <DefenseTechModal
          company={selectedDefenseTech}
          onClose={() => setSelectedDefenseTech(null)}
        />
      )}
    </div>
  )
}
