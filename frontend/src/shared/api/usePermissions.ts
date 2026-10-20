import { useSession } from '../../features/auth';
import { useWorkspace } from '../../stores/workspace';
import { permissions } from '../policy/roles';
export function usePermissions() {
  const session = useSession();
  const { orgId, eventId } = useWorkspace();
  const org = session.data?.organizations.find((o) => o.id === orgId);
  return {
    ...permissions(session.data?.user, org, eventId),
    canEditEvent: (id: string) => permissions(session.data?.user, org, id).canEdit,
  };
}
