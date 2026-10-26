import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Layer, useDismiss } from './Dropdown';

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDate = (v: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, Math.min(d.getDate(), new Date(d.getFullYear(), d.getMonth() + n + 1, 0).getDate()));
const th = (d: Date, o: Intl.DateTimeFormatOptions) => d.toLocaleDateString('th-TH', o);
const WEEKDAYS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

const Icon = ({ d }: { d: string }) => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;

/** Shared open/close shell: outside click, Escape, focus back to the trigger. */
function usePopover() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), layer = useRef<HTMLDivElement>(null);
  useDismiss([root, layer], open, () => setOpen(false));
  const close = () => { setOpen(false); trigger.current?.focus(); };
  const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape' && open) { e.preventDefault(); close(); } };
  return { open, setOpen, root, trigger, layer, close, onKeyDown };
}

/** Works uncontrolled (`defaultValue` + `name`, read by FormData) or controlled (`value` + `onChange`). */
interface PickerProps { label: string; name?: string; defaultValue?: string; value?: string; onChange?: (value: string) => void; disabled?: boolean; }

function useValue({ defaultValue = '', value, onChange }: Pick<PickerProps, 'defaultValue' | 'value' | 'onChange'>) {
  const [inner, setInner] = useState(defaultValue);
  return [value ?? inner, (v: string) => { setInner(v); onChange?.(v); }] as const;
}

/** Calendar popover. Posts `YYYY-MM-DD` through a hidden input so plain FormData forms keep working. */
export function DatePicker({ name, label, disabled, ...rest }: PickerProps) {
  const [value, setValue] = useValue(rest);
  const picked = parseDate(value);
  const [cursor, setCursor] = useState(() => picked ?? new Date());
  const { open, setOpen, root, trigger, layer, close, onKeyDown } = usePopover();
  const focusGrid = useRef(false);
  const id = useId();

  useEffect(() => { // only keyboard moves and opening pull focus into the grid, so the month buttons stay clickable
    if (open && focusGrid.current) { layer.current?.querySelector<HTMLElement>('[data-cursor="true"]')?.focus({ preventScroll: true }); focusGrid.current = false; }
  }, [open, cursor]);

  const go = (d: Date) => { focusGrid.current = true; setCursor(d); };
  const choose = (d: Date) => { setValue(iso(d)); close(); };
  const onGridKey = (e: KeyboardEvent) => {
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -cursor.getDay(), End: 6 - cursor.getDay() };
    if (e.key in step) { e.preventDefault(); go(addDays(cursor, step[e.key])); }
    else if (e.key === 'PageUp' || e.key === 'PageDown') { e.preventDefault(); go(addMonths(cursor, e.key === 'PageUp' ? -1 : 1)); }
  };

  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const days = Array.from({ length: 42 }, (_, i) => addDays(first, i - first.getDay()));
  const today = iso(new Date());
  return <div className="ov-dd" ref={root} data-open={open} onKeyDown={onKeyDown}>
    {name && <input type="hidden" name={name} value={value} />}
    <button ref={trigger} type="button" className="ov-dd__trigger" disabled={disabled} aria-haspopup="dialog" aria-expanded={open} aria-controls={`${id}-pop`} aria-label={`${label}: ${picked ? th(picked, { dateStyle: 'long' }) : 'ยังไม่ได้เลือก'}`} onClick={() => { if (open) setOpen(false); else { setCursor(picked ?? new Date()); focusGrid.current = true; setOpen(true); } }}>
      <span className={picked ? '' : 'pk-ph'}>{picked ? th(picked, { dateStyle: 'long' }) : 'เลือกวันที่'}</span>
      <Icon d="M4 6h16v14H4zM4 10h16M8 3v4M16 3v4" />
    </button>
    <Layer open={open} trigger={trigger} layerRef={layer}><div id={`${id}-pop`} className="pk-pop pk-cal" role="dialog" aria-label={label}>
      <div className="pk-cal__head">
        <button type="button" className="pk-nav" aria-label="เดือนก่อนหน้า" onClick={() => setCursor(addMonths(cursor, -1))}><Icon d="m15 6-6 6 6 6" /></button>
        <strong aria-live="polite">{th(cursor, { month: 'long', year: 'numeric' })}</strong>
        <button type="button" className="pk-nav" aria-label="เดือนถัดไป" onClick={() => setCursor(addMonths(cursor, 1))}><Icon d="m9 6 6 6-6 6" /></button>
      </div>
      <div className="pk-days" aria-hidden="true">{WEEKDAYS.map(w => <span key={w}>{w}</span>)}</div>
      <div className="pk-days pk-grid" key={`${cursor.getFullYear()}-${cursor.getMonth()}`} onKeyDown={onGridKey}>
        {days.map(d => {
          const key = iso(d), here = key === iso(cursor);
          return <button key={key} type="button" tabIndex={here ? 0 : -1} data-cursor={here} data-out={d.getMonth() !== cursor.getMonth()} data-today={key === today} aria-label={th(d, { dateStyle: 'full' })} aria-pressed={key === value} onClick={() => choose(d)}>{d.getDate()}</button>;
        })}
      </div>
      <div className="pk-foot"><button type="button" onClick={() => choose(new Date())}>วันนี้</button><button type="button" onClick={() => { setValue(''); close(); }}>ล้างวันที่</button></div>
    </div></Layer>
  </div>;
}

/** Hour and minute columns; picking a minute closes. Posts `HH:MM`. shortcut: 5-minute steps, an off-grid saved minute stays listed until changed. */
export function TimePicker({ name, label, disabled, ...rest }: PickerProps) {
  const [value, setValue] = useValue({ ...rest, defaultValue: rest.defaultValue ?? '09:00' });
  const [h, m] = /^\d{2}:\d{2}$/.test(value) ? value.split(':').map(Number) : [9, 0];
  const minutes = [...new Set([...Array.from({ length: 12 }, (_, i) => i * 5), m])].sort((a, b) => a - b);
  const { open, setOpen, root, trigger, layer, close, onKeyDown } = usePopover();
  const id = useId();
  const set = (nh: number, nm: number) => setValue(`${pad(nh)}:${pad(nm)}`);
  const focusSel = (col: 'h' | 'm') => requestAnimationFrame(() => layer.current?.querySelector<HTMLElement>(`[data-col="${col}"][aria-selected="true"]`)?.focus());

  useEffect(() => { // centre the current hour and minute when the popover opens
    if (!open) return;
    layer.current?.querySelectorAll<HTMLElement>('.pk-col').forEach(col => { const el = col.querySelector<HTMLElement>('[aria-selected="true"]'); if (el) col.scrollTop = el.offsetTop - col.clientHeight / 2 + el.offsetHeight / 2; });
    layer.current?.querySelector<HTMLElement>('[data-col="h"][aria-selected="true"]')?.focus({ preventScroll: true });
  }, [open]);

  const onColKey = (e: KeyboardEvent, col: 'h' | 'm') => {
    const list = col === 'h' ? HOURS : minutes, i = list.indexOf(col === 'h' ? h : m);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = list[Math.max(0, Math.min(list.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (col === 'h') set(n, m); else set(h, n);
      focusSel(col);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); focusSel(col === 'h' ? 'm' : 'h'); }
  };

  return <div className="ov-dd" ref={root} data-open={open} onKeyDown={onKeyDown}>
    {name && <input type="hidden" name={name} value={value} />}
    <button ref={trigger} type="button" className="ov-dd__trigger" disabled={disabled} aria-haspopup="dialog" aria-expanded={open} aria-controls={`${id}-pop`} aria-label={`${label}: ${pad(h)}:${pad(m)} น.`} onClick={() => setOpen(!open)}>
      <span>{pad(h)}:{pad(m)} น.</span>
      <Icon d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 7v5l3 2" />
    </button>
    <Layer open={open} trigger={trigger} layerRef={layer}><div id={`${id}-pop`} className="pk-pop pk-time" role="dialog" aria-label={label}>
      {([['h', 'ชั่วโมง', HOURS], ['m', 'นาที', minutes]] as const).map(([col, title, list]) =>
        <div key={col} className="pk-col" role="listbox" aria-label={title} onKeyDown={e => onColKey(e, col)}>
          {list.map(n => {
            const on = n === (col === 'h' ? h : m);
            return <button key={n} type="button" role="option" data-col={col} aria-selected={on} tabIndex={on ? 0 : -1} onClick={() => { if (col === 'h') set(n, m); else { set(h, n); close(); } }}>{pad(n)}</button>;
          })}
        </div>)}
    </div></Layer>
  </div>;
}
