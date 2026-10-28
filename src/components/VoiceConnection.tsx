import { useEffect, useState } from 'react';
import { botnoiFetch } from '../services/botnoi/client';
import { Button } from './Button';
import { routes } from '../routes';

type Account = {account_id:string;username:string;email:string;role:string;verified:boolean|null;expires_at:string|null};
type Connection = Partial<Account> & {connected:boolean;updated_at?:string;expired?:boolean;shared?:boolean};
export function VoiceConnection() {
  const [connection,setConnection]=useState<Connection|null>(null),[candidate,setCandidate]=useState<Account|null>(null);
  const [token,setToken]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const [editing,setEditing]=useState(false),[disconnecting,setDisconnecting]=useState(false),[confirmed,setConfirmed]=useState(false);
  useEffect(()=>{let alive=true;void botnoiFetch<Connection>('/workspace/connection').then(data=>{if(alive)setConnection(data);}).catch(e=>{if(alive)setError(e.message);}).finally(()=>{if(alive)setLoading(false);});return()=>{alive=false;};},[]);
  async function verify() {
    if(busy||!token.trim())return;setBusy(true);setError('');setCandidate(null);setConfirmed(false);
    try {const data=await botnoiFetch<{account:Account}>('/workspace/connection',{method:'POST',body:{action:'verify',token:token.trim()}});setCandidate(data.account);}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  async function save(action:'connect'|'disconnect') {
    if(!confirmed||busy||!connection||action==='connect'&&!candidate)return;
    setBusy(true);setError('');
    try {await botnoiFetch<Connection>('/workspace/connection',{method:'POST',body:{action,confirm:true,expected_updated_at:connection.updated_at??null,...(action==='connect'?{token:token.trim(),expected_account_id:candidate!.account_id}:{})}});setToken('');setCandidate(null);window.location.assign(routes.settings);}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  const shared=connection?.shared===true;
  const showForm=connection&&!shared&&(!connection.connected||editing||connection.expired);
  const identity=(account:Partial<Account>)=><dl className="real-data-fields"><div><dt>ชื่อผู้ใช้ Voice Bot</dt><dd>{account.username||'ไม่ระบุ'}</dd></div><div><dt>อีเมล Voice Bot</dt><dd>{account.email||'ไม่ระบุ'}</dd></div><div><dt>รหัสบัญชี</dt><dd><code>{account.account_id}</code></dd></div><div><dt>Token หมดอายุ</dt><dd>{account.expires_at?new Date(account.expires_at).toLocaleString('th-TH'):'บริการไม่ได้ระบุวันหมดอายุ · อาจถูกยกเลิกได้'}</dd></div></dl>;
  return <section className="settings-card voice-connection" aria-labelledby="voice-connection-title">
    <header className="voice-connection__heading"><div><span className="ui-kicker">VOICE BOT ACCOUNT</span><h2 id="voice-connection-title">{shared?'บัญชี Voice Bot ของทีม':'เชื่อมบัญชี Voice Bot ของคุณ'}</h2><p>{shared?'ทุกคนในทีมใช้ Agent และคู่สายของบัญชีนี้ ผู้ดูแลกำหนดบนเซิร์ฟเวอร์':'ใช้ Agent และคู่สายของบัญชีที่คุณเชื่อมไว้'}</p></div><span className={`voice-connection__status${connection?.connected&&!connection.expired?' is-connected':''}`} role="status">{loading?'กำลังตรวจ…':connection?.expired?'Token หมดอายุ':connection?.connected?'เชื่อมแล้ว':'ยังไม่เชื่อม'}</span></header>
    {error&&<p className="workspace-alert" role="alert">{error}</p>}
    {shared&&!connection?.connected&&!loading&&<p className="workspace-alert" role="alert">บัญชี Voice Bot ของทีมใช้ไม่ได้ กรุณาแจ้งผู้ดูแลให้ตรวจ VOICE_BOT_ACCESS_TOKEN</p>}
    {connection?.connected&&<><div className="voice-connection__identity">{identity(connection)}</div>{!shared&&<p className="workspace-note">การเชื่อมนี้เป็นของบัญชีเว็บที่คุณล็อกอินอยู่ แคมเปญและประวัติเดิมยังเก็บไว้ หากเปลี่ยนบัญชี Voice Bot ต้องใช้บัญชีเดิมเพื่อตรวจสายเดิมหรือโทรต่อ</p>}{!shared&&!editing&&!disconnecting&&<div className="draft-actions"><Button size="compact" variant="secondary" disabled={busy} onClick={()=>{setEditing(true);setConfirmed(false);}}>เปลี่ยน / ต่ออายุ Session JWT</Button><Button size="compact" variant="secondary" disabled={busy} onClick={()=>{setDisconnecting(true);setConfirmed(false);}}>ยกเลิกการเชื่อม</Button></div>}</>}
    {showForm&&!disconnecting&&<div className="voice-connection__form"><ol className="voice-connection__steps"><li>เข้า Voice Bot ของคุณ → Developers → API Keys</li><li>คัดลอก Session JWT แล้ววางด้านล่างเพื่อตรวจบัญชี</li></ol><a href="https://voicebot-stg.botnoigroup.com/home" target="_blank" rel="noopener noreferrer">เปิด Voice Bot ↗</a><label htmlFor="voice-session-jwt">Session JWT ของ Voice Bot</label><input id="voice-session-jwt" className="voice-connection__token" type="password" autoComplete="off" spellCheck={false} value={token} disabled={busy} onChange={e=>{setToken(e.target.value);setCandidate(null);setConfirmed(false);}} placeholder="วาง Session JWT ที่คัดลอกจาก Voice Bot"/><p className="workspace-note">Token ใช้เข้าถึงบัญชี Voice Bot ของคุณ เว็บจะเก็บแบบเข้ารหัสบนเซิร์ฟเวอร์ และไม่แสดง Token หลังบันทึก</p><div className="draft-actions"><Button size="compact" disabled={busy||!token.trim()} onClick={()=>void verify()}>{busy?'กำลังดำเนินการ…':'ตรวจบัญชีจาก JWT'}</Button>{connection?.connected&&<Button size="compact" variant="secondary" disabled={busy} onClick={()=>{setEditing(false);setToken('');setCandidate(null);}}>ยกเลิก</Button>}</div>{candidate&&<div className="voice-connection__review"><h3>ตรวจบัญชีก่อนเชื่อม</h3>{identity(candidate)}<label><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/> ฉันยืนยันให้เว็บใช้และเก็บ Session JWT ของบัญชีนี้เพื่อเรียก Voice Bot</label><Button size="compact" disabled={busy||!confirmed} onClick={()=>void save('connect')}>ยืนยันและเชื่อมบัญชีนี้</Button></div>}</div>}
    {disconnecting&&<div className="voice-connection__review"><p>เว็บจะลบ Token ที่เก็บไว้และหยุดเรียก Voice Bot ด้วยบัญชีนี้ แคมเปญและผลโทรที่บันทึกไว้ยังอยู่</p><label><input type="checkbox" disabled={busy} checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> ยืนยันยกเลิกการเชื่อมบัญชี {connection?.username}</label><div className="draft-actions"><Button size="compact" disabled={busy||!confirmed} onClick={()=>void save('disconnect')}>ยืนยันยกเลิกการเชื่อม</Button><Button size="compact" variant="secondary" disabled={busy} onClick={()=>{setDisconnecting(false);setConfirmed(false);}}>กลับ</Button></div></div>}
  </section>;
}
