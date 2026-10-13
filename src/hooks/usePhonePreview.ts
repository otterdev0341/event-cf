import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { botnoiApi, BotnoiApiError, botnoiFetch } from '../services/botnoi';
import { formatDialDestination, normalizePhone } from '../lib/campaigns';
import { terminalCall } from '../../shared/campaign-queue.mjs';
import type { PreviewData } from './useVoicePreview';

export interface PhoneAttempt {
  id: string; call_id: string | null; destination: string; status: string; created_at: string;
  metadata: { voice_account_id?: string; variables?: Record<string, string> };
  response: { review?: PhoneOutcome; callback?: { outcome: PhoneOutcome }; followup?: { outcome: PhoneOutcome; transcript?: string; checked_at?: string }; transcript?: { text: string } } | null;
  warning?: string;
}
export interface PhoneOutcome { call_result: string; needs_agent: boolean | null; source: string; evidence?: string }
export const phoneStatusLabels: Record<string, string> = { reserved: 'กำลังส่งคำขอ', queued: 'รอโทร', ringing: 'กำลังเรียกสาย', 'in-progress': 'กำลังสนทนา', answered: 'รับสายแล้ว', completed: 'จบสาย', failed: 'โทรไม่สำเร็จ', busy: 'สายไม่ว่าง', 'no-answer': 'ไม่รับสาย', cancelled: 'ยกเลิก', canceled: 'ยกเลิก', unknown: 'ยังยืนยันสถานะไม่ได้' };

export function usePhonePreview(data: PreviewData) {
  const [phone, setPhone] = useState(data.variables.phone_number || '');
  const [format, setFormat] = useState<'entered' | 'international'>('entered');
  const [consent, setConsent] = useState(false);
  const [attempts, setAttempts] = useState<PhoneAttempt[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [calling, setCalling] = useState(false);
  const [checking, setChecking] = useState(false);
  const [ready, setReady] = useState(false);
  const [tenant, setTenant] = useState('');
  const [error, setError] = useState('');
  const [connectionError, setConnectionError] = useState('');
  const [notice, setNotice] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const [revision, setRevision] = useState(0);
  const alive = useRef(true);
  const dialBusy = useRef(false);
  const resultBusy = useRef(false);
  const request = useRef('');
  const selected = attempts.find(a => a.id === selectedId) || attempts[0];
  const pending = attempts.find(a => !terminalCall(a.status));
  const destination = formatDialDestination(phone, format);
  const validPhone = /^\+[1-9]\d{7,14}$/.test(normalizePhone(phone));
  const blocked = Boolean(loading || calling || checking || pending || uncertain);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function readHistory(accountId: string) {
    if (!supabase) throw Error('ยังไม่ได้เชื่อมบัญชีเว็บ');
    const { data: rows, error: readError } = await supabase.from('voice_call_requests')
      .select('id,call_id,destination,status,created_at,metadata,response').eq('agent_id', data.agentId)
      .eq('metadata->>preview_test', 'true').eq('metadata->>voice_account_id', accountId)
      .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(20);
    if (readError) throw Error('ยังอ่านประวัติการทดสอบไม่ได้ กรุณาตรวจอีกครั้งก่อนโทร');
    return (rows || []) as PhoneAttempt[];
  }
  useEffect(() => {
    let current = true;
    setLoading(true); setReady(false); setConnectionError('');
    void (async () => {
      try {
        const account = await botnoiApi.getAccount();
        const overview = await botnoiApi.getProvisioningOverview(account._id, { include: 'tenant,trunk_status' });
        const rows = await readHistory(account._id);
        if (!current) return;
        setTenant(account._id); setAttempts(previous => {
          // Retain a locally accepted call if its initial database write has not become visible.
          const missing = previous.filter(a => a.id === request.current && !rows.some(row => row.id === a.id));
          return [...missing, ...rows];
        });
        const config = overview.sections.tenant?.ok ? overview.sections.tenant.data : null;
        const trunk = overview.sections.trunk_status?.ok ? overview.sections.trunk_status.data : null;
        if (!config?.outbound?.enabled || !trunk || trunk.disabled_at) throw Error('บัญชี Voice Bot นี้ยังไม่พร้อมโทรออก');
        if (config.readiness?.pbx?.ready !== true || (trunk.mode !== 'ip' && trunk.registration?.state !== 'registered')) throw Error('คู่สายโทรศัพท์ยังไม่พร้อม กรุณาตรวจการตั้งค่าใน Voice Bot');
        setReady(true);
      } catch (caught) { if (current) setConnectionError(caught instanceof Error ? caught.message : 'ตรวจการเชื่อมต่อไม่สำเร็จ'); }
      finally { if (current) setLoading(false); }
    })();
    return () => { current = false; };
  }, [data.agentId, revision]);

  async function refresh(attempt = selected) {
    if (!attempt || resultBusy.current || dialBusy.current) return;
    resultBusy.current = true; setChecking(true); setError('');
    try {
      const updated = await botnoiFetch<PhoneAttempt>(`/workspace/calls/${attempt.id}/result`);
      if (!alive.current) return;
      setAttempts(previous => previous.map(item => item.id === updated.id ? updated : item));
      if (updated.call_id) setUncertain(false);
    } catch (caught) { if (alive.current) setError(caught instanceof Error ? caught.message : 'ตรวจผลไม่สำเร็จ'); }
    finally { resultBusy.current = false; if (alive.current) setChecking(false); }
  }
  // Only read status/results. Polling never places or retries an outbound call.
  useEffect(() => {
    if (!pending?.call_id || !tenant || calling) return;
    let count = 0;
    const timer = window.setInterval(() => {
      void refresh(pending);
      if (++count >= 120) window.clearInterval(timer);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [pending?.id, pending?.call_id, tenant, calling]);
  useEffect(() => {
    if (!tenant || !selected || !terminalCall(selected.status)) return;
    const timer = window.setInterval(() => {
      void readHistory(tenant).then(rows => { if (alive.current) setAttempts(rows); }).catch(() => {});
    }, 15000);
    return () => window.clearInterval(timer);
  }, [tenant, selected?.id, selected?.status]);

  async function call() {
    if (dialBusy.current || blocked || !ready || !tenant || !validPhone || !consent) return;
    dialBusy.current = true; setCalling(true); setConsent(false); setError(''); setNotice('กำลังส่งคำขอโทร…');
    const id = crypto.randomUUID(); request.current = id;
    const created = new Date().toISOString();
    try {
      const result = await botnoiApi.placeCall(tenant, destination, data.agentId, { requestId: id, variables: { ...data.variables }, previewTest: true, outputs: data.outputs });
      if (!alive.current) return;
      setSelectedId(id);
      setAttempts(previous => [{ id, call_id: result.call_id || null, destination, status: result.status || 'unknown', created_at: created, metadata: { variables: data.variables, voice_account_id: tenant }, response: null }, ...previous]);
      setUncertain(!result.call_id || Boolean(result.persistence_warning));
      setNotice(result.persistence_warning || 'ส่งคำขอแล้ว กรุณารับสายที่เบอร์ทดสอบ');
    } catch (caught) {
      if (!alive.current) return;
      setNotice(''); setError(caught instanceof Error ? caught.message : 'ส่งคำขอโทรไม่สำเร็จ');
      const rejected = caught instanceof BotnoiApiError && [400, 401, 403, 404, 409, 428, 429, 503].includes(caught.status);
      setUncertain(!rejected);
      try {
        const rows = await readHistory(tenant);
        if (alive.current) { setAttempts(rows); if (rows.some(row => row.id === id)) { setSelectedId(id); setUncertain(!rows.find(row => row.id === id)?.call_id); } }
      } catch { if (alive.current) setUncertain(true); }
    } finally { dialBusy.current = false; if (alive.current) setCalling(false); }
  }
  return { phone, format, consent, attempts, selected, pending, loading, calling, checking, ready, error, connectionError, notice, uncertain, destination, validPhone, blocked,
    setPhone: (value: string) => { setPhone(value); setConsent(false); }, setFormat: (value: 'entered' | 'international') => { setFormat(value); setConsent(false); }, setConsent,
    select: (attempt: PhoneAttempt) => { setSelectedId(attempt.id); void refresh(attempt); }, refresh: () => refresh(pending || selected), reload: () => setRevision(value => value + 1), call };
}
