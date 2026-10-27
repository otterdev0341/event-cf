import { AppHeader } from '../components/AppHeader';
import { Button } from '../components/Button';
import { getContactById } from '../data/contacts';
import { routes } from '../routes';
export function ContactDetailPage({ contactId }: { contactId?: string }) {
  const contact = contactId ? getContactById(contactId) : null;
  return <div className="contact-detail-page"><AppHeader /><main className="page-shell real-data-page">
    <header className="rd-head"><div><a className="rd-back" href={routes.contacts}>← กลับหน้าผู้ติดต่อ</a></div></header>
    {!contact ? <section className="workspace-empty"><h1>ไม่พบผู้ติดต่อ</h1><p>รายชื่อนี้ไม่มีอยู่ในข้อมูล CSV ที่บันทึกในบัญชีของคุณ</p></section> : <>
      <section className="rd-card rd-pad rd-profile">
        <span className="rd-avatar rd-avatar--lg" aria-hidden="true">{(contact.name || '?').replace(/^คุณ\s*/, '').trim().charAt(0) || '?'}</span>
        <div className="rd-profile__text"><h1>{contact.name || 'ยังไม่จับคู่ชื่อ'}</h1><p>{contact.phone || 'ยังไม่จับคู่เบอร์'} · {contact.campaign}</p></div>
        <Button href={routes.apiTest}>ไปหน้าโทรทดสอบ</Button>
      </section>
      <div className="rd-split">
        <section className="rd-aside rd-card rd-pad rd-stack"><h2 className="rd-section-title" style={{fontSize:16}}>ข้อมูลจาก CSV</h2><dl className="rd-fields">{contact.fields.map(field => <div key={field.name}><dt>{field.name}</dt><dd>{field.value || 'ไม่ได้ระบุ'}</dd></div>)}<div><dt>แหล่งข้อมูล</dt><dd>{contact.fileName} · แถว {contact.row}</dd></div></dl></section>
        <section className="rd-card rd-pad rd-stack"><h2 className="rd-section-title" style={{fontSize:16}}>ประวัติการโทร</h2><div className="rd-empty" style={{border:'1px dashed var(--color-border-light)',borderRadius:14}}><strong style={{display:'block',color:'var(--color-heading)',marginBottom:4}}>ยังไม่มีข้อมูลการโทรที่เชื่อมกับรายชื่อนี้</strong>ผลการยืนยัน จำนวนครั้งที่โทร และบทสนทนาของแต่ละสายดูได้ในหน้าโทรของแคมเปญ</div></section>
      </div>
    </>}
  </main></div>;
}
