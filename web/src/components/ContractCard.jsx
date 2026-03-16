import Link from "next/link";
import { Building2, Calendar, MapPin, Tag } from "lucide-react";
import { formatCurrency, formatDateShort } from "@/lib/format";

export default function ContractCard({ award }) {
  return (
    <Link href={`/awards/${award.award_id}`} style={{ textDecoration: "none", color: "inherit" }}>
      <div className="contract-card">
        <div className="contract-card__header">
          <div className="contract-card__title">
            {award.description || award.award_id_piid || "Untitled Award"}
          </div>
          <div className="contract-card__amount">
            {formatCurrency(award.federal_action_obligation)}
          </div>
        </div>
        <div className="contract-card__meta">
          {award.agency_name && (
            <span className="contract-card__meta-item">
              <Building2 size={14} />
              {award.agency_name}
            </span>
          )}
          {award.recipient_name && (
            <span className="contract-card__meta-item">
              <Tag size={14} />
              {award.recipient_name}
            </span>
          )}
          {award.action_date && (
            <span className="contract-card__meta-item">
              <Calendar size={14} />
              {formatDateShort(award.action_date)}
            </span>
          )}
          {award.recipient_state && (
            <span className="contract-card__meta-item">
              <MapPin size={14} />
              {award.recipient_state}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
