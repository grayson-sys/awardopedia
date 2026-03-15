# Awardopedia API Reference

Base URL: `https://api.awardopedia.com` (production) or `http://localhost:3001` (development)

## Rate Limits

- Standard endpoints: 120 requests/minute
- AI endpoints: 10 requests/minute
- Rate limit headers: `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`

## Authentication

AI endpoints require a Bearer token in the `Authorization` header:

```
Authorization: Bearer <jwt_token>
```

Tokens are obtained via the magic link authentication flow.

---

## Endpoints

### GET /health

Health check.

**Response:** `{ "status": "ok", "ts": 1710000000000 }`

---

### GET /awards

Search and filter awards.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| q | string | Full-text search query |
| agency | string | Filter by agency name (partial match) |
| state | string | Filter by recipient state (2-letter code) |
| dateFrom | date | Minimum action date (YYYY-MM-DD) |
| dateTo | date | Maximum action date (YYYY-MM-DD) |
| minValue | number | Minimum federal obligation |
| maxValue | number | Maximum federal obligation |
| type | string | Award type (Contract, Grant, Loan, etc.) |
| naics | string | NAICS code |
| sort | string | Sort field: action_date, federal_action_obligation, recipient_name, agency_name |
| dir | string | Sort direction: asc, desc |
| page | number | Page number (default: 1) |
| limit | number | Results per page (default: 25) |

**Response:**
```json
{
  "data": [{ /* award objects */ }],
  "total": 12345,
  "page": 1,
  "limit": 25
}
```

### GET /awards/:id

Get a single award by ID with related awards.

**Response:**
```json
{
  "award": { /* full award object */ },
  "related": [{ /* related awards */ }]
}
```

---

### GET /agencies

List all agencies.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| q | string | Search agency name |
| sort | string | Sort field: agency_name, total_awarded, award_count, avg_award_value |
| dir | string | Sort direction: asc, desc |

**Response:** `{ "data": [{ /* agency objects */ }] }`

### GET /agencies/:code

Get agency profile by agency code. Includes `recent_awards`, `top_naics`, and `top_contractors`.

---

### GET /naics/:code

Get NAICS code profile. Includes `recent_awards`, `top_agencies`, and `top_contractors`.

---

### GET /contractors/search

Search contractors.

**Query Parameters:** `q` (name search), `state`, `naics`

**Response:** `{ "data": [{ /* contractor objects */ }] }`

### GET /contractors/:uei

Get contractor profile by UEI. Includes `awards` and `agency_breakdown`.

---

### GET /expiring

Get contracts expiring within 180 days.

**Query Parameters:** `agency`, `state`, `minValue`, `maxValue`, `naics`

**Response:** `{ "data": [{ /* expiring contract objects with days_remaining */ }] }`

---

### GET /stats

Get platform-wide statistics.

**Response:**
```json
{
  "total_awards": 150000,
  "total_value": 500000000000,
  "total_agencies": 450,
  "expiring_count": 2300
}
```

---

### POST /ai/analyze

Analyze an award using AI. Requires authentication and 1 credit.

**Request Body:**
```json
{
  "awardId": 123,
  "question": "Optional specific question about the award"
}
```

**Response:** `{ "analysis": "...", "credits": 99 }`

### POST /ai/summarize

Summarize an entity using AI. Requires authentication and 1 credit.

**Request Body:**
```json
{
  "entityType": "agency|contractor|naics",
  "entityId": "entity_identifier"
}
```

**Response:** `{ "summary": "...", "credits": 99 }`

---

### POST /webhooks/stripe

Stripe webhook for credit purchases. Verifies webhook signature.

---

## Error Responses

All errors return JSON:

```json
{
  "error": "Error message description"
}
```

| Status | Meaning |
|--------|---------|
| 400 | Bad request / missing parameters |
| 401 | Authentication required |
| 402 | Insufficient credits |
| 404 | Resource not found |
| 429 | Rate limit exceeded |
| 500 | Internal server error |
