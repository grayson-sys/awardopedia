import Link from "next/link";
import SearchBar from "@/components/SearchBar";
import TrustBox from "@/components/TrustBox";
import HomeStats from "./HomeStats";
import RecentAwardsTable from "./RecentAwardsTable";

// No server-side data fetching — stats + recent awards load client-side
// to avoid ISR build failures when DO API is mid-deploy
export const revalidate = 86400;

export default function Home() {
  return (
    <>
      <section style={{ padding: "var(--space-16) 0 var(--space-10)", textAlign: "center" }}>
        <div className="container">
          <div style={{
            display: "inline-block",
            fontSize: "var(--font-size-sm)",
            fontWeight: "var(--font-weight-medium)",
            color: "var(--color-amber)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            marginBottom: "var(--space-3)",
          }}>
            Finally.
          </div>
          <h1 style={{ fontSize: "var(--font-size-4xl)", fontWeight: "var(--font-weight-medium)", marginBottom: "var(--space-4)", color: "var(--color-navy)", lineHeight: 1.2 }}>
            A Free Window Into<br />Government Contracts
          </h1>
          <p style={{ fontSize: "var(--font-size-lg)", color: "var(--color-muted)", maxWidth: 580, margin: "0 auto var(--space-5)" }}>
            The U.S. government spends over $700 billion a year on contracts. That data is legally
            public — but platforms like GovWin charge $200/month to search it.
          </p>
          <p style={{ fontSize: "var(--font-size-base)", color: "var(--color-text)", fontWeight: "var(--font-weight-medium)", maxWidth: 480, margin: "0 auto var(--space-8)" }}>
            Here it&rsquo;s free. Every award, every agency, every contractor.
          </p>
          <SearchBar />
          <div style={{
            display: "flex",
            justifyContent: "center",
            flexWrap: "wrap",
            gap: "var(--space-5)",
            marginTop: "var(--space-6)",
            fontSize: "var(--font-size-sm)",
            color: "var(--color-muted)",
          }}>
            {["Search all contracts", "Agency profiles", "Contractor history", "Expiring contracts", "State & sector breakdowns"].map((item) => (
              <span key={item} style={{ display: "flex", alignItems: "center", gap: "var(--space-1)" }}>
                <span style={{ color: "var(--color-success)", fontWeight: "var(--font-weight-medium)" }}>✓</span>
                {item} — free
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="container" style={{ marginBottom: "var(--space-12)" }}>
        <HomeStats />
      </section>

      <section className="container" style={{ marginBottom: "var(--space-12)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-4)" }}>
          <h2 style={{ fontSize: "var(--font-size-xl)", fontWeight: "var(--font-weight-medium)" }}>Recent Awards</h2>
          <Link href="/awards" className="btn-secondary" style={{ fontSize: "var(--font-size-sm)" }}>View All</Link>
        </div>
        <RecentAwardsTable data={[]} clientLoad />
        <TrustBox />
      </section>
    </>
  );
}
