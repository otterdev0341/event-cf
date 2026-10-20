import { useEffect, useRef, useState } from 'react';
import { useEvent } from '../events';
import { knowledgeService } from './service';
import { downloadKnowledgeTemplate, type KnowledgeImport } from './template';
import { parseKnowledge } from './import-client';
import { useWorkspace } from '../../stores/workspace';
import { usePermissions } from '../../shared/api/usePermissions';
import { useAction } from '../../shared/api/query';
import { Button, Feedback } from '../../components/ui';
export function KnowledgeTransfer() {
  const { event } = useEvent();
  const { orgId, eventId } = useWorkspace();
  const { canEdit } = usePermissions();
  const [preview, setPreview] = useState<KnowledgeImport | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const key = useRef('');
  useEffect(() => () => controller.current?.abort(), []);
  const commit = useAction(async () => {
    await knowledgeService.importFaqs(orgId, eventId, preview!, key.current);
    setPreview(null);
  }, ['org', orgId, eventId]);
  async function download() {
    setBusy(true);
    setErrors([]);
    try {
      const latest = await knowledgeService.get(orgId, eventId);
      await downloadKnowledgeTemplate(event!.code, latest.categories, latest.categoryRevision);
    } catch (error) {
      setErrors([String(error)]);
    } finally {
      setBusy(false);
    }
  }
  async function upload(file?: File) {
    if (!file) return;
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    setBusy(true);
    setPreview(null);
    setErrors([]);
    commit.reset();
    try {
      const data = await parseKnowledge(file, next.signal);
      const latest = await knowledgeService.get(orgId, eventId, next.signal);
      const issues: string[] = [];
      const questions = new Set(latest.draft.map((f) => f.question.toLowerCase()));
      if (data.eventCode !== event!.code) issues.push('รหัส Event ไม่ตรงกับ Event ที่เลือก');
      if (data.categoryRevision !== latest.categoryRevision)
        issues.push('Category master เปลี่ยนแล้ว กรุณาดาวน์โหลด template ล่าสุด');
      data.rows.forEach((row, index) => {
        if (!latest.categories.includes(row.category))
          issues.push(`แถว ${index + 2}: Category ไม่อยู่ใน master ล่าสุด`);
        if (questions.has(row.question.toLowerCase())) issues.push(`แถว ${index + 2}: คำถามซ้ำ`);
        questions.add(row.question.toLowerCase());
      });
      key.current = crypto.randomUUID();
      setPreview(data);
      setErrors(issues);
    } catch (error) {
      if (!next.signal.aborted) setErrors([String(error)]);
    } finally {
      if (!next.signal.aborted) setBusy(false);
    }
  }
  return (
    <section className="panel p-6">
      <h2>Event knowledge template</h2>
      <p className="muted my-4">
        XLSX มีชีต FAQ, Categories ล่าสุด และ Event metadata · นำเข้าเป็น draft เท่านั้น ไม่ publish อัตโนมัติ
      </p>
      <div className="toolbar">
        <Button pending={busy} onClick={() => void download()}>
          Download knowledge template
        </Button>
        {canEdit && (
          <label>
            Upload knowledge template
            <input
              aria-label="Upload knowledge template"
              type="file"
              accept=".xlsx"
              disabled={busy || commit.isPending}
              onChange={(e) => {
                void upload(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </label>
        )}
      </div>
      <Feedback error={commit.error} notice={commit.notice} />
      {!!errors.length && (
        <div role="alert">
          {errors.slice(0, 30).map((error, i) => (
            <p key={i}>{error}</p>
          ))}
        </div>
      )}
      {preview && (
        <>
          <p className="eyebrow">PREVIEW · {preview.rows.length} QUESTIONS</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Question</th>
                  <th>Answer</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, 50).map((row, i) => (
                  <tr key={i}>
                    <td>{row.category}</td>
                    <td>{row.question}</td>
                    <td>{row.answer}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.rows.length > 50 && <p>แสดง 50 แถวแรกจาก {preview.rows.length}</p>}
          <Button
            variant="brand"
            className="mt-4"
            disabled={!!errors.length || busy || !canEdit}
            pending={commit.isPending}
            onClick={() => commit.mutate()}
          >
            ยืนยันนำเข้า {preview.rows.length} FAQ
          </Button>
        </>
      )}
    </section>
  );
}
