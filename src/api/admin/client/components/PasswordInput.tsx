/** @jsxImportSource hono/jsx/dom */
import { useState } from 'hono/jsx'

const EYE_OPEN = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
)

const EYE_OFF = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M14.12 14.12a3 3 0 1 1-4.24-4.24" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </svg>
)

export function PasswordInput({ value, onInput, onKeyDown, placeholder, autoFocus, disabled, inputRef }: {
  value:        string
  onInput:      (e: any) => void
  onKeyDown?:   (e: any) => void
  placeholder?: string
  autoFocus?:   boolean
  disabled?:    boolean
  inputRef?:    any
}) {
  const [visible, setVisible] = useState(false)

  return (
    <div style="position:relative">
      <input
        class="ob-input"
        type={visible ? 'text' : 'password'}
        placeholder={placeholder}
        value={value}
        autoFocus={autoFocus}
        disabled={disabled}
        ref={inputRef}
        onInput={onInput}
        onKeyDown={onKeyDown}
        style="padding-right:34px"
      />
      <button
        type="button"
        onClick={() => setVisible(v => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        style="position:absolute;top:0;bottom:0;right:0;width:34px;display:flex;
          align-items:center;justify-content:center;background:none;border:none;
          cursor:pointer;color:var(--muted);padding:0"
      >
        {visible ? EYE_OFF : EYE_OPEN}
      </button>
    </div>
  )
}
