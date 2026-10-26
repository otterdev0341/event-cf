interface StatusBadgeProps {
  children: string;
  dot?: boolean;
  dotSrc?: string;
  size?: "default" | "compact" | "campaign";
  tone: "primary" | "success" | "danger" | "warning" | "info" | "neutral";
}

export function StatusBadge({
  children,
  dot = false,
  dotSrc = import.meta.env.BASE_URL + "assets/live-agent/status-dot.svg",
  size = "default",
  tone,
}: StatusBadgeProps) {
  return (
    <span className={`status-badge status-badge--${tone} status-badge--${size}`}>
      {dot && <img src={dotSrc} width="6" height="6" alt="" />}
      {children}
    </span>
  );
}
