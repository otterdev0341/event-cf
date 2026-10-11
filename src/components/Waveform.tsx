interface WaveformProps {
  heights: number[];
  animated?: boolean;
  className?: string;
  label?: string;
}

export function Waveform({ heights, className = "", label, animated = false }: WaveformProps) {
  return (
    <div
      className={["waveform", animated ? "waveform--animated" : "", className].filter(Boolean).join(" ")}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {heights.map((height, index) => (
        <span
          className="waveform__bar"
          key={`${height}-${index}`}
          style={{ height, animationDelay: `${index * -0.13}s`, animationDuration: `${0.65 + (index % 5) * 0.12}s` }}
        />
      ))}
    </div>
  );
}

