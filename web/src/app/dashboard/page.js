"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CreditCard, Eye, GitBranch, Search, Plus, X, Loader } from "lucide-react";
import { clientApi } from "@/lib/api";
import { formatCurrency, formatDateShort, truncate, daysUntil, urgencyColor } from "@/lib/format";

const TOKEN_KEY = "aw_token";
const TABS = ["Overview", "Watchlist", "Pipeline", "Saved Searches"];
const STAGES = ["identified", "qualifying", "pursuing", "proposal_submitted", "won", "lost"];
const STAGE_LABELS = { identified: "Identified", qualifying: "Qualifying", pursuing: "Pursuing", proposal_submitted: "Proposal Submitted", won: "Won", lost: "Lost" };

export default function DashboardPage() {
  const router = useRouter();
  const [tab, setTab] = useState("Overview");
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [watchlist, setWatchlist] = useState([]);
  const [pipeline, setPipeline] = useState([]);
  const [searches, setSearches] = useState([]);
  const [addId, setAddId] = useState("");
  const [showAddOpp, setShowAddOpp] = useState(false);
  const [newOpp, setNewOpp] = useState({ title: "", estimated_value: "", due_date: "", stage: "identified" });

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) { router.replace("/credits"); return; }

    clientApi("/users/me")
      .then((u) => { setUser(u); setLoading(false); })
      .catch(() => { localStorage.removeItem(TOKEN_KEY); router.replace("/credits"); });
  }, [router]);

  useEffect(() => {
    if (!user) return;
    if (tab === "Watchlist") clientApi("/users/me/watchlist").then(setWatchlist).catch(() => {});
    if (tab === "Pipeline") clientApi("/users/me/pipeline").then(setPipeline).catch(() => {});
    if (tab === "Saved Searches") clientApi("/users/me/searches").then(setSearches).catch(() => {});
  }, [tab, user]);

  async function removeWatch(id) {
    try {
      await clientApi(`/users/me/watchlist/${id}`, { method: "DELETE" });
      setWatchlist((w) => w.filter((item) => item.id !== id));
    } catch {}
  }

  async function addWatch(e) {
    e.preventDefault();
    if (!addId.trim()) return;
    try {
      const item = await clientApi("/users/me/watchlist", { method: "POST", body: JSON.stringify({ award_id: addId.trim() }) });
      setWatchlist((w) => [...w, item]);
      setAddId("");
    } catch (err) {
      alert(err.message);
    }
  }

  async function addOpportunity(e) {
    e.preventDefault();
    try {
      const item = await clientApi("/users/me/pipeline", { method: "POST", body: JSON.stringify(newOpp) });
      setPipeline((p) => [...p, item]);
      setShowAddOpp(false);
      setNewOpp({ title: "", estimated_value: "", due_date: "", stage: "identified" });
    } catch (err) {
      alert(err.message);
    }
  }

  if (loading) {
    return (
      <div className="container" style={{ padding: "var(--space-12) 0", textAlign: "center" }}>
        <Loader size={32} style={{ animation: "spin 1s linear infinite" }} />
      </div>
    );
  }

  return (
    <div className="container" style={{ padding: "var(--space-8) 0" }}>
      <h1 style={{ fontSize: "var(--font-size-2xl)", fontWeight: "var(--font-weight-medium)", marginBottom: "var(--space-6)" }}>
        Dashboard
      </h1>

      <div style={{ display: "flex", gap: "var(--space-1)", marginBottom: "var(--space-6)", borderBottom: "1px solid var(--color-border)", overflowX: "auto" }}>
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: "var(--space-2) var(--space-4)",
              border: "none", background: "none", cursor: "pointer",
              fontSize: "var(--font-size-sm)", fontWeight: "var(--font-weight-medium)",
              color: tab === t ? "var(--color-navy)" : "var(--color-muted)",
              borderBottom: tab === t ? "2px solid var(--color-navy)" : "2px solid transparent",
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Overview" && (
        <div>
          <div className="card" style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-4)", marginBottom: "var(--space-6)" }}>
            <div style={{
              fontFamily: "var(--font-mono)", fontSize: "var(--font-size-3xl)", fontWeight: "var(--font-weight-medium)",
              color: "var(--color-amber)",
            }}>
              {user?.credits ?? 0}
            </div>
            <div>
              <div style={{ fontWeight: "var(--font-weight-medium)" }}>Credits</div>
              <Link href="/credits" style={{ fontSize: "var(--font-size-sm)", color: "var(--color-amber)" }}>Buy more &rarr;</Link>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "var(--space-6)" }}>
            <div className="card">
              <h3 style={{ fontSize: "var(--font-size-base)", fontWeight: "var(--font-weight-medium)", marginBottom: "var(--space-3)", display: "flex", alignItems: "center", gap: 6 }}>
                <Eye size={16} /> Recent Watchlist
              </h3>
              {user?.recent_watchlist?.length > 0 ? (
                <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {user.recent_watchlist.slice(0, 5).map((w) => (
                    <li key={w.id} style={{ padding: "var(--space-1) 0", fontSize: "var(--font-size-sm)", borderBottom: "1px solid var(--color-border)" }}>
                      <Link href={`/awards/${w.award_id}`} style={{ color: "var(--color-navy)" }}>{truncate(w.description, 60)}</Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p style={{ color: "var(--color-muted)", fontSize: "var(--font-size-sm)" }}>No watched contracts yet.</p>
              )}
            </div>

            <div className="card">
              <h3 style={{ fontSize: "var(--font-size-base)", fontWeight: "var(--font-weight-medium)", marginBottom: "var(--space-3)", display: "flex", alignItems: "center", gap: 6 }}>
                <GitBranch size={16} /> Pipeline Summary
              </h3>
              {user?.pipeline_summary ? (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-2)" }}>
                  {STAGES.map((s) => (
                    <div key={s} style={{ fontSize: "var(--font-size-sm)", display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "var(--color-muted)" }}>{STAGE_LABELS[s]}</span>
                      <span style={{ fontFamily: "var(--font-mono)" }}>{user.pipeline_summary[s] || 0}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ color: "var(--color-muted)", fontSize: "var(--font-size-sm)" }}>No pipeline items yet.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === "Watchlist" && (
        <div>
          <form onSubmit={addWatch} style={{ display: "flex", gap: "var(--space-2)", marginBottom: "var(--space-4)" }}>
            <input
              type="text" value={addId} onChange={(e) => setAddId(e.target.value)}
              placeholder="Add by contract ID"
              style={{
                flex: 1, padding: "var(--space-2) var(--space-3)",
                border: "1px solid var(--color-border)", borderRadius: "var(--border-radius)",
                fontSize: "var(--font-size-sm)",
              }}
            />
            <button type="submit" className="btn-primary">Add</button>
          </form>
          <div style={{ overflowX: "auto" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Description</th>
                  <th>Agency</th>
                  <th className="text-right">Value</th>
                  <th>Expires</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {watchlist.length > 0 ? watchlist.map((w) => {
                  const days = daysUntil(w.end_date);
                  return (
                    <tr key={w.id}>
                      <td>
                        <Link href={`/awards/${w.award_id}`} style={{ color: "var(--color-navy)" }}>
                          {truncate(w.description, 50)}
                        </Link>
                      </td>
                      <td>{w.agency}</td>
                      <td className="text-right mono">{formatCurrency(w.value)}</td>
                      <td style={{ whiteSpace: "nowrap", color: urgencyColor(days) }}>
                        {days != null ? `${days}d` : formatDateShort(w.end_date)}
                      </td>
                      <td>
                        <button onClick={() => removeWatch(w.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-error)" }}>
                          <X size={16} />
                        </button>
                      </td>
                    </tr>
                  );
                }) : (
                  <tr><td colSpan={5} className="data-table__empty">No watched contracts</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "Pipeline" && (
        <div>
          <button onClick={() => setShowAddOpp(!showAddOpp)} className="btn-primary" style={{ marginBottom: "var(--space-4)", display: "flex", alignItems: "center", gap: 6 }}>
            <Plus size={16} /> Add opportunity
          </button>

          {showAddOpp && (
            <form onSubmit={addOpportunity} className="card" style={{ marginBottom: "var(--space-6)", display: "grid", gap: "var(--space-3)" }}>
              <input type="text" placeholder="Title" value={newOpp.title} onChange={(e) => setNewOpp({ ...newOpp, title: e.target.value })} required
                style={{ padding: "var(--space-2) var(--space-3)", border: "1px solid var(--color-border)", borderRadius: "var(--border-radius)", fontSize: "var(--font-size-sm)" }} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "var(--space-3)" }}>
                <input type="number" placeholder="Est. value" value={newOpp.estimated_value} onChange={(e) => setNewOpp({ ...newOpp, estimated_value: e.target.value })}
                  style={{ padding: "var(--space-2) var(--space-3)", border: "1px solid var(--color-border)", borderRadius: "var(--border-radius)", fontSize: "var(--font-size-sm)" }} />
                <input type="date" value={newOpp.due_date} onChange={(e) => setNewOpp({ ...newOpp, due_date: e.target.value })}
                  style={{ padding: "var(--space-2) var(--space-3)", border: "1px solid var(--color-border)", borderRadius: "var(--border-radius)", fontSize: "var(--font-size-sm)" }} />
                <select value={newOpp.stage} onChange={(e) => setNewOpp({ ...newOpp, stage: e.target.value })}
                  style={{ padding: "var(--space-2) var(--space-3)", border: "1px solid var(--color-border)", borderRadius: "var(--border-radius)", fontSize: "var(--font-size-sm)" }}>
                  {STAGES.filter((s) => s !== "won" && s !== "lost").map((s) => (
                    <option key={s} value={s}>{STAGE_LABELS[s]}</option>
                  ))}
                </select>
              </div>
              <div style={{ display: "flex", gap: "var(--space-2)" }}>
                <button type="submit" className="btn-primary">Save</button>
                <button type="button" className="btn-secondary" onClick={() => setShowAddOpp(false)}>Cancel</button>
              </div>
            </form>
          )}

          {STAGES.map((stage) => {
            const items = pipeline.filter((p) => p.stage === stage);
            if (items.length === 0) return null;
            return (
              <section key={stage} style={{ marginBottom: "var(--space-6)" }}>
                <h3 style={{ fontSize: "var(--font-size-base)", fontWeight: "var(--font-weight-medium)", marginBottom: "var(--space-3)", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-muted)", fontSize: "var(--font-size-xs)" }}>
                  {STAGE_LABELS[stage]} ({items.length})
                </h3>
                <div style={{ display: "grid", gap: "var(--space-2)" }}>
                  {items.map((item) => (
                    <div key={item.id} className="card" style={{ padding: "var(--space-3)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <div style={{ fontWeight: "var(--font-weight-medium)", fontSize: "var(--font-size-sm)" }}>{item.title}</div>
                        {item.due_date && <div style={{ fontSize: "var(--font-size-xs)", color: "var(--color-muted)" }}>Due: {formatDateShort(item.due_date)}</div>}
                      </div>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-sm)" }}>
                        {formatCurrency(item.estimated_value)}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}

          {pipeline.length === 0 && (
            <p style={{ color: "var(--color-muted)", fontSize: "var(--font-size-sm)" }}>No pipeline items yet. Add your first opportunity above.</p>
          )}
        </div>
      )}

      {tab === "Saved Searches" && (
        <div>
          {searches.length > 0 ? (
            <div style={{ display: "grid", gap: "var(--space-3)" }}>
              {searches.map((s) => (
                <div key={s.id} className="card" style={{ padding: "var(--space-3)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontWeight: "var(--font-weight-medium)", fontSize: "var(--font-size-sm)" }}>
                      <Search size={14} style={{ verticalAlign: "text-bottom", marginRight: 4 }} />
                      {s.name}
                    </div>
                    <div style={{ fontSize: "var(--font-size-xs)", color: "var(--color-muted)" }}>
                      {s.filters_summary || "All filters"} &middot; Alerts: {s.alert_frequency || "off"}
                    </div>
                  </div>
                  <Link href={`/awards?${new URLSearchParams(s.filters || {}).toString()}`} className="btn-secondary" style={{ fontSize: "var(--font-size-xs)" }}>
                    Run
                  </Link>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ color: "var(--color-muted)", fontSize: "var(--font-size-sm)" }}>No saved searches yet. Search for contracts and save your filters.</p>
          )}
        </div>
      )}
    </div>
  );
}
