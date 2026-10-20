import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { Dialog } from '../../components/Dialog';
import { Button, Feedback, Field } from '../../components/ui';
import { parseImport } from './files';
import { participantService } from './service';
import { importPreviewSchema } from '../../shared/contracts/calling';
import type { EventDto } from '../../shared/contracts/events';
import { useAction } from '../../shared/api/query';
export function ImportPanel({ event, onClose }: { event: EventDto; onClose: () => void }) {
  const [preview, setPreview] = useState<z.infer<typeof importPreviewSchema> | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const parse = useMutation({
    mutationFn: async (file: File) => {
      setPreview(null);
      controller.current?.abort();
      controller.current = new AbortController();
      const rows = await parseImport(file, controller.current.signal);
      return participantService.preview(event.orgId, event.id, rows, controller.current.signal);
    },
    onSuccess: setPreview,
  });
  const commit = useAction(async () => {
    if (!preview || preview.errors.length) throw new Error('แก้ไขทุกแถวก่อน import');
    await participantService.commit(event.orgId, event.id, preview.id);
    onClose();
  }, ['org', event.orgId]);
  return (
    <Dialog title="Upload participants" onClose={onClose}>
      <p className="muted mb-5">
        {event.code} · {event.date} — ยืนยันนำเข้ารายชื่อแล้วจะยังไม่เริ่มโทร
      </p>
      <Field label="ไฟล์ CSV / XLSX" hint="ไม่เกิน 5 MiB / 5,000 รายชื่อ · หนึ่ง Event ต่อไฟล์">
        <input
          type="file"
          accept=".csv,.xlsx"
          disabled={parse.isPending || commit.isPending}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) parse.mutate(file);
          }}
        />
      </Field>
      <Feedback error={parse.error || commit.error} />
      {parse.isPending && <p role="status">กำลังตรวจไฟล์…</p>}
      {preview && (
        <>
          <p className="eyebrow my-4">
            {preview.rows.length} ROWS · {preview.errors.length} ERRORS
          </p>
          {!!preview.errors.length && (
            <div className="alert" role="alert">
              <ul>
                {preview.errors.slice(0, 20).map((error, i) => (
                  <li key={i}>{error}</li>
                ))}
              </ul>
              <p>แก้ไขไฟล์และเลือก upload ใหม่ก่อนนำเข้า</p>
            </div>
          )}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Phone</th>
                  <th>Name</th>
                  <th>Event</th>
                  <th>Language</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, 10).map((row, i) => (
                  <tr key={i}>
                    <td>{row.phone}</td>
                    <td>
                      {row.first_name} {row.last_name}
                    </td>
                    <td>{row.event_code}</td>
                    <td>{row.lang_code}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted text-xs mt-3">แสดงตัวอย่าง 10 แถวแรก · ตรวจสอบทุกแถวก่อนนำเข้า</p>
          <div className="form-actions">
            <Button
              variant="brand"
              disabled={!!preview.errors.length || !preview.rows.length}
              pending={commit.isPending}
              onClick={() => commit.mutate()}
            >
              ยืนยันนำเข้า {preview.rows.length} รายชื่อ
            </Button>
          </div>
        </>
      )}
    </Dialog>
  );
}
