import type { EventDto } from '../../shared/contracts/events';
export type EventSummary = { title: string; dateLabel: string; locationLabel: string; codeLabel: string };
export function toEventSummary(event: EventDto): EventSummary {
  return {
    title: event.name,
    dateLabel: new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${event.date}T12:00:00Z`)),
    locationLabel: event.location,
    codeLabel: event.code,
  };
}
