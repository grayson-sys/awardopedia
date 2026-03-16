export const metadata = {
  title: "About Awardopedia",
  description: "Free federal contract data from USASpending.gov. Search every U.S. government contract award at no cost.",
};

export default function AboutPage() {
  return (
    <div className="container" style={{ padding: "var(--space-12) 0", maxWidth: 700 }}>
      <h1 style={{ fontSize: "var(--font-size-2xl)", fontWeight: "var(--font-weight-medium)", marginBottom: "var(--space-6)" }}>
        About Awardopedia
      </h1>

      <section style={{ marginBottom: "var(--space-8)" }}>
        <h2 style={{ fontSize: "var(--font-size-lg)", fontWeight: "var(--font-weight-medium)", marginBottom: "var(--space-3)" }}>
          What this is
        </h2>
        <p style={{ fontSize: "var(--font-size-base)", lineHeight: "var(--line-height-relaxed)", color: "var(--color-text)", marginBottom: "var(--space-3)" }}>
          Awardopedia is a free, searchable interface for federal contract award data. All data comes
          from USASpending.gov, the official source of federal spending information maintained by the
          U.S. Department of the Treasury.
        </p>
        <p style={{ fontSize: "var(--font-size-base)", lineHeight: "var(--line-height-relaxed)", color: "var(--color-text)" }}>
          The site provides search, filtering, and analysis tools for government contracts, grants,
          and other federal awards. Core data access is free. AI-powered analysis features use credits
          that can be purchased.
        </p>
      </section>

      <section style={{ marginBottom: "var(--space-8)" }}>
        <h2 style={{ fontSize: "var(--font-size-lg)", fontWeight: "var(--font-weight-medium)", marginBottom: "var(--space-3)" }}>
          Data source
        </h2>
        <p style={{ fontSize: "var(--font-size-base)", lineHeight: "var(--line-height-relaxed)", color: "var(--color-text)", marginBottom: "var(--space-3)" }}>
          All contract data is sourced from{" "}
          <a href="https://www.usaspending.gov" target="_blank" rel="noopener noreferrer">USASpending.gov</a>,
          as mandated by the Federal Funding Accountability and Transparency Act (FFATA) of 2006 and
          the Digital Accountability and Transparency Act (DATA Act) of 2014.
        </p>
        <p style={{ fontSize: "var(--font-size-base)", lineHeight: "var(--line-height-relaxed)", color: "var(--color-text)" }}>
          Data is synchronized weekly from the USASpending API. Award records include contract
          obligations, recipient information, NAICS classifications, and performance periods.
        </p>
      </section>

      <section style={{ marginBottom: "var(--space-8)" }}>
        <h2 style={{ fontSize: "var(--font-size-lg)", fontWeight: "var(--font-weight-medium)", marginBottom: "var(--space-3)" }}>
          Why free
        </h2>
        <p style={{ fontSize: "var(--font-size-base)", lineHeight: "var(--line-height-relaxed)", color: "var(--color-text)" }}>
          Federal spending data is public information. Services like GovWin and Bloomberg Government
          charge hundreds of dollars per month to access the same underlying data. Awardopedia provides
          free access to this data with a sustainable model: core data is free, optional AI analysis
          features are paid via credits.
        </p>
      </section>

      <section>
        <h2 style={{ fontSize: "var(--font-size-lg)", fontWeight: "var(--font-weight-medium)", marginBottom: "var(--space-3)" }}>
          Limitations
        </h2>
        <ul style={{ fontSize: "var(--font-size-base)", lineHeight: "var(--line-height-relaxed)", color: "var(--color-text)", paddingLeft: "var(--space-6)", listStyle: "disc" }}>
          <li style={{ marginBottom: "var(--space-2)" }}>Data may lag USASpending.gov by up to 7 days</li>
          <li style={{ marginBottom: "var(--space-2)" }}>Not all USASpending fields are included</li>
          <li style={{ marginBottom: "var(--space-2)" }}>AI analysis is generated and may contain inaccuracies</li>
          <li>Not affiliated with USASpending.gov or any government agency</li>
        </ul>
      </section>
    </div>
  );
}
