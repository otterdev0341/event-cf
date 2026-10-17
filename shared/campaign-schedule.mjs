// Campaign dates are entered in Thailand time, regardless of the browser's timezone.
export function scheduledTime(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !/^\d{2}:\d{2}$/.test(time || '')) return null;
  const value = Date.parse(`${date}T${time}:00+07:00`);
  if (!Number.isFinite(value)) return null;
  const local = new Date(value + 7 * 3600000).toISOString().slice(0, 16);
  return local === `${date}T${time}` ? new Date(value).toISOString() : null;
}
export function scheduleLabel(value) {
  return new Date(value).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' });
}
export const activeSchedule = job => ['scheduled', 'running'].includes(job?.status);
