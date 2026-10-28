import { useState, type CSSProperties, type ReactNode } from "react";
import { Button } from "../components/Button";
import { Header } from "../components/Header";
import { Waveform } from "../components/Waveform";
import { routes } from "../routes";
import "../landing.css";

// Written for event organisers. Every claim matches what Voice Confirm does today; mock-ups use made-up names and say so.
const wave = [10, 18, 28, 20, 36, 44, 30, 22, 40, 48, 32, 20, 38, 46, 28, 18, 30, 42, 24, 14];
const docsUrl = import.meta.env.BASE_URL + "api-docs.html";
const sampleCsv = import.meta.env.BASE_URL + "sample-contacts.csv";

// Thai has no spaces between words, so the browser may break inside compounds such as มงคลสมรส.
// N keeps a JSX phrase together; keep() does the same for phrases inside plain strings (word joiner between letters).
const N = ({ children }: { children: ReactNode }) => <span className="lp-nw">{children}</span>;
const compounds = ["ขอให้โทรกลับ", "ต้องการเจ้าหน้าที่", "ตอบตกลง", "ไม่รับสาย", "คำตอบ", "ขั้นตอน", "ทุกสาย", "มงคลสมรส", "ร่วมงาน", "วันงาน", "ชื่อแขก", "คุณบีม", "โรงแรมริมน้ำค่ะ", "โทรหาแขกจริง", "ไหมคะ", "นะคะ", "นะครับ", "ที่จอดรถ", "ทุกคน"];
const keep = (text: string) => compounds.reduce((t, c) => t.replaceAll(c, [...c].join("⁠")), text);
const Arrow = ({ dir = "right" }: { dir?: "right" | "down" | "out" }) => <svg className="lp-icon" viewBox="0 0 16 16" aria-hidden="true">
  <path d={dir === "down" ? "M8 3v10M3.5 8.5 8 13l4.5-4.5" : dir === "out" ? "M5 11 11 5M6 5h5v5" : "M3 8h10M8.5 3.5 13 8l-4.5 4.5"} /></svg>;
const Start = () => <div className="lp-start"><Button href={routes.createCampaign}>เริ่มสร้างแคมเปญ <Arrow /></Button><a href="#needs">ดูสิ่งที่ต้องมีก่อนเริ่ม</a></div>;

const call = [
  ["bot", "สวัสดีค่ะคุณมาลี ขอเรียนเชิญร่วมงานแต่งคุณบีมและคุณต้น วันเสาร์ที่ 14 นี้ที่โรงแรมริมน้ำค่ะ สะดวกมาร่วมงานไหมคะ"],
  ["guest", "ไปค่ะ ยินดีด้วยนะคะ"],
  ["bot", "ขอบคุณค่ะ บันทึกว่ามาร่วมงานนะคะ"],
] as const;

const steps = [
  { when: "7 วันก่อนงาน", title: "อัปโหลดรายชื่อแขก", text: "ใช้ไฟล์ CSV ที่มีเบอร์โทร แล้วเลือกว่าคอลัมน์ไหนคือชื่อแขก วันงาน หรือสถานที่ เพื่อให้ Agent พูดถึงแต่ละคนได้ถูก" },
  { when: "6 วันก่อนงาน", title: "โทรทดสอบเข้าเบอร์ตัวเอง", text: "ฟังเสียงและบทพูดของ Agent ก่อน เมื่อมั่นใจแล้วจึงโทรหาแขกจริง" },
  { when: "5 วันก่อนงาน", title: "ตั้งเวลาให้ Agent โทร", text: "ตั้งเวลาครั้งเดียว รายวัน หรือรายสัปดาห์ แล้วคนที่ไม่รับสายจะถูกโทรซ้ำให้เอง ถ้าเลือกโทรทันที ระบบโทรทีละคนและต้องเปิดหน้านั้นไว้จนจบ" },
  { when: "1 วันก่อนงาน", title: "ดูว่าใครยืนยันแล้ว", text: "ดูว่าใครตอบตกลง ปฏิเสธ ขอให้โทรกลับ ต้องการเจ้าหน้าที่ หรือไม่รับสาย แล้วส่งออกเป็น CSV" },
];

// Mirrors the real outbound board: the five results land in four columns, and staff drag a card to fix a result.
const board = [
  { label: "ตอบตกลง", tone: "ok", count: 128, cards: [["คุณสมใจ", "จบสาย"], ["คุณอรุณ", "จบสาย"]] },
  { label: "ปฏิเสธ", tone: "bad", count: 14, cards: [["คุณวิทย์", "จบสาย"]] },
  { label: "ต้องติดตาม", tone: "warn", count: 9, cards: [["คุณนภา", "ขอให้โทรกลับ"], ["คุณวรรณา", "ต้องการเจ้าหน้าที่"]] },
  { label: "ไม่สำเร็จ", tone: "plain", count: 6, cards: [["คุณชัย", "ไม่รับสาย"]] },
];

const retries = [
  { when: "ไม่รับสาย หรือสายไม่ว่าง", then: "อีก 10 นาที" },
  { when: "ขอให้โทรกลับ", then: "อีก 2 ชั่วโมง" },
  { when: "วางสายก่อนได้คำตอบ", then: "อีก 1 ครั้ง" },
  { when: "ตอบตกลง หรือปฏิเสธ", then: "ไม่โทรซ้ำ" },
  { when: "ถึงคิวหลัง 20:00", then: "09:00 วันถัดไป" },
];

const industries = [
  { id: "wedding", label: "งานแต่งงาน", title: "ยืนยันแขกงานแต่งโดยไม่ต้องไล่โทรเอง",
    text: "Agent ทักแขกด้วยชื่อ แจ้งวัน เวลา และสถานที่ แล้วถามว่าจะมาร่วมงานไหม คู่บ่าวสาวเห็นว่าใครตอบตกลงบนบอร์ดเดียว",
    fields: ["ชื่อแขก", "วันงาน", "สถานที่"],
    lines: [["bot", "สวัสดีค่ะคุณปรีชา ขอเรียนเชิญร่วมงานมงคลสมรสวันเสาร์ที่ 14 เวลา 18:00\u00a0น. ที่โรงแรมริมน้ำค่ะ"], ["guest", "ขอถามเรื่องที่จอดรถกับเจ้าหน้าที่ก่อนได้ไหมครับ"], ["bot", "ได้ค่ะ จะให้เจ้าหน้าที่โทรกลับเรื่องที่จอดรถนะคะ"]] },
  { id: "event", label: "อีเวนต์และสัมมนา", title: "ลดที่นั่งว่างก่อนวันงาน",
    text: "โทรยืนยันผู้ลงทะเบียนล่วงหน้า คนที่ไม่ว่างจะถูกบันทึกว่าปฏิเสธ ทีมจึงเปิดที่นั่งให้คนในรายชื่อสำรองได้ทัน",
    fields: ["ชื่อผู้ลงทะเบียน", "รอบที่ลงทะเบียน", "วันงาน"],
    lines: [["bot", "สวัสดีครับคุณธนา ยืนยันการเข้าร่วมสัมมนารอบเช้าวันพุธนี้ไหมครับ"], ["guest", "ขอโทษครับ วันนั้นติดประชุม"], ["bot", "ไม่เป็นไรครับ บันทึกว่าไม่สะดวกเข้าร่วมนะครับ"]] },
  { id: "interview", label: "นัดสัมภาษณ์งาน", title: "ยืนยันผู้สมัครก่อนวันสัมภาษณ์",
    text: "Agent ยืนยันวันเวลานัด และบันทึกว่าต้องการเจ้าหน้าที่เมื่อผู้สมัครขอเลื่อนหรือมีคำถาม เพื่อให้ HR ติดต่อกลับ",
    fields: ["ชื่อผู้สมัคร", "ตำแหน่ง", "เวลานัด"],
    lines: [["bot", "สวัสดีค่ะคุณกานต์ ยืนยันนัดสัมภาษณ์ตำแหน่งนักบัญชี 10 โมงพรุ่งนี้นะคะ"], ["guest", "ขอเลื่อนเป็นช่วงบ่ายได้ไหมครับ"], ["bot", "รับทราบค่ะ จะให้เจ้าหน้าที่ติดต่อกลับเพื่อนัดเวลาใหม่นะคะ"]] },
  { id: "appointment", label: "นัดหมายลูกค้า", title: "เตือนนัดและลดการไม่มาตามนัด",
    text: "ตั้งเวลาโทรเตือนลูกค้าก่อนถึงเวลานัด คนที่ไม่รับสายจะถูกโทรซ้ำในช่วง 09:00–20:00 โดยอัตโนมัติ",
    fields: ["ชื่อลูกค้า", "เวลานัด", "สาขา"],
    lines: [["bot", "สวัสดีครับคุณพิม ขอเตือนนัดหมายที่สาขาสยามพรุ่งนี้บ่ายสองครับ"], ["guest", "ค่ะ ไปตามนัดค่ะ"], ["bot", "ขอบคุณครับ บันทึกว่ายืนยันนัดเรียบร้อยครับ"]] },
] as const;

const faqs = [
  { id: "no-agent", q: "ยังไม่มี Voice Agent ต้องทำอย่างไร", a: <>Voice Agent สร้างในบัญชี Botnoi Voice Bot แล้วเชื่อมกับ Voice Confirm ครั้งเดียว ขั้นตอนเชื่อมเป็นงานด้านเทคนิค ส่ง<a href={docsUrl} target="_blank" rel="noreferrer">คู่มือการเชื่อมต่อ (API)</a> ให้คนที่ดูแลระบบของทีม เมื่อเชื่อมแล้วคุณใช้งานต่อเองได้ทั้งหมด</> },
  { q: "ไฟล์รายชื่อต้องมีอะไรบ้าง", a: <>ไฟล์ CSV หนึ่งแถวต่อหนึ่งคน ต้องมีคอลัมน์เบอร์โทร และเพิ่มคอลัมน์ที่อยากให้ Agent พูดได้ เช่น ชื่อแขก วันงาน หรือสถานที่ ตอนสร้างแคมเปญคุณเลือกเองว่าคอลัมน์ไหนคืออะไร <a href={sampleCsv} download>ดาวน์โหลดหัวคอลัมน์ตัวอย่าง</a></> },
  { q: "ผู้รับสายจะได้ยินอะไร", a: "เสียงของ Voice Agent ตามบทพูดที่ตั้งไว้ใน Botnoi Voice Bot โดยเรียกชื่อและรายละเอียดของแต่ละคนจากรายชื่อ ถ้าผู้รับสายอยากคุยกับคน ระบบจะบันทึกว่าต้องการเจ้าหน้าที่ เพื่อให้ทีมโทรกลับ" },
  { q: "ถ้า Agent เข้าใจคำตอบผิด ทำอย่างไร", a: "เปิดสายนั้นเพื่อฟังเสียงและอ่านบทสนทนา แล้วแก้ผลเองบนบอร์ดผลการโทร ผลที่แก้จะแสดงว่าเป็นผลที่ผู้ใช้แก้ไขเอง" },
];

export function LandingPage() {
  const [industry, setIndustry] = useState<string>(industries[0].id);
  const [replay, setReplay] = useState(0);
  const active = industries.find(i => i.id === industry) ?? industries[0];
  return <div className="app lp" id="top"><Header /><main>
    <section className="lp-hero page-shell" aria-labelledby="hero-title">
      <div className="lp-hero__copy">
        <h1 id="hero-title"><N>โทรยืนยัน</N>แขกและ<N>นัดหมาย</N><br className="lp-br" /> <span className="lp-accent">ให้ Voice Agent <N>ทำแทน</N></span></h1>
        <p>{keep("Voice Agent คือผู้ช่วยเสียง AI ที่โทรหาทุกคนในรายชื่อ ถามว่าจะมาไหม แล้วบันทึกคำตอบให้ทีม เช่น ตอบตกลง ปฏิเสธ หรือขอให้โทรกลับ")}</p>
        <div className="lp-actions"><Button href={routes.createCampaign}>เริ่มสร้างแคมเปญ <Arrow /></Button><Button variant="secondary" href="#how">ดูวิธีทำงาน <Arrow dir="down" /></Button></div>
      </div>
      <div className="lp-hero__needs" id="needs"><p>สิ่งที่ต้องมีก่อนเริ่ม</p>
        <ol><li>บัญชี Voice Confirm สมัครด้วยอีเมลหรือ Google</li><li>Voice Agent ใน Botnoi Voice Bot ที่เชื่อมกับ Voice Confirm แล้ว</li><li>ไฟล์รายชื่อ CSV ที่มีเบอร์โทร</li></ol>
        <a href="#no-agent">ยังไม่มี Voice Agent?</a></div>
      <figure className="lp-call" key={replay} aria-labelledby="call-caption">
        <figcaption className="lp-call__head" id="call-caption"><span className="lp-call__tag">ตัวอย่างบทสนทนา งานแต่ง</span><span>คุณมาลี (ชื่อสมมติ)</span></figcaption>
        <ol className="lp-transcript">{call.map(([who, text], index) => <li key={index} className={`lp-bubble lp-bubble--${who}`} style={{ "--i": index } as CSSProperties}><span className="lp-sr">{who === "bot" ? "Agent: " : "แขก: "}</span>{keep(text)}</li>)}</ol>
        <div className="lp-result" style={{ "--i": call.length } as CSSProperties}><span>ผลตอบรับ</span><b className="lp-chip lp-chip--ok">ตอบตกลง</b></div>
        <p className="lp-call__foot">ถ้าแขกอยากคุยกับคน Agent จะบันทึกว่าต้องการเจ้าหน้าที่ ให้ทีมโทรกลับ อยากฟังเสียงจริง โทรทดสอบเข้าเบอร์ตัวเองได้ก่อนเริ่ม</p>
        <button type="button" className="lp-replay" onClick={() => setReplay(r => r + 1)}>ดูบทสนทนาอีกครั้ง</button>
      </figure>
    </section>

    <section className="lp-section page-shell" id="how" aria-labelledby="how-title">
      <div className="lp-heading"><h2 id="how-title">จากรายชื่อแขก <N>ถึงคำตอบของทุกคน</N> ใน <N>4 ขั้นตอน</N></h2><p>หนึ่งงานคือหนึ่งแคมเปญ หมายถึงรายชื่อหนึ่งชุดกับเวลาที่จะให้ Agent โทร ด้านล่างคือตัวอย่างแผนของงานแต่ง เริ่มก่อนวันงานหนึ่งสัปดาห์</p></div>
      <ol className="lp-flow">{steps.map(s => <li key={s.when}><span>{s.when}</span><strong>{s.title}</strong><small>{keep(s.text)}</small></li>)}</ol>
      <Start />
    </section>

    <section className="lp-section page-shell" id="features" aria-labelledby="features-title">
      <div className="lp-heading"><h2 id="features-title">รู้ผลของ<N>ทุกสาย</N> <N>โดยไม่ต้องไล่ฟังเอง</N></h2><p>{keep("ทุกสายมีผลตอบรับ เสียงสนทนา และบทสนทนาให้ตรวจย้อนหลัง ถ้า Agent เข้าใจผิด ทีมแก้ผลเองได้ทันที")}</p></div>
      <div className="lp-bento">
        <article className="lp-card lp-card--wide lp-card--lead"><h3>จากแถวในไฟล์ ถึงประโยคที่ Agent พูด</h3><p className="lp-card__sub">Agent ดึงข้อมูลของแต่ละคนจากคอลัมน์ที่คุณเลือก ทุกสายจึงเรียกชื่อและรายละเอียดถูกคน</p>
          <div className="lp-map">
            <table><caption className="lp-sr">ตัวอย่างหนึ่งแถวในไฟล์รายชื่อ</caption><thead><tr><th>เบอร์โทร</th><th>ชื่อแขก</th><th>วันงาน</th><th>สถานที่</th></tr></thead><tbody><tr><td>08x-xxx-xx12</td><td>มาลี</td><td>เสาร์ที่ 14</td><td>โรงแรมริมน้ำ</td></tr></tbody></table>
            <Arrow dir="down" />
            <p className="lp-bubble lp-bubble--bot"><span className="lp-sr">Agent พูดว่า: </span>สวัสดีค่ะคุณ<mark>มาลี</mark> ขอเรียนเชิญร่วมงานแต่ง<mark>วันเสาร์ที่ 14</mark> ที่<mark>โรงแรมริมน้ำ</mark>ค่ะ</p>
          </div></article>
        <article className="lp-card"><h3>ฟังเสียงและอ่านบทสนทนาได้ทุกสาย</h3><p className="lp-card__sub">ตรวจย้อนหลังได้ว่าผลมาจากอะไร</p>
          <div className="lp-review" aria-hidden="true"><Waveform heights={wave.slice(0, 14)} className="lp-review__wave" /><p><b>แขก</b> กำลังขับรถอยู่ ขอให้โทรมาใหม่นะคะ</p><div><span>ผลที่ Agent สรุป</span><b className="lp-chip lp-chip--warn">ขอให้โทรกลับ</b></div></div></article>
        <article className="lp-card lp-card--wide"><h3>บอร์ดผลการโทร</h3><p className="lp-card__sub">ผลทั้งหมดแยกเป็น 4 คอลัมน์ ถ้า Agent สรุปผิด ลากการ์ดไปคอลัมน์ที่ถูกได้เลย</p>
          <div className="lp-board" aria-hidden="true">{board.map(col => <div key={col.label}><p><b className={`lp-chip lp-chip--${col.tone}`}>{col.label}</b><span>{col.count}</span></p>{col.cards.map(([name, detail]) => <div className="lp-board__card" key={name}><b>{name}</b><small>{detail}</small></div>)}</div>)}</div>
          <p className="lp-sample">ข้อมูลตัวอย่าง ชื่อสมมติ · ขอให้โทรกลับ และต้องการเจ้าหน้าที่ อยู่ในคอลัมน์ต้องติดตาม</p></article>
        <article className="lp-card"><h3>โทรซ้ำให้เองเมื่อไร</h3><p className="lp-card__sub">แคมเปญที่ตั้งเวลา โทรได้สูงสุด 3 ครั้งต่อคนในแต่ละรอบ เฉพาะ 09:00–20:00 เวลาไทย</p>
          <ul className="lp-rules">{retries.map(r => <li key={r.when}><span>{r.when}</span><b>{r.then}</b></li>)}</ul></article>
      </div>
    </section>

    <section className="lp-section page-shell" id="industries" aria-labelledby="industries-title">
      <div className="lp-heading"><h2 id="industries-title">ใช้กับงานแบบไหนได้บ้าง</h2></div>
      <div className="lp-tabs" role="group" aria-label="ประเภทงาน">{industries.map(i => <button key={i.id} type="button" aria-pressed={i.id === active.id} aria-controls="industry-panel" onClick={() => setIndustry(i.id)}>{i.label}</button>)}</div>
      <div className="lp-usecase" id="industry-panel">
        <div><h3>{active.title}</h3><p>{keep(active.text)}</p><p className="lp-fields-label">ข้อมูลจากรายชื่อที่ Agent ใช้</p><ul className="lp-fields">{active.fields.map(f => <li key={f}>{f}</li>)}</ul></div>
        <figure className="lp-dialog"><figcaption>ตัวอย่างบทสนทนา ชื่อสมมติ</figcaption><ol className="lp-transcript">{active.lines.map(([who, text], index) => <li key={index} className={`lp-bubble lp-bubble--${who}`}><small>{who === "bot" ? "Agent" : "ผู้รับสาย"}</small>{keep(text)}</li>)}</ol></figure>
      </div>
    </section>

    <section className="lp-section page-shell lp-before" id="before" aria-labelledby="before-title">
      <div><h2 id="before-title">ก่อนเริ่มใช้งาน</h2><p>คำถามที่ผู้จัดงานถามบ่อยก่อนสร้างแคมเปญแรก</p></div>
      <div className="lp-faq">{faqs.map(f => <details key={f.q}><summary>{f.q}</summary><p id={"id" in f ? f.id : undefined}>{typeof f.a === "string" ? keep(f.a) : f.a}</p></details>)}</div>
    </section>

    <section className="lp-cta" aria-labelledby="cta-title"><div className="page-shell"><h2 id="cta-title">เริ่มจากไฟล์รายชื่อ<N>ที่คุณมีอยู่แล้ว</N></h2><p>สร้างแคมเปญแรก โทรทดสอบเข้าเบอร์ตัวเอง แล้วค่อยให้ Agent โทรหาทุกคนในรายชื่อ</p><div className="lp-actions"><Button href={routes.createCampaign}>เริ่มสร้างแคมเปญ <Arrow /></Button></div></div></section>
  </main><footer className="landing-footer page-shell"><span>Voice Confirm</span><span>โทรยืนยันแขก นัดหมาย และผู้เข้าร่วม ด้วย Voice Agent</span><a href={docsUrl} target="_blank" rel="noreferrer">คู่มือการเชื่อมต่อ <Arrow dir="out" /></a></footer></div>;
}
