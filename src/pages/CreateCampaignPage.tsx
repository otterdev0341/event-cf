import { useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AppHeader } from "../components/AppHeader";
import { Button } from "../components/Button";
import { CampaignStepIndicator } from "../components/CampaignStepIndicator";
import { DatePicker, TimePicker } from "../components/Pickers";
import { routes } from "../routes";

import { getDraft, saveDraft, parseCsv, suggestMapping, type CsvData } from "../lib/campaigns";

const PREVIEW_LIMIT = 200;

// ไฟล์ตัวอย่างสำหรับให้ผู้ใช้ดาวน์โหลด (ฝังไว้ในโค้ด ไม่ต้องพึ่งไฟล์ใน public/)
const SAMPLE_CSV_NAME = "seminar-list.csv";
const SAMPLE_CSV = `full_name,phone,company,seat
คุณสมชาย ใจดี,0812345678,บริษัท ตัวอย่าง จำกัด,A-12
คุณมานี รักเรียน,0897654321,บริษัท ตัวอย่าง จำกัด,A-13
คุณชูใจ ไฝ่ดี,0870001122,บริษัท เอบีซี จำกัด,B-04
คุณอารี มีสุข,0832229090,บริษัท เอบีซี จำกัด,B-05
คุณธนากร เจริญสุข,0845557788,ห้างหุ้นส่วน สยามเทรด,C-01
คุณกมลชนก ศรีสวัสดิ์,0623334455,ห้างหุ้นส่วน สยามเทรด,C-02
`;

function downloadSampleCsv() {
  // ใส่ BOM (\uFEFF) เพื่อให้ Excel อ่านภาษาไทยเป็น UTF-8 ถูกต้อง
  const blob = new Blob(["\uFEFF" + SAMPLE_CSV], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = SAMPLE_CSV_NAME;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// รองรับทั้ง rows แบบ array (string[][]) และแบบ object (Record<string, string>[])
function cellValue(row: unknown, header: string, index: number): string {
  const v = Array.isArray(row) ? row[index] : (row as Record<string, unknown>)[header];
  return String(v ?? '');
}

interface CampaignFieldProps {
  children: ReactNode;
  label: string;
}

function CampaignField({ children, label }: CampaignFieldProps) {
  return (
    <label className="campaign-form__field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function CreateCampaignPage() {
  const [draft] = useState(getDraft);
  const [campaignId] = useState(() => draft?.id ?? crypto.randomUUID());
  const [csv, setCsv] = useState<CsvData | null>(draft?.csv ?? null);
  const [fileName, setFileName] = useState(draft?.fileName ?? '');
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  async function importFile(file?: File) {
    if (!file) return;
    setReading(true); setError('');
    try {
      if (!/\.csv$/i.test(file.name)) throw new Error('กรุณาเลือกไฟล์ .csv');
      if (file.size > 2 * 1024 * 1024) throw new Error('ไฟล์ต้องมีขนาดไม่เกิน 2 MB');
      const data = parseCsv(await file.text()); setCsv(data); setFileName(file.name);
    } catch (err) { setCsv(null); setFileName(''); setError((err as Error).message); }
    finally { setReading(false); }
  }
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (saving) return; setError('');
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) || '');
    if (!value('campaignName').trim()) { setError('กรุณาระบุชื่อแคมเปญ'); return; }
    if (!csv) { setError('กรุณาอัปโหลดรายชื่อ CSV ก่อนดำเนินการต่อ'); return; }
    setSaving(true);
    try {
      await saveDraft({ id: campaignId, name: value('campaignName').trim(),
        variables: draft?.variables, variableBindings: draft?.variableBindings, recordConversation: draft?.recordConversation === true, voiceAccountId: draft?.voiceAccountId, eventDate: value('eventDate'), eventTime: value('eventTime'),
        callStartMode: 'manual', callStartDate: '', callStartTime: '',
        callingWindow: '', callingDays: [], allowedStartTime: '', allowedEndTime: '', csv, fileName,
        mapping: csv === draft?.csv ? draft.mapping : suggestMapping(csv.headers), agentId: draft?.agentId ?? '', updatedAt: draft?.updatedAt ?? '' });
      window.location.assign(routes.apiAgent);
    } catch (err) { setError((err as Error).message); } finally { setSaving(false); }
  }
  return (
    <div className="create-campaign-page">
      <AppHeader />

      <main className="create-campaign-main page-shell">
        <header className="rd-head"><div><a className="rd-back" href={routes.campaigns}>← กลับไปแคมเปญ</a><h1>{draft ? "ตั้งค่าแคมเปญ" : "สร้างแคมเปญใหม่"}</h1><p>เริ่มจากรายละเอียดงานและรายชื่อที่ต้องการยืนยัน</p></div></header>

        <CampaignStepIndicator />

        <form className="create-campaign-form rd-wizard-form" onSubmit={handleSubmit}>
          <section className="campaign-form-panel" aria-labelledby="campaign-details-title">
            <div className="rd-panel-head"><h2 id="campaign-details-title">ข้อมูลแคมเปญ</h2><span className="rd-muted">ชื่อและวันเวลาจะใช้เป็นตัวแปรในบทสนทนาได้</span></div>

            <CampaignField label="ชื่อแคมเปญ *">
              <input
                type="text"
                name="campaignName" required maxLength={120} defaultValue={draft?.name}
                placeholder="เช่น ยืนยันสิทธิ์เข้าร่วมงานแต่งงาน"
              />
            </CampaignField>

            <div className="campaign-form__row">
              <CampaignField label="วันที่จัดงาน">
                <DatePicker name="eventDate" label="วันที่จัดงาน" defaultValue={draft?.eventDate} />
              </CampaignField>

              <CampaignField label="เวลาจัดงาน">
                <TimePicker name="eventTime" label="เวลาจัดงาน" defaultValue={draft?.eventTime || "09:00"} />
              </CampaignField>
            </div>

          </section>

          <section className="campaign-upload-panel" aria-labelledby="campaign-upload-title">
            <div className="rd-panel-head rd-panel-head--row"><div><h2 id="campaign-upload-title">รายชื่อผู้ติดต่อ</h2><span className="rd-muted">ไฟล์ CSV ต้องมีคอลัมน์เบอร์โทร</span></div>
              <button className="rd-link" type="button" onClick={downloadSampleCsv}>ดาวน์โหลดไฟล์ตัวอย่าง (.csv)</button></div>

            <label className={`campaign-dropzone${dragging ? ' campaign-dropzone--dragging' : ''}`} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); void importFile(e.dataTransfer.files[0]); }}>
              <input id="campaign-csv" type="file" name="contacts" accept=".csv,text/csv" disabled={reading} onChange={e => void importFile(e.target.files?.[0])} />
              <span className="campaign-dropzone__icon" aria-hidden="true">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M7 18a4 4 0 0 1-.6-8A6 6 0 0 1 18 9a4 4 0 0 1 0 9M12 12v8M9 15l3-3 3 3"/></svg>
              </span>
              <span className="campaign-dropzone__copy">
                <strong>{reading ? "กำลังอ่านไฟล์..." : <>ลากไฟล์ CSV มาวาง หรือ <span className="rd-accent">เลือกไฟล์</span></>}</strong>
                <span>CSV ไม่เกิน 2 MB / 5,000 รายชื่อ</span>
              </span>
            </label>

            {csv && <div className="rd-file">
              <span className="rd-file__icon" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8ZM14 3v5h5"/></svg></span>
              <span className="rd-file__name"><strong>{fileName}</strong><span>{csv.rows.length.toLocaleString()} รายชื่อ · {csv.headers.length} คอลัมน์</span></span>
              <button type="button" className="button button--secondary button--compact" onClick={() => setPreviewOpen(true)}>ดูตัวอย่าง</button>
              <label className="button button--secondary button--compact" htmlFor="campaign-csv">เปลี่ยนไฟล์</label>
            </div>}

            {csv && previewOpen && createPortal(
              <div className="csv-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="csv-modal-title" onClick={() => setPreviewOpen(false)}>
                <div className="csv-modal" onClick={e => e.stopPropagation()}>
                  <div className="csv-modal__head">
                    <div>
                      <h3 id="csv-modal-title">{fileName}</h3>
                      <span className="rd-muted">{csv.rows.length.toLocaleString()} รายชื่อ · {csv.headers.length} คอลัมน์</span>
                    </div>
                    <button type="button" className="csv-modal__close" aria-label="ปิด" onClick={() => setPreviewOpen(false)}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
                    </button>
                  </div>
                  <div className="csv-modal__scroll">
                    <table>
                      <thead>
                        <tr><th>#</th>{csv.headers.map((h, j) => <th key={j}>{h}</th>)}</tr>
                      </thead>
                      <tbody>
                        {csv.rows.slice(0, PREVIEW_LIMIT).map((row, i) => (
                          <tr key={i}>
                            <td>{i + 1}</td>
                            {csv.headers.map((h, j) => <td key={j}>{cellValue(row, h, j)}</td>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {csv.rows.length > PREVIEW_LIMIT && (
                    <p className="rd-muted csv-modal__note">แสดง {PREVIEW_LIMIT} รายชื่อแรกจากทั้งหมด {csv.rows.length.toLocaleString()} รายชื่อ</p>
                  )}
                </div>
              </div>,
              document.body
            )}
          </section>

          {error && <p className="workspace-alert" role="alert">{error}</p>}
          <footer className="rd-wizard-foot">
            <a className="button button--secondary" href={routes.campaigns}>ยกเลิกการสร้างแคมเปญ</a>
            <div><span className="rd-muted">ขั้นตอนที่ 1 จาก 4 · บันทึกฉบับร่างอัตโนมัติเมื่อไปขั้นถัดไป</span>
              <Button type="submit" disabled={reading || saving}>{saving ? 'กำลังบันทึก…' : 'ถัดไป: เลือก Agent →'}</Button></div>
          </footer>
        </form>
      </main>
    </div>
  );
}