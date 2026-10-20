import { useSession } from '../../features/auth';
import { useWorkspace } from '../../stores/workspace';
export function usePermissions() {
  const session = useSession();
  const orgId = useWorkspace((s) => s.orgId);
  const role = session.data?.organizations.find((o) => o.id === orgId)?.role;
  return { role, canEdit: !!role && role !== 'viewer', canAdmin: role === 'owner' || role === 'admin' };
}
