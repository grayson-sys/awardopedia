"use client";

import { Zap, Star, Rocket } from "lucide-react";
import { purchaseCredits } from "@/lib/api";

const packs = [
  {
    id: "starter",
    name: "Starter",
    credits: 100,
    price: 9,
    icon: Zap,
    perCredit: "$0.09",
    tagline: "100 quick summaries",
    bullets: [
      "100 plain-English contract summaries",
      "or ~33 full opportunity analyses",
      "Good for occasional research",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    credits: 500,
    price: 29,
    icon: Star,
    perCredit: "$0.06",
    tagline: "A month of BD work",
    popular: true,
    bullets: [
      "~165 full opportunity analyses",
      "or 100 competitor deep-dives",
      "Covers a full BD pipeline",
    ],
  },
  {
    id: "power",
    name: "Power",
    credits: 2000,
    price: 79,
    icon: Rocket,
    perCredit: "$0.04",
    tagline: "For teams & heavy users",
    bullets: [
      "~665 full opportunity analyses",
      "Share across your whole team",
      "Best per-credit rate",
    ],
  },
];

export default function CreditPacks() {
  async function handlePurchase(packId) {
    try {
      const { url } = await purchaseCredits(packId);
      window.location.href = url;
    } catch (err) {
      alert(err.message);
    }
  }

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
      gap: "var(--space-6)",
    }}>
      {packs.map((pack) => {
        const Icon = pack.icon;
        return (
          <div
            key={pack.id}
            className="card"
            style={{
              textAlign: "center",
              position: "relative",
              border: pack.popular ? "2px solid var(--color-amber)" : undefined,
            }}
          >
            {pack.popular && (
              <div style={{
                position: "absolute",
                top: -12,
                left: "50%",
                transform: "translateX(-50%)",
                background: "var(--color-amber)",
                color: "var(--color-white)",
                fontSize: "var(--font-size-xs)",
                fontWeight: "var(--font-weight-medium)",
                padding: "2px 12px",
                borderRadius: "var(--border-radius)",
                whiteSpace: "nowrap",
              }}>
                Most Popular
              </div>
            )}

            <div style={{
              width: 48, height: 48,
              borderRadius: "var(--border-radius)",
              background: "var(--color-navy-light)",
              color: "var(--color-navy)",
              display: "flex", alignItems: "center", justifyContent: "center",
              margin: "0 auto var(--space-4)",
            }}>
              <Icon size={24} />
            </div>

            <h3 style={{ fontSize: "var(--font-size-lg)", fontWeight: "var(--font-weight-medium)", marginBottom: "var(--space-1)" }}>
              {pack.name}
            </h3>

            <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-3xl)", fontWeight: "var(--font-weight-medium)", color: "var(--color-navy)" }}>
              ${pack.price}
            </div>

            <div style={{ fontSize: "var(--font-size-sm)", color: "var(--color-muted)", margin: "var(--space-1) 0 var(--space-1)" }}>
              {pack.credits.toLocaleString()} credits &nbsp;&middot;&nbsp; {pack.perCredit}/credit
            </div>

            <div style={{
              fontSize: "var(--font-size-xs)",
              fontWeight: "var(--font-weight-medium)",
              color: "var(--color-amber)",
              marginBottom: "var(--space-4)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}>
              {pack.tagline}
            </div>

            <ul style={{
              listStyle: "none",
              padding: 0,
              margin: "0 0 var(--space-5)",
              textAlign: "left",
              fontSize: "var(--font-size-sm)",
              color: "var(--color-muted)",
            }}>
              {pack.bullets.map((b, i) => (
                <li key={i} style={{ display: "flex", gap: "var(--space-2)", marginBottom: "var(--space-1)" }}>
                  <span style={{ color: "var(--color-success)", flexShrink: 0 }}>{"\u2713"}</span>
                  {b}
                </li>
              ))}
            </ul>

            <button className="btn-primary" onClick={() => handlePurchase(pack.id)} style={{ width: "100%" }}>
              Buy {pack.name}
            </button>
          </div>
        );
      })}
    </div>
  );
}
