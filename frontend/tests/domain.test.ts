import { describe, expect, it } from 'vitest';
import { outcomeSchema } from '../src/shared/contracts/calling';
import { normalizePhone, validateRows } from '../src/shared/contracts/import-validation';
const row = {
  phone: '0812345678',
  first_name: 'กานต์',
  last_name: 'ตัวอย่าง',
  nickname: '',
  event_code: 'EV26',
  event_date: '2026-12-12',
};
const event = { code: 'EV26', date: '2026-12-12' };
describe('attendance contract', () => {
  it('requires a specific reason only for unknown', () => {
    expect(outcomeSchema.safeParse({ result: 'unknown', reason: null }).success).toBe(false);
    expect(outcomeSchema.safeParse({ result: 'confirm', reason: 'no_answer' }).success).toBe(false);
    for (const reason of ['no_answer', 'noisy_audio', 'ai_cannot_infer'])
      expect(outcomeSchema.parse({ result: 'unknown', reason }).result).toBe('unknown');
  });
  it('distinguishes pending from business unknown', () => {
    expect(outcomeSchema.parse({ result: null, reason: null }).result).toBeNull();
    expect(outcomeSchema.safeParse({ result: 'not_confirmed', reason: null }).success).toBe(false);
  });
});
describe('imports', () => {
  it('preserves phone semantics and validates event/date', () => {
    expect(normalizePhone(row.phone)).toBe('+66812345678');
    expect(validateRows([row], event)).toEqual([]);
    expect(validateRows([{ ...row, event_date: '2026-12-13' }], event).join()).toContain('วันที่ไม่ตรง');
  });
  it('rejects duplicates, missing names and formula payloads', () => {
    expect(validateRows([row, row], event).join()).toContain('ซ้ำ');
    expect(validateRows([row], event, ['+66812345678']).join()).toContain('ซ้ำ');
    expect(validateRows([{ ...row, first_name: '=cmd()', last_name: '' }], event).length).toBeGreaterThan(0);
  });
});
