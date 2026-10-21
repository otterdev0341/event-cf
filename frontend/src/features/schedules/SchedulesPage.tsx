import { useEvent } from '../events';
import { participantService } from '../participants';
import { useEventQuery } from '../../shared/api/useEventQuery';
import { usePermissions } from '../../shared/api/usePermissions';
import { Badge, Button, Empty, Feedback, PageHeader, QueryState } from '../../components/ui';
import { Dialog } from '../../components/Dialog';
import { useSchedules } from './hooks';
import { ScheduleForm } from './ScheduleForm';
import { scheduleView } from './view-model';
export function SchedulesPage() {
  const { event } = useEvent();
  const { canEdit } = usePermissions();
  const { query, open, setOpen, create, cancel } = useSchedules();
  const people = useEventQuery('participants', participantService.list);
  if (!event) return <Empty title="เลือก Event เพื่อจัดการตารางโทร" />;
  return (
    <>
      <PageHeader
        eyebrow={`${event.code} / SCHEDULES`}
        title="ตารางโทร"
        description="กำหนดรอบโทรครั้งเดียว รายวัน หรือรายสัปดาห์ ตามเวลา Bangkok"
        action={
          canEdit && (
            <Button
              variant="brand"
              disabled={event.status === 'archived' || !people.data?.length}
              onClick={() => setOpen(true)}
            >
              สร้างตารางโทร
            </Button>
          )
        }
      />
      <p className="notice">
        พักคิวก่อนสร้างตาราง · การยกเลิกตารางไม่ยุติสายที่ส่งไปแล้ว · หากแก้ไข Event ต้องสร้างตารางใหม่
      </p>
      {__MOCK__ && <p className="notice">Preview บันทึกตารางจำลองเท่านั้น ไม่มี worker เริ่มโทรตามเวลา</p>}
      <Feedback error={cancel.error} notice={cancel.notice || create.notice} />
      <QueryState
        pending={query.isPending || people.isPending}
        error={query.error || people.error}
        retry={() => {
          void query.refetch();
          void people.refetch();
        }}
      />
      <Button onClick={() => void query.refetch()}>รีเฟรชตาราง</Button>
      {query.data?.length === 0 && (
        <Empty title="ยังไม่มีตารางโทร">นำเข้าผู้รับก่อน แล้วเลือกวันและเวลาที่ต้องการ</Empty>
      )}
      {!!query.data?.length && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>รอบถัดไป · Bangkok</th>
                <th>ความถี่ / ผู้รับ</th>
                <th>สถานะ</th>
                <th>รอบเสร็จแล้ว</th>
                <th>การจัดการ</th>
              </tr>
            </thead>
            <tbody>
              {query.data.map(scheduleView).map((row) => (
                <tr key={row.id}>
                  <td>{row.nextLabel}</td>
                  <td>
                    {row.recurrenceLabel} {row.daysLabel}
                    <br />
                    {row.rule.participantIds.length} คน ·{' '}
                    {row.rule.redial ? 'อนุญาตโทรซ้ำทุกรอบ' : 'เฉพาะผู้ยังไม่เคยโทร'}
                  </td>
                  <td>
                    <Badge>{row.statusLabel}</Badge>
                    {row.status === 'failed' && (
                      <p className="muted">ตรวจสิทธิ์และเวอร์ชัน Event ก่อนสร้างใหม่</p>
                    )}
                  </td>
                  <td>{row.completedRuns}</td>
                  <td>
                    {canEdit && row.cancellable && (
                      <Button
                        variant="danger"
                        pending={cancel.isPending}
                        onClick={() => {
                          if (window.confirm('ยกเลิกตารางนี้? สายที่ส่งไปแล้วต้องรอผลตามปกติ'))
                            cancel.mutate(row);
                        }}
                      >
                        ยกเลิกตาราง
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && (
        <Dialog
          title="สร้างตารางโทร"
          onClose={() => {
            if (!create.isPending) setOpen(false);
          }}
        >
          <ScheduleForm
            people={people.data ?? []}
            version={event.version}
            pending={create.isPending}
            error={create.error}
            onSave={create.mutate}
          />
        </Dialog>
      )}
    </>
  );
}
