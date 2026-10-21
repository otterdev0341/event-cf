import { QueueSettings } from '../calling';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { useTheme, type Theme } from '../../stores/theme';
import { PageHeader } from '../../components/ui';
function Appearance() {
  const { theme, setTheme } = useTheme();
  return (
    <section className="panel p-6">
      <h2>Appearance</h2>
      <p className="muted mb-4">เลือกธีมสำหรับ browser นี้</p>
      <div className="theme-options">
        {(['light', 'dark', 'system'] as Theme[]).map((option) => (
          <button
            key={option}
            aria-pressed={theme === option}
            className={`theme-choice ${theme === option ? 'selected' : ''}`}
            onClick={() => setTheme(option)}
          >
            <span className={`theme-swatch ${option}`} aria-hidden="true" />
            {option === 'light' ? 'Light' : option === 'dark' ? 'Dark' : 'System'}
          </button>
        ))}
      </div>
    </section>
  );
}
export function SettingsPage() {
  const [params] = useSearchParams();
  const location = useLocation();
  const section = params.get('section');
  const detail = section === 'appearance' || section === 'calling';
  return (
    <>
      <PageHeader
        eyebrow="WORKSPACE / SETTINGS"
        title="Make this space yours."
        description={detail ? 'จัดการการตั้งค่าที่เลือก' : 'เลือกหมวดการตั้งค่าที่ต้องการจัดการ'}
      />
      {detail ? (
        <>
          <Link className="event-link inline-block mb-6" to={location.pathname}>
            ← กลับไป Settings
          </Link>
          {section === 'appearance' ? (
            <Appearance />
          ) : (
            <section className="panel p-6">
              <QueueSettings />
            </section>
          )}
        </>
      ) : (
        <nav aria-label="Settings sections" className="settings-grid">
          <Link className="panel p-6" to="?section=appearance">
            <h2>Appearance</h2>
            <p className="muted">เลือกธีม Light, Dark หรือ System</p>
          </Link>
          <Link className="panel p-6" to="?section=calling">
            <h2>Calling policy</h2>
            <p className="muted">สัดส่วนคิวโทรและจำนวนครั้งที่โทรซ้ำของ Event</p>
          </Link>
          <Link className="panel p-6" to="/organizations">
            <h2>Organization</h2>
            <p className="muted">สร้างและเลือกองค์กร รวมถึงรับคำเชิญ</p>
          </Link>
          <Link className="panel p-6" to="/organization">
            <h2>Team management</h2>
            <p className="muted">สมาชิก Role policy และ event grants</p>
          </Link>
          <Link className="panel p-6" to="/agent-access">
            <h2>Agent access</h2>
            <p className="muted">Generate, rotate และ revoke org/event credentials</p>
          </Link>
          <a className="panel p-6" href="/event-confirm/swagger-ui/">
            <h2>Swagger UI</h2>
            <p className="muted">OpenAPI contract และตัวอย่างการเรียก API</p>
          </a>
        </nav>
      )}
    </>
  );
}
