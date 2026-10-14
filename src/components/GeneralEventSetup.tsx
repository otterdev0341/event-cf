import { useEffect, useState } from 'react';
import { botnoiFetch } from '../services/botnoi/client';
import { Button } from './Button';
type Reception = { company_name: string; support_phone: string; company_details: string };
type Status = { agent_id: string; agent_name: string; revision: string; can_manage: boolean; configured: boolean; connected: boolean; reception?: Reception; warning?: string };
export function GeneralEventSetup({ agentId, onConnected }: { agentId: string; onConnected?: () => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const [reception, setReception] = useState<Reception>({ company_name: '', support_phone: '', company_details: '' });
  const path = `/workspace/agents/${agentId}/general-setup`;
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setStatus(null); setError(''); setReview(false); setConfirmed(false);
    void botnoiFetch<Status>(path, { signal: controller.signal }).then(data => { if (!controller.signal.aborted) { setStatus(data); setReception({ company_name: '', support_phone: '', company_details: '', ...data.reception }); } })
      .catch(err => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'ตรวจการเชื่อมข้อมูลไม่ได้'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [path, revision]);
  async function connect() {
    if (!status?.can_manage || !status.configured || !confirmed || busy) return;
    setBusy(true); setError('');
    try { const result = await botnoiFetch<Status>(path, { method: 'POST', body: { confirm: true, expected_revision: status.revision, reception } }); setStatus(result); setReception(result.reception || reception); setReview(false); setConfirmed(false); onConnected?.(); }
    catch (err) { setError(err instanceof Error ? err.message : 'เชื่อมข้อมูลไม่ได้'); }
    finally { setBusy(false); }
  }
  return <section className="activity-section" aria-label="บอทตอบข้อมูลทั่วไป"><div className="inbound-section-heading"><div><h2>บอทตอบข้อมูลทั่วไปของทุกงาน</h2><p className="workspace-note">{status?.agent_name || 'Agent ที่เลือก'} · ถามชื่องาน แล้วค้นข้อมูลจากเว็บโดยไม่ถามเบอร์</p></div><span className="inbound-status">{loading ? 'กำลังตรวจ…' : status?.connected ? 'เชื่อมข้อมูลแล้ว' : 'ยังไม่เชื่อมข้อมูล'}</span></div>
    {status?.connected && <p className="workspace-notice">บอทเชื่อมเครื่องมือค้นงานแล้ว เปิดข้อมูลของแต่ละงานด้านล่าง และเลือกบอทนี้เป็น Agent ประจำเบอร์รับสาย จากนั้นโทรทดสอบคำตอบจริง</p>}
    {status?.reception?.company_name && <p className="workspace-note">บริษัท {status.reception.company_name}{status.reception.support_phone && <> · ติดต่อเจ้าหน้าที่ {status.reception.support_phone}</>}</p>}
    {error && <p className="workspace-alert" role="alert">{error}</p>}
    {status?.warning && <p className="workspace-notice">{status.warning}</p>}
    {review && status && <div className="inbound-review"><h3>ตั้งค่าผู้ช่วยรับสาย · {status.agent_name}</h3><p>บอทตอบชื่อบริษัทและเบอร์ติดต่อได้โดยตรง รายละเอียดงานใช้เฉพาะข้อมูลที่เปิดให้ผู้โทรทุกคน หากไม่มีข้อมูลหรือเป็นคำถามเชิงลึก จะแนะนำเบอร์เจ้าหน้าที่ให้ผู้โทรติดต่อเอง</p><div className="inbound-reception-fields"><label>ชื่อบริษัท<input value={reception.company_name} maxLength={160} disabled={busy} placeholder="ชื่อบริษัทที่ให้บอทใช้ทักทาย" onChange={e => { setReception(value => ({ ...value, company_name: e.target.value })); setConfirmed(false); }} /></label><label>เบอร์ติดต่อเจ้าหน้าที่<input type="tel" value={reception.support_phone} maxLength={20} disabled={busy} placeholder="เช่น 0641922433" onChange={e => { setReception(value => ({ ...value, support_phone: e.target.value })); setConfirmed(false); }} /></label></div><label className="inbound-reception-details">ข้อมูลบริษัท / คำถามที่พบบ่อย<textarea value={reception.company_details} maxLength={8000} rows={5} disabled={busy} placeholder="ใส่ข้อเท็จจริงที่ให้บอทตอบ เช่น บริการ ช่องทางติดต่อ เวลาทำการ และคำตอบที่พบบ่อย" onChange={e => { setReception(value => ({ ...value, company_details: e.target.value })); setConfirmed(false); }} /></label><p className="workspace-note">เบอร์นี้ใช้แนะนำให้ติดต่อ ยังไม่ใช่การโอนสายอัตโนมัติ หากบอทนี้ใช้โทรออกด้วย ควรเลือกบอทที่สร้างสำหรับรับสายโดยเฉพาะ</p><label className="inbound-consent"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} />ฉันตรวจชื่อบริษัท เบอร์ติดต่อ และเลือกบอทรับสายแล้ว</label><div className="draft-actions"><Button disabled={!confirmed || busy} size="compact" onClick={() => void connect()}>{busy ? 'กำลังบันทึก…' : 'บันทึกและเชื่อมข้อมูลทั่วไป'}</Button><Button variant="secondary" size="compact" disabled={busy} onClick={() => { setReview(false); setConfirmed(false); setReception({ company_name: '', support_phone: '', company_details: '', ...status.reception }); }}>ยกเลิก</Button></div></div>}
    {!review && <div className="draft-actions">{status?.can_manage && <Button size="compact" disabled={loading || busy || !status.configured || Boolean(error)} onClick={() => setReview(true)}>{status.connected ? 'ตั้งค่าบริษัทและเบอร์ติดต่อ' : 'เชื่อมข้อมูลทั่วไปให้บอทนี้'}</Button>}<Button variant="secondary" size="compact" disabled={loading || busy} onClick={() => setRevision(value => value + 1)}>ตรวจการเชื่อมใหม่</Button></div>}
  </section>;
}
