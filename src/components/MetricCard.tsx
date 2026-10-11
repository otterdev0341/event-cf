interface MetricCardProps {
  description?: string;
  label: string;
  tone?: "primary" | "success" | "danger" | "warning" | "neutral";
  value: string;
}

export function MetricCard({ description, label, tone = "primary", value }: MetricCardProps) {
  return (
    <article className="metric-card">
      <p className="metric-card__label">{label}</p>
      <p className={`metric-card__value metric-card__value--${tone}`}>{value}</p>
      {description && <p className="metric-card__description">{description}</p>}
    </article>
  );
}
