import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Navigate, useLocation } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { authService } from './service';
import { useSession } from './hooks';
import { Button, Feedback, Field, formText } from '../../components/ui';
export function AuthPage() {
  const client = useQueryClient();
  const location = useLocation();
  const session = useSession();
  const [reset, setReset] = useState(location.pathname === '/forgot-password');
  const login = useMutation({
    mutationFn: __DEMO__ ? authService.demo : authService.login,
    onSuccess: (data) => client.setQueryData(['session'], data),
  });
  const recovery = useMutation({ mutationFn: authService.reset });
  if (session.data) return <Navigate to={location.state?.from ?? '/events'} replace />;
  return (
    <div className="auth-layout">
      <section className="auth-story">
        <div className="wordmark">
          <span className="brand-mark">e.</span>event confirm
        </div>
        <div>
          <p className="eyebrow">A LITTLE LESS ADMIN. A LOT MORE CONNECTION.</p>
          <h1>
            Every invitation.
            <br />A real connection.
          </h1>
          <p>ให้ทุกการยืนยันเป็นเรื่องง่าย จัดการอีเวนท์ คำถาม และการติดตามผู้เข้าร่วมในพื้นที่เดียว</p>
        </div>
        <footer className="eyebrow">BUILT FOR THE PEOPLE BEHIND THE EVENT</footer>
      </section>
      <main className="auth-form">
        <p className="eyebrow">YOUR EVENT WORKSPACE</p>
        <h1>{reset ? 'Reset password' : 'Welcome back.'}</h1>
        <p className="muted mb-8">
          {reset
            ? 'กรอกอีเมลเพื่อขอลิงก์ตั้งรหัสผ่านใหม่'
            : 'เข้าสู่ระบบเพื่อเตรียมประสบการณ์ที่ดีให้ผู้เข้าร่วม'}
        </p>
        {__MOCK__ && !__DEMO__ && (
          <div className="notice">
            Development preview · ไม่มีการโทรหรือส่งเมลจริง
            <br />
            <code>admin@otterheaven.com / passwordpassword</code>
          </div>
        )}
        {__DEMO__ ? (
          <div className="form-grid">
            <div className="notice">
              UI DEMO · ข้อมูลจำลองสำหรับทดลองใช้งาน ไม่ต้องกรอกอีเมลหรือรหัสผ่าน
              <br />
              ไม่มีการโทรหรือส่งอีเมลจริง ข้อมูลรีเซ็ตเมื่อรีโหลดหน้า
            </div>
            <Feedback error={login.error} />
            <Button
              variant="brand"
              pending={login.isPending}
              onClick={() => login.mutate({ email: '', password: '' })}
            >
              เข้าสู่ workspace ตัวอย่าง <ArrowUpRight size={16} />
            </Button>
          </div>
        ) : (
          <form
            className="form-grid"
            onSubmit={(e) => {
              e.preventDefault();
              const email = formText(e.currentTarget, 'email');
              if (reset) recovery.mutate(email);
              else login.mutate({ email, password: formText(e.currentTarget, 'password') });
            }}
          >
            <Field label="Email">
              <input name="email" type="email" autoComplete="email" required />
            </Field>
            {!reset && (
              <Field label="Password">
                <input
                  name="password"
                  type="password"
                  minLength={8}
                  autoComplete="current-password"
                  required
                />
              </Field>
            )}
            <Feedback error={reset ? recovery.error : login.error} notice={recovery.data?.message} />
            <Button type="submit" variant="brand" pending={login.isPending || recovery.isPending}>
              {reset ? 'ขอลิงก์ตั้งรหัสผ่าน' : 'เข้าสู่ workspace'}
              <ArrowUpRight size={16} />
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setReset(!reset);
                login.reset();
                recovery.reset();
              }}
            >
              {reset ? 'กลับไปเข้าสู่ระบบ' : 'ลืมรหัสผ่าน?'}
            </Button>
          </form>
        )}
      </main>
    </div>
  );
}
