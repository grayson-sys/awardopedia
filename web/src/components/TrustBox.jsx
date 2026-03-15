import { ShieldCheck } from 'lucide-react';

export default function TrustBox() {
  return (
    <div className="trust-box">
      <ShieldCheck size={20} className="trust-box__icon" />
      <div>
        Data sourced from{' '}
        <a href="https://www.usaspending.gov" target="_blank" rel="noopener noreferrer">
          USASpending.gov
        </a>
        , the official open data source of federal spending information, maintained by the
        U.S. Department of the Treasury as mandated by the Federal Funding Accountability
        and Transparency Act (FFATA). Updated weekly.
      </div>
    </div>
  );
}
