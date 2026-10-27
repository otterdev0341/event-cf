import { useMemo, useState } from "react";
import { AppHeader } from "../components/AppHeader";
import { apiGroups } from "../data/apiEndpoints";
import "../api-docs-page.css";

export function ApiDocsPage() {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return apiGroups;
    return apiGroups
      .map(group => ({ ...group, endpoints: group.endpoints.filter(item => `${item.method} ${item.path} ${item.tag} ${item.summary} ${item.detail}`.toLowerCase().includes(q)) }))
      .filter(group => group.endpoints.length);
  }, [query]);

  return <div className="apidocs-page"><AppHeader activeNav="docs" /><main className="analytics-main page-shell real-data-page apidocs-main">
    <header className="rd-head"><div><span className="ui-kicker">API DOCS</span><h1>เอกสาร API</h1><p>สรุป endpoint ทั้งหมดของ Voice Confirm · สัญญาฉบับจริงคือ openapi.yaml</p></div>
      <div className="rd-head__actions"><a className="rd-link" href={`${import.meta.env.BASE_URL}api-docs.html`} target="_blank" rel="noreferrer">เปิดเอกสารฉบับเต็ม ↗</a><a className="rd-link" href={`${import.meta.env.BASE_URL}openapi.yaml`} download>ดาวน์โหลด OpenAPI</a></div></header>
    <label className="apidocs-search"><span>ค้นหา endpoint</span>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
      <input type="search" placeholder="ค้นหา endpoint หรือคำอธิบาย" value={query} onChange={e => setQuery(e.target.value)} /></label>
    {groups.length === 0 && <p className="rd-card rd-empty" role="status">ไม่พบ endpoint ที่ตรงกับ "{query}"</p>}
    {groups.map(group => <section className="rd-card apidocs-group" key={group.id} aria-labelledby={`g-${group.id}`}>
      <div className="apidocs-group__head"><h2 id={`g-${group.id}`}>{group.title}</h2><span className="apidocs-auth">{group.auth}</span></div>
      <p className="apidocs-note">{group.note}</p>
      <ul className="apidocs-list">{group.endpoints.map(item => {
        const key = `${item.method} ${item.path}`;
        const expanded = open === key || query.trim() !== "";
        return <li key={key}>
          <button type="button" className="apidocs-row" aria-expanded={expanded} onClick={() => setOpen(open === key ? null : key)}>
            <span className={`apidocs-method apidocs-method--${item.method.toLowerCase()}`}>{item.method}</span>
            <code>{item.path}</code><span className="apidocs-tag">{item.tag}</span>
            <span className="apidocs-summary">{item.summary}</span>
            <svg className="apidocs-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
          </button>
          <div className="apidocs-detail" data-open={expanded}><p>{item.detail}</p></div>
        </li>;
      })}</ul>
    </section>)}
  </main></div>;
}
