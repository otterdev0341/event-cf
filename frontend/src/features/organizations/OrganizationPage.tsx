import { memberService } from './service';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { type Role } from '../../shared/contracts/identity';
import { useWorkspace } from '../../stores/workspace';
import { usePermissions } from '../../shared/api/usePermissions';
import { useAction } from '../../shared/api/query';
import { Dialog } from '../../components/Dialog';
import { Badge, Button, Empty, Feedback, Field, formText, PageHeader, QueryState } from '../../components/ui';
export function OrganizationPage() {
  const { orgId } = useWorkspace();
  const { canAdmin } = usePermissions();
  const [open, setOpen] = useState(false);
  const members = useQuery({
    queryKey: ['org', orgId, 'members'],
    enabled: canAdmin && !!orgId,
    queryFn: ({ signal }) => memberService.list(orgId, signal),
  });
  const invite = useAction(
    async (input: { email: string; role: Role }) => {
      await memberService.invite(orgId, input);
      setOpen(false);
    },
    ['org', orgId],
  );
  const change = useAction(
    ({ id, role }: { id: string; role: Role }) => memberService.change(orgId, id, role),
    ['org', orgId],
  );
  const remove = useAction((id: string) => memberService.remove(orgId, id), ['org', orgId]);
  if (!canAdmin)
    return (
      <Empty title="เฉพาะ Owner และ Admin">
        คุณสามารถเปิดดูข้อมูล Event ขององค์กรนี้ได้ แต่ไม่มีสิทธิ์จัดการสมาชิก
      </Empty>
    );
  return (
    <>
      <PageHeader
        eyebrow="WORKSPACE / PEOPLE & PERMISSIONS"
        title="A shared space. Clear roles."
        description="จัดการทีมและสิทธิ์การเข้าถึงข้อมูลภายในองค์กร"
        action={
          <Button variant="brand" onClick={() => setOpen(true)}>
            Invite member
          </Button>
        }
      />
      {__MOCK__ && <p className="notice">Invitation preview เท่านั้น — ไม่มีการส่งอีเมลจริง</p>}
      <Feedback
        error={change.error || remove.error}
        notice={invite.notice || change.notice || remove.notice}
      />
      <QueryState pending={members.isPending} error={members.error} retry={members.refetch} />
      <div className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {members.data?.map((m) => (
              <tr key={m.id}>
                <td>{m.email}</td>
                <td>
                  {m.role === 'owner' ? (
                    'owner'
                  ) : (
                    <select
                      aria-label={`Role ${m.email}`}
                      value={m.role}
                      disabled={change.isPending}
                      onChange={(e) => change.mutate({ id: m.id, role: e.target.value as Role })}
                    >
                      <option value="admin">Admin</option>
                      <option value="editor">Editor</option>
                      <option value="viewer">Viewer</option>
                    </select>
                  )}
                </td>
                <td>
                  <Badge>{m.status}</Badge>
                  {m.role !== 'owner' && (
                    <Button
                      variant="ghost"
                      pending={remove.isPending}
                      onClick={() => {
                        if (window.confirm(`นำ ${m.email} ออกจากองค์กร?`)) remove.mutate(m.id);
                      }}
                    >
                      Remove
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted mt-6">
        Owner/Admin จัดการทีมและ keys · Editor แก้ไข Event/FAQ/รายชื่อ/tickets · Viewer อ่านอย่างเดียว
      </p>
      {open && (
        <Dialog title="Invite member" onClose={() => setOpen(false)}>
          <form
            className="form-grid"
            onSubmit={(e) => {
              e.preventDefault();
              invite.mutate({
                email: formText(e.currentTarget, 'email'),
                role: formText(e.currentTarget, 'role') as Role,
              });
            }}
          >
            <Field label="Email">
              <input name="email" type="email" required autoFocus />
            </Field>
            <Field label="Role">
              <select name="role">
                <option value="editor">Editor</option>
                <option value="viewer">Viewer</option>
                <option value="admin">Admin</option>
              </select>
            </Field>
            <Feedback error={invite.error} />
            <Button variant="brand" pending={invite.isPending}>
              ส่งคำเชิญ
            </Button>
          </form>
        </Dialog>
      )}
    </>
  );
}
