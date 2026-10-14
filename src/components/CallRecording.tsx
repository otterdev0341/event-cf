import { useEffect, useRef, useState } from 'react';
import { Button } from './Button';
import { botnoiFetch, botnoiFetchBlob } from '../services/botnoi/client';
import { repairRecording } from '../lib/recordingRepair';
import './AgentRecordings.css';

type Candidate = { id: string; file_time: string; part: number };
type RecordingState = { state: 'available'|'pending'|'not_available'; message?: string; source?: string; linked_at?: string|null; agent_id?: string; range?: {start_date:string;end_date:string}; candidates?: Candidate[]; has_more?: boolean };
type Player = { url: string; originalSeconds: number; adjustedSeconds: number; candidateId?: string };
export function CallRecording({ requestId, callId }: { requestId: string; callId: string|null }) {
  const [info,setInfo]=useState<RecordingState|null>(null);
  const [busy,setBusy]=useState('');
  const [error,setError]=useState('');
  const [selection,setSelection]=useState('');
  const [confirmed,setConfirmed]=useState(false);
  const [player,setPlayer]=useState<Player|null>(null);
  const controller=useRef<AbortController|null>(null), version=useRef(0), url=useRef('');
  const panel=useRef<HTMLElement|null>(null);
  function release(){if(url.current)URL.revokeObjectURL(url.current);url.current='';}
  function begin(){controller.current?.abort();const next=new AbortController();controller.current=next;return {signal:next.signal,current:++version.current};}
  async function play(path:string,signal:AbortSignal,current:number,candidateId?:string){
    release();setPlayer(null);setConfirmed(false);setBusy('กำลังโหลดเสียง…');
    const blob=await botnoiFetchBlob(path,{signal});
    if(current!==version.current)return;
    if(!blob.size||!blob.type.startsWith('audio/'))throw Error('บริการไม่ส่งไฟล์เสียงที่เปิดฟังได้');
    setBusy('กำลังปรับเสียง…');const result=await repairRecording(blob,signal);
    if(current!==version.current)return;
    url.current=URL.createObjectURL(new Blob([result.buffer],{type:'audio/wav'}));
    setPlayer({url:url.current,originalSeconds:result.original_seconds,adjustedSeconds:result.adjusted_seconds,candidateId});
  }
  async function check(){
    const {signal,current}=begin();release();setPlayer(null);setInfo(null);setSelection('');setConfirmed(false);setError('');setBusy('กำลังตรวจเสียง…');
    try{const result=await botnoiFetch<RecordingState>(`/workspace/calls/${requestId}/recording`,{signal});if(current!==version.current)return;setInfo(result);if(result.state==='available')await play(`/workspace/calls/${requestId}/recording-audio`,signal,current);}
    catch(caught){if(!signal.aborted&&current===version.current)setError(caught instanceof Error?caught.message:'ตรวจเสียงไม่ได้');}
    finally{if(current===version.current)setBusy('');}
  }
  useEffect(()=>{panel.current?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'nearest'});void check();return()=>{version.current++;controller.current?.abort();release();};},[requestId]);
  async function preview(){
    if(!info?.agent_id||!info.range||!selection)return;
    const {signal,current}=begin();setError('');
    try{await play(`/workspace/agents/${info.agent_id}/audio/${selection}?${new URLSearchParams(info.range)}`,signal,current,selection);}
    catch(caught){if(!signal.aborted&&current===version.current)setError(caught instanceof Error?caught.message:'โหลดเสียงไม่ได้');}
    finally{if(current===version.current)setBusy('');}
  }
  async function save(){
    if(!confirmed||!player?.candidateId||player.candidateId!==selection)return;
    const {signal,current}=begin();setBusy('กำลังบันทึก…');setError('');
    try{const result=await botnoiFetch<RecordingState>(`/workspace/calls/${requestId}/recording`,{method:'POST',signal,body:{recording_id:selection,confirm:true,expected_link_at:info?.linked_at??null}});if(current===version.current){setInfo(result);setPlayer(previous=>previous?{...previous,candidateId:undefined}:null);setConfirmed(false);}}
    catch(caught){if(!signal.aborted&&current===version.current)setError(caught instanceof Error?caught.message:'บันทึกไม่ได้');}
    finally{if(current===version.current)setBusy('');}
  }
  return <section ref={panel} className="call-recording" aria-label="บันทึกเสียงของครั้งนี้">
    <header className="results-header"><div><h4>บันทึกเสียงของครั้งนี้</h4><small>Call ID: {callId||'ยังไม่ได้รับ'}</small></div><Button size="compact" variant="secondary" disabled={Boolean(busy)} onClick={()=>void check()}>ตรวจเสียงใหม่</Button></header>
    {busy&&<p role="status" className="workspace-note">{busy}</p>}
    {error&&<p role="alert" className="workspace-alert">{error}</p>}
    {info?.state!=='available'&&info?.message&&<p className="workspace-note">{info.message}</p>}
    {info?.state==='not_available'&&Boolean(info.candidates?.length)&&<div className="call-recording-link">
      <label>เลือกบันทึกของ Agent ในช่วงวันโทร<select className="workspace-select" value={selection} disabled={Boolean(busy)} onChange={e=>{version.current++;controller.current?.abort();release();setPlayer(null);setConfirmed(false);setSelection(e.target.value);}}><option value="">เลือกไฟล์เพื่อฟังตรวจสอบ</option>{info.candidates!.map(item=><option key={item.id} value={item.id}>{item.file_time} · ส่วนที่ {item.part+1} · {item.id.slice(0,8)}</option>)}</select></label>
      <p className="workspace-note">เวลาในชื่อไฟล์ตามบริการ · รายการนี้ยังไม่ยืนยันว่าเป็นเสียงของผู้ติดต่อนี้{info.has_more?' · แสดง 100 ไฟล์ล่าสุด':''}</p>
      <Button size="compact" variant="secondary" disabled={Boolean(busy)||!selection} onClick={()=>void preview()}>ฟังตรวจสอบไฟล์ที่เลือก</Button>
    </div>}
    {info?.state==='not_available'&&!info.candidates?.length&&<p className="workspace-note">ไม่พบไฟล์เสียงของ Agent ในช่วงวันโทร</p>}
    {player&&<div className="agent-recordings-player"><strong>{player.candidateId?'เสียงที่เลือก · ยังไม่ได้บันทึกกับสายนี้':info?.source==='manual'?'เสียงที่ผู้ใช้เลือกและเชื่อมกับสายนี้':'เสียงที่บริการเชื่อมกับสายนี้'}</strong><span className="agent-recordings-ready">ปรับเสียงสำหรับฟังแล้ว</span><p className="agent-recordings-adjustment">{player.originalSeconds.toFixed(1)} → {player.adjustedSeconds.toFixed(1)} วินาที · ความยาวนี้ไม่ใช่ระยะเวลาสายจริง</p><audio key={player.url} controls preload="metadata" src={player.url} aria-label="ฟังบันทึกเสียงของครั้งนี้" onError={()=>setError('เปิดเสียงไม่ได้ กรุณาลองตรวจเสียงใหม่')} /><a href={player.url} download={`call-${requestId.slice(0,8)}-adjusted.wav`}>ดาวน์โหลดเสียงที่ปรับแล้ว</a>
      {player.candidateId&&<div className="call-recording-confirm"><label><input type="checkbox" checked={confirmed} disabled={Boolean(busy)} onChange={e=>setConfirmed(e.target.checked)} /> ฉันฟังแล้วและยืนยันว่าไฟล์นี้เป็นบทสนทนาของสายนี้</label><Button size="compact" disabled={Boolean(busy)||!confirmed} onClick={()=>void save()}>บันทึกเสียงกับครั้งนี้</Button></div>}
    </div>}
  </section>;
}
