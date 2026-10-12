import { useEffect, useState } from 'react';
import { botnoiFetch } from '../services/botnoi/client';
import { Button } from './Button';

type SetupStatus = { agent_id: string; agent_name: string; revision: string; can_manage: boolean; configured: boolean; connected: boolean; warning?: string };
export function AgentResultSetup({ agentId, onConnected, onBusy }: { agentId: string; onConnected?: () => void; onBusy?: (busy: boolean) => void }) {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [review, setReview] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const path = `/workspace/agents/${encodeURIComponent(agentId)}/result-setup`;
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true); setError(''); setStatus(null); setReview(false); setConfirmed(false);
    void botnoiFetch<SetupStatus>(path, { signal: abort.signal }).then(data => {
      if (!abort.signal.aborted) setStatus(data);
    }).catch(err => {
      if (!abort.signal.aborted) setError(err instanceof Error ? err.message : 'ตรวจการเชื่อมต่อไม่สำเร็จ');
    }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [path, revision]);
  async function connect() {
    if (!status || !confirmed || busy || !status.can_manage || !status.configured) return;
    setBusy(true); onBusy?.(true); setError('');
    try {
      const data = await botnoiFetch<SetupStatus>(path, { method: 'POST', body: { confirm: true, expected_revision: status.revision } });
      setStatus(data); setReview(false); setConfirmed(false); onConnected?.();
    } catch (err) { setError(err instanceof Error ? err.message : 'เชื่อมไม่สำเร็จ กรุณาตรวจสถานะก่อนลองใหม่'); }
    finally { setBusy(false); onBusy?.(false); }
  }
  return <section className={`agent-result-setup${status?.connected ? ' agent-result-setup--connected' : ''}`} aria-label="ระบบรับผลตอบรับ">
    <div className="agent-result-setup__heading"><div><h3>รับผลตอบรับจากบอท</h3><p>บันทึกคำตอบของผู้รับกลับแคมเปญ เช่น ตกลง ปฏิเสธ หรือขอเจ้าหน้าที่</p></div><span className="agent-result-setup__badge" role="status">{loading ? 'กำลังตรวจ…' : busy ? 'กำลังเชื่อม…' : status?.connected ? 'เชื่อมแล้ว' : status ? 'ยังไม่เชื่อม' : 'ตรวจไม่ได้'}</span></div>
    {status?.connected && <p className="agent-result-setup__success">พร้อมส่งผลจากสายใหม่ · โทรทดสอบเพื่อยืนยันคำตอบจริงของบอทนี้</p>}
    {status && !status.connected && <p>{status.can_manage ? status.configured ? 'เชื่อมครั้งเดียว แล้วใช้รับผลกับแคมเปญที่เลือกบอทนี้ได้' : 'ผู้ดูแลต้องตั้งค่าระบบรับผลบนเซิร์ฟเวอร์ก่อนเชื่อม' : 'เชื่อมบัญชี Voice Bot ของคุณที่หน้าตั้งค่าก่อน แล้วเลือกบอทที่บัญชีของคุณมีสิทธิ์ใช้'}</p>}
    {error && <p className="workspace-alert" role="alert">{error}</p>}
    {status?.warning && <p className="workspace-notice" role="status">{status.warning}</p>}
    {review && status && <div className="agent-result-setup__review"><h4>เชื่อม {status.agent_name}</h4><p>ระบบจะสร้างหรือใช้เครื่องมือรับผลในบัญชี Voice Bot ที่คุณเชื่อมไว้ เพิ่มคำสั่งส่งผลก่อนวางสาย และเก็บการตั้งค่าก่อนแก้ หากมีผู้อื่นใช้บัญชี Voice Bot เดียวกัน การเปลี่ยนบอทนี้จะมีผลกับเขาด้วย</p><p className="workspace-note">หากผู้รับวางสายก่อนบอทส่งผล อาจยังไม่มีคำตอบกลับมา</p><label><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} /> ฉันตรวจบอทและยืนยันให้เชื่อมระบบรับผล</label><div className="agent-result-setup__actions"><Button size="compact" disabled={!confirmed || busy} onClick={() => void connect()}>{busy ? 'กำลังเชื่อมระบบรับผล…' : 'ยืนยันและเชื่อมระบบรับผล'}</Button><Button size="compact" variant="secondary" disabled={busy} onClick={() => { setReview(false); setConfirmed(false); }}>ยกเลิก</Button></div></div>}
    {!review && <div className="agent-result-setup__actions">{status?.can_manage && !status.connected && <Button size="compact" disabled={!status.configured || loading || busy || Boolean(error)} onClick={() => setReview(true)}>เชื่อมระบบรับผล</Button>}<Button size="compact" variant="secondary" disabled={loading || busy} onClick={() => setRevision(v => v + 1)}>ตรวจสถานะใหม่</Button></div>}
  </section>;
}
