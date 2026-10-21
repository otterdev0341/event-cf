import { QueueSettings } from '../calling';
import { Link } from 'react-router-dom';
import { useTheme, type Theme } from '../../stores/theme';
import { PageHeader } from '../../components/ui';
export function SettingsPage() {
  const { theme, setTheme } = useTheme();
  return (
    <>
      <PageHeader
        eyebrow="WORKSPACE / SETTINGS"
        title="Make this space yours."
        description="Theme, organization, team policy และการเชื่อมต่อ Agent"
      />
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
      <section className="panel p-6 mt-6">
        <QueueSettings />
      </section>
      <nav aria-label="Settings sections" className="settings-grid mt-6">
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
          <p className="muted">OpenAPI contract และ JSON · backend pending</p>
        </a>
      </nav>
    </>
  );
}
