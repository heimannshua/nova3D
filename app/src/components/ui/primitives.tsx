import type { ReactNode } from 'react'
import { isPending, type Verified } from '@/api'
import { useSettings } from '@/store/workspace'
import { translate } from '@/lib/i18n'

/** Translate a chrome string at the current locale and wording level. */
export function useT() {
  const { locale, wording } = useSettings()
  return (key: string) => translate(key, locale, wording)
}

/**
 * Renders a value that must come from evidence, a provider, a slicer or a machine.
 *
 * This is the single most important component in the scaffold. A PENDING value
 * prints the pending phrase — it never prints a plausible substitute. If you find
 * yourself wanting to pass a hard-coded string here to make a screen look
 * finished, that is the failure mode the product exists to prevent.
 *
 *   kind="content" → "verified content pending"   (passages, citations, names)
 *   kind="value"   → "value pending"              (dimensions, prices, durations)
 */
export function Value({
  of,
  kind = 'value',
  as: As = 'span',
  className,
}: {
  of: Verified<string>
  kind?: 'content' | 'value'
  as?: 'span' | 'div' | 'p'
  className?: string
}) {
  const t = useT()
  if (isPending(of)) {
    return (
      <As className={['muted', className].filter(Boolean).join(' ')} data-pending="true">
        {t(kind === 'content' ? 'pending.content' : 'pending.value')}
      </As>
    )
  }
  return <As className={className}>{of as string}</As>
}

/** An identifier, measurement, file name or citation: always its own LTR run. */
export function Ltr({ children }: { children: ReactNode }) {
  return (
    <span className="ltr-run" dir="ltr">
      {children}
    </span>
  )
}

/** Says the same thing two ways. Never changes what is available (FR-47). */
export function Wording({ ordinary, technical }: { ordinary: string; technical: string }) {
  const { wording } = useSettings()
  return <>{wording === 'technical' ? technical : ordinary}</>
}

export function Btn({
  variant = 'secondary',
  gate = false,
  children,
  ...rest
}: {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  gate?: boolean
  children: ReactNode
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className={['btn', `btn-${variant}`, gate ? 'btn-gate' : '', rest.className ?? '']
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </button>
  )
}

export function Tag({
  tone = 'neutral',
  children,
}: {
  tone?: 'accent' | 'accent-2' | 'neutral' | 'outline'
  children: ReactNode
}) {
  return <span className={`tag tag-${tone}`}>{children}</span>
}

/**
 * A tinted block always carries a 3px edge or a leading glyph, so the fill is
 * never the only signal (DESIGN.md, Colors).
 */
export function Notice({
  tone = 'neutral',
  glyph,
  title,
  children,
}: {
  tone?: 'neutral' | 'accent' | 'warn'
  glyph?: string
  title?: string
  children: ReactNode
}) {
  const cls = tone === 'accent' ? 'notice notice-accent' : tone === 'warn' ? 'notice notice-warn' : 'notice'
  return (
    <div className={cls}>
      {title && (
        <strong style={{ display: 'block', marginBottom: 'var(--space-1)' }}>
          {glyph && <span aria-hidden="true">{glyph} </span>}
          {title}
        </strong>
      )}
      {!title && glyph && <span aria-hidden="true">{glyph} </span>}
      {children}
    </div>
  )
}

/** The dashed edge marks a stated absence — never a decorative boundary. */
export function StatedAbsence({ children }: { children: ReactNode }) {
  return <div className="stated-absence">{children}</div>
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint && (
        <div className="caption muted" style={{ marginTop: 'var(--space-1)' }}>
          {hint}
        </div>
      )}
    </div>
  )
}

export function RadioCard({
  checked,
  onChange,
  title,
  children,
  name,
}: {
  checked: boolean
  onChange: () => void
  title: string
  children?: ReactNode
  name: string
}) {
  return (
    <label className="radio-card" data-checked={checked}>
      <input type="radio" name={name} checked={checked} onChange={onChange} />
      <span className="dot" aria-hidden="true" />
      <span className="stack gap-1 grow">
        <span className="radio-card-title">{title}</span>
        {children && <span className="sm">{children}</span>}
      </span>
    </label>
  )
}

export function Seg<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
  label: string
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className="seg-opt"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Dialog({
  title,
  children,
  actions,
}: {
  title: string
  children: ReactNode
  actions: ReactNode
}) {
  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className="dialog">
        <div className="dialog-title">{title}</div>
        <div className="sm">{children}</div>
        <div className="dialog-actions">{actions}</div>
      </div>
    </div>
  )
}

/**
 * The plate treatment. Three places only: the wordmark, the three Home numerals,
 * and the Version stamp. Never a status, never a gate, never a control label —
 * a misregistered fringe costs contrast, and those elements must be unambiguous.
 */
export function PlateMark({ children, size = 48 }: { children: string; size?: number }) {
  return (
    <span className="plate-mark" style={{ fontSize: size }}>
      <span className="paper">{children}</span>
      <span className="plate plate-c" aria-hidden="true">
        {children}
      </span>
      <span className="plate plate-m" aria-hidden="true">
        {children}
      </span>
      <span className="plate plate-y" aria-hidden="true">
        {children}
      </span>
    </span>
  )
}

/**
 * No SVG in this scaffold pretends to be a reconstruction. Geometry is a
 * captioned placeholder that says what it is, exactly as the mockups did.
 */
export function ViewportPlaceholder({
  label = 'Model preview',
  note,
  height,
}: {
  label?: string
  note?: string
  height?: number
}) {
  return (
    <div className="viewport-placeholder halftone" style={height ? { minHeight: height } : undefined}>
      <div className="stack gap-1">
        <strong>{label}</strong>
        <span className="caption">{note ?? 'Placeholder. No geometry exists in this scaffold.'}</span>
      </div>
    </div>
  )
}

export function Divider() {
  return <hr style={{ border: 0, borderTop: '1px solid var(--color-divider)', margin: 'var(--space-4) 0' }} />
}

export function KeyValue({ rows }: { rows: { k: string; v: ReactNode }[] }) {
  return (
    <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 'var(--space-1) var(--space-3)' }}>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'contents' }}>
          <dt className="sm muted">{r.k}</dt>
          <dd className="sm" style={{ margin: 0 }}>
            {r.v}
          </dd>
        </div>
      ))}
    </dl>
  )
}
