import { useQuery } from '@tanstack/react-query';
import { useWorkspace } from '../../stores/workspace';
export function useEventQuery<T>(
  name: string,
  load: (org: string, event: string, signal: AbortSignal) => Promise<T>,
) {
  const { orgId, eventId } = useWorkspace();
  return useQuery({
    queryKey: ['org', orgId, eventId, name],
    enabled: !!orgId && !!eventId,
    queryFn: ({ signal }) => load(orgId, eventId, signal),
  });
}
