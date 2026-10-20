import { useId, useState } from 'react';
type Option = { id: string; label: string };
export function SearchSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const filtered = options.filter((o) => `${o.label} ${o.id}`.toLowerCase().includes(query.toLowerCase()));
  const selected = options.find((o) => o.id === value);
  function choose(option: Option) {
    onChange(option.id);
    setOpen(false);
    setQuery('');
  }
  return (
    <div
      className="search-select"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <input
        aria-label={label}
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-options`}
        aria-autocomplete="list"
        aria-activedescendant={open && filtered[active] ? `${id}-${active}` : undefined}
        placeholder={selected?.label ?? `Search ${label}`}
        value={open ? query : (selected?.label ?? '')}
        onFocus={() => {
          setOpen(true);
          setQuery('');
          setActive(0);
        }}
        onClick={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setOpen(false);
            e.stopPropagation();
          }
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setOpen(true);
            setActive((i) =>
              Math.max(0, Math.min(filtered.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1))),
            );
          }
          if (e.key === 'Enter' && open && filtered[active]) {
            e.preventDefault();
            choose(filtered[active]);
          }
        }}
      />
      {open && (
        <div className="search-options" id={`${id}-options`} role="listbox" aria-label={`${label} results`}>
          {filtered.map((option, index) => (
            <button
              key={option.id}
              id={`${id}-${index}`}
              type="button"
              role="option"
              aria-selected={option.id === value}
              className={index === active ? 'highlighted' : ''}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(option)}
            >
              {option.label}
            </button>
          ))}
          {!filtered.length && <p role="status">ไม่พบรายการที่ตรงกับคำค้น</p>}
        </div>
      )}
    </div>
  );
}
