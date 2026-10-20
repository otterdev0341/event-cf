import { useQuery } from '@tanstack/react-query';
import { useWorkspace } from '../../stores/workspace';
import { eventService } from './service';
export function useEvents() {
  const org = useWorkspace((s) => s.orgId);
  return useQuery({
    queryKey: ['org', org, 'events'],
    enabled: !!org,
    queryFn: ({ signal }) => eventService.list(org, signal),
  });
}
export function useEvent() {
  const events = useEvents();
  const eventId = useWorkspace((s) => s.eventId);
  return { ...events, event: events.data?.find((e) => e.id === eventId) };
}
