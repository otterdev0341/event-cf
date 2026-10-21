import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { Plus } from 'lucide-react';
import { useWorkspace } from '../../stores/workspace';
import { usePermissions } from '../../shared/api/usePermissions';
import { useAction } from '../../shared/api/query';
import { credentialInputSchema } from '../../shared/contracts/credentials';
import { credentialService } from './service';
import { CredentialForm, SecretDialog } from './CredentialForm';
import { PairCheck } from './PairCheck';
import { Badge, Button, Empty, Feedback, PageHeader, QueryState } from '../../components/ui';
export function AgentAccessPage() {
  const { orgId, eventId } = useWorkspace();
  const { canAdmin } = usePermissions();
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ['org', orgId, 'credentials'],
    enabled: !!orgId && canAdmin,
    queryFn: ({ signal }) => credentialService.list(orgId, signal),
  });
  const keys = ['org', orgId, 'credentials'];
  // Consume secrets inside mutationFn, return no secret to the mutation cache.
  const create = useAction(async (input: z.infer<typeof credentialInputSchema>) => {
    const result = await credentialService.create(orgId, input);
    setCreating(false);
    setSecret(result.secret);
  }, keys);
  const revoke = useAction((id: string) => credentialService.revoke(orgId, id), keys);
  const rotate = useAction(async (id: string) => {
    const result = await credentialService.rotate(orgId, id);
    setSecret(result.secret);
  }, keys);
  if (!canAdmin)
    return (
      <Empty title="เฉพาะ Root และ Org admin">
        Event admin และ Team member ไม่มีสิทธิ์จัดการ credentials
      </Empty>
    );
  return (
    <>
      <PageHeader
        eyebrow="WORKSPACE / AGENT ACCESS"
        title="The right access. Nothing more."
        description="เชื่อม Agent ด้วย Org credential และ Event credential พร้อม scopes ที่จำเป็นเท่านั้น"
        action={
          <Button
            variant="brand"
            onClick={() => {
              create.reset();
              setCreating(true);
            }}
          >
            <Plus size={16} />
            Create credential
          </Button>
        }
      />
      {__MOCK__ && <p className="notice">Keys ใน preview เป็นค่า demo_only ใช้เรียกบริการจริงไม่ได้</p>}
      <Feedback error={revoke.error || rotate.error} notice={revoke.notice || rotate.notice} />
      <QueryState pending={query.isPending} error={query.error} retry={query.refetch} />
      <div className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>Credential</th>
              <th>Scope / parent</th>
              <th>Expiry</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {query.data?.map((c) => (
              <tr key={c.id}>
                <td>
                  <h3>{c.name}</h3>
                  <span className="font-mono text-xs muted">
                    {c.kind} · {c.prefix}
                  </span>
                </td>
                <td className="text-xs">
                  <p>{c.scopes.join(', ')}</p>
                  {c.parentId && (
                    <p className="muted">Parent: {query.data?.find((p) => p.id === c.parentId)?.name}</p>
                  )}
                </td>
                <td>{c.expiresAt}</td>
                <td>
                  <Badge tone={c.status}>{c.status}</Badge>
                </td>
                <td>
                  {c.status === 'active' && (
                    <div className="flex gap-2">
                      <Button
                        disabled={rotate.isPending || revoke.isPending}
                        onClick={() => {
                          if (
                            window.confirm(
                              'Rotate key? Key เดิมและ Event keys ที่ผูกอยู่จะถูก revoke ต้องสร้างคู่ใหม่',
                            )
                          )
                            rotate.mutate(c.id);
                        }}
                      >
                        Rotate
                      </Button>
                      <Button
                        variant="danger"
                        disabled={rotate.isPending || revoke.isPending}
                        onClick={() => {
                          if (window.confirm('Revoke key และ Event keys ที่ผูกอยู่?')) revoke.mutate(c.id);
                        }}
                      >
                        Revoke
                      </Button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!query.isPending && !query.data?.length && (
          <Empty title="ยังไม่มี credentials">
            สร้าง Org key ก่อน แล้วสร้าง Event key ที่ผูกกับ Org key นั้น
          </Empty>
        )}
      </div>
      <PairCheck orgId={orgId} eventId={eventId} credentials={query.data ?? []} />
      <section className="dark-panel mt-6">
        <p className="eyebrow text-white/60">AGENT API / PUBLISHED KNOWLEDGE</p>
        <h2 className="my-3">Two credentials. One event.</h2>
        <pre>{`GET /event-confirm/api/v1/agent/orgs/${orgId || '{org}'}/events/${eventId || '{event}'}/knowledge\nX-Org-Credential: <ORG_CREDENTIAL>\nX-Event-Credential: <EVENT_CREDENTIAL>\n\nPOST /event-confirm/api/v1/agent/orgs/{org}/events/{event}/tickets\nPOST /event-confirm/api/v1/agent/orgs/{org}/events/{event}/calls/{attempt}/result\nIdempotency-Key: <unique-request-id>`}</pre>
        <p className="muted mt-4 text-xs">
          FAQ อ่านเฉพาะ published · calls:result ต้อง opt-in · Provider callback ใช้ signature แยก
        </p>
      </section>
      {creating && (
        <CredentialForm
          eventId={eventId}
          credentials={query.data ?? []}
          onClose={() => setCreating(false)}
          onSave={create.mutate}
          pending={create.isPending}
          error={create.error}
        />
      )}
      {secret && <SecretDialog secret={secret} onClose={() => setSecret(null)} />}
    </>
  );
}
