const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export async function serverFetch(path, opts = {}) {
  const fetchOpts = opts.noCache
    ? { cache: 'no-store' }
    : { next: { revalidate: opts.revalidate ?? 3600 } };
  const res = await fetch(`${API}/api${path}`, fetchOpts);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `API error: ${res.status}`);
  }
  return res.json();
}

export async function getStats() {
  return serverFetch("/stats");
}

export async function getAwards(params = {}) {
  // Ensure sort key matches backend allowedSort list
  if (params.sort === 'date') params.sort = 'action_date';
  const qs = new URLSearchParams(params).toString();
  return serverFetch(`/awards?${qs}`);
}

export async function getAward(id) {
  return serverFetch(`/awards/${id}`, { noCache: true });
}

export async function getAgencies(params = {}) {
  const qs = new URLSearchParams(params).toString();
  return serverFetch(`/agencies?${qs}`);
}

export async function getAgency(code) {
  return serverFetch(`/agencies/${code}`);
}

export async function getContractor(uei) {
  return serverFetch(`/contractors/${uei}`);
}

export async function getNaics(code) {
  return serverFetch(`/naics/${code}`);
}

export async function getExpiring(params = {}) {
  const qs = new URLSearchParams(params).toString();
  return serverFetch(`/expiring?${qs}`);
}

export async function getGeoSpend(state, sector) {
  const params = new URLSearchParams();
  if (state) params.set("state", state);
  if (sector) params.set("sector", sector);
  return serverFetch(`/geo-spend?${params.toString()}`);
}

export async function getSector(slug) {
  return serverFetch(`/sectors/${slug}`);
}

export async function getState(code) {
  return serverFetch(`/states/${code}`);
}

export async function getStateSector(code, sector) {
  return serverFetch(`/states/${code}/${sector}`);
}

export function clientApi(path, options = {}) {
  const token = typeof window !== "undefined" ? localStorage.getItem("awardopedia_token") : null;
  const headers = { "Content-Type": "application/json", ...options.headers };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return fetch(`/api${path}`, { ...options, headers }).then(async (res) => {
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const err = new Error(body.error || `Request failed: ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  });
}

export function searchAwardsClient(params = {}) {
  const qs = new URLSearchParams(params).toString();
  return clientApi(`/awards?${qs}`);
}

export function analyzeWithAI(awardId, question) {
  return clientApi("/ai/analyze", {
    method: "POST",
    body: JSON.stringify({ awardId, question }),
  });
}

export function purchaseCredits(packId) {
  return clientApi("/credits/checkout", {
    method: "POST",
    body: JSON.stringify({ packId }),
  });
}

export function sendMagicLink(email) {
  return clientApi("/auth/magic-link", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export function verifyMagicLink(token) {
  return clientApi(`/auth/verify?token=${token}`);
}

export function getExpiringClient(params = {}) {
  const qs = new URLSearchParams(params).toString();
  return clientApi(`/expiring?${qs}`);
}

export function getAgenciesClient(params = {}) {
  const qs = new URLSearchParams(params).toString();
  return clientApi(`/agencies?${qs}`);
}
