import { useEffect, useId, useState, type ReactNode } from 'react';

export function NumField({
  label, value, onChange, min, max, step, unit, digits = 1, hint, disabled,
}: {
  label: ReactNode; value: number; onChange: (v: number) => void; min: number; max: number; step: number;
  unit?: string; digits?: number; hint?: ReactNode; disabled?: boolean;
}) {
  const id = useId();
  const [text, setText] = useState(value.toFixed(digits));
  useEffect(() => setText(value.toFixed(digits)), [value, digits]);
  const commit = (s: string) => {
    const v = parseFloat(s);
    if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
    else setText(value.toFixed(digits));
  };
  return (
    <div className={`numfield ${disabled ? 'disabled' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <div className="nf-row">
        <input
          type="range" min={min} max={max} step={step} value={Math.min(max, Math.max(min, value))} disabled={disabled}
          onChange={(e) => onChange(parseFloat(e.target.value))} aria-label={typeof label === 'string' ? label : undefined}
        />
        <input
          id={id} className="nf-num" type="number" inputMode="decimal" min={min} max={max} step={step} value={text} disabled={disabled}
          onChange={(e) => setText(e.target.value)} onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') commit((e.target as HTMLInputElement).value); }}
        />
        {unit && <span className="nf-unit">{unit}</span>}
      </div>
      {hint && <div className="nf-hint">{hint}</div>}
    </div>
  );
}

export function Section({ title, children, defaultOpen = true, badge }: { title: ReactNode; children: ReactNode; defaultOpen?: boolean; badge?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`section ${open ? 'open' : ''}`}>
      <button className="section-h" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="chev">{open ? '▾' : '▸'}</span> {title} {badge}
      </button>
      {open && <div className="section-b">{children}</div>}
    </section>
  );
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map(([k, l]) => (
        <button key={k} role="radio" aria-checked={value === k} className={value === k ? 'on' : ''} onClick={() => onChange(k)}>{l}</button>
      ))}
    </div>
  );
}
