# Awardopedia Technical Decisions

## 2026-03-15 — Node.js + Express for backend
Choice: Node.js 20 LTS with Express 4
Alternatives considered: FastAPI (Python), Hono (Bun)
Reason: Specified in tech stack; consistent with existing Mac Mini tooling
Affects: All backend routes, Dockerfile, App Platform config

## 2026-03-15 — PostgreSQL 15 on DigitalOcean Managed DB
Choice: DO Managed PostgreSQL, db-s-1vcpu-1gb, nyc3 region
Alternatives considered: Supabase, PlanetScale, self-hosted
Reason: Specified in tech stack; managed = no maintenance overhead
Affects: Schema design, connection pooling, backup strategy

## 2026-03-15 — React + Vite for frontend
Choice: React 18 + Vite 5 static site
Alternatives considered: Next.js, Astro, plain HTML
Reason: Specified in tech stack; Vite = fast builds, DO App Platform static hosting
Affects: SSR not available; SEO via react-helmet-async + prerender strategy

## 2026-03-15 — No SSR; SEO via sitemap + metadata
Choice: Client-side React with react-helmet-async for meta tags
Alternatives considered: Next.js SSR, Astro static generation
Reason: Tech stack specifies React+Vite (no SSR framework); USASpending data creates
  thousands of indexable URLs — sitemap.xml will be generated at build time from DB
Affects: Step 4 frontend, robots.txt, sitemap generation script

## 2026-03-15 — Magic link auth (no passwords)
Choice: Email magic link via SendGrid + JWT stored in localStorage
Alternatives considered: OAuth (Google), Clerk, Auth0
Reason: Specified in tech stack; no passwords reduces support burden
Affects: Step 5 auth flow, email templates, JWT middleware

## 2026-03-15 — Freemium model: free data, paid AI credits
Choice: All award/agency/NAICS data free; AI analysis costs credits
Alternatives considered: Subscription tiers, per-search pricing
Reason: Specified in product brief; maximizes indexable content for SEO
Affects: Step 5 credit system, Step 3 middleware/auth, Stripe integration
