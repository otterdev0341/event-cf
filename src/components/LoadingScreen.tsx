// Full-page placeholder shown while a page chunk, the session or the campaign workspace loads.
export function LoadingScreen({ label = 'กำลังโหลด…' }: { label?: string }) {
  return <main className="loading-screen" role="status" aria-live="polite">
    <div className="loading-screen__mark" aria-hidden="true">{[0, 1, 2, 3, 4].map(i => <span key={i} />)}</div>
    <p>{label}</p>
  </main>;
}
