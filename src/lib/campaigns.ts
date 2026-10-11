import type { VariableBinding } from '../../shared/campaign-inputs.mjs';
import { supabase } from './supabase';
export interface CsvData { headers: string[]; rows: string[][] }
export interface CampaignDraft {
  id: string; name: string; eventDate: string; eventTime: string;
  callStartMode: string; callStartDate: string; callStartTime: string;
  callingWindow: string; callingDays: string[]; allowedStartTime: string; allowedEndTime: string;
  fileName: string; csv: CsvData; mapping: Record<string, string>; agentId: string;
  variables?: Record<string, string>;
  variableBindings?: Record<string, VariableBinding>;
  updatedAt: string;
}
const DRAFT_KEY = 'voice-confirm:draft:v1';
const CAMPAIGNS_KEY = 'voice-confirm:campaigns:v1';

// Quoted commas, escaped quotes, CRLF, BOM and multiline fields are supported.
export function parseCsv(input: string): CsvData {
  const text = input.replace(/^\uFEFF/, '');
  const records: string[][] = [];
  let row: string[] = [], field = '', quoted = false, closed = false;
  const cell = () => { row.push(field.trim()); field = ''; closed = false; };
  const record = () => { cell(); if (row.some(Boolean)) records.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else field += c;
    } else if (c === ',' ) cell();
    else if (c === '\n' || c === '\r') { record(); if (c === '\r' && text[i + 1] === '\n') i++; }
    else if (c === '"' && !field && !closed) quoted = true;
    else if (closed && /\s/.test(c)) continue;
    else if (closed || c === '"') throw new Error('รูปแบบเครื่องหมายคำพูดใน CSV ไม่ถูกต้อง');
    else field += c;
  }
  if (quoted) throw new Error('ไฟล์ CSV มีเครื่องหมายคำพูดที่ยังไม่ปิด');
  record();
  const headers = records.shift();
  if (!headers?.length || headers.some(h => !h)) throw new Error('กรุณาระบุชื่อทุกคอลัมน์ในบรรทัดแรก');
  if (new Set(headers.map(h => h.toLowerCase())).size !== headers.length) throw new Error('ชื่อคอลัมน์ต้องไม่ซ้ำกัน');
  if (!records.length) throw new Error('ไฟล์ CSV ต้องมีรายชื่ออย่างน้อย 1 รายการ');
  if (records.length > 5000) throw new Error('รองรับไม่เกิน 5,000 รายการต่อไฟล์');
  const invalid = records.findIndex(r => r.length !== headers.length);
  if (invalid >= 0) throw new Error(`รายการที่ ${invalid + 1} มีจำนวนคอลัมน์ไม่ตรงกับหัวตาราง`);
  return { headers, rows: records };
}
// Dial using the entered national/international format unless explicitly selected.
export const DEFAULT_DIAL_FORMAT = 'entered' as const;
export type DialFormat = 'entered' | 'international';
export function formatDialDestination(value: string, format: DialFormat = DEFAULT_DIAL_FORMAT) {
  return format === 'international' ? normalizePhone(value) : value.replace(/[\s().-]/g, '');
}
export function normalizePhone(value: string) {
  const phone = value.replace(/[\s().-]/g, '');
  return /^0\d{8,9}$/.test(phone) ? '+66' + phone.slice(1) : phone;
}
export function mappingErrors(csv: CsvData, mapping: Record<string, string>): string[] {
  const selected = Object.values(mapping).filter(Boolean);
  if (!selected.includes('phone')) return ['กรุณาจับคู่คอลัมน์หมายเลขโทรศัพท์'];
  if (new Set(selected).size !== selected.length) return ['ตัวแปรแต่ละตัวจับคู่ได้กับคอลัมน์เดียว'];
  const column = csv.headers.findIndex(h => mapping[h] === 'phone');
  const invalid = csv.rows.flatMap((row, i) => /^\+[1-9]\d{7,14}$/.test(normalizePhone(row[column] || '')) ? [] : [i + 1]);
  return invalid.length ? [`หมายเลขโทรศัพท์ไม่ถูกต้องในรายการที่ ${invalid.slice(0, 5).join(', ')}${invalid.length > 5 ? ' และรายการอื่น' : ''}`] : [];
}
export function suggestMapping(headers: string[]): Record<string, string> {
  const used = new Set<string>();
  return Object.fromEntries(headers.map(header => {
    const key = header.toLowerCase().replace(/[\s-]/g, '_');
    let value = /^(phone|phone_number|mobile|tel|เบอร์โทร|เบอร์โทรศัพท์)$/.test(key) ? 'phone'
      : /^(name|guest_name|full_name|ชื่อ|ชื่อผู้ติดต่อ)$/.test(key) ? 'guest_name' : '';
    if (used.has(value)) value = '';
    if (value) used.add(value);
    return [header, value];
  }));
}
function read<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; }
  catch { return fallback; }
}
function isDraft(value: unknown): value is CampaignDraft {
  if (!value || typeof value !== 'object') return false;
  const d = value as CampaignDraft;
  return typeof d.id === 'string' && typeof d.name === 'string' && typeof d.fileName === 'string'
    && Array.isArray(d.csv?.headers) && d.csv.headers.every(h => typeof h === 'string')
    && Array.isArray(d.csv?.rows) && d.csv.rows.length > 0
    && d.csv.rows.every(r => Array.isArray(r) && r.length === d.csv.headers.length && r.every(v => typeof v === 'string'))
    && !!d.mapping && typeof d.mapping === 'object' && Object.values(d.mapping).every(v => typeof v === 'string')
    && Array.isArray(d.callingDays);
}

type CloudRecord = { id: string; state: 'editing' | 'saved'; data: CampaignDraft; updated_at: string };
let records: CloudRecord[] = [];
let workspaceOwner: string | null = null;
let loadVersion = 0;
const asDraft = (record: CloudRecord): CampaignDraft => ({ ...record.data, id: record.id, updatedAt: record.updated_at });
export function clearWorkspace() { loadVersion++; records = []; workspaceOwner = null; }
function databaseError(error: { message: string; code?: string }): Error {
  if (error.message.includes('edit_conflict')) return new Error('ข้อมูลถูกแก้จากอีกหน้าต่างหรืออุปกรณ์ กรุณารีเฟรชแล้วแก้ไขใหม่');
  if (error.code === '42P01' || error.code === 'PGRST205' || error.code === 'PGRST202') return new Error('ยังไม่ได้ติดตั้งตารางแคมเปญใน Supabase กรุณาให้ผู้ดูแลติดตั้งฐานข้อมูลก่อน');
  return new Error('บันทึกหรือโหลดข้อมูลไม่สำเร็จ กรุณาตรวจการเชื่อมต่อแล้วลองใหม่');
}
async function client() {
  if (!supabase || !workspaceOwner) throw new Error('กรุณาเข้าสู่ระบบก่อนจัดการแคมเปญ');
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user.id !== workspaceOwner) { clearWorkspace(); throw new Error('บัญชีเปลี่ยนหรือเซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่'); }
  return supabase;
}
export async function loadCampaignWorkspace(ownerId: string) {
  if (!supabase) throw new Error('ยังไม่ได้ตั้งค่าระบบบัญชี');
  clearWorkspace();
  const version = loadVersion;
  const collected: CloudRecord[] = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await supabase.from('voice_campaigns').select('id,state,data,updated_at').eq('owner_id', ownerId).order('updated_at', { ascending: false }).order('id').range(offset, offset + 99);
    if (error) throw databaseError(error);
    if (data.some(row => !isDraft({ ...row.data, id: row.id, updatedAt: row.updated_at }))) throw new Error('ข้อมูลแคมเปญในฐานข้อมูลมีรูปแบบไม่ถูกต้อง');
    collected.push(...data as CloudRecord[]);
    if (data.length < 100) break;
  }
  if (version !== loadVersion) throw new Error("บัญชีหรือคำขอโหลดเปลี่ยนแล้ว กรุณาลองใหม่");
  records = collected; workspaceOwner = ownerId;
}
export function getDraft(): CampaignDraft | null { const draft = records.find(r => r.state === 'editing'); return draft ? asDraft(draft) : null; }
export function getCampaigns(): CampaignDraft[] { return records.filter(r => r.state === 'saved').map(asDraft); }
async function persistCampaign(draft: CampaignDraft, state: 'editing' | 'saved') {
  if (!isDraft(draft)) throw new Error('ข้อมูลแคมเปญไม่ถูกต้อง');
  const db = await client();
  const owner = workspaceOwner;
  const exists = records.some(record => record.id === draft.id);
  const { data, error } = await db.rpc('save_voice_campaign', { p_data: draft, p_state: state, p_expected_updated_at: exists ? draft.updatedAt : null });
  if (error) throw databaseError(error);
  if (workspaceOwner !== owner) throw new Error('บัญชีเปลี่ยนแล้ว กรุณาโหลดข้อมูลใหม่');
  const saved = (Array.isArray(data) ? data[0] : data) as CloudRecord;
  records = [saved, ...records.filter(r => r.id !== saved.id).map(r => state === 'editing' && r.state === 'editing' ? { ...r, state: 'saved' as const } : r)];
  return asDraft(saved);
}
export async function saveDraft(draft: CampaignDraft) { return persistCampaign(draft, 'editing'); }
export async function completeDraft(draft: CampaignDraft) { return persistCampaign(draft, 'saved'); }
export async function deleteCampaign(id: string) {
  const db = await client();
  const { error } = await db.from('voice_campaigns').delete().eq('id', id);
  if (error) throw databaseError(error);
  records = records.filter(r => r.id !== id);
}
export async function discardDraft() { const draft = getDraft(); if (draft) await deleteCampaign(draft.id); }
// Legacy browser data is offered for explicit import; it is never silently assigned to a login.
export function getLegacyCampaigns(): CampaignDraft[] {
  const saved = read<CampaignDraft[]>(CAMPAIGNS_KEY, []);
  const draft = read<CampaignDraft | null>(DRAFT_KEY, null);
  return [...new Map([...(Array.isArray(saved) ? saved : []), ...(draft ? [draft] : [])].filter(isDraft).map(d => [d.id, d])).values()];
}
export async function importLegacyCampaigns() {
  for (const draft of getLegacyCampaigns()) if (!records.some(r => r.id === draft.id)) await persistCampaign(draft, 'saved');
}
export function resolveVariables(draft: CampaignDraft | null, rowIndex: number, overrides: Record<string, string> = {}) {
  const values: Record<string, string> = { ...(draft?.eventDate ? { event_date: draft.eventDate } : {}), ...(draft?.eventTime ? { event_time: draft.eventTime } : {}), ...draft?.variables };
  if (draft && rowIndex >= 0) draft.csv.headers.forEach((header, index) => {
    const variable = draft.mapping[header];
    if (variable && variable !== 'phone' && !['__proto__','constructor','prototype'].includes(variable)) values[variable] = draft.csv.rows[rowIndex]?.[index] || '';
  });
  if (draft && rowIndex >= 0) for (const [variable, binding] of Object.entries(draft.variableBindings || {})) {
    if (['__proto__', 'constructor', 'prototype'].includes(variable)) continue;
    if (binding.source === 'output') delete values[variable];
    else values[variable] = draft.csv.rows[rowIndex]?.[draft.csv.headers.indexOf(binding.column)] || '';
  }
  return { ...values, ...overrides };
}
export function downloadCsvTemplate() {
  const url = URL.createObjectURL(new Blob(['\uFEFFguest_name,phone_number\r\n'], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = 'voice-confirm-contacts.csv'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Keep only fields supported by the selected Agent, plus the dial destination.
export function mappingForAgent(csv: CsvData, previous: Record<string, string>, variables: string[], suggest = true) {
  const allowed = new Set(['phone', ...variables]);
  const used = new Set<string>();
  const result: Record<string, string> = {};
  for (const header of csv.headers) {
    const current = previous[header];
    result[header] = current && allowed.has(current) && !used.has(current) ? current : '';
    if (result[header]) used.add(result[header]);
  }
  if (!suggest) return result;
  const suggested = suggestMapping(csv.headers);
  for (const header of csv.headers) {
    if (result[header]) continue;
    const candidate = suggested[header] === 'phone' ? 'phone' : variables.find(v => v.toLowerCase() === header.trim().toLowerCase()) || suggested[header];
    if (candidate && allowed.has(candidate) && !used.has(candidate)) { result[header] = candidate; used.add(candidate); }
  }
  return result;
}
