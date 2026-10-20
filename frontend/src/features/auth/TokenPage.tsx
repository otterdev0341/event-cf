import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { authService } from './service';
import { Button, Feedback, Field, formText } from '../../components/ui';
export function TokenPage() {
  const [params] = useSearchParams();
  const [validation, setValidation] = useState<Error | null>(null);
  const reset = useMutation({ mutationFn: authService.completeReset });
  const token = params.get('token') ?? '';
  return (
    <main className="auth-form">
      <p className="eyebrow">ACCOUNT RECOVERY</p>
      <h1>Set a new password.</h1>
      {__MOCK__ && <p className="notice">Preview token: preview-reset · ไม่เปลี่ยนบัญชีจริง</p>}
      {!token ? (
        <p className="alert" role="alert">
          ลิงก์ไม่มี token กรุณาขอลิงก์ใหม่
        </p>
      ) : (
        <form
          className="form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            const password = formText(e.currentTarget, 'password');
            if (password !== formText(e.currentTarget, 'confirm')) {
              setValidation(new Error('รหัสผ่านไม่ตรงกัน'));
              return;
            }
            setValidation(null);
            reset.mutate({ token, password });
          }}
        >
          <Field label="New password">
            <input name="password" type="password" autoComplete="new-password" minLength={8} required />
          </Field>
          <Field label="Confirm password">
            <input name="confirm" type="password" autoComplete="new-password" minLength={8} required />
          </Field>
          <Feedback error={validation || reset.error} notice={reset.data?.message} />
          <Button variant="brand" pending={reset.isPending} disabled={reset.isSuccess}>
            ตั้งรหัสผ่านใหม่
          </Button>
        </form>
      )}
      <Link className="event-link mt-6" to="/login">
        กลับไปเข้าสู่ระบบ →
      </Link>
    </main>
  );
}
