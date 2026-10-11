import { AppHeader } from '../components/AppHeader';
import { Button } from '../components/Button';
import { getContactById } from '../data/contacts';
import { routes } from '../routes';
export function ContactDetailPage({ contactId }: { contactId?: string }) {
  const contact = contactId ? getContactById(contactId) : null;
  return <div className="contact-detail-page"><AppHeader /><main className="page-shell real-data-page"><Button size="compact" variant="secondary" href={routes.contacts}>กลับหน้าผู้ติดต่อ</Button>
    {!contact ? <section className="workspace-empty"><h1>ไม่พบผู้ติดต่อ</h1><p>รายชื่อนี้ไม่มีอยู่ในข้อมูล CSV ที่บันทึกในบัญชีของคุณ</p></section> : <><header><h1>{contact.name || 'ยังไม่จับคู่ชื่อ'}</h1><p>{contact.campaign} · {contact.fileName} · แถว {contact.row}</p></header><section className="activity-section"><h2>ข้อมูลจาก CSV</h2><dl className="real-data-fields">{contact.fields.map(field => <div key={field.name}><dt>{field.name}</dt><dd>{field.value || 'ไม่ได้ระบุ'}</dd></div>)}</dl></section><section className="workspace-empty"><h2>ยังไม่มีข้อมูลการโทรที่เชื่อมกับรายชื่อนี้</h2><p>ผลการยืนยัน จำนวนครั้งที่โทร และบทสนทนายังไม่พร้อมแสดง</p><Button href={routes.apiTest} size="compact">ไปหน้าโทรทดสอบ</Button></section></>}
  </main></div>;
}
