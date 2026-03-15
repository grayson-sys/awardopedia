# Awardopedia

Free, searchable interface for U.S. federal contract award data sourced from [USASpending.gov](https://www.usaspending.gov).

## Tech Stack

- **Frontend**: React 18 + Vite 5, react-router-dom v6, Chart.js, lucide-react
- **Backend**: Node.js 20 + Express 4, PostgreSQL 15
- **AI**: Anthropic Claude API for contract analysis (paid credits)
- **Payments**: Stripe Checkout for credit packs
- **Auth**: Magic link email via SendGrid + JWT
- **Hosting**: DigitalOcean App Platform
- **DNS/CDN**: Cloudflare

## Local Development

### Prerequisites

- Node.js 20+
- PostgreSQL 15+
- Python 3.10+ (for data sync scripts)

### Setup

```bash
# Clone
git clone https://github.com/openclaw/awardopedia.git
cd awardopedia

# Database
psql -d your_db -f scripts/schema.sql

# API
cd api
cp ../.env.example .env   # Edit with your values
npm install
npm run dev               # Starts on :3001

# Frontend (separate terminal)
cd web
npm install
npm run dev               # Starts on :3000, proxies /api to :3001
```

### Environment Variables

See `.env.example` for all required variables. At minimum for local dev:

```
DATABASE_URL=postgresql://localhost:5432/awardopedia
JWT_SECRET=any-dev-secret
PORT=3001
```

## Project Structure

```
awardopedia/
├── api/                  # Express API server
│   ├── src/
│   │   ├── db/           # Database connection + queries
│   │   ├── middleware/    # Auth, credits, rate limiting
│   │   ├── routes/       # API route handlers
│   │   └── services/     # Claude AI, Stripe, SendGrid
│   └── Dockerfile
├── web/                  # React + Vite frontend
│   ├── src/
│   │   ├── components/   # Reusable UI components
│   │   ├── pages/        # Route pages
│   │   ├── styles/       # CSS tokens, global, components
│   │   └── utils/        # API client, formatters, SEO
│   └── public/
├── scripts/
│   ├── schema.sql        # PostgreSQL schema
│   ├── ingest.py         # Bulk CSV ingestion
│   └── sync.py           # Weekly USASpending API sync
├── docs/
│   ├── api.md            # API endpoint reference
│   ├── data-model.md     # Database schema docs
│   └── deployment.md     # Deployment guide
└── assets/               # Brand logos
```

## Data

All contract data is sourced from USASpending.gov, the official open data source of federal spending information maintained by the U.S. Department of the Treasury as mandated by FFATA.

- **Bulk import**: `python3 scripts/ingest.py --file contracts.csv`
- **Weekly sync**: `python3 scripts/sync.py` (fetches last 7 days from USASpending API)

## Business Model

- Core data access (search, filter, browse): **Free**
- AI analysis (contract insights, summaries): **Paid credits**
  - Starter: 100 credits / $9
  - Pro: 500 credits / $29
  - Power: 2,000 credits / $79

## License

Proprietary. Data sourced from USASpending.gov (public domain).
