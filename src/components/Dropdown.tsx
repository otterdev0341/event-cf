import { createPortal } from 'react-dom';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject } from 'react';

export type DropdownOption = { value: string; label: string };
interface DropdownProps { label: string; value: string; options: DropdownOption[]; onChange: (value: string) => void; disabled?: boolean; id?: string; }

/** Closes a popover on any pointer press outside every ref given (trigger root and its portal layer). */
export function useDismiss(refs: RefObject<HTMLElement | null>[], open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!refs.some(r => r.current?.contains(e.target as Node))) close(); };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);
}

const LAYER_WIDTH = 328; // widest popover (calendar 308px) plus a gutter, used to keep it on screen
const LAYER_HEIGHT = 360; // flip above the trigger when less than this is free below

/**
 * Popover layer rendered outside the page flow so table, card and dialog `overflow` never clips it.
 * Inside a modal <dialog> it must live in the dialog, or the browser's top layer would cover it.
 */
export function Layer({ open, trigger, layerRef, children }: { open: boolean; trigger: RefObject<HTMLElement | null>; layerRef: RefObject<HTMLDivElement | null>; children: ReactNode }) {
  const [host, setHost] = useState<Element | null>(null);
  const [pos, setPos] = useState({ left: 0, y: 0, width: 0, flip: false });
  useEffect(() => setHost(trigger.current?.closest('dialog') ?? document.body), []);
  const measure = useCallback(() => {
    const r = trigger.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom, flip = below < LAYER_HEIGHT && r.top > below;
    setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - LAYER_WIDTH)), y: flip ? window.innerHeight - r.top + 8 : r.bottom + 8, width: r.width, flip });
  }, []);
  useLayoutEffect(() => {
    if (!open) return;
    measure();
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => { window.removeEventListener('scroll', measure, true); window.removeEventListener('resize', measure); };
  }, [open]);
  if (!host) return null;
  const style = { left: pos.left, [pos.flip ? 'bottom' : 'top']: pos.y, '--w': `${pos.width}px` } as CSSProperties;
  return createPortal(<div ref={layerRef} className="ov-layer" data-open={open} data-flip={pos.flip} style={style}>{children}</div>, host);
}

/** Select replacement: springy expand, one indicator that glides between rows. Row height is fixed so the glide needs no measuring. */
export function Dropdown({ label, value, options, onChange, disabled, id: triggerId }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const selected = Math.max(0, options.findIndex(o => o.value === value));
  const [cursor, setCursor] = useState(selected);
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), layer = useRef<HTMLDivElement>(null), list = useRef<HTMLUListElement>(null);
  const id = useId();

  useDismiss([root, layer], open, () => setOpen(false));
  useEffect(() => { // keep the keyboard cursor in view
    if (open) list.current?.children[cursor + 1]?.scrollIntoView?.({ block: 'nearest' });
  }, [open, cursor]);

  const show = () => { if (disabled) return; setCursor(selected); setOpen(true); };
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
    <button ref={trigger} id={triggerId} type="button" className="ov-dd__trigger" disabled={disabled} aria-haspopup="listbox" aria-expanded={open} aria-controls={`${id}-list`} aria-label={`${label}: ${options[selected]?.label ?? ''}`} aria-activedescendant={open ? `${id}-${cursor}` : undefined} onClick={() => open ? setOpen(false) : show()}>
      <span>{options[selected]?.label}</span>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
    </button>
    <Layer open={open} trigger={trigger} layerRef={layer}>
      <ul ref={list} id={`${id}-list`} className="ov-dd__list" role="listbox" aria-label={label} tabIndex={-1}>
        <li className="ov-dd__glide" aria-hidden="true" style={{ transform: `translateY(${cursor * 42}px)` }}/>
        {options.map((o, i) => <li key={i} id={`${id}-${i}`} role="option" aria-selected={i === selected} data-current={i === cursor} style={{ '--i': i } as CSSProperties} onMouseEnter={() => setCursor(i)} onMouseLeave={() => setCursor(selected)} onClick={() => choose(i)}>{o.label}</li>)}
      </ul>
    </Layer>
  </div>;
}
