import { cloneElement, isValidElement, useId, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { LoaderCircle, ArrowUpRight } from 'lucide-react';
export function Button({
  variant = 'neutral',
  pending,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'neutral' | 'brand' | 'outline' | 'danger' | 'ghost';
  pending?: boolean;
}) {
  return (
    <button
      {...props}
      disabled={props.disabled || pending}
      className={`button button-${variant} ${props.className ?? ''}`}
    >
      {pending && <LoaderCircle size={15} className="animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
}
export function Field({
  label,
  children,
  hint,
  error,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  error?: string;
}) {
  const id = useId();
  const control = isValidElement<{ id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }>(
    children,
  )
    ? cloneElement(children, {
        id,
        'aria-describedby': hint || error ? `${id}-help` : undefined,
        'aria-invalid': !!error,
      })
    : children;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {control}
      {(hint || error) && (
        <small id={`${id}-help`} role={error ? 'alert' : undefined} className={error ? 'text-danger' : ''}>
          {error || hint}
        </small>
      )}
    </div>
  );
}
export function Badge({ children, tone = '' }: { children: ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="muted">{description}</p>
      </div>
      {action}
    </header>
  );
}
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <ArrowUpRight size={24} />
      <h3>{title}</h3>
      <p className="muted">{children}</p>
    </div>
  );
}
export function Feedback({ error, notice }: { error?: Error | null; notice?: string }) {
  return (
    <>
      {error && (
        <p className="alert" role="alert">
          {error.message}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
    </>
  );
}
export function QueryState({
  pending,
  error,
  retry,
}: {
  pending: boolean;
  error: Error | null;
  retry: () => unknown;
}) {
  if (pending)
    return (
      <p role="status" className="loading">
        กำลังโหลด…
      </p>
    );
  if (error)
    return (
      <div className="alert" role="alert">
        {error.message} <Button onClick={() => retry()}>ลองอีกครั้ง</Button>
      </div>
    );
  return null;
}
export const formText = (form: HTMLFormElement, key: string) => String(new FormData(form).get(key) ?? '');
