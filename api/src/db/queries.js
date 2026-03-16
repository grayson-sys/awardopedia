import { query } from './connection.js';

// ── Awards ────────────────────────────────────────
export async function searchAwards({ q, agency, state, dateFrom, dateTo, minValue, maxValue, type, naics, sort = 'federal_action_obligation', dir = 'desc', page = 1, limit = 25 }) {
  const conditions = [];
  const params = [];
  let idx = 1;

  if (q) {
    conditions.push(`to_tsvector('english', coalesce(description,'') || ' ' || coalesce(recipient_name,'') || ' ' || coalesce(agency_name,'') || ' ' || coalesce(naics_description,'')) @@ plainto_tsquery('english', $${idx})`);
    params.push(q);
    idx++;
  }
  if (agency) {
    conditions.push(`agency_name ILIKE $${idx}`);
    params.push(`%${agency}%`);
    idx++;
  }
  if (state) {
    conditions.push(`recipient_state = $${idx}`);
    params.push(state);
    idx++;
  }
  if (dateFrom) {
    conditions.push(`action_date >= $${idx}`);
    params.push(dateFrom);
    idx++;
  }
  if (dateTo) {
    conditions.push(`action_date <= $${idx}`);
    params.push(dateTo);
    idx++;
  }
  if (minValue) {
    conditions.push(`federal_action_obligation >= $${idx}`);
    params.push(Number(minValue));
    idx++;
  }
  if (maxValue) {
    conditions.push(`federal_action_obligation <= $${idx}`);
    params.push(Number(maxValue));
    idx++;
  }
  if (type) {
    conditions.push(`award_type = $${idx}`);
    params.push(type);
    idx++;
  }
  if (naics) {
    conditions.push(`naics_code = $${idx}`);
    params.push(naics);
    idx++;
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const allowedSort = ['action_date', 'federal_action_obligation', 'recipient_name', 'agency_name'];
  const sortCol = allowedSort.includes(sort) ? sort : 'action_date';
  const sortDirection = dir === 'asc' ? 'ASC' : 'DESC';
  const offset = (Math.max(1, Number(page)) - 1) * Number(limit);

  const countResult = await query(`SELECT COUNT(*) FROM awards ${where}`, params);
  const total = parseInt(countResult.rows[0].count, 10);

  const dataResult = await query(
    `SELECT * FROM awards ${where} ORDER BY ${sortCol} ${sortDirection} NULLS LAST LIMIT $${idx} OFFSET $${idx + 1}`,
    [...params, Number(limit), offset]
  );

  return { data: dataResult.rows, total, page: Number(page), limit: Number(limit) };
}

export async function getAwardById(id) {
  const result = await query('SELECT * FROM awards WHERE award_id = $1', [id]);
  return result.rows[0] || null;
}

export async function enrichAwardFromUSASpending(id) {
  // Fetch current record to get usaspending_id
  const current = await getAwardById(id);
  if (!current?.usaspending_id) return current;

  // Skip if recently enriched (within 7 days)
  if (current.enriched_at) {
    const age = Date.now() - new Date(current.enriched_at).getTime();
    if (age < 7 * 24 * 60 * 60 * 1000) return current;
  }

  // Fetch full detail from USASpending
  let data;
  try {
    const url = `https://api.usaspending.gov/api/v2/awards/${encodeURIComponent(current.usaspending_id)}/`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return current;
    data = await res.json();
  } catch {
    return current;
  }

  const tx = data.latest_transaction_contract_data || {};
  const recipient = data.recipient || {};
  const loc = recipient.location || {};
  const pop = data.place_of_performance || {};
  const perf = data.period_of_performance || {};

  // Build executive officers array
  const officers = (data.executive_details?.officers || [])
    .filter(o => o.name && o.amount)
    .map(o => ({ name: o.name.trim(), amount: o.amount }));

  // Recipient address
  const addrParts = [loc.address_line1, loc.city_name, loc.state_code, loc.zip5].filter(Boolean);
  const recipientAddress = addrParts.join(', ') || null;
  const congDistrict = loc.state_code && loc.congressional_code
    ? `${loc.state_code}-${loc.congressional_code}`
    : null;

  // Description — keep raw gov text
  const description = (data.description && data.description !== 'IGF::OT::IGF')
    ? data.description
    : null;

  await query(`
    UPDATE awards SET
      solicitation_id        = COALESCE($2, solicitation_id),
      number_of_offers       = COALESCE($3, number_of_offers),
      competition_type       = COALESCE($4, competition_type),
      extent_competed        = COALESCE($5, extent_competed),
      pricing_type           = COALESCE($6, pricing_type),
      subaward_count         = COALESCE($7, subaward_count),
      subaward_amount        = COALESCE($8, subaward_amount),
      executive_officers     = COALESCE($9, executive_officers),
      base_exercised_options = COALESCE($10, base_exercised_options),
      potential_total_value  = COALESCE($11, potential_total_value),
      congressional_district = COALESCE($12, congressional_district),
      recipient_address      = COALESCE($13, recipient_address),
      naics_code             = COALESCE($14, naics_code),
      naics_description      = COALESCE($15, naics_description),
      psc_code               = COALESCE($16, psc_code),
      psc_description        = COALESCE($17, psc_description),
      set_aside_type         = COALESCE($18, set_aside_type),
      description            = COALESCE($19, description),
      period_of_performance_start       = COALESCE($20, period_of_performance_start),
      period_of_performance_current_end = COALESCE($21, period_of_performance_current_end),
      enriched_at            = NOW()
    WHERE award_id = $1`,
    [
      id,
      tx.solicitation_identifier || null,
      tx.number_of_offers_received ? parseInt(tx.number_of_offers_received) : null,
      tx.extent_competed_description || null,
      tx.extent_competed || null,
      tx.type_of_contract_pricing_description || null,
      data.subaward_count ?? null,
      data.total_subaward_amount ?? null,
      officers.length ? JSON.stringify(officers) : null,
      data.base_exercised_options ?? null,
      data.base_and_all_options ?? null,
      congDistrict,
      recipientAddress,
      tx.naics || null,
      tx.naics_description || null,
      tx.product_or_service_code || null,
      tx.product_or_service_description || null,
      tx.type_set_aside_description || null,
      description,
      perf.start_date || null,
      perf.end_date || null,
    ]
  );

  return await getAwardById(id);
}

export async function getRelatedAwards(award) {
  if (!award) return [];
  const result = await query(
    `SELECT * FROM awards
     WHERE award_id != $1
       AND (recipient_uei = $2 OR naics_code = $3)
     ORDER BY action_date DESC LIMIT 5`,
    [award.award_id, award.recipient_uei, award.naics_code]
  );
  return result.rows;
}

// ── Agencies ──────────────────────────────────────
export async function listAgencies({ q, sort = 'total_awarded', dir = 'desc' }) {
  // agencies table is not populated — derive live from awards
  const params = [];
  let having = '';
  if (q) {
    having = 'HAVING agency_name ILIKE $1';
    params.push(`%${q}%`);
  }
  const allowedSort = ['agency_name', 'total_awarded', 'award_count', 'avg_award_value'];
  const sortCol = allowedSort.includes(sort) ? sort : 'total_awarded';
  const sortDirection = dir === 'asc' ? 'ASC' : 'DESC';

  const result = await query(
    `SELECT
       agency_name,
       COUNT(*)                           AS award_count,
       COALESCE(SUM(federal_action_obligation), 0) AS total_awarded,
       COALESCE(AVG(federal_action_obligation), 0) AS avg_award_value
     FROM awards
     WHERE agency_name IS NOT NULL
     GROUP BY agency_name
     ${having}
     ORDER BY ${sortCol} ${sortDirection} NULLS LAST
     LIMIT 200`,
    params
  );
  return { data: result.rows };
}

export async function getAgencyByCode(code) {
  const result = await query('SELECT * FROM agencies WHERE agency_code = $1', [code]);
  const agency = result.rows[0];
  if (!agency) return null;

  const awards = await query(
    'SELECT * FROM awards WHERE agency_code = $1 ORDER BY action_date DESC LIMIT 20',
    [code]
  );
  agency.recent_awards = awards.rows;
  return agency;
}

// ── NAICS ─────────────────────────────────────────
export async function getNaicsByCode(code) {
  const result = await query('SELECT * FROM naics_codes WHERE naics_code = $1', [code]);
  const naics = result.rows[0];
  if (!naics) return null;

  const awards = await query(
    'SELECT * FROM awards WHERE naics_code = $1 ORDER BY action_date DESC LIMIT 20',
    [code]
  );
  naics.recent_awards = awards.rows;
  return naics;
}

// ── Contractors ───────────────────────────────────
export async function getContractorByUei(uei) {
  const result = await query('SELECT * FROM contractors WHERE uei = $1', [uei]);
  const contractor = result.rows[0];
  if (!contractor) return null;

  const awards = await query(
    'SELECT * FROM awards WHERE recipient_uei = $1 ORDER BY action_date DESC LIMIT 50',
    [uei]
  );
  contractor.awards = awards.rows;

  const breakdown = await query(
    `SELECT agency_code, agency_name, COUNT(*) as count, SUM(federal_action_obligation) as total
     FROM awards WHERE recipient_uei = $1
     GROUP BY agency_code, agency_name ORDER BY total DESC LIMIT 20`,
    [uei]
  );
  contractor.agency_breakdown = breakdown.rows;

  return contractor;
}

export async function searchContractors({ q, state, naics }) {
  const conditions = [];
  const params = [];
  let idx = 1;

  if (q) {
    conditions.push(`name ILIKE $${idx}`);
    params.push(`%${q}%`);
    idx++;
  }
  if (state) {
    conditions.push(`state_code = $${idx}`);
    params.push(state);
    idx++;
  }
  if (naics) {
    conditions.push(`naics_primary = $${idx}`);
    params.push(naics);
    idx++;
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await query(
    `SELECT * FROM contractors ${where} ORDER BY total_awarded DESC NULLS LAST LIMIT 100`,
    params
  );
  return { data: result.rows };
}

// ── Expiring ──────────────────────────────────────
export async function getExpiringContracts({ agency, state, minValue, maxValue, naics }) {
  const conditions = [];
  const params = [];
  let idx = 1;

  if (agency) {
    conditions.push(`agency_name ILIKE $${idx}`);
    params.push(`%${agency}%`);
    idx++;
  }
  if (state) {
    conditions.push(`recipient_state = $${idx}`);
    params.push(state);
    idx++;
  }
  if (minValue) {
    conditions.push(`federal_action_obligation >= $${idx}`);
    params.push(Number(minValue));
    idx++;
  }
  if (maxValue) {
    conditions.push(`federal_action_obligation <= $${idx}`);
    params.push(Number(maxValue));
    idx++;
  }
  if (naics) {
    conditions.push(`naics_code = $${idx}`);
    params.push(naics);
    idx++;
  }

  const where = conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : '';
  const result = await query(
    `SELECT * FROM expiring_contracts WHERE 1=1 ${where} ORDER BY end_date ASC LIMIT 200`,
    params
  );
  return { data: result.rows };
}

// ── Stats ─────────────────────────────────────────
export async function getStats() {
  const [awards, value, agencies, expiring] = await Promise.all([
    query('SELECT COUNT(*) FROM awards'),
    query('SELECT COALESCE(SUM(federal_action_obligation), 0) as total FROM awards'),
    query('SELECT COUNT(DISTINCT agency_name) as count FROM awards WHERE agency_name IS NOT NULL'),
    query("SELECT COUNT(*) FROM awards WHERE period_of_performance_current_end BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '180 days' AND federal_action_obligation > 0"),
  ]);

  return {
    total_awards: parseInt(awards.rows[0].count, 10),
    total_value: parseFloat(value.rows[0].total),
    total_agencies: parseInt(agencies.rows[0].count, 10),
    expiring_count: parseInt(expiring.rows[0].count, 10),
  };
}

// ── Users / Credits ───────────────────────────────
export async function findOrCreateUser(email) {
  let result = await query('SELECT * FROM users WHERE email = $1', [email]);
  if (result.rows.length === 0) {
    result = await query('INSERT INTO users (email) VALUES ($1) RETURNING *', [email]);
  }
  return result.rows[0];
}

export async function getUserById(id) {
  const result = await query('SELECT * FROM users WHERE user_id = $1', [id]);
  return result.rows[0] || null;
}

export async function setMagicToken(userId, token, expires) {
  await query('UPDATE users SET magic_token = $2, magic_expires = $3 WHERE user_id = $1', [userId, token, expires]);
}

export async function verifyMagicToken(token) {
  const result = await query(
    'SELECT * FROM users WHERE magic_token = $1 AND magic_expires > NOW()',
    [token]
  );
  if (result.rows.length === 0) return null;
  const user = result.rows[0];
  await query('UPDATE users SET magic_token = NULL, magic_expires = NULL, last_login = NOW() WHERE user_id = $1', [user.user_id]);
  return user;
}

export async function deductCredits(userId, amount) {
  const result = await query(
    'UPDATE users SET credits = credits - $2 WHERE user_id = $1 AND credits >= $2 RETURNING credits',
    [userId, amount]
  );
  return result.rows[0] || null;
}

export async function addCredits(userId, amount) {
  const result = await query(
    'UPDATE users SET credits = credits + $2, total_credits_purchased = total_credits_purchased + $2 WHERE user_id = $1 RETURNING credits',
    [userId, amount]
  );
  return result.rows[0] || null;
}

export async function recordCreditPurchase({ userId, stripeSessionId, stripePaymentId, credits, amountCents, status }) {
  await query(
    `INSERT INTO credit_purchases (user_id, stripe_session_id, stripe_payment_id, credits_purchased, amount_cents, status)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (stripe_session_id) DO UPDATE SET status = $6, stripe_payment_id = $3`,
    [userId, stripeSessionId, stripePaymentId, credits, amountCents, status]
  );
}

export async function recordCreditUsage({ userId, awardId, action, creditsUsed, result: aiResult }) {
  await query(
    'INSERT INTO credit_usage (user_id, award_id, action, credits_used, result) VALUES ($1, $2, $3, $4, $5)',
    [userId, awardId, action, creditsUsed, aiResult]
  );
}

export async function getCachedAnalysis(awardId, action) {
  const result = await query(
    'SELECT result FROM credit_usage WHERE award_id = $1 AND action = $2 ORDER BY created_at DESC LIMIT 1',
    [awardId, action]
  );
  return result.rows[0]?.result || null;
}

// ── Geo / Map ──────────────────────────────────────
export async function getGeoSpend(state, sector) {
  if (state) {
    const params = [state];
    let where = "WHERE pop_state_code = $1 AND federal_action_obligation > 0";
    if (sector) { where += " AND sector_slug = $2"; params.push(sector); }
    const result = await query(
      `SELECT award_id, award_id_piid, recipient_name, agency_name, federal_action_obligation::float as federal_action_obligation, action_date, sector_slug
       FROM awards ${where} ORDER BY federal_action_obligation DESC NULLS LAST LIMIT 25`, params);
    return { awards: result.rows };
  }
  const params = [];
  let where = "WHERE pop_state_code IS NOT NULL AND federal_action_obligation IS NOT NULL";
  if (sector) { where += " AND sector_slug = $1"; params.push(sector); }
  const result = await query(
    `SELECT pop_state_code as state_code, COUNT(*)::int as award_count, SUM(federal_action_obligation::float) as total_awarded
     FROM awards ${where} GROUP BY pop_state_code ORDER BY total_awarded DESC`, params);
  return { states: result.rows };
}
