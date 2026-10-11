import { Brand } from "./Brand";
import { routes } from "../routes";

const navigation = [
  { key: "home", label: "ภาพรวม", href: routes.dashboard },
  { key: "campaigns", label: "แคมเปญ", href: routes.campaigns },
  { key: "contacts", label: "ผู้ติดต่อ", href: routes.contacts },
  { key: "live", label: "Agent / บทสนทนา", href: routes.liveAgent },
  { key: "reports", label: "รายงาน", href: routes.analytics },
];
interface AppHeaderProps { activeNav?: "home" | "campaigns" | "reports" | "settings" | "contacts" | "live"; }
export function AppHeader({ activeNav }: AppHeaderProps) {
  const path = window.location.pathname;
  const active = activeNav ?? (path.startsWith(routes.campaigns) ? "campaigns" : path.startsWith(routes.contacts) ? "contacts" : path === routes.liveAgent ? "live" : path === routes.dashboard ? "home" : path === routes.analytics ? "reports" : "settings");
  return <header className="app-header"><div className="app-header__inner page-shell">
    <Brand href={routes.home} tone="dark" />
    <nav className="app-nav" aria-label="เมนูแอปพลิเคชัน">{navigation.map(item => <a className={`app-nav__link${item.key === active ? " app-nav__link--active" : ""}`} href={item.href} key={item.key} aria-current={item.key === active ? "page" : undefined}>{item.label}</a>)}</nav>
    <a className={`app-header__user${active === "settings" ? " app-header__user--active" : ""}`} href={routes.settings} aria-label="ตั้งค่าผู้ใช้" aria-current={active === "settings" ? "page" : undefined}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="12" cy="8" r="3.5"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/></svg></a>
  </div></header>;
}
