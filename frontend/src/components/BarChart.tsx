import { useEffect, useRef } from 'react';
import { Chart, BarController, BarElement, CategoryScale, LinearScale, Legend, Tooltip } from 'chart.js';
import { useTheme } from '../stores/theme';
Chart.register(BarController, BarElement, CategoryScale, LinearScale, Legend, Tooltip);
type Series = { label: string; values: number[]; color: string };
export function BarChart({ title, labels, series }: { title: string; labels: string[]; series: Series[] }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const theme = useTheme((s) => s.theme);
  useEffect(() => {
    if (!canvas.current) return;
    const chart = new Chart(canvas.current, {
      type: 'bar',
      data: {
        labels,
        datasets: series.map((s) => ({
          label: s.label,
          data: s.values,
          backgroundColor: s.color,
          borderRadius: 2,
          maxBarThickness: 36,
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: { legend: { labels: { color: '#85857c', boxWidth: 10 } } },
        scales: {
          y: { beginAtZero: true, ticks: { precision: 0, color: '#85857c' }, grid: { color: '#88888822' } },
          x: { ticks: { color: '#85857c' }, grid: { display: false } },
        },
      },
    });
    return () => chart.destroy();
  }, [labels, series, theme]);
  return (
    <>
      <div style={{ height: 260 }}>
        <canvas ref={canvas} role="img" aria-label={title} />
      </div>
      <details className="mt-3">
        <summary className="muted text-xs">ดูข้อมูล {title} แบบตาราง</summary>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Period / person</th>
                {series.map((s) => (
                  <th key={s.label}>{s.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {labels.map((label, i) => (
                <tr key={`${label}-${i}`}>
                  <td>{label}</td>
                  {series.map((s) => (
                    <td key={s.label}>{s.values[i]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
