import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from '../auth';
import { useWorkspace } from '../../stores/workspace';
import { useAction } from '../../shared/api/query';
import { organizationService } from './service';
import { Button, Empty, Feedback, Field, formText, PageHeader } from '../../components/ui';
import { Dialog } from '../../components/Dialog';
export function OrganizationsPage() {
  const session = useSession();
  const client = useQueryClient();
  const { selectOrg } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const choose = async (id: string) => {
    await client.cancelQueries({ queryKey: ['org'] });
    client.removeQueries({ queryKey: ['org'] });
    selectOrg(id);
    navigate('/events');
  };
  const create = useAction(
    async (name: string) => {
      const result = await organizationService.create(name);
      client.setQueryData(['session'], result);
      setOpen(false);
      await choose(result.organizations.at(-1)!.id);
    },
    ['session'],
  );
  const accept = useAction(
    async (token: string) => {
      const result = await organizationService.accept(token);
      client.setQueryData(['session'], result);
    },
    ['session'],
  );
  return (
    <>
      <PageHeader
        eyebrow="YOUR ORGANIZATIONS"
        title="Choose your workspace."
        description="แต่ละองค์กรมีสมาชิก Event และ credentials แยกจากกัน"
        action={
          <Button variant="brand" onClick={() => setOpen(true)}>
            Create organization
          </Button>
        }
      />
      <div className="grid gap-4">
        {session.data?.organizations.map((org) => (
          <div key={org.id} className="panel panel-heading">
            <div>
              <h2>{org.name}</h2>
              <p className="eyebrow">{org.role}</p>
            </div>
            <Button onClick={() => void choose(org.id)}>เปิด workspace</Button>
          </div>
        ))}
      </div>
      {!session.data?.organizations.length && (
        <Empty title="ยังไม่มีองค์กร">สร้างองค์กร หรือรับคำเชิญจากผู้ดูแล</Empty>
      )}
      <section className="panel p-6 mt-6">
        <h2>Accept an invitation</h2>
        <p className="muted my-3">
          {__MOCK__
            ? 'Preview token: preview-invite · ไม่ใช่คำเชิญจริง'
            : 'ใช้ token จากลิงก์คำเชิญที่ส่งถึงอีเมลของคุณ'}
        </p>
        <form
          className="form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            accept.mutate(formText(e.currentTarget, 'token'));
          }}
        >
          <Field label="Invitation token">
            <input name="token" required defaultValue={params.get('invite') ?? ''} />
          </Field>
          <Feedback error={accept.error} notice={accept.notice} />
          <div>
            <Button pending={accept.isPending}>รับคำเชิญ</Button>
          </div>
        </form>
      </section>
      {open && (
        <Dialog title="Create organization" onClose={() => setOpen(false)}>
          <form
            className="form-grid"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate(formText(e.currentTarget, 'name'));
            }}
          >
            <Field label="Organization name">
              <input name="name" required maxLength={100} autoFocus />
            </Field>
            <Feedback error={create.error} />
            <Button variant="brand" pending={create.isPending}>
              สร้างองค์กร
            </Button>
          </form>
        </Dialog>
      )}
    </>
  );
}
