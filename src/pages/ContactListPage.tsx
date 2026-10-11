import { useState } from 'react';
import { AppHeader } from '../components/AppHeader';
import { Button } from '../components/Button';
import { getImportedContacts } from '../data/contacts';
import { routes } from '../routes';
export function ContactListPage() {
  const [contacts, setContacts] = useState(getImportedContacts);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const filtered = contacts.filter(contact => `${contact.name} ${contact.phone} ${contact.campaign}`.toLowerCase().includes(query.toLowerCase()));
  const pages = Math.max(1, Math.ceil(filtered.length / 20));
  return <div className="contact-list-page"><AppHeader /><main className="contact-list-main page-shell real-data-page">
    <header><h1>ผู้ติดต่อ</h1><p>รายชื่อจากไฟล์ CSV ในแคมเปญที่บันทึกในบัญชีของคุณ</p></header>
    <div className="workspace-toolbar"><input className="workspace-search" type="search" aria-label="ค้นหาผู้ติดต่อ" placeholder="ค้นหาชื่อ เบอร์ หรือแคมเปญ" value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} /><Button size="compact" variant="secondary" onClick={() => window.location.reload()}>รีเฟรชรายชื่อ</Button><Button size="compact" href={routes.createCampaign}>นำเข้า CSV</Button></div>
    <p className="workspace-note">ยังไม่มีประวัติการโทรที่เชื่อมกับผู้ติดต่อแต่ละคน รายการสนทนาจาก API ดูได้ที่ <a href={routes.liveAgent}>หน้า Agent และบทสนทนา</a></p>
    {filtered.length ? <section className="activity-section"><div className="activity-table-wrap"><table className="activity-table"><thead><tr><th>ชื่อผู้ติดต่อ</th><th>หมายเลขโทรศัพท์</th><th>แคมเปญฉบับร่าง</th><th>แหล่งข้อมูล</th><th>รายละเอียด</th></tr></thead><tbody>{filtered.slice((page - 1) * 20, page * 20).map(contact => <tr key={contact.id}><td>{contact.name || 'ยังไม่จับคู่ชื่อ'}</td><td>{contact.phone || 'ยังไม่จับคู่เบอร์'}</td><td>{contact.campaign}</td><td>{contact.fileName} · แถว {contact.row}</td><td><a href={routes.contactDetailWithId(contact.id)}>ดูข้อมูล</a></td></tr>)}</tbody></table></div></section> : <section className="workspace-empty"><h2>{query ? 'ไม่พบรายชื่อที่ค้นหา' : 'ยังไม่มีรายชื่อที่นำเข้า'}</h2><p>นำเข้า CSV ของคุณในขั้นตอนสร้างแคมเปญเพื่อแสดงรายชื่อที่นี่</p></section>}
    <nav className="pagination" aria-label="หน้าผู้ติดต่อ"><p>{filtered.length.toLocaleString()} รายการจากข้อมูลที่นำเข้า</p><div className="pagination__controls"><button disabled={page <= 1} onClick={() => setPage(value => value - 1)}>ย้อนกลับ</button><span>หน้า {page} / {pages}</span><button disabled={page >= pages} onClick={() => setPage(value => value + 1)}>ถัดไป</button></div></nav>
  </main></div>;
}
