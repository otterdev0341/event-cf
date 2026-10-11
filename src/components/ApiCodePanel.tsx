import type { ReactNode } from "react";

interface ApiCodePanelProps {
  children: ReactNode;
  heading: ReactNode;
  meta?: ReactNode;
  variant?: "request" | "response";
}

export function ApiCodePanel({
  children,
  heading,
  meta,
  variant = "request",
}: ApiCodePanelProps) {
  return (
    <div className={`api-code-panel api-code-panel--${variant}`}>
      <header className="api-code-panel__header">
        <div className="api-code-panel__heading">{heading}</div>
        <div className="api-code-panel__meta">
          {meta}
          <span className="api-code-panel__lights" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        </div>
      </header>
      <div className="api-code-panel__body">{children}</div>
    </div>
  );
}
