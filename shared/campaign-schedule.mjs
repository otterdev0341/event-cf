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

export function nextScheduleTime(after, recurrence, time, weekdays = []) {
  const stamp = typeof after === 'number' ? after : Date.parse(after);
  if (!Number.isFinite(stamp) || !['daily','weekly'].includes(recurrence)) return null;
  if (recurrence === 'weekly' && (!Array.isArray(weekdays) || !weekdays.length || weekdays.some(d => !Number.isInteger(d) || d < 0 || d > 6))) return null;
  const local = new Date(stamp + 7 * 3600000);
  for (let offset = 0; offset <= 7; offset++) {
    const day = new Date(Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate()+offset));
    if (recurrence === 'weekly' && !weekdays.includes(day.getUTCDay())) continue;
    const candidate = scheduledTime(day.toISOString().slice(0,10),time);
    if (candidate && Date.parse(candidate) > stamp) return candidate;
  }
  return null;
}
export function firstScheduleTime({date,time,recurrence,weekdays = []}, now = Date.now()) {
  const initial = scheduledTime(date,time);
  if (!initial || !['once','daily','weekly'].includes(recurrence)) return null;
  if (recurrence === 'once') return Date.parse(initial) > now ? initial : null;
  return nextScheduleTime(Math.max(now,Date.parse(initial)-1),recurrence,time,weekdays);
}
