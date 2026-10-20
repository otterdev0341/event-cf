import { ApiError } from '../shared/api/client';
import { state } from './state';
export function authorize(orgId: string, write = false, admin = false) {
  if (!state.session) throw new ApiError(401, 'กรุณาเข้าสู่ระบบ');
  const org = state.session.organizations.find((org) => org.id === orgId);
  if (!org || (write && org.role === 'viewer') || (admin && !['owner', 'admin'].includes(org.role))) {
    throw new ApiError(403, 'ไม่มีสิทธิ์ทำรายการในองค์กรนี้');
  }
  return org;
}
export function findEvent(orgId: string, eventId: string) {
  const event = state.events.find((event) => event.id === eventId && event.orgId === orgId);
  if (!event) throw new ApiError(404, 'ไม่พบ Event ในองค์กรนี้');
  return event;
}
export function version(actual: number, expected: unknown) {
  if (expected !== actual) throw new ApiError(409, 'ข้อมูลเปลี่ยนแล้ว โหลดข้อมูลล่าสุดและลองอีกครั้ง');
}
