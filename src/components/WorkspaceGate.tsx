import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { clearWorkspace, loadCampaignWorkspace } from '../lib/campaigns';
import { Button } from './Button';
import { LoadingScreen } from './LoadingScreen';
import { currentPath, routes } from '../routes';
// Dev role comes from Supabase app_metadata (server-written). The backend enforces it; this only hides UI.
const DevRole = createContext(false);
export const useIsDev = () => useContext(DevRole);
export function WorkspaceGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [readyOwner, setReadyOwner] = useState('');
  const [revision, setRevision] = useState(0);
  const needsDatabase = currentPath() === routes.dashboard || currentPath().startsWith(routes.campaigns) || currentPath().startsWith(routes.contacts);
  useEffect(() => {
    if (!supabase) { setError('ยังไม่ได้ตั้งค่า Supabase'); setLoading(false); return; }
    let active = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => {
      if (active) { setSession(next); setLoading(false); if (!next) { clearWorkspace(); setReadyOwner(''); } }
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, []);
  useEffect(() => {
    let active = true;
    setReadyOwner(''); if (supabase) setError('');
    if (!session) { clearWorkspace(); return; }
    if (!needsDatabase) { setReadyOwner(session.user.id); return; }
    void loadCampaignWorkspace(session.user.id).then(() => { if (active) setReadyOwner(session.user.id); }).catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [session?.user.id, needsDatabase, revision]);
  // Signed out: go straight to the login page instead of showing a dead-end screen.
  const signedOut = !loading && !session && !error;
  useEffect(() => { if (signedOut) window.location.replace(routes.login); }, [signedOut]);
  if (signedOut) return <LoadingScreen label="กำลังไปหน้าเข้าสู่ระบบ…" />;
  if (loading) return <LoadingScreen label="กำลังตรวจสอบบัญชี…" />;
  if (!session) return <main className="page-shell real-data-page"><h1>เข้าสู่ระบบเพื่อใช้งาน</h1><p>แคมเปญและรายชื่อจะบันทึกไว้กับบัญชีของคุณ</p>{error && <p role="alert">{error}</p>}<Button href={routes.login}>เข้าสู่ระบบ</Button></main>;
  if (error) return <main className="page-shell real-data-page"><h1>ยังเปิดพื้นที่แคมเปญไม่ได้</h1><p role="alert" className="workspace-alert">{error}</p><Button onClick={() => setRevision(v => v + 1)}>ลองโหลดใหม่</Button><Button href={routes.dashboard} variant="secondary">กลับภาพรวม</Button></main>;
  if (readyOwner !== session.user.id) return <LoadingScreen label="กำลังโหลดแคมเปญของคุณ…" />;
  return <DevRole.Provider value={session.user.app_metadata?.role === 'dev'}><div key={session.user.id}>{children}</div></DevRole.Provider>;
}
