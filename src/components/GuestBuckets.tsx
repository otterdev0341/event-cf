import { bucketLabels, type GuestBucket } from '../../shared/call-display.mjs';

// One order for every bar, legend and filter: answers first, then who still needs a call; "not called yet" is the bar's empty end.
export const BUCKET_ORDER: GuestBucket[] = ['confirmed', 'declined', 'staff', 'redial', 'awaiting', 'calling', 'pending'];
// legend={false} where filter tiles under the bar already name and count each group. The legend skips empty groups.
export function GuestBuckets({ count, total, ready, legend = true }: { count: (bucket: GuestBucket) => number; total: number; ready: boolean; legend?: boolean }) {
  return <>
    <div className="rd-bar guest-summary__bar" role="img" aria-label={`${BUCKET_ORDER.map(b => `${bucketLabels[b]} ${count(b)}`).join(' ')} จาก ${total} แขก`}>
      {BUCKET_ORDER.filter(b => b !== 'pending').map(b => <span key={b} className={`ob-tone--${b}`} style={{ width: `${total ? count(b) / total * 100 : 0}%` }} />)}
    </div>
    {legend && ready && <ul className="rd-legend">{BUCKET_ORDER.filter(b => count(b) > 0).map(b => <li key={b}><i className={`ob-tone--${b}`} />{bucketLabels[b]} {count(b).toLocaleString('th-TH')}</li>)}</ul>}
  </>;
}
