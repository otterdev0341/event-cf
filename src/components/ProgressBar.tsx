interface ProgressBarProps {
  className?: string;
  label: string;
  value: number;
  valueLabel: string;
}

export function ProgressBar({ className = "", label, value, valueLabel }: ProgressBarProps) {
  return (
    <div className={["progress-bar", className].filter(Boolean).join(" ")}>
      <div className="progress-bar__labels">
        <span>{label}</span>
        <strong>{valueLabel}</strong>
      </div>
      <div
        className="progress-bar__track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
      >
        <span className="progress-bar__fill" style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}
