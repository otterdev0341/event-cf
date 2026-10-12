import { useEffect, useRef, useState } from "react";
import { Brand } from "./Brand";
import { routes } from "../routes";

const navigation = [
  { key: "home", label: "ภาพรวม", href: routes.dashboard, path: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" },
  { key: "campaigns", label: "แคมเปญ", href: routes.campaigns, path: "M4 5h16v14H4zM8 9h8M8 13h5" },
  { key: "contacts", label: "ผู้ติดต่อ", href: routes.contacts, path: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z" },
  { key: "live", label: "Agent / บทสนทนา", href: routes.liveAgent, path: "M4 10v4M8 5v14M12 8v8M16 3v18M20 9v6" },
  { key: "reports", label: "รายงาน", href: routes.analytics, path: "M4 3v18h17M9 16v-4M14 16V8M19 16V5" },
];
function NavIcon({path}:{path:string}) { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={path}/></svg>; }
interface AppHeaderProps { activeNav?: "home" | "campaigns" | "reports" | "settings" | "contacts" | "live"; }
export function AppHeader({ activeNav }: AppHeaderProps) {
  const [menuOpen,setMenuOpen]=useState(false);
  const menuButton=useRef<HTMLButtonElement>(null);
  const path = window.location.pathname;
  const active = activeNav ?? (path.startsWith(routes.campaigns) ? "campaigns" : path.startsWith(routes.contacts) ? "contacts" : path === routes.liveAgent ? "live" : path === routes.dashboard ? "home" : path === routes.analytics ? "reports" : "settings");
  useEffect(()=>{if(!menuOpen)return;const close=(event:KeyboardEvent)=>{if(event.key==='Escape'){setMenuOpen(false);menuButton.current?.focus();}};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close);},[menuOpen]);
  return <header className={`app-header${menuOpen?' app-header--open':''}`}><div className="app-header__inner page-shell">
    <div className="app-header__brand"><Brand href={routes.dashboard} tone="dark" /><span className="app-header__subtitle">พื้นที่จัดการการโทรของคุณ</span></div>
    <button ref={menuButton} className="app-menu-toggle" type="button" aria-label={menuOpen?'ปิดเมนู':'เปิดเมนู'} aria-expanded={menuOpen} aria-controls="workspace-navigation" onClick={()=>setMenuOpen(!menuOpen)}><NavIcon path={menuOpen?'M6 6l12 12M6 18 18 6':'M4 6h16M4 12h16M4 18h16'}/></button>
    <nav className="app-nav" id="workspace-navigation" aria-label="เมนูแอปพลิเคชัน"><span className="app-nav__caption">พื้นที่ทำงาน</span>{navigation.map(item => <a className={`app-nav__link${item.key === active ? " app-nav__link--active" : ""}`} href={item.href} key={item.key} aria-current={item.key === active ? "page" : undefined}><NavIcon path={item.path}/><span>{item.label}</span>{item.key===active&&<span className="app-nav__active-mark" aria-hidden="true"/>}</a>)}
    <a className={`app-nav__link app-nav__settings${active==='settings'?' app-nav__link--active':''}`} href={routes.settings} aria-current={active==='settings'?'page':undefined}><NavIcon path="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/><span>บัญชีและการเชื่อมต่อ</span></a></nav>
    <div className="app-header__footer"><span className="app-header__footer-mark" aria-hidden="true">VC</span><div><strong>Voice Confirm</strong><span>เตรียมรายชื่อ · โทร · ติดตามผล</span></div></div>
  </div></header>;
}
