import { useState } from 'react';
import { z } from 'zod';
import { scopes, credentialInputSchema, type Credential } from '../../shared/contracts/credentials';
import { Dialog } from '../../components/Dialog';
import { Button, Field, Feedback, formText } from '../../components/ui';
export function CredentialForm({
  eventId,
  credentials,
  onClose,
  onSave,
  pending,
  error,
}: {
  eventId: string;
  credentials: Credential[];
  onClose: () => void;
  onSave: (input: z.infer<typeof credentialInputSchema>) => void;
  pending: boolean;
  error: Error | null;
}) {
  const [kind, setKind] = useState<'org' | 'event'>('org');
  return (
    <Dialog title="Create credential" onClose={onClose}>
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          const f = e.currentTarget;
          onSave({
            name: formText(f, 'name'),
            kind,
            parentId: kind === 'event' ? formText(f, 'parent') : null,
            eventId: kind === 'event' ? eventId : null,
            expiresAt: formText(f, 'expiresAt'),
            scopes: new FormData(f).getAll('scope') as z.infer<typeof credentialInputSchema>['scopes'],
          });
        }}
      >
        <Field label="Name">
          <input name="name" required maxLength={100} autoFocus />
        </Field>
        <Field label="Credential type">
          <select value={kind} onChange={(e) => setKind(e.target.value as 'org' | 'event')}>
            <option value="org">Organization credential</option>
            <option value="event" disabled={!eventId}>
              Event credential
            </option>
          </select>
        </Field>
        {kind === 'event' && (
          <Field
            label="Parent org credential"
            hint={`ผูกกับ Event ${eventId} · scopes และ expiry ต้องไม่เกิน parent`}
          >
            <select name="parent" required>
              <option value="">เลือก Org credential</option>
              {credentials
                .filter((c) => c.kind === 'org' && c.status === 'active')
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </Field>
        )}
        <Field label="Expiry date">
          <input
            name="expiresAt"
            type="date"
            required
            min={new Date(Date.now() + 86400000).toISOString().slice(0, 10)}
          />
        </Field>
        <fieldset>
          <legend className="mb-2">Scopes · calling ต้องเลือกเอง</legend>
          <div className="grid gap-2">
            {scopes.map((scope) => (
              <label key={scope} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="scope"
                  value={scope}
                  defaultChecked={scope === 'knowledge:read'}
                />
                {scope}
              </label>
            ))}
          </div>
        </fieldset>
        <Feedback error={error} />
        <Button variant="brand" pending={pending}>
          สร้าง key
        </Button>
      </form>
    </Dialog>
  );
}
export function SecretDialog({ secret, onClose }: { secret: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  return (
    <Dialog title="Copy your key once" onClose={onClose}>
      <p className="muted mb-4">
        ปิดหน้าต่างแล้วจะไม่สามารถแสดง key นี้อีก ไม่บันทึกลง localStorage หรือ query cache
      </p>
      <pre className="dark-panel">{secret}</pre>
      <Feedback error={error} notice={copied ? 'คัดลอกแล้ว' : ''} />
      <div className="form-actions">
        <Button
          onClick={() =>
            void navigator.clipboard
              .writeText(secret)
              .then(() => setCopied(true))
              .catch(() => setError(new Error('คัดลอกไม่ได้ กรุณาเลือกข้อความแล้วคัดลอกเอง')))
          }
        >
          Copy key
        </Button>
        <Button variant="brand" onClick={onClose}>
          เก็บ key แล้ว
        </Button>
      </div>
    </Dialog>
  );
}
