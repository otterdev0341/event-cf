import type { Organization, Session } from '../contracts/identity';
export const roleLabels = {
  root: 'Root',
  org_admin: 'Org admin',
  event_admin: 'Event admin',
  team_member: 'Team member',
};
export function permissions(
  user: Session['user'] | undefined,
  org: Organization | undefined,
  eventId: string,
) {
  const root = user?.platformRole === 'root';
  const canAdmin = root || org?.role === 'org_admin';
  const assigned = !!org?.eventIds.includes(eventId);
  return {
    role: root ? 'root' : org?.role,
    canAdmin,
    canEdit: canAdmin || (org?.role === 'event_admin' && assigned),
    canCreateEvent: canAdmin,
    canTickets: canAdmin || (assigned && (org?.role === 'event_admin' || org?.role === 'team_member')),
  };
}
