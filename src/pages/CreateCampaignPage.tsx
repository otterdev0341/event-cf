import { useState, type FormEvent, type ReactNode } from "react";
import { AppHeader } from "../components/AppHeader";
import { Button } from "../components/Button";
import { CampaignStepIndicator } from "../components/CampaignStepIndicator";
import { routes } from "../routes";
import { scheduledTime } from '../../shared/campaign-schedule.mjs';

import { getDraft, saveDraft, parseCsv, suggestMapping, downloadCsvTemplate, type CsvData } from "../lib/campaigns";

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
  const [callStartMode, setCallStartMode] = useState(draft?.callStartMode === 'scheduled' ? 'scheduled' : 'immediate');
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
    if (callStartMode === 'scheduled') {
      const scheduled = scheduledTime(value('callStartDate'), value('callStartTime'));
      if (!scheduled || Date.parse(scheduled) <= Date.now()) { setError('กรุณาเลือกวันและเวลาโทรในอนาคต (เวลาไทย)'); return; }
    }
    setSaving(true);
    try {
      await saveDraft({ id: campaignId, name: value('campaignName').trim(),
        variables: draft?.variables, variableBindings: draft?.variableBindings, recordConversation: draft?.recordConversation === true, voiceAccountId: draft?.voiceAccountId, eventDate: value('eventDate'), eventTime: value('eventTime'),
        callStartMode, callStartDate: callStartMode === 'scheduled' ? value('callStartDate') : '', callStartTime: callStartMode === 'scheduled' ? value('callStartTime') : '',
        callingWindow: '', callingDays: [], allowedStartTime: '', allowedEndTime: '', csv, fileName,
        mapping: csv === draft?.csv ? draft.mapping : suggestMapping(csv.headers), agentId: draft?.agentId ?? '', updatedAt: draft?.updatedAt ?? '' });
      window.location.assign(routes.apiAgent);
    } catch (err) { setError((err as Error).message); } finally { setSaving(false); }
  }
  return (
    <div className="create-campaign-page">
      <AppHeader />

      <main className="create-campaign-main page-shell">
        <header className="form-page-heading"><a href={routes.campaigns}>← กลับไปแคมเปญ</a><h1>{draft ? "ตั้งค่าแคมเปญ" : "สร้างแคมเปญใหม่"}</h1><p>เริ่มจากรายละเอียดงานและรายชื่อที่ต้องการยืนยัน</p></header>

        <CampaignStepIndicator />

        <form className="create-campaign-form" onSubmit={handleSubmit}>
          <section className="campaign-form-panel" aria-labelledby="campaign-details-title">
            <h2 id="campaign-details-title"><span className="section-marker" aria-hidden="true">01</span> ข้อมูลแคมเปญ</h2>

            <CampaignField label="ชื่อแคมเปญ *">
              <input
                type="text"
                name="campaignName" required maxLength={120} defaultValue={draft?.name}
                placeholder="เช่น ยืนยันสิทธิ์เข้าร่วมงานแต่งงาน"
              />
            </CampaignField>

            <div className="campaign-form__row">
              <CampaignField label="วันที่จัดงาน">
                <span className="campaign-form__control">
                  <input
                    type="date" defaultValue={draft?.eventDate}
                    name="eventDate"
                    placeholder="วว / ดด / ปปปป"
                    inputMode="numeric"
                  />
                  <img src="/assets/create-campaign/calendar.svg" width="20" height="20" alt="" />
                </span>
              </CampaignField>

              <CampaignField label="เวลาจัดงาน">
                <span className="campaign-form__control">
                  <input type="time" name="eventTime" defaultValue={draft?.eventTime || "09:00"} inputMode="numeric" />
                  <img src="/assets/create-campaign/clock.svg" width="20" height="20" alt="" />
                </span>
              </CampaignField>
            </div>

            <fieldset className="campaign-choice-group">
              <legend>เริ่มโทรเมื่อไหร่</legend>
              <div className="campaign-choice-grid campaign-choice-grid--two">
                <label className={`campaign-radio${callStartMode === 'immediate' ? ' campaign-radio--selected' : ''}`}>
                  <input type="radio" name="callStartMode" value="immediate" checked={callStartMode === 'immediate'} onChange={() => setCallStartMode('immediate')} />
                  <span className="campaign-radio__copy"><strong>โทรตอนนี้</strong><span>เริ่มคิวหลังตรวจข้อมูลและยืนยันในขั้นตอนสุดท้าย</span></span>
                </label>
                <label className={`campaign-radio${callStartMode === 'scheduled' ? ' campaign-radio--selected' : ''}`}>
                  <input type="radio" name="callStartMode" value="scheduled" checked={callStartMode === 'scheduled'} onChange={() => setCallStartMode('scheduled')} />
                  <span className="campaign-radio__copy"><strong>โทรภายหลัง</strong><span>เลือกวันและเวลาให้ระบบเริ่มโทรอัตโนมัติ</span></span>
                </label>
              </div>
              {callStartMode === 'scheduled' && <div className="campaign-form__row campaign-choice-inputs">
                <CampaignField label="วันที่เริ่มโทร"><input type="date" name="callStartDate" required defaultValue={draft?.callStartDate} /></CampaignField>
                <CampaignField label="เวลาเริ่มโทร (เวลาไทย)"><input type="time" name="callStartTime" required defaultValue={draft?.callStartTime || '09:00'} /></CampaignField>
              </div>}
              <p className="workspace-note">คิวโทรทำงานบนเซิร์ฟเวอร์ ปิดเว็บหรือปิดคอมได้ ระบบตรวจคิวทุกนาที</p>
            </fieldset>
          </section>

          <section className="campaign-upload-panel" aria-labelledby="campaign-upload-title">
            <h2 id="campaign-upload-title"><span className="section-marker" aria-hidden="true">02</span> รายชื่อผู้ติดต่อ</h2>

            <label className={`campaign-dropzone${dragging ? ' campaign-dropzone--dragging' : ''}`} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); void importFile(e.dataTransfer.files[0]); }}>
              <input type="file" name="contacts" accept=".csv,text/csv" disabled={reading} onChange={e => void importFile(e.target.files?.[0])} />
              <span className="campaign-dropzone__icon" aria-hidden="true">
                <img src="/assets/create-campaign/cloud-upload.svg" width="24" height="24" alt="" />
              </span>
              <span className="campaign-dropzone__copy">
                <strong>{reading ? "กำลังอ่านไฟล์..." : fileName || "ลากไฟล์ CSV มาวางที่นี่"}</strong>
                <span>{csv ? `${csv.rows.length.toLocaleString()} รายชื่อ · ${csv.headers.length} คอลัมน์ · คลิกเพื่อเปลี่ยนไฟล์` : "CSV ไม่เกิน 2 MB / 5,000 รายชื่อ"}</span>
              </span>
            </label>

            <button className="campaign-template-link" type="button" onClick={downloadCsvTemplate}>
              <img src="/assets/create-campaign/file-down.svg" width="18" height="18" alt="" />
              ดาวน์โหลด Template สำหรับแคมเปญ (.csv)
            </button>
          </section>

          <p className="workspace-note">ตรวจรายชื่อและ Agent ให้ครบก่อนยืนยันเริ่มคิวในขั้นตอนสุดท้าย</p>
          {error && <p className="workspace-alert" role="alert">{error}</p>}
          <footer className="create-campaign-actions"><span className="form-step-note">ขั้นตอนที่ 1 จาก 4</span>
            <a href={routes.campaigns}>ยกเลิกการสร้างแคมเปญ</a>
            <Button className="create-campaign-next" type="submit" disabled={reading || saving}>
              เลือก Agent
              <img src="/assets/create-campaign/arrow-right.svg" width="14" height="14" alt="" />
            </Button>
          </footer>
        </form>
      </main>
    </div>
  );
}
