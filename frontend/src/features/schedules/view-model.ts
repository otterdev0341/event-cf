import type { ScheduleDto } from '../../shared/contracts/schedules';
export const weekdays = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
export const recurrenceLabels = { once: 'ครั้งเดียว', daily: 'ทุกวัน', weekly: 'ทุกสัปดาห์' };
const statuses = {
  scheduled: 'รอเวลา',
  running: 'กำลังดำเนินการ',
  completed: 'เสร็จแล้ว',
  cancelled: 'ยกเลิกแล้ว',
  failed: 'ต้องตรวจสอบ',
};
export function scheduleView(dto: ScheduleDto) {
  return {
    ...dto,
    statusLabel: statuses[dto.status],
    recurrenceLabel: recurrenceLabels[dto.rule.recurrence],
    daysLabel: dto.rule.weekdays.map((day) => weekdays[day]).join(', '),
    nextLabel: new Intl.DateTimeFormat('th-TH', {
      timeZone: 'Asia/Bangkok',
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(dto.nextAt)),
    cancellable: ['scheduled', 'running', 'failed'].includes(dto.status),
  };
}
