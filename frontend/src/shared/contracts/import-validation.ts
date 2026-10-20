import type { ImportRow } from './calling';
export const templateHeaders = [
  'phone',
  'first_name',
  'last_name',
  'nickname',
  'event_code',
  'event_date',
] as const;
export function normalizePhone(value: string): string {
  const phone = value.replace(/[\s()-]/g, '');
  return /^0\d{8,9}$/.test(phone) ? `+66${phone.slice(1)}` : phone;
}
export function validateRows(
  rows: ImportRow[],
  event: { code: string; date: string },
  existing: string[] = [],
) {
  const errors: string[] = [];
  const phones = new Set(existing);
  if (!rows.length || rows.length > 5000) errors.push('ต้องมี 1–5,000 รายชื่อ');
  rows.forEach((row, index) => {
    const phone = normalizePhone(row.phone);
    const prefix = `แถว ${index + 2}: `;
    if (!/^\+[1-9]\d{7,14}$/.test(phone)) errors.push(prefix + 'เบอร์โทรไม่ถูกต้อง');
    if (phones.has(phone)) errors.push(prefix + 'เบอร์โทรซ้ำในไฟล์หรือ Event');
    phones.add(phone);
    if (!row.first_name.trim() || !row.last_name.trim()) errors.push(prefix + 'ต้องมีชื่อและนามสกุล');
    if (row.event_code !== event.code || row.event_date !== event.date)
      errors.push(prefix + 'รหัสหรือวันที่ไม่ตรงกับ Event');
    if (
      Object.values(row).some(
        (v) => v.length > 250 || /^[=\-@\t\r]/.test(v) || (/^\+/.test(v) && v !== row.phone),
      )
    ) {
      errors.push(prefix + 'ข้อมูลยาวเกินกำหนดหรือมี formula');
    }
  });
  return errors;
}
