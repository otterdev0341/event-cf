import { useEffect, useState, type FormEvent } from "react";
import { Brand } from "../components/Brand";
import { Button } from "../components/Button";
import { FormField } from "../components/FormField";
import { Waveform } from "../components/Waveform";
import { routes } from "../routes";
import { supabase } from "../lib/supabase";

const storyWaveform = [10, 18, 28, 16, 34, 22, 30, 14, 24, 10];
const trustPoints = [
  "ตั้งค่าแคมเปญและนำเข้ารายชื่อ",
  "ทดสอบ API และ Agent ก่อนใช้งานจริง",
  "ติดตามผลการสนทนา",
];

export function AuthPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);


  const [mode, setMode] = useState<'login' | 'signup' | 'reset' | 'update'>('login');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!supabase) return;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setMode('update');
    });
    return () => subscription.unsubscribe();
  }, []);
  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSigningIn) return;
    if (!supabase) { setAuthError('ยังไม่ได้เชื่อมต่อระบบบัญชี กรุณาติดต่อผู้ดูแล'); return; }
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') || '').trim();
    const password = String(form.get('password') || '');
    setAuthError(null); setNotice(''); setIsSigningIn(true);
    try {
      if (mode === 'reset') {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}${routes.login}` });
        if (error) throw error;
        setNotice('หากมีบัญชีนี้ คุณจะได้รับอีเมลสำหรับตั้งรหัสผ่านใหม่');
      } else if (mode === 'update') {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        window.location.assign(routes.dashboard);
      } else if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (data.session) window.location.assign(routes.dashboard);
        else setNotice('ตรวจสอบอีเมลเพื่อยืนยันบัญชี แล้วกลับมาเข้าสู่ระบบ');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        window.location.assign(routes.dashboard);
      }
    } catch (err) { setAuthError((err as Error).message); }
    finally { setIsSigningIn(false); }
  };


  const handleGoogleSignIn = async () => {
    if (!supabase) {
      setAuthError("ยังไม่ได้ตั้งค่า Supabase ในไฟล์ .env.local");
      return;
    }

    setAuthError(null);
    setIsSigningIn(true);

    try {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}${routes.dashboard}`,
      },
    });

    if (error) {
      setAuthError(error.message);
      setIsSigningIn(false);
    }
    } catch (err) { setAuthError((err as Error).message); setIsSigningIn(false); }
  };

  return (
    <main className="auth-page">
      <div className="auth-layout">
        <aside className="auth-story" aria-label="ข้อมูล Voice Confirm">
          <Brand href={routes.home} size="hero" />

          <div className="auth-story__value">
            <Waveform heights={storyWaveform} className="auth-story__waveform" />
            <h1>
              ให้บทสนทนา
              <br />
              เป็นงานของเรา
            </h1>
            <p className="auth-story__description">
              จัดการ Voice AI, API และแคมเปญโทรออกในพื้นที่ทำงานเดียว
            </p>

            <ul className="trust-points">
              {trustPoints.map((point) => (
                <li key={point}>
                  <img src={import.meta.env.BASE_URL + "assets/circle-check.svg"} width="18" height="18" alt="" />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </div>

          <p className="auth-story__footer">VOICE CONFIRM</p>
        </aside>

        <section className="auth-content" aria-labelledby="login-heading">
          <div className="auth-card">
            <header className="auth-card__header">
              <Brand size="card" tone="dark" />
              <p>แพลตฟอร์ม Voice AI สำหรับธุรกิจ</p>
            </header>

            <div className="auth-tabs" role="tablist" aria-label="บัญชีผู้ใช้">
              <button
                className={`auth-tab${mode !== "signup" ? " auth-tab--active" : ""}`} onClick={() => { setMode("login"); setAuthError(null); setNotice(""); }}
                id="login-heading"
                type="button"
                role="tab"
                aria-selected={mode !== "signup"}
              >
                เข้าสู่ระบบ
              </button>
              <button className={`auth-tab${mode === "signup" ? " auth-tab--active" : ""}`} onClick={() => { setMode("signup"); setAuthError(null); setNotice(""); }} type="button" role="tab" aria-selected={mode === "signup"}>
                สมัครสมาชิก
              </button>
            </div>

            <form className="auth-form" onSubmit={handleSubmit}>
              <FormField
                htmlFor="email"
                label="อีเมลบัญชีผู้ใช้"
                support={
                  <label className="auth-remember">
                    <span>ใช้บัญชีอีเมลของคุณ</span>
                  </label>
                }
              >
                <input
                  id="email"
                  name="email"
                  type="email" required={mode !== "update"} disabled={mode === "update"}
                  autoComplete="email"
                  placeholder="yourname@company.com"
                />
              </FormField>

              <FormField
                htmlFor="password"
                label="รหัสผ่าน"
                action={
                  <button className="auth-forgot" type="button" onClick={() => { setMode("reset"); setAuthError(null); setNotice("กรอกอีเมล แล้วกดส่งลิงก์ตั้งรหัสผ่าน"); }}>
                    ลืมรหัสผ่าน?
                  </button>
                }
              >
                <div className="password-input">
                  <input
                    id="password"
                    name="password" required={mode !== "reset"} disabled={mode === "reset"} minLength={mode === "signup" || mode === "update" ? 8 : undefined}
                    type={showPassword ? "text" : "password"}
                    autoComplete={mode === "signup" || mode === "update" ? "new-password" : "current-password"}
                    placeholder="••••••••••••"
                  />
                  <button
                    className="password-toggle"
                    type="button"
                    aria-label={showPassword ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword((visible) => !visible)}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      {showPassword
                        ? <path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.2M6.6 6.6C3.9 8.4 2 12 2 12s3.6 7 10 7c1.9 0 3.6-.6 5-1.5M9.9 9.9a3 3 0 0 0 4.2 4.2" />
                        : <><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" /></>}
                    </svg>
                  </button>
                </div>
              </FormField>

              <Button className="auth-submit" type="submit" disabled={isSigningIn}>
                {isSigningIn ? "กำลังดำเนินการ..." : mode === "signup" ? "สมัครสมาชิก" : mode === "reset" ? "ส่งลิงก์ตั้งรหัสผ่าน" : mode === "update" ? "บันทึกรหัสผ่านใหม่" : "เข้าสู่ระบบ"}
              </Button>
            </form>

            <div className="auth-divider" aria-hidden="true">
              <span>หรือ</span>
            </div>

            <button
              className="auth-google"
              type="button"
              onClick={handleGoogleSignIn}
              disabled={isSigningIn}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M21.8 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.5a4.7 4.7 0 0 1-2 3.1v2.5h3.2c1.9-1.8 3.1-4.4 3.1-7.4Z"
                />
                <path
                  fill="#34A853"
                  d="M12 22c2.7 0 5-.9 6.7-2.4l-3.2-2.5c-.9.6-2 .9-3.5.9-2.7 0-5-1.8-5.8-4.3H2.9v2.6A10 10 0 0 0 12 22Z"
                />
                <path
                  fill="#FBBC05"
                  d="M6.2 13.7a6 6 0 0 1 0-3.4V7.7H2.9a10 10 0 0 0 0 8.6l3.3-2.6Z"
                />
                <path
                  fill="#EA4335"
                  d="M12 6c1.6 0 3 .5 4.1 1.6l3.1-3A10 10 0 0 0 2.9 7.7l3.3 2.6C7 7.8 9.3 6 12 6Z"
                />
              </svg>
              {isSigningIn ? "กำลังไปยัง Google..." : "ดำเนินการต่อด้วย Google"}
            </button>

            {notice && <p className="workspace-notice" role="status">{notice}</p>}
            <p className="workspace-note">ข้อมูลแคมเปญแยกตามบัญชี ยืนยันอีเมลและเข้าสู่ระบบเพื่อเริ่มใช้งาน</p>
            {authError ? <p className="auth-error" role="alert">{authError}</p> : null}
          </div>
        </section>
      </div>
    </main>
  );
}

