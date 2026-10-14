import { useEffect, useState } from 'react';
import { botnoiFetch } from '../services/botnoi/client';
import { Button } from './Button';
type Status = { agent_id: string; agent_name: string; revision: string; can_manage: boolean; configured: boolean; connected: boolean; warning?: string };
export function GeneralEventSetup({ agentId, onConnected }: { agentId: string; onConnected?: () => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const path = `/workspace/agents/${agentId}/general-setup`;
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setStatus(null); setError(''); setReview(false); setConfirmed(false);
    void botnoiFetch<Status>(path, { signal: controller.signal }).then(data => { if (!controller.signal.aborted) setStatus(data); })
      .catch(err => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'ตรวจการเชื่อมข้อมูลไม่ได้'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [path, revision]);
  async function connect() {
    if (!status?.can_manage || !status.configured || !confirmed || busy) return;
    setBusy(true); setError('');
    try { const result = await botnoiFetch<Status>(path, { method: 'POST', body: { confirm: true, expected_revision: status.revision } }); setStatus(result); setReview(false); setConfirmed(false); onConnected?.(); }
    catch (err) { setError(err instanceof Error ? err.message : 'เชื่อมข้อมูลไม่ได้'); }
    finally { setBusy(false); }
  }
  return <section className="activity-section" aria-label="บอทตอบข้อมูลทั่วไป"><div className="inbound-section-heading"><div><h2>บอทตอบข้อมูลทั่วไปของทุกงาน</h2><p className="workspace-note">{status?.agent_name || 'Agent ที่เลือก'} · ถามชื่องาน แล้วค้นข้อมูลจากเว็บโดยไม่ถามเบอร์</p></div><span className="inbound-status">{loading ? 'กำลังตรวจ…' : status?.connected ? 'เชื่อมข้อมูลแล้ว' : 'ยังไม่เชื่อมข้อมูล'}</span></div>
    {status?.connected && <p className="workspace-notice">บอทเชื่อมเครื่องมือค้นงานแล้ว เปิดข้อมูลของแต่ละงานด้านล่าง และเลือกบอทนี้เป็น Agent ประจำเบอร์รับสาย จากนั้นโทรทดสอบคำตอบจริง</p>}
    {error && <p className="workspace-alert" role="alert">{error}</p>}
    {status?.warning && <p className="workspace-notice">{status.warning}</p>}
    {review && status && <div className="inbound-review"><h3>เชื่อม {status.agent_name} กับข้อมูลทั่วไป</h3><p>เพิ่มเครื่องมือค้นงานและคำสั่งให้บอทถามชื่องานก่อนตอบ ใช้เฉพาะงานที่เปิดข้อมูลให้ผู้โทรทุกคน หากบอทนี้ใช้โทรออกด้วย ควรเลือกบอทที่สร้างสำหรับรับสายข้อมูลทั่วไปโดยเฉพาะ</p><label className="inbound-consent"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} />ฉันเลือกบอทรับสายและตรวจข้อมูลที่ให้ตอบแล้ว</label><div className="draft-actions"><Button disabled={!confirmed || busy || Boolean(error)} size="compact" onClick={() => void connect()}>{busy ? 'กำลังเชื่อม…' : 'ยืนยันและเชื่อมข้อมูลทั่วไป'}</Button><Button variant="secondary" size="compact" disabled={busy} onClick={() => setReview(false)}>ยกเลิก</Button></div></div>}
    {!review && <div className="draft-actions">{status?.can_manage && !status.connected && <Button size="compact" disabled={loading || busy || !status.configured || Boolean(error)} onClick={() => setReview(true)}>เชื่อมข้อมูลทั่วไปให้บอทนี้</Button>}<Button variant="secondary" size="compact" disabled={loading || busy} onClick={() => setRevision(value => value + 1)}>ตรวจการเชื่อมใหม่</Button></div>}
  </section>;
}
