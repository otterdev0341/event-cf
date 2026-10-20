import { useState } from 'react';
import { credentialService } from './service';
import type { Credential } from '../../shared/contracts/credentials';
import { Button, Feedback, Field, formText } from '../../components/ui';
export function PairCheck({
  orgId,
  eventId,
  credentials,
}: {
  orgId: string;
  eventId: string;
  credentials: Credential[];
}) {
  const [notice, setNotice] = useState('');
  const [error, setError] = useState<Error | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <section className="panel p-6 mt-6">
      <h2>Check the credential pair</h2>
      <p className="muted mb-5">ทดสอบความสัมพันธ์ของ key กับ Event ที่เลือก โดยไม่แสดง secret</p>
      <form
        className="form-grid"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = e.currentTarget;
          setPending(true);
          setError(null);
          setNotice('');
          try {
            const result = await credentialService.check(
              orgId,
              formText(f, 'orgKey'),
              formText(f, 'eventKey'),
              eventId,
            );
            setNotice(result.message ?? 'Pair valid');
          } catch (error) {
            setError(error instanceof Error ? error : new Error('ตรวจสอบไม่สำเร็จ'));
          } finally {
            setPending(false);
          }
        }}
      >
        <div className="form-pair">
          <Field label="Org credential">
            <select name="orgKey" required>
              <option value="">เลือก Org key</option>
              {credentials
                .filter((c) => c.kind === 'org')
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Event credential">
            <select name="eventKey" required>
              <option value="">เลือก Event key</option>
              {credentials
                .filter((c) => c.kind === 'event')
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </Field>
        </div>
        <Feedback error={error} notice={notice} />
        <div>
          <Button pending={pending} disabled={!eventId}>
            Validate pair
          </Button>
        </div>
      </form>
    </section>
  );
}
