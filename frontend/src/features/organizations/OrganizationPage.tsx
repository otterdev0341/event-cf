import { useState } from 'react';
import { memberService } from './service';
import { useMembers } from './hooks';
import { useEvents } from '../events';
import { useSession } from '../auth';
import type { Member, Role } from '../../shared/contracts/identity';
import { roleLabels } from '../../shared/policy/roles';
import { useWorkspace } from '../../stores/workspace';
import { usePermissions } from '../../shared/api/usePermissions';
import { useAction } from '../../shared/api/query';
import { Dialog } from '../../components/Dialog';
import { Badge, Button, Empty, Feedback, Field, formText, PageHeader, QueryState } from '../../components/ui';
export function OrganizationPage() {
  const { orgId } = useWorkspace();
  const { canAdmin } = usePermissions();
  const session = useSession();
  const events = useEvents();
  const members = useMembers();
  const [editing, setEditing] = useState<Member | 'new' | null>(null);
  const [role, setRole] = useState<Role>('team_member');
  const save = useAction(
    async (input: { email: string; role: Role; eventIds: string[] }) => {
      if (editing && editing !== 'new')
        await memberService.change(orgId, editing.id, input.role, input.eventIds);
      else await memberService.invite(orgId, input);
      setEditing(null);
    },
    ['org', orgId],
  );
  const remove = useAction((id: string) => memberService.remove(orgId, id), ['org', orgId]);
  if (!canAdmin) return <Empty title="เฉพาะ Root และ Org admin">จัดการทีมและ Role policy ในองค์กร</Empty>;
  return (
    <>
      <PageHeader
        eyebrow="SETTINGS / TEAM MANAGEMENT"
        title="A shared space. Clear roles."
        description="สมาชิกอยู่ภายในองค์กร กำหนด event ที่รับผิดชอบให้แต่ละคน"
        action={
          <Button
            variant="brand"
            onClick={() => {
              save.reset();
              setRole('team_member');
              setEditing('new');
            }}
          >
            Invite member
          </Button>
        }
      />
      {__MOCK__ && <p className="notice">Invitation preview เท่านั้น — ไม่มีการส่งอีเมลจริง</p>}
      <Feedback error={remove.error} notice={save.notice || remove.notice} />
      <QueryState pending={members.isPending} error={members.error} retry={members.refetch} />
      <div className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>Email</th>
              <th>Role</th>
              <th>Events</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {members.data?.map((m) => (
              <tr key={m.id}>
                <td>{m.email}</td>
                <td>{roleLabels[m.role]}</td>
                <td>
                  {['root', 'org_admin'].includes(m.role)
                    ? 'All events'
                    : m.eventIds.map((id) => events.data?.find((e) => e.id === id)?.name ?? id).join(', ') ||
                      'No event grants'}
                </td>
                <td>
                  <Badge>{m.status}</Badge>
                </td>
                <td>
                  {m.id !== session.data?.user.id && m.role !== 'root' && (
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        onClick={() => {
                          save.reset();
                          setRole(m.role);
                          setEditing(m);
                        }}
                      >
                        Edit role
                      </Button>
                      <Button
                        variant="ghost"
                        pending={remove.isPending}
                        onClick={() => {
                          if (window.confirm(`นำ ${m.email} ออกจากองค์กร?`)) remove.mutate(m.id);
                        }}
                      >
                        Remove
                      </Button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="panel table-wrap mt-6">
        <table aria-label="Role policy">
          <thead>
            <tr>
              <th>Role</th>
              <th>Scope / capabilities</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Root</td>
              <td>Platform administration; provisioned separately, never granted from an organization</td>
            </tr>
            <tr>
              <td>Org admin</td>
              <td>All events, team management, organization and agent credentials</td>
            </tr>
            <tr>
              <td>Event admin</td>
              <td>Edit assigned events, knowledge, imports, calls and follow-up</td>
            </tr>
            <tr>
              <td>Team member</td>
              <td>Read organization events; manage follow-up in assigned events</td>
            </tr>
          </tbody>
        </table>
      </div>
      {editing && (
        <Dialog
          title={editing === 'new' ? 'Invite member' : 'Edit member policy'}
          onClose={() => setEditing(null)}
        >
          <form
            className="form-grid"
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              save.mutate({
                email: formText(form, 'email'),
                role,
                eventIds: role === 'org_admin' ? [] : new FormData(form).getAll('eventIds').map(String),
              });
            }}
          >
            <Field label="Email">
              <input
                name="email"
                type="email"
                required
                autoFocus
                readOnly={editing !== 'new'}
                defaultValue={editing === 'new' ? '' : editing.email}
              />
            </Field>
            <Field label="Role">
              <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
                {(['org_admin', 'event_admin', 'team_member'] as const).map((r) => (
                  <option key={r} value={r}>
                    {roleLabels[r]}
                  </option>
                ))}
              </select>
            </Field>
            {role !== 'org_admin' && (
              <fieldset>
                <legend>Event grants</legend>
                {events.data?.map((event) => (
                  <label className="check-row" key={event.id}>
                    <input
                      type="checkbox"
                      name="eventIds"
                      value={event.id}
                      defaultChecked={editing !== 'new' && editing.eventIds.includes(event.id)}
                    />
                    {event.name}
                  </label>
                ))}
              </fieldset>
            )}
            <Feedback error={save.error} />
            <Button variant="brand" pending={save.isPending}>
              {editing === 'new' ? 'ส่งคำเชิญ' : 'Save policy'}
            </Button>
          </form>
        </Dialog>
      )}
    </>
  );
}
