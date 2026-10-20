import { useQuery } from '@tanstack/react-query';
import { memberService } from './service';
import { useWorkspace } from '../../stores/workspace';
export function useMembers() {
  const orgId = useWorkspace((s) => s.orgId);
  return useQuery({
    queryKey: ['org', orgId, 'members'],
    enabled: !!orgId,
    queryFn: ({ signal }) => memberService.list(orgId, signal),
  });
}
