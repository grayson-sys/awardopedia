# Awardopedia Deployment Guide

## Architecture

- **Frontend**: React + Vite static site on DigitalOcean App Platform (Static Site component)
- **Backend**: Node.js + Express API on DigitalOcean App Platform (Web Service component)
- **Database**: DigitalOcean Managed PostgreSQL (db-s-1vcpu-1gb, nyc3)
- **DNS**: Cloudflare (awardopedia.com)

## Prerequisites

- DigitalOcean account with App Platform access
- Cloudflare account managing awardopedia.com DNS
- Stripe account with credit pack products configured
- SendGrid account for transactional email
- Anthropic API key for AI features

## Environment Variables

### API Service

```
DATABASE_URL=postgresql://user:pass@host:25060/db?sslmode=require
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_STARTER=price_...
STRIPE_PRICE_PRO=price_...
STRIPE_PRICE_POWER=price_...
ANTHROPIC_API_KEY=sk-ant-...
SENDGRID_API_KEY=SG...
JWT_SECRET=<random-64-char-hex>
FROM_EMAIL=login@awardopedia.com
APP_URL=https://awardopedia.com
NODE_ENV=production
PORT=3001
ALLOWED_ORIGINS=https://awardopedia.com
```

## DigitalOcean App Platform Setup

### 1. Create the App

```bash
doctl apps create --spec .do/app.yaml
```

Or create via the DO dashboard:

1. Go to App Platform > Create App
2. Connect GitHub repo: `openclaw/awardopedia`
3. Add two components:

### 2. API Component (Web Service)

- **Name**: api
- **Source**: `/api` directory
- **Dockerfile**: `api/Dockerfile`
- **HTTP Port**: 3001
- **Health Check**: `/health`
- **Instance Size**: Basic ($5/mo)
- **Environment variables**: Set all API env vars above

### 3. Frontend Component (Static Site)

- **Name**: web
- **Source**: `/web` directory
- **Build Command**: `npm install && npm run build`
- **Output Dir**: `dist`
- **Catchall Document**: `index.html` (for SPA routing)

### 4. Database

Attach the managed PostgreSQL database to the app. The `DATABASE_URL` environment variable will be auto-injected.

Run the schema:
```bash
psql $DATABASE_URL -f scripts/schema.sql
```

## DNS Configuration (Cloudflare)

1. Add CNAME record:
   - Name: `@` (or `awardopedia.com`)
   - Target: DO App Platform domain (e.g., `app-xxxxx.ondigitalocean.app`)
   - Proxy: On (orange cloud)

2. Add CNAME for API:
   - Name: `api`
   - Target: Same DO App Platform domain
   - Proxy: On

3. SSL: Full (strict) in Cloudflare SSL settings

## Initial Data Load

1. Download contract data from USASpending.gov bulk download
2. Run the ingest script:
```bash
cd scripts
DATABASE_URL=... python3 ingest.py --file /path/to/contracts.csv
```

## Weekly Sync

Set up a cron job or use DO App Platform's Job component:

```bash
# Crontab entry (runs every Sunday at 2 AM)
0 2 * * 0 cd /app/scripts && DATABASE_URL=... python3 sync.py
```

## Stripe Webhook

1. In Stripe Dashboard > Developers > Webhooks
2. Add endpoint: `https://api.awardopedia.com/webhooks/stripe`
3. Events: `checkout.session.completed`
4. Copy signing secret to `STRIPE_WEBHOOK_SECRET`

## Monitoring

- Health endpoint: `GET /health`
- App Platform provides built-in metrics and alerts
- Slow queries (>1s) are logged to stdout

## Rollback

App Platform supports instant rollback to previous deployments via the dashboard or CLI:

```bash
doctl apps create-deployment <app-id> --force-rebuild
```
