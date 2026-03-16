import { ExternalLink } from "lucide-react";

export default function ProvenancePanel({ award }) {
  const confidence = award.confidence != null ? Math.round(award.confidence * 100) : null;

  return (
    <div className="provenance-panel">
      <div className="provenance-panel__title">Data Provenance</div>
      <div className="provenance-panel__row">
        <span className="provenance-panel__label">Source</span>
        <span className="provenance-panel__value">USASpending.gov</span>
      </div>
      {award.source_fetched_at && (
        <div className="provenance-panel__row">
          <span className="provenance-panel__label">Retrieved</span>
          <span className="provenance-panel__value">
            {new Date(award.source_fetched_at).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}
          </span>
        </div>
      )}
      {confidence != null && (
        <div className="provenance-panel__row">
          <span className="provenance-panel__label">Confidence</span>
          <span className="provenance-panel__value">{confidence}%</span>
        </div>
      )}
      <div className="provenance-panel__links">
        {award.usaspending_url && (
          <a href={award.usaspending_url} target="_blank" rel="noopener noreferrer" className="btn-secondary" style={{ fontSize: "var(--font-size-xs)", padding: "4px 10px" }}>
            <ExternalLink size={12} /> View on USASpending &rarr;
          </a>
        )}
        {award.solicitation_url && (
          <a href={award.solicitation_url} target="_blank" rel="noopener noreferrer" className="btn-secondary" style={{ fontSize: "var(--font-size-xs)", padding: "4px 10px" }}>
            <ExternalLink size={12} /> View solicitation on SAM.gov &rarr;
          </a>
        )}
      </div>
    </div>
  );
}
