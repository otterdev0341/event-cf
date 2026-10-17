import { useState, type FormEvent, type ReactNode } from "react";
import { AppHeader } from "../components/AppHeader";
import { Button } from "../components/Button";
import { CampaignStepIndicator } from "../components/CampaignStepIndicator";
import { routes } from "../routes";

import { getDraft, saveDraft, parseCsv, suggestMapping, downloadCsvTemplate, type CsvData } from "../lib/campaigns";

interface CampaignFieldProps {
  children: ReactNode;
  label: string;
}

type CallStartMode = "immediate" | "scheduled";
type CallingWindow = "business-hours" | "custom";
type CallingDay = "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";

const callingDays: Array<{ label: string; longLabel: string; value: CallingDay }> = [
  { label: "จ.", longLabel: "วันจันทร์", value: "monday" },
  { label: "อ.", longLabel: "วันอังคาร", value: "tuesday" },
  { label: "พ.", longLabel: "วันพุธ", value: "wednesday" },
  { label: "พฤ.", longLabel: "วันพฤหัสบดี", value: "thursday" },
  { label: "ศ.", longLabel: "วันศุกร์", value: "friday" },
  { label: "ส.", longLabel: "วันเสาร์", value: "saturday" },
  { label: "อา.", longLabel: "วันอาทิตย์", value: "sunday" },
];

interface CampaignRadioOptionProps<T extends string> {
  checked: boolean;
  description?: string;
  label: string;
  name: string;
  onChange: (value: T) => void;
  value: T;
}

function CampaignRadioOption<T extends string>({
  checked,
  description,
  label,
  name,
  onChange,
  value,
}: CampaignRadioOptionProps<T>) {
  return (
    <label className={`campaign-radio${checked ? " campaign-radio--selected" : ""}`}>
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={() => onChange(value)}
      />
      <span className="campaign-radio__copy">
        <strong>{label}</strong>
        {description ? <span>{description}</span> : null}
      </span>
    </label>
  );
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
    if (callStartMode !== 'immediate' && !selectedCallingDays.length) { setError('กรุณาเลือกวันที่อนุญาตให้โทรอย่างน้อย 1 วัน'); return; }
    if (callStartMode === 'scheduled' && new Date(value('callStartDate') + 'T' + value('callStartTime')).getTime() <= Date.now()) {
      setError('เวลาเริ่มโทรต้องอยู่ในอนาคต'); return;
    }
    if (callStartMode !== 'immediate' && callingWindow === 'custom' && value('allowedStartTime') >= value('allowedEndTime')) {
      setError('เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่มต้น'); return;
    }
    setSaving(true);
    try {
      await saveDraft({ id: campaignId, name: value('campaignName').trim(),
        variables: draft?.variables, variableBindings: draft?.variableBindings, recordConversation: draft?.recordConversation === true, voiceAccountId: draft?.voiceAccountId, eventDate: value('eventDate'), eventTime: value('eventTime'), callStartMode,
        callStartDate: value('callStartDate'), callStartTime: value('callStartTime'),
        callingWindow: callStartMode === 'immediate' ? '' : callingWindow,
        callingDays: callStartMode === 'immediate' ? [] : selectedCallingDays,
        allowedStartTime: callStartMode === 'immediate' ? '' : value('allowedStartTime') || '09:00',
        allowedEndTime: callStartMode === 'immediate' ? '' : value('allowedEndTime') || '18:00', csv, fileName,
        mapping: csv === draft?.csv ? draft.mapping : suggestMapping(csv.headers), agentId: draft?.agentId ?? '', updatedAt: draft?.updatedAt ?? '' });
      window.location.assign(routes.apiAgent);
    } catch (err) { setError((err as Error).message); } finally { setSaving(false); }
  }
  const [callStartMode, setCallStartMode] = useState<CallStartMode>(draft?.callStartMode === "scheduled" ? "scheduled" : "immediate");
  const [callingWindow, setCallingWindow] = useState<CallingWindow>((draft?.callingWindow as CallingWindow) || "business-hours");
  const [selectedCallingDays, setSelectedCallingDays] = useState<CallingDay[]>((draft?.callStartMode !== "immediate" ? draft?.callingDays as CallingDay[] : undefined) ?? [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
  ]);

  const toggleCallingDay = (day: CallingDay) => {
    setSelectedCallingDays((currentDays) =>
      currentDays.includes(day)
        ? currentDays.filter((currentDay) => currentDay !== day)
        : [...currentDays, day],
    );
  };

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

            <div className="campaign-call-settings">
              <fieldset className="campaign-choice-group">
                <legend>แผนเริ่มการโทร</legend>
                <div className="campaign-choice-grid campaign-choice-grid--two">
                  <CampaignRadioOption
                    checked={callStartMode === "immediate"}
                    description="บันทึกความต้องการไว้ ใช้เมื่อเชื่อมระบบโทรแล้ว"
                    label="ต้องการโทรทันที"
                    name="callStartMode"
                    onChange={setCallStartMode}
                    value="immediate"
                  />
                  <CampaignRadioOption
                    checked={callStartMode === "scheduled"}
                    description="กำหนดวันและเวลาที่ต้องการเริ่มแคมเปญ"
                    label="กำหนดเวลาเริ่มโทร"
                    name="callStartMode"
                    onChange={setCallStartMode}
                    value="scheduled"
                  />
                </div>

                {callStartMode === "scheduled" ? (
                  <div className="campaign-form__row campaign-choice-inputs">
                    <CampaignField label="วันที่เริ่มโทร">
                      <span className="campaign-form__control">
                        <input
                          type="date" required defaultValue={draft?.callStartDate}
                          name="callStartDate"
                          placeholder="วว / ดด / ปปปป"
                          inputMode="numeric"
                        />
                        <img src="/assets/create-campaign/calendar.svg" width="20" height="20" alt="" />
                      </span>
                    </CampaignField>
                    <CampaignField label="เวลาเริ่มโทร">
                      <span className="campaign-form__control">
                        <input type="time" required name="callStartTime" defaultValue={draft?.callStartTime || "09:00"} inputMode="numeric" />
                        <img src="/assets/create-campaign/clock.svg" width="20" height="20" alt="" />
                      </span>
                    </CampaignField>
                  </div>
                ) : null}
              </fieldset>

              <fieldset className="campaign-choice-group" hidden={callStartMode === "immediate"} disabled={callStartMode === "immediate"}>
                <legend>ช่วงเวลาที่อนุญาตให้โทร</legend>
                <div className="campaign-choice-grid campaign-choice-grid--two">
                  <CampaignRadioOption
                    checked={callingWindow === "business-hours"}
                    label="เวลาทำการทั่วไป (09:00 - 18:00)"
                    name="callingWindow"
                    onChange={setCallingWindow}
                    value="business-hours"
                  />
                  <CampaignRadioOption
                    checked={callingWindow === "custom"}
                    label="กำหนดช่วงเวลาเอง"
                    name="callingWindow"
                    onChange={setCallingWindow}
                    value="custom"
                  />
                </div>

                <div className="campaign-day-picker">
                  <div className="campaign-day-picker__header">
                    <span>วันที่อนุญาตให้โทร</span>
                    <small>เลือกได้มากกว่า 1 วัน</small>
                  </div>
                  <div className="campaign-day-grid" role="group" aria-label="วันที่อนุญาตให้โทร">
                    {callingDays.map((day) => {
                      const isSelected = selectedCallingDays.includes(day.value);

                      return (
                        <label
                          className={`campaign-day-option${isSelected ? " campaign-day-option--selected" : ""}`}
                          key={day.value}
                          title={day.longLabel}
                        >
                          <input
                            type="checkbox"
                            name="callingDays"
                            value={day.value}
                            checked={isSelected}
                            aria-label={day.longLabel}
                            onChange={() => toggleCallingDay(day.value)}
                          />
                          <span>{day.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {callingWindow === "custom" ? (
                  <div className="campaign-form__row campaign-choice-inputs">
                    <CampaignField label="เวลาเริ่มต้น">
                      <span className="campaign-form__control">
                        <input type="time" required name="allowedStartTime" defaultValue={draft?.allowedStartTime || "09:00"} inputMode="numeric" />
                        <img src="/assets/create-campaign/clock.svg" width="20" height="20" alt="" />
                      </span>
                    </CampaignField>
                    <CampaignField label="เวลาสิ้นสุด">
                      <span className="campaign-form__control">
                        <input type="time" required name="allowedEndTime" defaultValue={draft?.allowedEndTime || "18:00"} inputMode="numeric" />
                        <img src="/assets/create-campaign/clock.svg" width="20" height="20" alt="" />
                      </span>
                    </CampaignField>
                  </div>
                ) : null}
              </fieldset>
            </div>
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

          <p className="workspace-note">บันทึกแคมเปญแล้วเริ่มคิวโทรจากรายชื่อ CSV ได้ การตั้งเวลาอัตโนมัติยังไม่เปิดใช้งาน</p>
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
