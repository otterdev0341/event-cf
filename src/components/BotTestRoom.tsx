import { useEffect, useRef } from 'react';
import { Button } from './Button';
import { useVoicePreview, type PreviewData } from '../hooks/useVoicePreview';

function BotMark() { return <svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M16 4v5M13 4h6M7 12h18a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-9a3 3 0 0 1 3-3Z" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/><circle cx="11" cy="19" r="2" fill="currentColor"/><circle cx="21" cy="19" r="2" fill="currentColor"/><path d="M13 23h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>; }
function MicMark() { return <svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><rect x="11" y="3" width="10" height="18" rx="5" fill="currentColor"/><path d="M7 15v2a9 9 0 0 0 18 0v-2M16 26v4" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></svg>; }
const labels = { ready: 'พร้อมเริ่มทดสอบ', connecting: 'กำลังเชื่อมต่อ', active: 'เชื่อมต่อแล้ว', ended: 'จบการทดสอบ', error: 'เชื่อมต่อไม่สำเร็จ' };

export function BotTestRoom({ data, onBack }: { data: PreviewData; onBack: () => void }) {
  const voice = useVoicePreview(data);
  const transcript = useRef<HTMLDivElement>(null);
  const busy = voice.phase === 'active' || voice.phase === 'connecting';
  useEffect(() => { const panel = transcript.current; if (panel) panel.scrollTop = panel.scrollHeight; }, [voice.messages]);
  return <>
    <header className="preview-heading"><div><span className="ui-kicker">LIVE PLAYGROUND</span><h1>ห้องทดสอบบทสนทนา</h1><p>ลองพูดกับบอท แล้วดูคำตอบระหว่างสนทนา</p></div><Button variant="secondary" size="compact" onClick={() => { voice.stop(); onBack(); }}>← กลับไปแก้ข้อมูล</Button></header>
    <div className="bot-test-layout">
      <section className="bot-chat-panel" aria-label="ห้องสนทนา"><header className="bot-chat-header"><div className="bot-avatar"><BotMark /></div><div><h2>{data.name}</h2><p className={`bot-connection ${voice.phase}`}><span />{labels[voice.phase]}</p></div><span className="preview-chip">Voice test</span></header>
        <div className="bot-transcript" ref={transcript} role="log" aria-label="บทสนทนาทดสอบ" aria-live="polite">
          {!voice.messages.length && <div className="bot-chat-empty"><div className="bot-avatar"><BotMark /></div><h3>{voice.phase === 'connecting' ? 'กำลังเตรียมบทสนทนา…' : voice.phase === 'active' ? 'พร้อมฟังแล้ว ลองพูดได้เลย' : voice.phase === 'error' ? 'ยังเริ่มบทสนทนาไม่ได้' : 'เริ่มบทสนทนาแรกของคุณ'}</h3><p>{voice.phase === 'active' ? 'ข้อความจะแสดงเมื่อบริการส่งบทสนทนากลับมา' : voice.phase === 'error' ? 'ตรวจสาเหตุและขั้นตอนถัดไปด้านล่าง' : 'กดปุ่มไมโครโฟนด้านล่าง แล้วอนุญาตการใช้ไมโครโฟน'}</p></div>}
          {voice.messages.map(message => <div key={message.id} className={`bot-message ${message.role}`}><span className="bot-message-avatar" aria-label={message.role === 'assistant' ? 'บอท' : 'คุณ'}>{message.role === 'assistant' ? <BotMark /> : 'คุณ'}</span><div><p>{message.text}</p><time>{new Date(message.at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}</time></div></div>)}
        </div>
        {voice.error && <div role="alert" className="bot-test-error"><p>{voice.error}</p>{voice.errorKind === 'account' && <a href="/settings">การเชื่อมต่อบัญชี</a>}{voice.errorKind === 'service' && <p>เมื่อบริการพร้อมแล้ว กดเริ่มการทดสอบใหม่เพื่อลองเชื่อมต่ออีกครั้ง</p>}</div>}
        <footer className="bot-voice-controls"><div className={`bot-mic-stage ${voice.phase === 'active' && !voice.muted ? 'active' : ''}`}><div className="bot-wave" aria-hidden="true">{[1, 2, 3, 4, 5, 6, 7].map(n => <i key={n} style={{ animationDelay: `${n * 90}ms` }} />)}</div><button className="bot-mic-button" disabled={voice.phase === 'connecting' || voice.errorKind === 'service'} aria-label={voice.phase === 'active' ? voice.muted ? 'เปิดไมโครโฟน' : 'ปิดไมโครโฟน' : 'เริ่มคุยกับบอท'} aria-pressed={voice.phase === 'active' ? !voice.muted : undefined} onClick={() => voice.phase === 'active' ? voice.toggleMute() : void voice.start()}><MicMark />{voice.muted && <span className="bot-mic-muted" />}</button><div className="bot-wave" aria-hidden="true">{[7, 6, 5, 4, 3, 2, 1].map(n => <i key={n} style={{ animationDelay: `${n * 90}ms` }} />)}</div></div>
          <p role="status">{voice.phase === 'connecting' ? 'กำลังตรวจบริการและเชื่อมต่อบอท…' : voice.phase === 'active' ? voice.muted ? 'ไมโครโฟนปิดอยู่ · กดเพื่อเปิด' : voice.speaking ? 'บอทกำลังพูด' : 'กำลังฟังคุณ · กดไมโครโฟนเพื่อพักเสียง' : voice.errorKind === 'service' ? 'รอให้บริการทดสอบเสียงพร้อมใช้งาน' : 'กดเพื่อเริ่มพูดกับบอท'}</p>
          {busy && <Button size="compact" variant="secondary" onClick={voice.stop}>{voice.phase === 'connecting' ? 'ยกเลิกการเชื่อมต่อ' : 'จบการทดสอบ'}</Button>}
        </footer>
      </section>
      <aside className="bot-test-sidebar"><section className="preview-card"><div className="preview-section-head"><h2>ความพร้อมของบอท</h2><span className={`preview-chip ${voice.phase === 'active' ? 'connected' : ''}`}>{voice.phase === 'active' ? 'Online' : 'Preview'}</span></div><ul className="bot-readiness"><li><span>✓</span><div>เลือก {data.name} แล้ว</div></li><li><span>✓</span><div>ข้อมูลทดสอบครบ {Object.keys(data.variables).length} ตัวแปร</div></li><li className={voice.phase === 'active' ? '' : 'pending'}><span>{voice.phase === 'active' ? '✓' : '·'}</span><div>{voice.phase === 'active' ? 'เชื่อมต่อเสียงกับบอทแล้ว' : 'เริ่มคุยเพื่อตรวจการเชื่อมต่อเสียง'}</div></li></ul></section>
        <section className="preview-card"><span className="ui-kicker">TEST CONTEXT</span><h2>ข้อมูลที่ใช้ทดสอบ</h2><dl className="bot-test-data">{Object.entries(data.variables).map(([key, value]) => <div key={key}><dt>{`{{${key}}}`}</dt><dd>{value}</dd></div>)}</dl>{!Object.keys(data.variables).length && <p>บอทนี้ไม่มีตัวแปรข้อมูลนำเข้า</p>}{Boolean(data.outputs.length) && <p className="workspace-note">ผลลัพธ์หลังสนทนา: {data.outputs.join(', ')}</p>}</section>
        <Button className="bot-restart" onClick={voice.reset} disabled={voice.phase === 'ready'}>↻ เริ่มการทดสอบใหม่</Button><p className="bot-test-footnote">บทสนทนาในห้องนี้แสดงเฉพาะรอบทดสอบปัจจุบัน การเริ่มใหม่จะล้างข้อความในห้องนี้</p>
      </aside>
    </div>
  </>;
}
