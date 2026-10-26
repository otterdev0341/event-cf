import { Button } from "../components/Button";
import { FeatureCard } from "../components/FeatureCard";
import { Header } from "../components/Header";
import { VoiceAssistantPanel } from "../components/VoiceAssistantPanel";
import { routes } from "../routes";

const features = [
  { icon: import.meta.env.BASE_URL + "assets/brain-circuit.svg", title: "เตรียมแคมเปญ", description: "จัดการวันเวลาและรายละเอียดการยืนยัน ให้ทุกแคมเปญพร้อมก่อนเริ่มโทร" },
  { icon: import.meta.env.BASE_URL + "assets/arrow-up-right.svg", title: "นำเข้ารายชื่อ", description: "อัปโหลด CSV จับคู่ข้อมูล และตรวจสอบหมายเลขโทรศัพท์ในขั้นตอนเดียว" },
  { icon: import.meta.env.BASE_URL + "assets/message-square-reply.svg", title: "เลือกบทสนทนา", description: "เลือก Voice Agent ที่เหมาะกับงาน และทดสอบการเชื่อมต่อก่อนใช้งาน" },
  { icon: import.meta.env.BASE_URL + "assets/webhook.svg", title: "ติดตามการยืนยัน", description: "เตรียมดูผลการโทรและบทสนทนาเมื่อเชื่อมต่อบริการ Voice Bot ของคุณ" },
];
export function LandingPage() {
  return <div className="app landing-refined" id="top"><Header /><main>
    <section className="hero page-shell" aria-labelledby="hero-title">
      <div className="hero__copy"><span className="eyebrow"><span className="eyebrow-dot" /> VOICE CONFIRM / VOICE AI WORKSPACE</span>
        <div className="hero__heading-group"><h1 id="hero-title">ทุกการยืนยัน<br />เริ่มด้วย<span>บทสนทนาที่ดี</span></h1><p>เตรียมรายชื่อ สร้างแคมเปญ และให้ Voice Agent<br className="desktop-break" /> ช่วยดูแลการยืนยันนัดหมายและงานสำคัญของคุณ</p></div>
        <div className="hero__actions"><Button href={routes.campaigns}>เริ่มสร้างแคมเปญ <span aria-hidden="true">↗</span></Button><Button variant="secondary" href="#how-it-works">ดูขั้นตอนการใช้งาน <span aria-hidden="true">↓</span></Button></div>
        <div className="hero-benefits"><span><i aria-hidden="true">✓</i> เตรียมรายชื่อจาก CSV</span><span><i aria-hidden="true">✓</i> บันทึกฉบับร่างได้ทันที</span></div>
      </div>
      <div className="voice-stage"><div className="voice-stage__caption"><span>พื้นที่ทำงานของคุณ</span><span>เริ่มต้นใช้งาน ↙</span></div><VoiceAssistantPanel /><div className="voice-stage__footer">นำเข้า · จัดการ · ติดตาม <span>TH / ไทย</span></div></div>
    </section>
    <section className="workflow-band page-shell" id="how-it-works" aria-labelledby="workflow-title"><div className="workflow-intro"><span className="ui-kicker">HOW IT WORKS</span><h2 id="workflow-title">พร้อมใน 4 ขั้นตอน</h2></div><ol><li><span>01</span><div><strong>เตรียมรายชื่อ</strong><small>อัปโหลด CSV ของคุณ</small></div></li><li><span>02</span><div><strong>เลือก Agent</strong><small>อ่านตัวแปรจากบทสนทนา</small></div></li><li><span>03</span><div><strong>จับคู่ข้อมูล</strong><small>เชื่อมคอลัมน์กับตัวแปร</small></div></li><li><span>04</span><div><strong>สรุปแคมเปญ</strong><small>ตรวจสอบก่อนบันทึก</small></div></li></ol></section>
    <section className="features page-shell" id="features" aria-labelledby="features-title"><div className="features-heading"><div><span className="ui-kicker">BUILT AROUND YOUR WORK</span><h2 id="features-title">ทุกขั้นตอน ในพื้นที่เดียว</h2></div><p>จัดระเบียบงานโทร ให้คุณมีเวลาดูแลเรื่องสำคัญ</p></div><div className="feature-grid">{features.map(feature => <FeatureCard key={feature.title} {...feature} />)}</div></section>
  </main><footer className="landing-footer page-shell"><span>Voice Confirm</span><span>สร้างพื้นที่ให้ทุกบทสนทนามีความหมาย</span><a href={import.meta.env.BASE_URL + "api-documentation.md"} target="_blank" rel="noreferrer">เอกสารการเชื่อมต่อ ↗</a></footer></div>;
}
