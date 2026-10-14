import { useEffect, useRef, useState } from 'react';
import { Button } from './Button';
import { botnoiFetch, botnoiFetchBlob } from '../services/botnoi/client';
import { repairRecording } from '../lib/recordingRepair';
import './AgentRecordings.css';

type RecordingState = { state: 'available'|'pending'|'not_available'; message?: string; source?: string };
type Player = { url: string; originalSeconds: number; adjustedSeconds: number };
export function CallRecording({ requestId, callId, campaignId }: { requestId: string; callId: string|null; campaignId: string }) {
  const [info,setInfo]=useState<RecordingState|null>(null);
  const [busy,setBusy]=useState('');
  const [error,setError]=useState('');
  const [player,setPlayer]=useState<Player|null>(null);
  const controller=useRef<AbortController|null>(null), version=useRef(0), url=useRef('');
  const panel=useRef<HTMLElement|null>(null);
  function release(){if(url.current)URL.revokeObjectURL(url.current);url.current='';}
  async function check(){
    controller.current?.abort();const next=new AbortController();controller.current=next;
    const current=++version.current,signal=next.signal;
    release();setPlayer(null);setInfo(null);setError('');setBusy('กำลังตรวจเสียง…');
    const query=new URLSearchParams({campaign_id:campaignId});
    try{
      const result=await botnoiFetch<RecordingState>(`/workspace/calls/${requestId}/recording?${query}`,{signal});
      if(current!==version.current)return;setInfo(result);
      if(result.state==='available'){
        setBusy('กำลังโหลดเสียง…');
        const blob=await botnoiFetchBlob(`/workspace/calls/${requestId}/recording-audio?${query}`,{signal});
        if(current!==version.current)return;
        if(!blob.size||!blob.type.startsWith('audio/'))throw Error('บริการไม่ส่งไฟล์เสียงที่เปิดฟังได้');
        setBusy('กำลังปรับเสียง…');const repaired=await repairRecording(blob,signal);
        if(current!==version.current)return;
        url.current=URL.createObjectURL(new Blob([repaired.buffer],{type:'audio/wav'}));
        setPlayer({url:url.current,originalSeconds:repaired.original_seconds,adjustedSeconds:repaired.adjusted_seconds});
      }
    }
    catch(caught){if(!signal.aborted&&current===version.current)setError(caught instanceof Error?caught.message:'ตรวจเสียงไม่ได้');}
    finally{if(current===version.current)setBusy('');}
  }
  useEffect(()=>{panel.current?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'nearest'});void check();return()=>{version.current++;controller.current?.abort();release();};},[requestId,campaignId]);
  return <section ref={panel} className="call-recording" aria-label="บันทึกเสียงของครั้งนี้">
    <header className="results-header"><div><h4>เสียงของสายนี้ในแคมเปญ</h4><small>Call ID: {callId||'ยังไม่ได้รับ'}</small></div><Button size="compact" variant="secondary" disabled={Boolean(busy)} onClick={()=>void check()}>ตรวจเสียงใหม่</Button></header>
    {busy&&<p role="status" className="workspace-note">{busy}</p>}
    {error&&<p role="alert" className="workspace-alert">{error}</p>}
    {info?.state!=='available'&&info?.message&&<p className="workspace-note">{info.message}</p>}
    {player&&<div className="agent-recordings-player"><strong>{info?.source==='manual'?'เสียงที่ผู้ใช้ยืนยันและเชื่อมกับสายนี้':'เสียงที่บริการเชื่อมกับสายนี้'}</strong><span className="agent-recordings-ready">ปรับเสียงสำหรับฟังแล้ว</span><p className="agent-recordings-adjustment">{player.originalSeconds.toFixed(1)} → {player.adjustedSeconds.toFixed(1)} วินาที · ความยาวนี้ไม่ใช่ระยะเวลาสายจริง</p><audio key={player.url} controls preload="metadata" src={player.url} aria-label="ฟังบันทึกเสียงของครั้งนี้" onError={()=>setError('เปิดเสียงไม่ได้ กรุณาลองตรวจเสียงใหม่')} /><a href={player.url} download={`call-${requestId.slice(0,8)}-adjusted.wav`}>ดาวน์โหลดเสียงที่ปรับแล้ว</a></div>}
  </section>;
}
