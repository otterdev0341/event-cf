import type { Participant } from '../../shared/contracts/calling';
export function callSeries(people: Participant[], period: 'daily' | 'weekly', now = new Date()) {
  const bangkokDay = (date: Date) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  const today = new Date(`${bangkokDay(now)}T00:00:00Z`);
  if (period === 'weekly') today.setUTCDate(today.getUTCDate() - ((today.getUTCDay() + 6) % 7));
  const count = period === 'daily' ? 7 : 8;
  const step = period === 'daily' ? 1 : 7;
  const dates = Array.from(
    { length: count },
    (_, i) => new Date(today.getTime() - (count - 1 - i) * step * 86400000),
  );
  const labels = dates.map((d) => d.toISOString().slice(0, 10));
  const values = labels.map(() => 0);
  for (const person of people)
    for (const attempt of person.attempts) {
      const at = new Date(attempt.at);
      if (!Number.isFinite(at.getTime()) || at > now) continue;
      const date = new Date(`${bangkokDay(at)}T00:00:00Z`);
      if (period === 'weekly') date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
      const index = labels.indexOf(date.toISOString().slice(0, 10));
      if (index !== -1) values[index]++;
    }
  return { labels, values };
}
