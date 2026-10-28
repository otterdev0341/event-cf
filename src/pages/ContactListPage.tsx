import { useState } from 'react';
import { AppHeader } from '../components/AppHeader';
import { Button } from '../components/Button';
import { getImportedContacts } from '../data/contacts';
import { routes } from '../routes';
export function ContactListPage() {
  const [contacts] = useState(getImportedContacts);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const filtered = contacts.filter(contact => `${contact.name} ${contact.phone} ${contact.campaign}`.toLowerCase().includes(query.toLowerCase()));
  const pages = Math.max(1, Math.ceil(filtered.length / 20));
  return <div className="contact-list-page"><AppHeader /><main className="contact-list-main page-shell real-data-page">
    <header className="rd-head"><div><span className="ui-kicker">CONTACTS</span><h1>ผู้ติดต่อ</h1><p>รายชื่อจากไฟล์ CSV ในแคมเปญที่บันทึกในบัญชีของคุณ</p></div><div className="rd-head__actions"><Button variant="secondary" onClick={() => window.location.reload()}>รีเฟรชรายชื่อ</Button><Button href={routes.createCampaign}>นำเข้า CSV</Button></div></header>
    <div className="rd-filters"><label className="rd-search"><span className="sr-only">ค้นหาผู้ติดต่อ</span><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4"/></svg><input type="search" placeholder="ค้นหาชื่อ เบอร์ หรือแคมเปญ" value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} /></label></div>
    <section className="rd-card rd-table-card" aria-label="รายชื่อผู้ติดต่อ">
      {filtered.length ? <div className="rd-table-wrap"><table className="rd-table"><thead><tr><th>ชื่อผู้ติดต่อ</th><th>หมายเลขโทรศัพท์</th><th>แคมเปญ</th><th>แหล่งข้อมูล</th><th><span className="sr-only">รายละเอียด</span></th></tr></thead><tbody>{filtered.slice((page - 1) * 20, page * 20).map(contact => <tr key={contact.id}><td><span className="rd-person"><span className="rd-avatar" aria-hidden="true">{(contact.name || '?').replace(/^คุณ\s*/, '').trim().charAt(0) || '?'}</span><strong>{contact.name || 'ยังไม่จับคู่ชื่อ'}</strong></span></td><td>{contact.phone || <span className="rd-muted">ยังไม่จับคู่เบอร์</span>}</td><td style={{color:'var(--color-body)'}}>{contact.campaign}</td><td className="rd-muted">{contact.fileName} · แถว {contact.row}</td><td style={{textAlign:'right'}}><a className="rd-link" href={routes.contactDetailWithId(contact.id)}>ดูข้อมูล →</a></td></tr>)}</tbody></table></div>
        : <div className="rd-empty"><strong style={{display:'block',color:'var(--color-heading)',marginBottom:4}}>{query ? 'ไม่พบรายชื่อที่ค้นหา' : 'ยังไม่มีรายชื่อที่นำเข้า'}</strong>นำเข้า CSV ของคุณในขั้นตอนสร้างแคมเปญเพื่อแสดงรายชื่อที่นี่</div>}
      <nav className="rd-table-foot" aria-label="หน้าผู้ติดต่อ"><span>{filtered.length.toLocaleString()} รายการจากข้อมูลที่นำเข้า</span><div><Button size="compact" variant="secondary" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>ย้อนกลับ</Button><span>หน้า {page} / {pages}</span><Button size="compact" variant="secondary" disabled={page >= pages} onClick={() => setPage(value => value + 1)}>ถัดไป</Button></div></nav>
    </section>
    <p className="rd-stat__note">ยังไม่มีประวัติการโทรที่เชื่อมกับผู้ติดต่อแต่ละคน รายการสนทนาจาก API ดูได้ที่ <a className="rd-link" style={{fontSize:'inherit'}} href={routes.liveAgent}>หน้าทดสอบ Agent</a></p>
  </main></div>;
}
