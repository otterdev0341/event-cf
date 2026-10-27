"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import useMeasure from "react-use-measure";
import { cn } from "@/lib/utils";

// A <select> replacement with the same motion as smooth-dropdown: spring-sized panel,
// staggered items and a sliding hover indicator. Keyboard and listbox semantics follow
// the ARIA select-only combobox pattern.

export interface SmoothSelectOption<T extends string | number> {
  value: T;
  label: string;
  disabled?: boolean;
}

interface SmoothSelectProps<T extends string | number> {
  value: T;
  options: SmoothSelectOption<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
  className?: string;
}

const easeOutQuint: [number, number, number, number] = [0.23, 1, 0.32, 1];
const spring = { type: "spring" as const, damping: 34, stiffness: 380, mass: 0.8 };
const indicatorSpring = { type: "spring" as const, damping: 30, stiffness: 520, mass: 0.8 };
const MAX_HEIGHT = 320;
const ANIMATED_ITEMS = 14;

export function SmoothSelect<T extends string | number>({ value, options, onChange, placeholder = "เลือก", disabled = false, id, className, ...aria }: SmoothSelectProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const [hovered, setHovered] = useState<number | null>(null);
  const [active, setActive] = useState(-1);
  const [rect, setRect] = useState<{ left: number; top: number; bottom: number; width: number; flip: boolean } | null>(null);
  // Inside a modal <dialog> the body is inert, so the panel renders in place instead of in a portal.
  const [inline, setInline] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [contentRef, bounds] = useMeasure();
  const uid = useId();
  const listId = `${uid}-list`;
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = options[selectedIndex];

  function place() {
    const box = triggerRef.current?.getBoundingClientRect();
    if (!box) return;
    const below = window.innerHeight - box.bottom;
    setRect({ left: box.left, width: box.width, top: box.bottom + 6, bottom: window.innerHeight - box.top + 6, flip: below < Math.min(MAX_HEIGHT, 48 * options.length) + 16 && box.top > below });
  }
  function open() {
    if (disabled) return;
    setInline(Boolean(triggerRef.current?.closest("dialog")));
    place();
    setActive(selectedIndex >= 0 ? selectedIndex : options.findIndex((option) => !option.disabled));
    setIsOpen(true);
  }
  function close(focus = true) {
    setIsOpen(false);
    setHovered(null);
    if (focus) triggerRef.current?.focus();
  }
  function choose(index: number) {
    const option = options[index];
    if (!option || option.disabled) return;
    if (option.value !== value) onChange(option.value);
    close();
  }
  function step(from: number, delta: number) {
    for (let i = 1; i <= options.length; i++) {
      const next = (from + delta * i + options.length * i) % options.length;
      if (!options[next].disabled) return next;
    }
    return from;
  }
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    if (!isOpen) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) { event.preventDefault(); open(); }
      return;
    }
    if (event.key === "Escape") { event.preventDefault(); close(); }
    else if (event.key === "Tab") close(false);
    else if (event.key === "ArrowDown") { event.preventDefault(); setActive((i) => step(i, 1)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActive((i) => step(i < 0 ? 0 : i, -1)); }
    else if (event.key === "Home") { event.preventDefault(); setActive(step(-1, 1)); }
    else if (event.key === "End") { event.preventDefault(); setActive(step(options.length, -1)); }
    else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); choose(active); }
  }

  useEffect(() => {
    if (!isOpen) return;
    const outside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !panelRef.current?.contains(target)) close(false);
    };
    const reposition = () => place();
    document.addEventListener("mousedown", outside);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("mousedown", outside);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [isOpen]);

  useLayoutEffect(() => {
    if (isOpen && active >= 0) listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [isOpen, active]);

  useEffect(() => { if (disabled && isOpen) close(false); }, [disabled]);

  const height = Math.min(MAX_HEIGHT, Math.ceil(bounds.height) || 0);
  const indicatorIndex = hovered ?? active;

  const panel = isOpen && rect && (
    <motion.div
      ref={panelRef}
      initial={{ height: 0, opacity: 0.6, borderRadius: 12 }}
      animate={{ height, opacity: 1, borderRadius: 14 }}
      transition={spring}
      className={cn("z-[100] bg-popover border border-border shadow-lg overflow-hidden", inline ? "absolute left-0 right-0" : "fixed", rect.flip ? "origin-bottom" : "origin-top")}
      style={inline
        ? (rect.flip ? { bottom: "calc(100% + 6px)" } : { top: "calc(100% + 6px)" })
        : { left: rect.left, width: Math.max(rect.width, 180), ...(rect.flip ? { bottom: rect.bottom } : { top: rect.top }) }}
    >
      <div className="overflow-y-auto overscroll-contain" style={{ maxHeight: MAX_HEIGHT }}>
        <div ref={contentRef}>
          <motion.ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={aria["aria-label"]}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2, delay: 0.06 }}
            className="flex flex-col gap-0.5 m-0! p-2! list-none!"
            onMouseLeave={() => setHovered(null)}
          >
            {options.map((option, index) => {
              const isSelected = index === selectedIndex;
              const showIndicator = indicatorIndex === index && !option.disabled;
              const animated = index < ANIMATED_ITEMS;
              return (
                <motion.li
                  key={`${option.value}`}
                  id={`${uid}-opt-${index}`}
                  data-index={index}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={option.disabled || undefined}
                  initial={animated ? { opacity: 0, x: 8 } : false}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: animated ? 0.05 + index * 0.02 : 0, duration: 0.15, ease: easeOutQuint }}
                  onMouseEnter={() => setHovered(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(index)}
                  className={cn(
                    "relative flex items-center gap-3 rounded-lg text-sm m-0! pl-3! pr-2! py-2.5! min-h-10 transition-colors duration-200 ease-out",
                    option.disabled ? "opacity-45 cursor-not-allowed text-muted-foreground" : "cursor-pointer",
                    !option.disabled && (showIndicator || isSelected ? "text-primary" : "text-muted-foreground hover:text-foreground"),
                  )}
                >
                  {showIndicator && <motion.span layoutId={`${uid}-bg`} className="absolute inset-0 rounded-lg bg-muted" transition={indicatorSpring} />}
                  {showIndicator && <motion.span layoutId={`${uid}-bar`} className="absolute left-0 top-0 bottom-0 my-auto w-[3px] h-5 rounded-full bg-primary" transition={indicatorSpring} />}
                  <span className={cn("relative z-10 flex-1 min-w-0", isSelected ? "font-semibold" : "font-medium")}>{option.label}</span>
                  {isSelected && <HugeiconsIcon icon={Tick02Icon} className="relative z-10 w-4 h-4 shrink-0" />}
                </motion.li>
              );
            })}
          </motion.ul>
        </div>
      </div>
    </motion.div>
  );

  return (
    <span className={cn("smooth-select-wrap", className)}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listId}
        aria-activedescendant={isOpen && active >= 0 ? `${uid}-opt-${active}` : undefined}
        aria-label={aria["aria-label"]}
        disabled={disabled}
        onClick={() => (isOpen ? close() : open())}
        onKeyDown={onKeyDown}
        className={cn("smooth-select", isOpen && "smooth-select--open")}
      >
        <span className={cn("smooth-select__value", !selected && "smooth-select__placeholder")}>{selected ? selected.label : placeholder}</span>
        <motion.span animate={{ rotate: isOpen ? 180 : 0 }} transition={{ duration: 0.2, ease: easeOutQuint }} className="flex shrink-0 text-muted-foreground" aria-hidden="true">
          <HugeiconsIcon icon={ArrowDown01Icon} className="w-[18px] h-[18px]" />
        </motion.span>
      </button>
      {panel && (inline ? panel : createPortal(panel, document.body))}
    </span>
  );
}

export default SmoothSelect;
