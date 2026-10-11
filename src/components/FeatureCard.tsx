interface FeatureCardProps {
  icon: string;
  title: string;
  description: string;
}

export function FeatureCard({ icon, title, description }: FeatureCardProps) {
  return (
    <article className="feature-card">
      <span className="feature-card__icon" aria-hidden="true">
        <img src={icon} width="24" height="24" alt="" />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
    </article>
  );
}

