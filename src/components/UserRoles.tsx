import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Button } from './Button';
import { SmoothSelect } from './ui/smooth-select';
import '../user-roles.css';

type Role = 'dev' | 'admin';
interface Member { id: string; email: string | null; role: Role; last_sign_in_at: string | null; }

const roleOptions = [{ value: 'dev' as const, label: 'dev · ทีมพัฒนา' }, { value: 'admin' as const, label: 'admin · ผู้ดูแล' }];
const lastSeen = (date: string | null) => date ? new Date(date).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium' }) : 'ยังไม่เคยเข้า';

/** Sends the signed-in user's token to /api/voice-users; the server only answers dev accounts. */
async function usersApi<T>(init?: { role: Role; user_id: string }): Promise<T> {
  const token = (await supabase?.auth.getSession())?.data.session?.access_token;
  if (!token) throw new Error('กรุณาเข้าสู่ระบบใหม่');
  const response = await fetch(`${import.meta.env.BASE_URL}api/voice-users`, {
    method: init ? 'POST' : 'GET', cache: 'no-store', signal: AbortSignal.timeout(25000),
    headers: { Authorization: `Bearer ${token}`, ...(init ? { 'Content-Type': 'application/json' } : {}) },
    body: init ? JSON.stringify(init) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'ทำรายการไม่สำเร็จ');
  return data as T;
}

export function UserRoles() {
  const [members, setMembers] = useState<Member[]>([]);
  const [me, setMe] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { const data = await usersApi<{ users: Member[]; me: string }>(); setMembers(data.users); setMe(data.me); }
    catch (err) { setError(err instanceof Error ? err.message : 'โหลดรายชื่อผู้ใช้ไม่ได้'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function change(member: Member, role: Role) {
    if (role === member.role || savingId) return;
    setSavingId(member.id); setError(''); setNotice('');
    try {
      await usersApi({ user_id: member.id, role });
      setMembers(list => list.map(item => item.id === member.id ? { ...item, role } : item));
      // The browser's copy of the role lives in its token; refresh it so the menu updates now.
      if (member.id === me) { await supabase?.auth.refreshSession(); window.location.reload(); return; }
      setNotice(`เปลี่ยน ${member.email || 'ผู้ใช้'} เป็น ${role} แล้ว ผู้ใช้ต้องเข้าสู่ระบบใหม่เพื่อให้เมนูเปลี่ยน`);
    } catch (err) { setError(err instanceof Error ? err.message : 'เปลี่ยนตำแหน่งไม่สำเร็จ'); }
    finally { setSavingId(''); }
  }

  return <section className="settings-card" aria-busy={loading}>
    <div className="rd-filters" style={{ justifyContent: 'space-between' }}><h2>ตำแหน่งผู้ใช้งาน</h2><Button size="compact" variant="secondary" onClick={() => void load()} disabled={loading || Boolean(savingId)}>รีเฟรชรายชื่อ</Button></div>
    <p className="workspace-note"><strong>dev</strong> เห็นหน้าทดสอบ Agent เอกสาร API และการเชื่อมต่อ Voice Bot · <strong>admin</strong> ใช้งานแคมเปญและรายงานตามปกติ แต่ไม่เห็นเมนูเหล่านี้ เฉพาะ dev เปลี่ยนตำแหน่งได้</p>
    {error && <p className="workspace-alert" role="alert">{error}</p>}
    {notice && <p className="workspace-notice" role="status">{notice}</p>}
    {loading ? <p role="status">กำลังโหลดรายชื่อผู้ใช้…</p> : <ul className="user-roles">{members.map(member => <li key={member.id}>
      <div><strong>{member.email || member.id}{member.id === me && <span className="rd-chip rd-chip--info rd-chip--plain" style={{ marginLeft: 8 }}>คุณ</span>}</strong><span className="rd-muted">เข้าล่าสุด {lastSeen(member.last_sign_in_at)}</span></div>
      <SmoothSelect aria-label={`ตำแหน่งของ ${member.email || member.id}`} value={member.role} disabled={Boolean(savingId)} options={roleOptions} onChange={role => void change(member, role)} />
    </li>)}</ul>}
  </section>;
}
