import type { ReactNode, CSSProperties } from 'react'

// ─── Card ─────────────────────────────────────────────────────────────────────

export function Card({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{
      background:   '#1a1d27',
      border:       '1px solid #2a2d3a',
      borderRadius: 10,
      padding:      20,
      ...style,
    }}>
      {children}
    </div>
  )
}

// ─── StatCard ─────────────────────────────────────────────────────────────────

export function StatCard({ label, value, icon }: { label: string; value: number | string; icon?: ReactNode }) {
  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ color: '#6b7280', fontSize: 12, marginBottom: 6 }}>{label}</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: '#818cf8' }}>{value}</div>
        </div>
        {icon && (
          <div style={{
            background:   'rgba(99,102,241,.12)',
            borderRadius: 8,
            padding:      8,
            color:        '#6366f1',
          }}>
            {icon}
          </div>
        )}
      </div>
    </Card>
  )
}

// ─── Badge ────────────────────────────────────────────────────────────────────

export function Badge({ children, color = 'indigo' }: { children: ReactNode; color?: 'indigo' | 'green' | 'red' | 'gray' }) {
  const colors = {
    indigo: { background: 'rgba(99,102,241,.15)', color: '#818cf8' },
    green:  { background: 'rgba(16,185,129,.15)',  color: '#10b981' },
    red:    { background: 'rgba(239,68,68,.15)',   color: '#ef4444' },
    gray:   { background: 'rgba(107,114,128,.15)', color: '#9ca3af' },
  }
  return (
    <span style={{
      display:      'inline-block',
      padding:      '2px 8px',
      borderRadius: 99,
      fontSize:     11,
      fontWeight:   500,
      ...colors[color],
    }}>
      {children}
    </span>
  )
}

// ─── Button ───────────────────────────────────────────────────────────────────

export function Button({
  children, onClick, variant = 'primary', size = 'md', disabled,
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'ghost' | 'danger'
  size?:    'sm' | 'md'
  disabled?: boolean
}) {
  const variants = {
    primary: { background: '#6366f1', color: '#fff',    border: 'none' },
    ghost:   { background: 'transparent', color: '#e2e4f0', border: '1px solid #2a2d3a' },
    danger:  { background: 'rgba(239,68,68,.12)', color: '#ef4444', border: '1px solid rgba(239,68,68,.2)' },
  }
  const sizes = {
    sm: { padding: '5px 10px', fontSize: 12 },
    md: { padding: '8px 16px', fontSize: 14 },
  }
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        borderRadius: 8,
        fontWeight:   500,
        cursor:       disabled ? 'not-allowed' : 'pointer',
        opacity:      disabled ? 0.5 : 1,
        transition:   'opacity .15s',
        ...variants[variant],
        ...sizes[size],
      }}
    >
      {children}
    </button>
  )
}

// ─── Input ────────────────────────────────────────────────────────────────────

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      style={{
        background:   '#1a1d27',
        border:       '1px solid #2a2d3a',
        borderRadius: 8,
        color:        '#e2e4f0',
        padding:      '8px 12px',
        fontSize:     14,
        width:        '100%',
        outline:      'none',
        ...(props.style ?? {}),
      }}
      onFocus={e => { e.target.style.borderColor = '#6366f1' }}
      onBlur={e  => { e.target.style.borderColor = '#2a2d3a' }}
    />
  )
}

// ─── Table ────────────────────────────────────────────────────────────────────

export function Table({ headers, rows, emptyMessage = 'No records' }: {
  headers:      string[]
  rows:         (string | ReactNode)[][]
  emptyMessage?: string
}) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', background: '#1a1d27', borderRadius: 10, overflow: 'hidden' }}>
        <thead>
          <tr>
            {headers.map(h => (
              <th key={h} style={{
                background:    'rgba(99,102,241,.08)',
                color:         '#6b7280',
                fontSize:      11,
                textTransform: 'uppercase',
                letterSpacing: '.07em',
                padding:       '10px 16px',
                textAlign:     'left',
                borderBottom:  '1px solid #2a2d3a',
                whiteSpace:    'nowrap',
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={headers.length} style={{ padding: '40px', textAlign: 'center', color: '#6b7280', fontSize: 13 }}>
                {emptyMessage}
              </td>
            </tr>
          ) : rows.map((row, i) => (
            <tr key={i} style={{ transition: 'background .1s' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(99,102,241,.04)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              {row.map((cell, j) => (
                <td key={j} style={{
                  padding:      '10px 16px',
                  borderBottom: i < rows.length - 1 ? '1px solid #2a2d3a' : 'none',
                  fontSize:     13,
                  maxWidth:     200,
                  overflow:     'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace:   'nowrap',
                }}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── PageHeader ───────────────────────────────────────────────────────────────

export function PageHeader({ title, subtitle, action }: {
  title:     string
  subtitle?: string
  action?:   ReactNode
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: subtitle ? 4 : 0 }}>{title}</h1>
        {subtitle && <p style={{ color: '#6b7280', fontSize: 13 }}>{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

// ─── Spinner ──────────────────────────────────────────────────────────────────

export function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
      <div style={{
        width:        32,
        height:       32,
        border:       '3px solid #2a2d3a',
        borderTop:    '3px solid #6366f1',
        borderRadius: '50%',
        animation:    'spin .7s linear infinite',
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

// ─── ErrorMessage ─────────────────────────────────────────────────────────────

export function ErrorMessage({ message }: { message: string }) {
  return (
    <div style={{
      background:   'rgba(239,68,68,.1)',
      border:       '1px solid rgba(239,68,68,.2)',
      borderRadius: 8,
      padding:      '12px 16px',
      color:        '#ef4444',
      fontSize:     13,
    }}>
      {message}
    </div>
  )
}
