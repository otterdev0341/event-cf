import { useRef, useState } from 'react';
import { Button, Feedback, Field } from '../../components/ui';
import type { Participant } from '../../shared/contracts/calling';
import type { ScheduleRule } from '../../shared/contracts/schedules';
import { recurrenceLabels, weekdays } from './view-model';
type Props = {
  people: Participant[];
  version: number;
  pending: boolean;
  error: Error | null;
  onSave: (input: { rule: ScheduleRule; key: string }) => void;
};
export function ScheduleForm({ people, version, pending, error, onSave }: Props) {
  const [recurrence, setRecurrence] = useState<ScheduleRule['recurrence']>('once');
  const [redial, setRedial] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [days, setDays] = useState<number[]>([]);
  const [validation, setValidation] = useState<Error | null>(null);
  const submitted = useRef({ payload: '', key: '' });
  const eligible = people.filter((p) => redial || p.attempts.length === 0);
  const visible = eligible.filter((p) =>
    `${p.firstName} ${p.lastName} ${p.phone}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        if (!selected.length || (recurrence === 'weekly' && !days.length)) {
          setValidation(new Error('เลือกผู้รับอย่างน้อยหนึ่งคน และวันสำหรับตารางรายสัปดาห์'));
          return;
        }
        const rule: ScheduleRule = {
          date: String(data.get('date')),
          time: String(data.get('time')),
          recurrence,
          weekdays: recurrence === 'weekly' ? days : [],
          redial,
          participantIds: selected,
          expectedEventVersion: version,
          consent: true,
        };
        const payload = JSON.stringify(rule);
        if (submitted.current.payload !== payload) submitted.current = { payload, key: crypto.randomUUID() };
        setValidation(null);
        onSave({ rule, key: submitted.current.key });
      }}
    >
      <fieldset disabled={pending} className="grid gap-4 border-0 p-0 min-w-0">
        <p className="notice">เวลา Asia/Bangkok (UTC+7) · รายชื่อถูกบันทึก ณ ตอนสร้างตาราง</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="วันที่เริ่ม">
            <input name="date" type="date" required />
          </Field>
          <Field label="เวลา Bangkok">
            <input name="time" type="time" required />
          </Field>
        </div>
        <Field label="ความถี่">
          <select
            value={recurrence}
            onChange={(e) => setRecurrence(e.target.value as ScheduleRule['recurrence'])}
          >
            {Object.entries(recurrenceLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        {recurrence === 'weekly' && (
          <fieldset className="flex flex-wrap gap-3">
            <legend>วันในสัปดาห์</legend>
            {weekdays.map((label, day) => (
              <label key={day} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={days.includes(day)}
                  onChange={(e) => setDays(e.target.checked ? [...days, day] : days.filter((d) => d !== day))}
                />
                {label}
              </label>
            ))}
          </fieldset>
        )}
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={redial}
            onChange={(e) => {
              setRedial(e.target.checked);
              setSelected([]);
            }}
          />
          โทรซ้ำผู้ที่เคยโทรแล้วในแต่ละรอบ (รวม confirm/decline และผู้ที่ครบจำนวนครั้งแล้ว)
        </label>
        <p className="muted text-sm">
          หากเลือกโทรซ้ำ แต่ละรอบจะเริ่มงบ retry ใหม่ โดยยังเก็บประวัติเดิมทั้งหมด
        </p>
        <Field label="ค้นหาผู้รับในตาราง">
          <input value={search} onChange={(e) => setSearch(e.target.value)} />
        </Field>
        <p>
          เลือกแล้ว {selected.length} คน จาก {eligible.length} คนที่เลือกได้
        </p>
        <Button type="button" onClick={() => setSelected(visible.map((p) => p.id))}>
          เลือกทั้งหมดที่ค้นพบ
        </Button>
        <div
          className="max-h-48 overflow-auto border border-border p-3 grid gap-2"
          role="group"
          aria-label="ผู้รับในตาราง"
        >
          {visible.map((person) => (
            <label key={person.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={selected.includes(person.id)}
                onChange={(e) =>
                  setSelected(
                    e.target.checked ? [...selected, person.id] : selected.filter((id) => id !== person.id),
                  )
                }
              />
              {person.firstName} {person.lastName} · {person.phone}
            </label>
          ))}
          {!visible.length && <p>ไม่มีผู้รับที่ตรงเงื่อนไข</p>}
        </div>
        <label className="flex items-start gap-2">
          <input type="checkbox" required />
          ฉันยืนยันให้เริ่มคิวอัตโนมัติตามวัน เวลา และรายชื่อที่เลือก
        </label>
        <Feedback error={validation || error} />
        <div className="form-actions">
          <Button type="submit" variant="brand" pending={pending}>
            บันทึกตารางโทร
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
