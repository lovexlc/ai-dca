export function StatCard({ label, value, note, tone = 'default' }) {
  return (
    <section className={`stat-card stat-card--${tone}`}>
      <div className="stat-card__label">{label}</div>
      <div className="stat-card__value">{value}</div>
      {note ? <div className="stat-card__note">{note}</div> : null}
    </section>
  );
}
