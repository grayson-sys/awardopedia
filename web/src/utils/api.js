const BASE = '/api';

async function request(path, options = {}) {
  const token = localStorage.getItem('awardopedia_token');
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error || `Request failed: ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export function searchAwards(params = {}) {
  const qs = new URLSearchParams(params).toString();
  return request(`/awards?${qs}`);
}

export function getAward(id) {
  return request(`/awards/${id}`);
}

export function getAgencies(params = {}) {
  const qs = new URLSearchParams(params).toString();
  return request(`/agencies?${qs}`);
}

export function getAgency(code) {
  return request(`/agencies/${code}`);
}

export function getNaics(code) {
  return request(`/naics/${code}`);
}

export function getContractor(uei) {
  return request(`/contractors/${uei}`);
}

export function searchContractors(params = {}) {
  const qs = new URLSearchParams(params).toString();
  return request(`/contractors/search?${qs}`);
}

export function getExpiring(params = {}) {
  const qs = new URLSearchParams(params).toString();
  return request(`/expiring?${qs}`);
}

export function getStats() {
  return request('/stats');
}

export function analyzeWithAI(awardId, question) {
  return request('/ai/analyze', {
    method: 'POST',
    body: JSON.stringify({ awardId, question }),
  });
}

export function summarizeWithAI(entityType, entityId) {
  return request('/ai/summarize', {
    method: 'POST',
    body: JSON.stringify({ entityType, entityId }),
  });
}

export function purchaseCredits(packId) {
  return request('/credits/checkout', {
    method: 'POST',
    body: JSON.stringify({ packId }),
  });
}

export function sendMagicLink(email) {
  return request('/auth/magic-link', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export function verifyMagicLink(token) {
  return request(`/auth/verify?token=${token}`);
}
