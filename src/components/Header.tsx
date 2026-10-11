import { Brand } from "./Brand";
import { Button } from "./Button";
import { routes } from "../routes";

const navigation = ["หน้าหลัก", "แคมเปญ", "รายงาน"];

export function Header() {
  return (
    <header className="site-header">
      <div className="site-header__inner page-shell">
        <Brand href="#top" tone="dark" />

        <nav className="primary-nav" aria-label="เมนูหลัก">
          {navigation.map((item, index) => (
            <a
              className={`primary-nav__link${index === 0 ? " primary-nav__link--active" : ""}`}
              href={index === 0 ? "#top" : index === 1 ? routes.campaigns : routes.analytics}
              key={item}
              aria-current={index === 0 ? "page" : undefined}
            >
              {item}
            </a>
          ))}
        </nav>

        <Button className="site-header__login" href={routes.login} size="compact">
          เข้าสู่ระบบ
        </Button>
      </div>
    </header>
  );
}

