import { ShieldCheck } from "lucide-react";

export default function TrustBox({ sourceUrl }) {
  return (
    <div className="trust-box">
      <ShieldCheck size={20} className="trust-box__icon" style={{ flexShrink: 0 }} />
      <div>
        <strong>This data is public, and so is our access to it.</strong>{" "}
        Sourced from{" "}
        <a href="https://www.usaspending.gov" target="_blank" rel="noopener noreferrer">
          USASpending.gov
        </a>
        {" "}— the official federal spending database maintained by the U.S. Treasury under
        the Federal Funding Accountability and Transparency Act. Every contract record
        includes a direct source link. We don&rsquo;t lock public data behind a paywall.
        {sourceUrl && (
          <>
            {" "}
            <a href={sourceUrl} target="_blank" rel="noopener noreferrer">
              View original record &rarr;
            </a>
          </>
        )}
      </div>
    </div>
  );
}
