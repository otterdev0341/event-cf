import type { ReactNode } from "react";

interface FormFieldProps {
  action?: ReactNode;
  children: ReactNode;
  htmlFor: string;
  label: string;
  support?: ReactNode;
}

export function FormField({
  action,
  children,
  htmlFor,
  label,
  support,
}: FormFieldProps) {
  return (
    <div className="auth-field">
      {action ? (
        <div className="auth-field__label-row">
          <label htmlFor={htmlFor}>{label}</label>
          {action}
        </div>
      ) : (
        <label htmlFor={htmlFor}>{label}</label>
      )}
      {children}
      {support}
    </div>
  );
}

