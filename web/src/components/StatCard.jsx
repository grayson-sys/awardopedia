export default function StatCard({ label, value, subtext, icon: Icon }) {
  return (
    <div className="stat-card">
      {Icon && (
        <div className="stat-card__icon">
          <Icon size={20} />
        </div>
      )}
      <div className="stat-card__content">
        <div className="stat-card__label">{label}</div>
        <div className="stat-card__value">{value}</div>
        {subtext && <div className="stat-card__subtext">{subtext}</div>}
      </div>
    </div>
  );
}
