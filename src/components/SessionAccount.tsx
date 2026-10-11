import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { clearWorkspace } from '../lib/campaigns';
import { Button } from './Button';
import { routes } from '../routes';
export function SessionAccount() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [requests, setRequests] = useState<Array<{ id: string; destination: string; status: string; call_id: string | null; created_at: string }>>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { let active = true; void (async () => {
    if (!supabase) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!active || !user) return;
    setEmail(user.email || user.id);
    const { data, error } = await supabase.from('voice_call_requests').select('id,destination,status,call_id,created_at').order('created_at', { ascending: false }).limit(20);
    if (active) { setRequests(data || []); setError(error ? 'ยังอ่านประวัติคำขอไม่ได้ กรุณาตรวจการติดตั้งฐานข้อมูล' : ''); setLoading(false); }
  })(); return () => { active = false; }; }, []);
  async function logout() { if (!supabase) return; const { error } = await supabase.auth.signOut(); if (error) { setError('ออกจากระบบไม่สำเร็จ กรุณาลองใหม่'); return; } clearWorkspace(); window.location.assign(routes.login); }
  return <section className="settings-card"><h2>บัญชีที่เข้าสู่ระบบ</h2><p>{email || 'กำลังโหลด…'}</p><Button size="compact" variant="secondary" onClick={logout}>ออกจากระบบ</Button><h3>คำขอโทรล่าสุดของคุณ</h3><p className="workspace-note">สถานะ ณ ตอนส่งคำขอ ใช้ Call ID ตรวจสถานะสายล่าสุดได้ที่หน้าโทรทดสอบ · unknown หมายถึงยังยืนยันไม่ได้ ห้ามถือว่าไม่เกิดการโทร</p>{error && <p role="alert">{error}</p>}{loading ? <p role="status">กำลังโหลด…</p> : requests.length ? <div className="activity-table-wrap"><table className="activity-table"><thead><tr><th>เวลา</th><th>เบอร์</th><th>สถานะคำขอ</th><th>Call ID</th></tr></thead><tbody>{requests.map(r => <tr key={r.id}><td>{new Date(r.created_at).toLocaleString('th-TH')}</td><td>{r.destination}</td><td>{r.status}</td><td>{r.call_id || 'ยังไม่ได้รับ'}</td></tr>)}</tbody></table></div> : !error && <p>ยังไม่มีคำขอโทร</p>}</section>;
}
