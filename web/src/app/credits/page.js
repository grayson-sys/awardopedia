"use client";

import { useState, useEffect } from "react";
import { Mail, CheckCircle, Loader, CreditCard, Shield, Zap } from "lucide-react";
import CreditPacks from "@/components/CreditPacks";
import { sendMagicLink, verifyMagicLink, clientApi } from "@/lib/api";

const TOKEN_KEY = "aw_token";

export default function CreditsPage() {
  const [user, setUser] = useState(null);
  const [email, setEmail] = useState("");
  const [authState, setAuthState] = useState("loading"); // loading | anonymous | link_sent | authenticated
  const [error, setError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get("token");

    if (urlToken) {
      verifyMagicLink(urlToken)
        .then(({ jwt, user: u }) => {
          localStorage.setItem(TOKEN_KEY, jwt);
          setUser(u);
          setAuthState("authenticated");
          window.history.replaceState({}, "", "/credits");
        })
        .catch(() => {
          setError("Invalid or expired link. Please request a new one.");
          setAuthState("anonymous");
        });
      return;
    }

    const stored = localStorage.getItem(TOKEN_KEY);
    if (stored) {
      clientApi("/users/me")
        .then((u) => { setUser(u); setAuthState("authenticated"); })
        .catch(() => { localStorage.removeItem(TOKEN_KEY); setAuthState("anonymous"); });
    } else {
      setAuthState("anonymous");
    }
  }, []);

  async function handleSendLink(e) {
    e.preventDefault();
    setError("");
    try {
      await sendMagicLink(email);
      setAuthState("link_sent");
    } catch (err) {
      setError(err.message);
    }
  }

  if (authState === "loading") {
    return (
      <div className="container" style={{ padding: "var(--space-12) 0", textAlign: "center" }}>
        <Loader size={32} style={{ animation: "spin 1s linear infinite" }} />
      </div>
    );
  }

  return (
    <div className="container" style={{ padding: "var(--space-8) 0", maxWidth: 900, margin: "0 auto" }}>
      <h1 style={{ fontSize: "var(--font-size-2xl)", fontWeight: "var(--font-weight-medium)", marginBottom: "var(--space-2)" }}>
        AI Credits
      </h1>
      <p style={{ color: "var(--color-muted)", marginBottom: "var(--space-8)" }}>
        Unlock AI-powered contract analysis. No subscription. No auto-renew.
      </p>

      {authState === "authenticated" && user && (
        <div className="card" style={{ marginBottom: "var(--space-8)", display: "flex", alignItems: "center", gap: "var(--space-4)" }}>
          <div style={{
            width: 48, height: 48, borderRadius: "var(--border-radius)",
            background: "var(--color-amber)", color: "var(--color-white)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xl)", fontWeight: "var(--font-weight-medium)",
          }}>
            {user.credits ?? 0}
          </div>
          <div>
            <div style={{ fontWeight: "var(--font-weight-medium)" }}>Credits remaining</div>
            <div style={{ fontSize: "var(--font-size-sm)", color: "var(--color-muted)" }}>{user.email}</div>
          </div>
        </div>
      )}

      {authState === "anonymous" && (
        <div className="card" style={{ marginBottom: "var(--space-8)", maxWidth: 420 }}>
          <h2 style={{ fontSize: "var(--font-size-lg)", fontWeight: "var(--font-weight-medium)", marginBottom: "var(--space-4)" }}>
            <Mail size={18} style={{ verticalAlign: "text-bottom", marginRight: 6 }} />
            Sign in to buy credits
          </h2>
          <form onSubmit={handleSendLink}>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              required
              style={{
                width: "100%", padding: "var(--space-2) var(--space-3)",
                border: "1px solid var(--color-border)", borderRadius: "var(--border-radius)",
                fontSize: "var(--font-size-base)", marginBottom: "var(--space-3)",
              }}
            />
            <button type="submit" className="btn-primary" style={{ width: "100%" }}>
              Send magic link
            </button>
          </form>
          {error && <p style={{ color: "var(--color-error)", fontSize: "var(--font-size-sm)", marginTop: "var(--space-2)" }}>{error}</p>}
        </div>
      )}

      {authState === "link_sent" && (
        <div className="card" style={{ marginBottom: "var(--space-8)", maxWidth: 420, textAlign: "center" }}>
          <CheckCircle size={32} style={{ color: "var(--color-success)", marginBottom: "var(--space-3)" }} />
          <h2 style={{ fontSize: "var(--font-size-lg)", fontWeight: "var(--font-weight-medium)", marginBottom: "var(--space-2)" }}>
            Check your email
          </h2>
          <p style={{ color: "var(--color-muted)", fontSize: "var(--font-size-sm)" }}>
            We sent a sign-in link to <strong>{email}</strong>. Click it to continue.
          </p>
        </div>
      )}

      <section style={{ marginBottom: "var(--space-10)" }}>
        <h2 style={{ fontSize: "var(--font-size-xl)", fontWeight: "var(--font-weight-medium)", marginBottom: "var(--space-6)" }}>
          Choose a credit pack
        </h2>
        <CreditPacks />
      </section>

      <section style={{ marginBottom: "var(--space-10)" }}>
        <h2 style={{ fontSize: "var(--font-size-lg)", fontWeight: "var(--font-weight-medium)", marginBottom: "var(--space-4)" }}>
          <CreditCard size={18} style={{ verticalAlign: "text-bottom", marginRight: 6 }} />
          What credits buy
        </h2>
        <div style={{ overflowX: "auto" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Action</th>
                <th className="text-right">Credits</th>
                <th>What you get</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Summary</td>
                <td className="text-right mono">1</td>
                <td>Plain-English contract summary</td>
              </tr>
              <tr>
                <td>Full Analysis</td>
                <td className="text-right mono">3</td>
                <td>Fit score, proposal themes, competitive landscape</td>
              </tr>
              <tr>
                <td>Deep Dive</td>
                <td className="text-right mono">5</td>
                <td>Agency report, historical patterns, win strategies</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section style={{ marginBottom: "var(--space-10)" }}>
        <h2 style={{ fontSize: "var(--font-size-lg)", fontWeight: "var(--font-weight-medium)", marginBottom: "var(--space-4)" }}>
          How we compare
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "var(--space-4)" }}>
          <div className="card" style={{ textAlign: "center" }}>
            <div style={{ fontSize: "var(--font-size-sm)", color: "var(--color-muted)", marginBottom: "var(--space-2)" }}>GovWin / Deltek</div>
            <div style={{ fontSize: "var(--font-size-xl)", fontWeight: "var(--font-weight-medium)", color: "var(--color-error)" }}>~$200/mo</div>
            <div style={{ fontSize: "var(--font-size-xs)", color: "var(--color-muted)" }}>Annual contract required</div>
          </div>
          <div className="card" style={{ textAlign: "center" }}>
            <div style={{ fontSize: "var(--font-size-sm)", color: "var(--color-muted)", marginBottom: "var(--space-2)" }}>BD Consultant</div>
            <div style={{ fontSize: "var(--font-size-xl)", fontWeight: "var(--font-weight-medium)", color: "var(--color-error)" }}>$150-250/hr</div>
            <div style={{ fontSize: "var(--font-size-xs)", color: "var(--color-muted)" }}>Plus retainer fees</div>
          </div>
          <div className="card" style={{ textAlign: "center", border: "2px solid var(--color-amber)" }}>
            <div style={{ fontSize: "var(--font-size-sm)", color: "var(--color-amber)", fontWeight: "var(--font-weight-medium)", marginBottom: "var(--space-2)" }}>Awardopedia Pro</div>
            <div style={{ fontSize: "var(--font-size-xl)", fontWeight: "var(--font-weight-medium)", color: "var(--color-navy)" }}>$29</div>
            <div style={{ fontSize: "var(--font-size-xs)", color: "var(--color-muted)" }}>One-time, 500 credits</div>
          </div>
        </div>
      </section>

      <section className="card" style={{ background: "var(--color-bg-muted)", fontSize: "var(--font-size-sm)", color: "var(--color-muted)" }}>
        <Shield size={16} style={{ verticalAlign: "text-bottom", marginRight: 6 }} />
        <strong>Fine print that&rsquo;s actually fine:</strong> Credits never expire. No subscription.
        No auto-renew. No recurring charges. AI analysis is powered by Claude (Anthropic).
        All underlying contract data remains free and public.
      </section>
    </div>
  );
}
