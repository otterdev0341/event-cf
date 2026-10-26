import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type RefObject } from 'react';

export type DropdownOption = { value: string; label: string };
interface DropdownProps { label: string; value: string; options: DropdownOption[]; onChange: (value: string) => void; disabled?: boolean; }

/** Closes a popover on any pointer press outside `root`. */
export function useDismiss(root: RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) close(); };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);
}

/** Select replacement: springy expand, one indicator that glides between rows. Row height is fixed so the glide needs no measuring. */
export function Dropdown({ label, value, options, onChange, disabled }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const selected = Math.max(0, options.findIndex(o => o.value === value));
  const [cursor, setCursor] = useState(selected);
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), list = useRef<HTMLUListElement>(null);
  const id = useId();

  useDismiss(root, open, () => setOpen(false));
  useEffect(() => { // keep the keyboard cursor in view
    if (open) list.current?.children[cursor + 1]?.scrollIntoView?.({ block: 'nearest' });
  }, [open, cursor]);

  const show = () => { setCursor(selected); setOpen(true); };
  const choose = (i: number) => { onChange(options[i].value); setOpen(false); trigger.current?.focus(); };
  const onKey = (e: KeyboardEvent) => {
    const last = options.length - 1;
    if (e.key === 'Escape' && open) { e.preventDefault(); setOpen(false); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!open) show(); else setCursor(c => e.key === 'ArrowDown' ? Math.min(last, c + 1) : Math.max(0, c - 1)); }
    else if (e.key === 'Home' && open) { e.preventDefault(); setCursor(0); }
    else if (e.key === 'End' && open) { e.preventDefault(); setCursor(last); }
    else if ((e.key === 'Enter' || e.key === ' ') && open) { e.preventDefault(); choose(cursor); }
    else if (e.key === 'Tab') setOpen(false);
  };

  return <div className="ov-dd" ref={root} onKeyDown={onKey} data-open={open}>
    <button ref={trigger} type="button" className="ov-dd__trigger" disabled={disabled} aria-haspopup="listbox" aria-expanded={open} aria-controls={`${id}-list`} aria-label={`${label}: ${options[selected]?.label ?? ''}`} aria-activedescendant={open ? `${id}-${cursor}` : undefined} onClick={() => open ? setOpen(false) : show()}>
      <span>{options[selected]?.label}</span>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
    </button>
    <ul ref={list} id={`${id}-list`} className="ov-dd__list" role="listbox" aria-label={label} tabIndex={-1}>
      <li className="ov-dd__glide" aria-hidden="true" style={{ transform: `translateY(${cursor * 42}px)` }}/>
      {options.map((o, i) => <li key={o.value} id={`${id}-${i}`} role="option" aria-selected={i === selected} data-current={i === cursor} style={{ '--i': i } as CSSProperties} onMouseEnter={() => setCursor(i)} onMouseLeave={() => setCursor(selected)} onClick={() => choose(i)}>{o.label}</li>)}
    </ul>
  </div>;
}
