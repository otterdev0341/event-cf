import { Brand } from "./Brand";
import { Button } from "./Button";
import { routes } from "../routes";

// The home page is for visitors who are not signed in yet, so the menu jumps to its sections instead of app pages.
const navigation = [["วิธีทำงาน", "#how"], ["ตัวอย่างงาน", "#industries"], ["ก่อนเริ่มใช้งาน", "#before"]];

export function Header() {
  return (
    <header className="site-header">
      <div className="site-header__inner page-shell">
        <Brand href="#top" tone="dark" />

        <nav className="primary-nav" aria-label="เมนูหลัก">
          {navigation.map(([item, href]) => (
            <a className="primary-nav__link" href={href} key={href}>
              {item}
            </a>
          ))}
        </nav>

        <Button className="site-header__login" href={routes.login} size="compact" variant="secondary">
          เข้าสู่ระบบ
        </Button>
      </div>
    </header>
  );
}

