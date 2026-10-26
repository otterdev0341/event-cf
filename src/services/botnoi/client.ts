import { supabase } from '../../lib/supabase';
export type BotnoiRequestOptions = Omit<RequestInit, 'body'> & { body?: BodyInit | Record<string, unknown> | unknown[] | null };
export class BotnoiApiError extends Error {
  constructor(message: string, public status: number, public data?: unknown) { super(message); this.name = 'BotnoiApiError'; }
}
export function getBotnoiConfig() { return { baseUrl: `${import.meta.env.BASE_URL}api/voice` }; }
async function request(endpoint: string, options: BotnoiRequestOptions) {
  if (!supabase) throw new BotnoiApiError('ยังไม่ได้ตั้งค่าระบบบัญชี', 503);
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new BotnoiApiError('กรุณาเข้าสู่ระบบก่อนใช้งาน', 401);
  if (!endpoint.startsWith('/') || endpoint.startsWith('//')) throw new BotnoiApiError('เส้นทางไม่ถูกต้อง', 400);
  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${session.access_token}`);
  let body = options.body;
  if (body && typeof body === 'object' && !(body instanceof Blob) && !(body instanceof FormData) && !(body instanceof URLSearchParams)) body = JSON.stringify(body);
  if (body) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${import.meta.env.BASE_URL}api/voice?path=${encodeURIComponent(endpoint)}`, { ...options, headers, body: body as BodyInit | null, signal: options.signal ?? AbortSignal.timeout(55000), cache: 'no-store' });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new BotnoiApiError(data?.error || `โหลดข้อมูลไม่สำเร็จ (${response.status})`, response.status);
  }
  return response;
}
export async function botnoiFetch<T>(endpoint: string, options: BotnoiRequestOptions = {}): Promise<T> { return (await request(endpoint, options)).json(); }
export async function botnoiFetchBlob(endpoint: string, options: BotnoiRequestOptions = {}): Promise<Blob> { return (await request(endpoint, options)).blob(); }
