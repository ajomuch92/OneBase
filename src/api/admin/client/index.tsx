/** @jsxImportSource hono/jsx/dom */
import { useState, useEffect, useCallback, useRef } from 'hono/jsx'
import { render } from 'hono/jsx/dom'

// ─── CSS ──────────────────────────────────────────────────────────────────────

const css = `
  .ob-layout { display: flex; min-height: 100vh; }
  .ob-sidebar { width: 220px; background: var(--surface); border-right: 1px solid var(--border);
    display: flex; flex-direction: column; flex-shrink: 0; position: fixed; top: 0; bottom: 0; z-index: 10; }
  .ob-logo { display: flex; align-items: center; gap: 8px; padding: 20px;
    border-bottom: 1px solid var(--border); font-weight: 700; font-size: 17px; color: var(--accent2); }
  .ob-logo-sub { color: var(--muted); font-size: 11px; font-weight: 400; margin-left: 2px; }
  .ob-nav { flex: 1; padding: 8px 0; overflow-y: auto; }
  .ob-nav-link { display: flex; align-items: center; gap: 9px; padding: 8px 16px;
    color: var(--muted); transition: all .12s; border-right: 2px solid transparent;
    cursor: pointer; background: none; border-left: none; border-top: none; border-bottom: none;
    width: 100%; text-align: left; font-size: 13px; }
  .ob-nav-link:hover { color: var(--text); background: rgba(99,102,241,.08); }
  .ob-nav-link.active { color: var(--text); background: rgba(99,102,241,.12); border-right-color: var(--accent); }
  .ob-logout { padding: 12px 16px; border-top: 1px solid var(--border); display: flex;
    align-items: center; gap: 8px; color: var(--muted); cursor: pointer; font-size: 13px;
    background: none; border-left: none; border-right: none; border-bottom: none; width: 100%; }
  .ob-main { flex: 1; margin-left: 220px; padding: 32px; min-height: 100vh; }
  .ob-page-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 28px; }
  .ob-title { font-size: 20px; font-weight: 600; }
  .ob-subtitle { color: var(--muted); font-size: 13px; margin-top: 3px; }
  .ob-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 14px; margin-bottom: 28px; }
  .ob-card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 18px; }
  .ob-stat-label { color: var(--muted); font-size: 11px; margin-bottom: 5px; }
  .ob-stat-value { font-size: 26px; font-weight: 700; color: var(--accent2); }
  .ob-section-title { font-size: 11px; font-weight: 600; text-transform: uppercase;
    letter-spacing: .07em; color: var(--muted); margin-bottom: 14px; }
  .ob-table-wrap { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
  table { width: 100%; border-collapse: collapse; }
  th { background: rgba(99,102,241,.07); color: var(--muted); font-size: 10px; text-transform: uppercase;
    letter-spacing: .08em; padding: 9px 14px; text-align: left; border-bottom: 1px solid var(--border); white-space: nowrap; }
  td { padding: 9px 14px; border-bottom: 1px solid var(--border); font-size: 12px;
    max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: rgba(99,102,241,.04); }
  .ob-badge { display: inline-block; padding: 2px 7px; border-radius: 99px; font-size: 10px; font-weight: 500; }
  .ob-badge-indigo { background: rgba(99,102,241,.15); color: var(--accent2); }
  .ob-badge-green  { background: rgba(16,185,129,.15);  color: var(--green); }
  .ob-badge-red    { background: rgba(239,68,68,.15);   color: var(--red); }
  .ob-badge-gray   { background: rgba(107,114,128,.15); color: #9ca3af; }
  .ob-btn { border-radius: var(--r); font-size: 13px; font-weight: 500; padding: 7px 14px;
    cursor: pointer; transition: opacity .12s; display: inline-flex; align-items: center; gap: 5px; border: none; }
  .ob-btn-primary { background: var(--accent); color: #fff; }
  .ob-btn-ghost   { background: transparent; color: var(--text); border: 1px solid var(--border) !important; }
  .ob-btn-danger  { background: rgba(239,68,68,.1); color: var(--red); border: 1px solid rgba(239,68,68,.2) !important; }
  .ob-btn-sm      { padding: 5px 10px; font-size: 12px; }
  .ob-btn:hover   { opacity: .82; }
  .ob-btn:disabled { opacity: .4; cursor: not-allowed; }
  .ob-input { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r);
    color: var(--text); padding: 7px 11px; font-size: 13px; width: 100%; outline: none; transition: border-color .12s; }
  .ob-input:focus { border-color: var(--accent); }
  .ob-select { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r);
    color: var(--text); padding: 7px 11px; font-size: 13px; outline: none; width: 100%; }
  .ob-label { display: block; color: var(--muted); font-size: 11px; margin-bottom: 5px; }
  .ob-field-row { margin-bottom: 14px; }
  .ob-error { color: var(--red); font-size: 12px; padding: 8px 12px; margin-bottom: 10px;
    background: rgba(239,68,68,.08); border: 1px solid rgba(239,68,68,.2); border-radius: var(--r); }
  .ob-spinner { display: flex; justify-content: center; padding: 48px; }
  .ob-spinner-circle { width: 28px; height: 28px; border: 3px solid var(--border);
    border-top-color: var(--accent); border-radius: 50%; animation: spin .7s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .ob-empty { color: var(--muted); text-align: center; padding: 40px; font-size: 13px; }
  .ob-pagination { display: flex; align-items: center; justify-content: space-between;
    padding: 12px 14px; border-top: 1px solid var(--border); font-size: 12px; color: var(--muted); }
  .ob-modal-bg { position: fixed; inset: 0; background: rgba(0,0,0,.6); z-index: 100;
    display: flex; align-items: center; justify-content: center; padding: 20px; }
  .ob-modal { background: var(--surface); border: 1px solid var(--border); border-radius: 12px;
    padding: 28px; width: 100%; max-width: 520px; max-height: 90vh; overflow-y: auto; }
  .ob-modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 22px; }
  .ob-modal-title { font-size: 16px; font-weight: 600; }
  .ob-close { background: none; border: none; color: var(--muted); font-size: 22px; cursor: pointer; line-height: 1; padding: 0; }
  .ob-field-builder { border: 1px solid var(--border); border-radius: var(--r); padding: 12px;
    margin-bottom: 8px; display: grid; grid-template-columns: 1fr 1fr auto auto; gap: 8px; align-items: end; }
  .ob-tag { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px;
    background: rgba(99,102,241,.12); border-radius: 99px; font-size: 11px; color: var(--accent2); margin: 2px; }
  .ob-split { display: flex; gap: 20px; }
  .ob-col-sidebar { width: 200px; flex-shrink: 0; }
  .ob-col-main { flex: 1; min-width: 0; }
  .ob-collection-item { display: flex; align-items: center; justify-content: space-between;
    padding: 7px 10px; border-radius: 6px; cursor: pointer; transition: background .1s; border: none;
    background: none; width: 100%; text-align: left; color: var(--text); font-size: 13px; }
  .ob-collection-item:hover { background: rgba(99,102,241,.08); }
  .ob-collection-item.active { background: rgba(99,102,241,.14); }
  .ob-actions { display: flex; gap: 6px; }
  .ob-login-wrap { position: fixed; inset: 0; display: flex; align-items: center;
    justify-content: center; background: var(--bg); }
  .ob-login-box { background: var(--surface); border: 1px solid var(--border); border-radius: 14px;
    padding: 36px; width: 100%; max-width: 370px; margin: 0 16px; }
  .ob-login-logo { font-size: 22px; font-weight: 700; color: var(--accent2); margin-bottom: 4px; }
  .ob-login-sub  { color: var(--muted); font-size: 13px; margin-bottom: 26px; }
  .ob-btn-row { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
`

// ─── API client ───────────────────────────────────────────────────────────────

let _token: string | null = localStorage.getItem('ob_token')

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(_token ? { Authorization: `Bearer ${_token}` } : {}),
      ...(init.headers ?? {}),
    },
  })
  if (!res.ok) {
    const e = await res.json().catch(() => ({})) as any
    throw new Error(e.error ?? res.statusText)
  }
  return res.json()
}

function setToken(t: string | null) {
  _token = t
  if (t) localStorage.setItem('ob_token', t)
  else   localStorage.removeItem('ob_token')
}

// ─── useAsync hook ────────────────────────────────────────────────────────────

function useAsync<T>(fn: () => Promise<T>, deps: any[] = []) {
  const [data,    setData]    = useState<T | null>(null)
  const [error,   setError]   = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const run = useCallback(async () => {
    setLoading(true); setError(null)
    try   { setData(await fn()) }
    catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }, deps)

  useEffect(() => { run() }, [run])
  return { data, error, loading, refetch: run }
}

// ─── UI primitives ────────────────────────────────────────────────────────────

function Spinner() {
  return <div class="ob-spinner"><div class="ob-spinner-circle" /></div>
}

function Err({ msg }: { msg: string }) {
  return <div class="ob-error">{msg}</div>
}

function Badge({ children, color = 'indigo' }: { children: any; color?: string }) {
  return <span class={`ob-badge ob-badge-${color}`}>{children}</span>
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: any }) {
  return (
    <div class="ob-modal-bg" onClick={(e: any) => e.target === e.currentTarget && onClose()}>
      <div class="ob-modal">
        <div class="ob-modal-header">
          <span class="ob-modal-title">{title}</span>
          <button class="ob-close" onClick={onClose}>×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function OTable({ headers, rows, empty = 'No records' }: { headers: string[]; rows: any[][]; empty?: string }) {
  return (
    <div class="ob-table-wrap">
      <table>
        <thead><tr>{headers.map(h => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.length === 0
            ? <tr><td colSpan={headers.length} class="ob-empty">{empty}</td></tr>
            : rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => <td key={j}>{cell}</td>)}
                </tr>
              ))
          }
        </tbody>
      </table>
    </div>
  )
}

// ─── Field types ──────────────────────────────────────────────────────────────

const FIELD_TYPES = ['string', 'text', 'number', 'boolean', 'date', 'datetime', 'json', 'relation', 'file']

// ─── Dashboard ────────────────────────────────────────────────────────────────

function Dashboard() {
  const { data, loading, error } = useAsync(() => apiFetch<any>('/admin/api/stats'))
  if (loading) return <Spinner />
  if (error)   return <Err msg={error} />
  const total = data.collections.reduce((s: number, c: any) => s + c.count, 0)
  return (
    <div>
      <div class="ob-page-header">
        <div>
          <div class="ob-title">Dashboard</div>
          <div class="ob-subtitle">Overview of your OneBase instance</div>
        </div>
      </div>
      <div class="ob-grid">
        {[['Collections', data.collections.length], ['Total records', total], ['Live connections', data.realtimeConnections]].map(([l, v]) => (
          <div class="ob-card" key={l as string}>
            <div class="ob-stat-label">{l}</div>
            <div class="ob-stat-value">{v}</div>
          </div>
        ))}
      </div>
      <div class="ob-section-title">Collections</div>
      <OTable
        headers={['Name', 'Records', 'Status']}
        empty="No collections yet"
        rows={data.collections.map((c: any) => [
          <Badge>{c.name}</Badge>,
          c.count.toLocaleString(),
          <Badge color="green">active</Badge>,
        ])}
      />
    </div>
  )
}

// ─── Collection editor modal ──────────────────────────────────────────────────

interface FieldDef { name: string; type: string; required: boolean; unique: boolean }

function CollectionModal({ initial, onClose, onSave }: {
  initial?: { name: string; fields: Record<string, any> }
  onClose: () => void
  onSave:  () => void
}) {
  const isEdit = !!initial
  const [name,   setName]   = useState(initial?.name ?? '')
  const [fields, setFields] = useState<FieldDef[]>(
    initial
      ? Object.entries(initial.fields).map(([n, f]) => ({ name: n, type: f.type, required: !!f.required, unique: !!f.unique }))
      : [{ name: '', type: 'string', required: false, unique: false }]
  )
  const [error,  setError]  = useState('')
  const [saving, setSaving] = useState(false)

  function updateField(i: number, key: keyof FieldDef, value: any) {
    setFields(f => f.map((field, j) => j === i ? { ...field, [key]: value } : field))
  }

  async function handleSave() {
    setError('')
    if (!name.trim()) { setError('Collection name is required'); return }
    if (!/^[a-z][a-z0-9_]*$/.test(name)) { setError('Lowercase letters, numbers and underscores only'); return }
    if (fields.some(f => !f.name.trim())) { setError('All fields must have a name'); return }

    const schema = {
      fields: Object.fromEntries(
        fields.filter(f => f.name.trim()).map(f => [
          f.name, { type: f.type, ...(f.required ? { required: true } : {}), ...(f.unique ? { unique: true } : {}) }
        ])
      )
    }
    setSaving(true)
    try {
      if (isEdit) {
        await apiFetch(`/admin/api/collections/${name}`, { method: 'PUT', body: JSON.stringify({ schema }) })
      } else {
        await apiFetch('/admin/api/collections', { method: 'POST', body: JSON.stringify({ name, schema }) })
      }
      onSave(); onClose()
    } catch (e: any) { setError(e.message) }
    finally { setSaving(false) }
  }

  return (
    <Modal title={isEdit ? `Edit — ${name}` : 'New Collection'} onClose={onClose}>
      {!isEdit && (
        <div class="ob-field-row">
          <label class="ob-label">Collection name</label>
          <input class="ob-input" placeholder="e.g. posts" value={name}
            onInput={(e: any) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} />
          <div style="color:var(--muted);font-size:11px;margin-top:4px">Lowercase, numbers, underscores</div>
        </div>
      )}

      <div class="ob-section-title" style="margin-top:16px">Fields</div>

      {fields.map((field, i) => (
        <div class="ob-field-builder" key={i}>
          <div>
            <label class="ob-label">Name</label>
            <input class="ob-input" placeholder="field_name" value={field.name}
              onInput={(e: any) => updateField(i, 'name', e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} />
          </div>
          <div>
            <label class="ob-label">Type</label>
            <select class="ob-select" value={field.type}
              onChange={(e: any) => updateField(i, 'type', e.target.value)}>
              {FIELD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label class="ob-label">Req</label>
            <input type="checkbox" checked={field.required}
              onChange={(e: any) => updateField(i, 'required', e.target.checked)} />
          </div>
          <button class="ob-btn ob-btn-danger ob-btn-sm"
            onClick={() => setFields(f => f.filter((_, j) => j !== i))}
            disabled={fields.length === 1}>✕</button>
        </div>
      ))}

      <button class="ob-btn ob-btn-ghost ob-btn-sm" style="margin-bottom:16px"
        onClick={() => setFields(f => [...f, { name: '', type: 'string', required: false, unique: false }])}>
        + Add field
      </button>

      {error && <Err msg={error} />}

      <div class="ob-btn-row">
        <button class="ob-btn ob-btn-ghost" onClick={onClose}>Cancel</button>
        <button class="ob-btn ob-btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create collection'}
        </button>
      </div>
    </Modal>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** author_id → Author Id   |   coverImage → Cover Image */
function fieldLabel(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, c => c.toUpperCase())
}

/** Fetch first 50 records from a related collection for the select options */
function useRelationOptions(collectionName: string | undefined) {
  const [options, setOptions] = useState<{ id: string; label: string }[]>([])
  useEffect(() => {
    if (!collectionName) return
    apiFetch<any>(`/api/${collectionName}?limit=50`)
      .then(res => {
        const items: any[] = res.items ?? []
        setOptions(items.map(r => ({
          id:    r.id,
          // Show the first meaningful text field found, fallback to id slice
          label: r.name ?? r.title ?? r.email ?? r.slug ?? `${collectionName}:${String(r.id).slice(0, 8)}`,
        })))
      })
      .catch(() => setOptions([]))
  }, [collectionName])
  return options
}

// ─── Record field — renders the right input per field type ────────────────────

function RecordField({ fieldKey, field, value, onChange }: {
  fieldKey: string
  field:    any
  value:    any
  onChange: (val: any) => void
}) {
  const label = fieldLabel(fieldKey)
  const req   = field.required ? ' *' : ''

  // ── boolean ──
  if (field.type === 'boolean') return (
    <div class="ob-field-row" key={fieldKey}>
      <label class="ob-label">{label}</label>
      <input type="checkbox" checked={!!value}
        onChange={(e: any) => onChange(e.target.checked)} />
    </div>
  )

  // ── text (textarea) ──
  if (field.type === 'text') return (
    <div class="ob-field-row" key={fieldKey}>
      <label class="ob-label">{label}{req}</label>
      <textarea class="ob-input" rows={3} style="resize:vertical" value={value ?? ''}
        onInput={(e: any) => onChange(e.target.value)} />
    </div>
  )

  // ── file ──
  if (field.type === 'file') return (
    <div class="ob-field-row" key={fieldKey}>
      <label class="ob-label">{label}{req}</label>
      {value && (
        <div style="margin-bottom:6px;font-size:11px;color:var(--muted)">
          Current: <a href={value} target="_blank" style="color:var(--accent2)">{String(value).split('/').pop()}</a>
        </div>
      )}
      <input
        type="file"
        style="color:var(--text);font-size:12px;width:100%"
        onChange={(e: any) => {
          const file = e.target.files?.[0]
          if (file) onChange(file)   // store the File object; upload handled on save
        }}
      />
    </div>
  )

  // ── relation (select populated with related records) ──
  if (field.type === 'relation') {
    const options = useRelationOptions(field.collection)
    return (
      <div class="ob-field-row" key={fieldKey}>
        <label class="ob-label">{label}{req} <span style="color:var(--muted)">→ {field.collection}</span></label>
        <select class="ob-select" value={value ?? ''}
          onChange={(e: any) => onChange(e.target.value)}>
          <option value="">— select —</option>
          {options.map(o => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
      </div>
    )
  }

  // ── date ──
  if (field.type === 'date' || field.type === 'datetime') return (
    <div class="ob-field-row" key={fieldKey}>
      <label class="ob-label">{label}{req}</label>
      <input class="ob-input"
        type={field.type === 'datetime' ? 'datetime-local' : 'date'}
        value={value ?? ''}
        onInput={(e: any) => onChange(e.target.value)} />
    </div>
  )

  // ── number ──
  if (field.type === 'number') return (
    <div class="ob-field-row" key={fieldKey}>
      <label class="ob-label">{label}{req}</label>
      <input class="ob-input" type="number" value={value ?? ''}
        onInput={(e: any) => onChange(Number(e.target.value))} />
    </div>
  )

  // ── json ──
  if (field.type === 'json') return (
    <div class="ob-field-row" key={fieldKey}>
      <label class="ob-label">{label}{req} <span style="color:var(--muted)">(JSON)</span></label>
      <textarea class="ob-input" rows={3} style="resize:vertical;font-family:monospace;font-size:11px"
        value={typeof value === 'object' ? JSON.stringify(value, null, 2) : (value ?? '')}
        onInput={(e: any) => onChange(e.target.value)} />
    </div>
  )

  // ── string (default) ──
  return (
    <div class="ob-field-row" key={fieldKey}>
      <label class="ob-label">{label}{req}</label>
      <input class="ob-input" type="text" value={value ?? ''}
        onInput={(e: any) => onChange(e.target.value)} />
    </div>
  )
}

// ─── Record modal ─────────────────────────────────────────────────────────────

function RecordModal({ collection, fields, record, onClose, onSave }: {
  collection: string; fields: Record<string, any>; record?: Record<string, any>
  onClose: () => void; onSave: () => void
}) {
  const isEdit = !!record
  const [data,   setData]   = useState<Record<string, any>>(
    record ? { ...record } : Object.fromEntries(Object.keys(fields).map(k => [k, '']))
  )
  const [error,  setError]  = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setError('')
    setSaving(true)
    try {
      const { id, created_at, updated_at, ...payload } = data

      // Check if any field is a File object — needs multipart upload first
      const fileFields = Object.entries(payload).filter(([, v]) => v instanceof File)
      const jsonFields = Object.fromEntries(
        Object.entries(payload).filter(([, v]) => !(v instanceof File))
      )

      let savedId = record?.id

      // 1. Create/update the record with non-file fields
      if (isEdit) {
        await apiFetch(`/api/${collection}/${record!.id}`, { method: 'PATCH', body: JSON.stringify(jsonFields) })
      } else {
        const res = await apiFetch<any>(`/api/${collection}`, { method: 'POST', body: JSON.stringify(jsonFields) })
        savedId = res.id
      }

      // 2. Upload each file field separately
      for (const [fieldKey, file] of fileFields) {
        const form = new FormData()
        form.append(fieldKey, file as File)
        await fetch(`/api/${collection}/${savedId}/upload?field=${fieldKey}`, {
          method:  'POST',
          headers: _token ? { Authorization: `Bearer ${_token}` } : {},
          body:    form,
        })
      }

      onSave(); onClose()
    } catch (e: any) { setError(e.message) }
    finally { setSaving(false) }
  }

  return (
    <Modal title={isEdit ? 'Edit record' : 'New record'} onClose={onClose}>
      {Object.entries(fields).map(([key, field]) => (
        <RecordField
          key={key}
          fieldKey={key}
          field={field}
          value={data[key]}
          onChange={(val: any) => setData((d: any) => ({ ...d, [key]: val }))}
        />
      ))}
      {error && <Err msg={error} />}
      <div class="ob-btn-row">
        <button class="ob-btn ob-btn-ghost" onClick={onClose}>Cancel</button>
        <button class="ob-btn ob-btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : isEdit ? 'Save' : 'Create'}
        </button>
      </div>
    </Modal>
  )
}

// ─── Index modal (create / edit) ───────────────────────────────────────────────

interface IndexRow { name: string; columns: string[]; unique: boolean }

function IndexModal({ collection, columnOptions, initial, onClose, onSave }: {
  collection:    string
  columnOptions: string[]
  initial?:      IndexRow
  onClose:       () => void
  onSave:        () => void
}) {
  const isEdit = !!initial
  const [name,    setName]    = useState(initial?.name ?? '')
  const [columns, setColumns] = useState<string[]>(initial?.columns ?? [])
  const [unique,  setUnique]  = useState(initial?.unique ?? false)
  const [error,   setError]   = useState('')
  const [saving,  setSaving]  = useState(false)

  function toggleColumn(col: string) {
    setColumns(cs => cs.includes(col) ? cs.filter(c => c !== col) : [...cs, col])
  }

  async function handleSave() {
    setError('')
    if (!isEdit && (!name.trim() || !/^[a-z][a-z0-9_]*$/.test(name))) {
      setError('Index name must be lowercase letters, numbers, underscores'); return
    }
    if (columns.length === 0) { setError('Select at least one column'); return }

    setSaving(true)
    try {
      if (isEdit) {
        await apiFetch(`/admin/api/collections/${collection}/indexes/${initial!.name}`, {
          method: 'PUT', body: JSON.stringify({ columns, unique }),
        })
      } else {
        await apiFetch(`/admin/api/collections/${collection}/indexes`, {
          method: 'POST', body: JSON.stringify({ name, columns, unique }),
        })
      }
      onSave(); onClose()
    } catch (e: any) { setError(e.message) }
    finally { setSaving(false) }
  }

  return (
    <Modal title={isEdit ? `Edit index — ${initial!.name}` : 'New index'} onClose={onClose}>
      {!isEdit && (
        <div class="ob-field-row">
          <label class="ob-label">Index name</label>
          <input class="ob-input" placeholder={`idx_${collection}_...`} value={name}
            onInput={(e: any) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} />
        </div>
      )}

      <div class="ob-field-row">
        <label class="ob-label">Columns</label>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          {columnOptions.map(col => (
            <label key={col} style={`display:flex;align-items:center;gap:5px;padding:5px 9px;border-radius:99px;
              font-size:12px;cursor:pointer;border:1px solid var(--border);
              ${columns.includes(col) ? 'background:rgba(99,102,241,.15);border-color:var(--accent)' : ''}`}>
              <input type="checkbox" checked={columns.includes(col)} onChange={() => toggleColumn(col)} style="margin:0" />
              {col}
            </label>
          ))}
        </div>
      </div>

      <div class="ob-field-row" style="display:flex;align-items:center;gap:8px">
        <input type="checkbox" id="ob-idx-unique" checked={unique}
          onChange={(e: any) => setUnique(e.target.checked)} />
        <label for="ob-idx-unique" style="color:var(--text);font-size:13px;cursor:pointer">Unique</label>
      </div>

      {error && <Err msg={error} />}

      <div class="ob-btn-row">
        <button class="ob-btn ob-btn-ghost" onClick={onClose}>Cancel</button>
        <button class="ob-btn ob-btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create index'}
        </button>
      </div>
    </Modal>
  )
}

// ─── Indexes card ───────────────────────────────────────────────────────────────

function IndexesCard({ def }: { def: any }) {
  const { data: indexes, loading, error, refetch } = useAsync<IndexRow[]>(
    () => apiFetch(`/admin/api/collections/${def.name}/indexes`),
    [def.name],
  )
  const [showNew, setShowNew] = useState(false)
  const [editIdx, setEditIdx] = useState<IndexRow | null>(null)

  const columnOptions = ['id', ...Object.keys(def.fields), 'created_at', 'updated_at']

  async function handleDelete(indexName: string) {
    if (!confirm(`Delete index "${indexName}"?`)) return
    try {
      await apiFetch(`/admin/api/collections/${def.name}/indexes/${indexName}`, { method: 'DELETE' })
      refetch()
    } catch (e: any) { alert(e.message) }
  }

  return (
    <div class="ob-card" style="padding:0">
      <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 16px">
        <div class="ob-section-title" style="margin-bottom:0">Indexes</div>
        <div class="ob-actions">
          <button class="ob-btn ob-btn-ghost ob-btn-sm" onClick={refetch}>↺ Refresh</button>
          <button class="ob-btn ob-btn-primary ob-btn-sm" onClick={() => setShowNew(true)}>+ New index</button>
        </div>
      </div>

      {loading && <Spinner />}
      {error   && <div style="padding:16px"><Err msg={error} /></div>}

      {indexes && (
        <OTable
          headers={['Name', 'Columns', 'Unique', 'Actions']}
          empty="No indexes yet"
          rows={indexes.map(idx => [
            idx.name,
            idx.columns.join(', '),
            <Badge color={idx.unique ? 'green' : 'gray'}>{idx.unique ? 'yes' : 'no'}</Badge>,
            <div class="ob-actions">
              <button class="ob-btn ob-btn-ghost ob-btn-sm" onClick={() => setEditIdx(idx)}>Edit</button>
              <button class="ob-btn ob-btn-danger ob-btn-sm" onClick={() => handleDelete(idx.name)}>Del</button>
            </div>,
          ])}
        />
      )}

      {showNew && (
        <IndexModal collection={def.name} columnOptions={columnOptions}
          onClose={() => setShowNew(false)} onSave={refetch} />
      )}
      {editIdx && (
        <IndexModal collection={def.name} columnOptions={columnOptions} initial={editIdx}
          onClose={() => setEditIdx(null)} onSave={refetch} />
      )}
    </div>
  )
}

// ─── Collection panel ─────────────────────────────────────────────────────────

function CollectionPanel({ def, onEdit, onDelete, onRefresh }: {
  def: any; onEdit: () => void; onDelete: () => void; onRefresh: () => void
}) {
  const [page,       setPage]       = useState(0)
  const [showNew,    setShowNew]    = useState(false)
  const [editRecord, setEditRecord] = useState<any | null>(null)
  const limit = 20

  const { data, loading, error, refetch } = useAsync(
    () => apiFetch<any>(`/admin/api/collections/${def.name}/records?limit=${limit}&offset=${page * limit}`),
    [def.name, page]
  )

  async function handleDeleteRecord(id: string) {
    if (!confirm('Delete this record?')) return
    try { await apiFetch(`/api/${def.name}/${id}`, { method: 'DELETE' }); refetch() }
    catch (e: any) { alert(e.message) }
  }

  const fieldNames = Object.keys(def.fields)
  const displayCols = fieldNames.slice(0, 5)

  return (
    <div style="display:flex;flex-direction:column;gap:16px">
      {/* Schema card */}
      <div class="ob-card">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px">
          <div>
            <div class="ob-section-title" style="margin-bottom:2px">{def.name}</div>
            <div style="color:var(--muted);font-size:11px">{def.count} records · {fieldNames.length} fields</div>
          </div>
          <div class="ob-actions">
            <button class="ob-btn ob-btn-ghost ob-btn-sm" onClick={onEdit}>Edit schema</button>
            <button class="ob-btn ob-btn-danger ob-btn-sm" onClick={onDelete}>Delete</button>
          </div>
        </div>
        <div style="display:flex;flex-wrap:wrap">
          {fieldNames.map(n => (
            <span class="ob-tag" key={n}>
              {n} <span style="opacity:.6">{def.fields[n].type}</span>
              {def.fields[n].required && <span style="color:var(--accent)">*</span>}
            </span>
          ))}
        </div>
      </div>

      {/* Indexes card */}
      <IndexesCard def={def} />

      {/* Records card */}
      <div class="ob-card" style="padding:0">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 16px">
          <div class="ob-section-title" style="margin-bottom:0">Records</div>
          <div class="ob-actions">
            <button class="ob-btn ob-btn-ghost ob-btn-sm" onClick={refetch}>↺ Refresh</button>
            <button class="ob-btn ob-btn-primary ob-btn-sm" onClick={() => setShowNew(true)}>+ New record</button>
          </div>
        </div>

        {loading && <Spinner />}
        {error   && <div style="padding:16px"><Err msg={error} /></div>}

        {data && (
          <>
            <OTable
              headers={['id', ...displayCols, 'created_at', 'actions']}
              empty="No records yet — create one!"
              rows={(data.items ?? []).map((row: any) => [
                <span style="font-family:monospace;font-size:10px;color:var(--muted)">{String(row.id).slice(0, 8)}…</span>,
                ...displayCols.map(f => {
                  const v = row[f]
                  if (v === null || v === undefined) return <span style="color:var(--muted)">—</span>
                  if (typeof v === 'boolean' || v === 0 || v === 1)
                    return <Badge color={v ? 'green' : 'gray'}>{v ? 'true' : 'false'}</Badge>
                  return String(v).slice(0, 35)
                }),
                <span style="color:var(--muted);font-size:10px">{new Date(row.created_at).toLocaleString()}</span>,
                <div class="ob-actions">
                  <button class="ob-btn ob-btn-ghost ob-btn-sm" onClick={() => setEditRecord(row)}>Edit</button>
                  <button class="ob-btn ob-btn-danger ob-btn-sm" onClick={() => handleDeleteRecord(row.id)}>Del</button>
                </div>,
              ])}
            />
            <div class="ob-pagination">
              <span>{page * limit + 1}–{Math.min((page + 1) * limit, data.total)} of {data.total}</span>
              <div class="ob-actions">
                <button class="ob-btn ob-btn-ghost ob-btn-sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>← Prev</button>
                <button class="ob-btn ob-btn-ghost ob-btn-sm" disabled={(page + 1) * limit >= data.total} onClick={() => setPage(p => p + 1)}>Next →</button>
              </div>
            </div>
          </>
        )}
      </div>

      {showNew    && <RecordModal collection={def.name} fields={def.fields} onClose={() => setShowNew(false)} onSave={refetch} />}
      {editRecord && <RecordModal collection={def.name} fields={def.fields} record={editRecord} onClose={() => setEditRecord(null)} onSave={refetch} />}
    </div>
  )
}

// ─── Collections page ─────────────────────────────────────────────────────────

function Collections() {
  const { data: cols, loading, error, refetch } = useAsync<any[]>(() => apiFetch('/admin/api/collections'))
  const [selected,   setSelected]   = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [editTarget, setEditTarget] = useState<any | null>(null)

  const activeDef = cols?.find(c => c.name === (selected ?? cols?.[0]?.name))

  async function handleDelete(name: string) {
    if (!confirm(`Delete "${name}" and ALL its records? This cannot be undone.`)) return
    try { await apiFetch(`/admin/api/collections/${name}`, { method: 'DELETE' }); setSelected(null); refetch() }
    catch (e: any) { alert(e.message) }
  }

  if (loading) return <Spinner />
  if (error)   return <Err msg={error} />

  return (
    <div>
      <div class="ob-page-header">
        <div>
          <div class="ob-title">Collections</div>
          <div class="ob-subtitle">Manage your data schema and records</div>
        </div>
        <button class="ob-btn ob-btn-primary" onClick={() => setShowCreate(true)}>+ New collection</button>
      </div>

      <div class="ob-split">
        <div class="ob-col-sidebar">
          <div class="ob-card" style="padding:8px">
            {!cols?.length
              ? <div style="color:var(--muted);font-size:12px;padding:8px">No collections yet</div>
              : cols.map(c => (
                <button key={c.name}
                  class={`ob-collection-item${(selected ?? cols[0]?.name) === c.name ? ' active' : ''}`}
                  onClick={() => setSelected(c.name)}>
                  <span>{c.name}</span>
                  <span style="color:var(--muted);font-size:11px">{c.count}</span>
                </button>
              ))
            }
          </div>
        </div>

        <div class="ob-col-main">
          {activeDef
            ? <CollectionPanel def={activeDef} onEdit={() => setEditTarget(activeDef)}
                onDelete={() => handleDelete(activeDef.name)} onRefresh={refetch} />
            : <div class="ob-card ob-empty">Select a collection or create one</div>
          }
        </div>
      </div>

      {showCreate && <CollectionModal onClose={() => setShowCreate(false)} onSave={refetch} />}
      {editTarget && <CollectionModal initial={editTarget} onClose={() => setEditTarget(null)} onSave={refetch} />}
    </div>
  )
}

// ─── User modal (create / edit) ───────────────────────────────────────────────

function UserModal({ user, onClose, onSave }: {
  user?:    any
  onClose:  () => void
  onSave:   () => void
}) {
  const isEdit = !!user
  const [email,    setEmail]    = useState(user?.email    ?? '')
  const [password, setPassword] = useState('')
  const [role,     setRole]     = useState(user?.role     ?? 'user')
  const [verified, setVerified] = useState(user?.verified ?? false)
  const [error,    setError]    = useState('')
  const [saving,   setSaving]   = useState(false)

  async function handleSave() {
    setError('')
    if (!email.includes('@'))           { setError('Valid email required'); return }
    if (!isEdit && password.length < 8) { setError('Password must be at least 8 characters'); return }

    setSaving(true)
    try {
      if (isEdit) {
        await apiFetch(`/admin/api/users/${user.id}`, {
          method: 'PATCH',
          body:   JSON.stringify({
            role, verified,
            ...(password ? { password } : {}),
          }),
        })
      } else {
        await apiFetch('/admin/api/users', {
          method: 'POST',
          body:   JSON.stringify({ email, password, role }),
        })
      }
      onSave(); onClose()
    } catch (e: any) { setError(e.message) }
    finally { setSaving(false) }
  }

  return (
    <Modal title={isEdit ? `Edit — ${user.email}` : 'New User'} onClose={onClose}>
      <div class="ob-field-row">
        <label class="ob-label">Email</label>
        <input class="ob-input" type="email" placeholder="user@example.com"
          value={email} onInput={(e: any) => setEmail(e.target.value)}
          disabled={isEdit} style={isEdit ? 'opacity:.5' : ''} />
      </div>

      <div class="ob-field-row">
        <label class="ob-label">{isEdit ? 'New password (leave blank to keep current)' : 'Password *'}</label>
        <input class="ob-input" type="password" placeholder="••••••••"
          value={password} onInput={(e: any) => setPassword(e.target.value)} />
      </div>

      <div class="ob-field-row">
        <label class="ob-label">Role</label>
        <select class="ob-select" value={role} onChange={(e: any) => setRole(e.target.value)}>
          <option value="user">user</option>
          <option value="admin">admin</option>
        </select>
      </div>

      {isEdit && (
        <div class="ob-field-row" style="display:flex;align-items:center;gap:8px">
          <input type="checkbox" id="ob-verified" checked={verified}
            onChange={(e: any) => setVerified(e.target.checked)} />
          <label for="ob-verified" style="color:var(--text);font-size:13px;cursor:pointer">
            Verified
          </label>
        </div>
      )}

      {error && <Err msg={error} />}

      <div class="ob-btn-row">
        <button class="ob-btn ob-btn-ghost" onClick={onClose}>Cancel</button>
        <button class="ob-btn ob-btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create user'}
        </button>
      </div>
    </Modal>
  )
}

// ─── Users page ───────────────────────────────────────────────────────────────

function Users() {
  const { data, loading, error, refetch } = useAsync(() => apiFetch<any>('/admin/api/users'))
  const [showCreate, setShowCreate] = useState(false)
  const [editUser,   setEditUser]   = useState<any | null>(null)

  async function handleDelete(u: any) {
    if (!confirm(`Delete user "${u.email}"? This cannot be undone.`)) return
    try {
      await apiFetch(`/admin/api/users/${u.id}`, { method: 'DELETE' })
      refetch()
    } catch (e: any) { alert(e.message) }
  }

  if (loading) return <Spinner />
  if (error)   return <Err msg={error} />

  return (
    <div>
      <div class="ob-page-header">
        <div>
          <div class="ob-title">Users</div>
          <div class="ob-subtitle">{data.total} registered users</div>
        </div>
        <button class="ob-btn ob-btn-primary" onClick={() => setShowCreate(true)}>+ New user</button>
      </div>

      <div class="ob-table-wrap">
        <OTable
          headers={['ID', 'Email', 'Role', 'Verified', 'Created', 'Actions']}
          empty="No users yet"
          rows={(data.items ?? []).map((u: any) => [
            <span style="font-family:monospace;font-size:10px;color:var(--muted)">{u.id.slice(0, 8)}…</span>,
            u.email,
            <Badge color={u.role === 'admin' ? 'indigo' : 'gray'}>{u.role}</Badge>,
            <Badge color={u.verified ? 'green' : 'gray'}>{u.verified ? 'yes' : 'no'}</Badge>,
            <span style="color:var(--muted);font-size:10px">{new Date(u.created_at).toLocaleString()}</span>,
            <div class="ob-actions">
              <button class="ob-btn ob-btn-ghost ob-btn-sm" onClick={() => setEditUser(u)}>Edit</button>
              <button class="ob-btn ob-btn-danger ob-btn-sm" onClick={() => handleDelete(u)}>Delete</button>
            </div>,
          ])}
        />
      </div>

      {showCreate && <UserModal onClose={() => setShowCreate(false)} onSave={refetch} />}
      {editUser   && <UserModal user={editUser} onClose={() => setEditUser(null)} onSave={refetch} />}
    </div>
  )
}

// ─── Login page ───────────────────────────────────────────────────────────────

function Login({ onLogin }: { onLogin: () => void }) {
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)
  const pwdRef = useRef<HTMLInputElement>(null)

  async function handleLogin() {
    if (!email || !password) { setError('Email and password are required'); return }
    setLoading(true); setError('')
    try {
      const res = await apiFetch<any>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
      setToken(res.token)
      onLogin()
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }

  return (
    <div class="ob-login-wrap">
      <div class="ob-login-box">
        <div class="ob-login-logo">⬡ OneBase</div>
        <div class="ob-login-sub">Sign in to your admin panel</div>
        <div class="ob-field-row">
          <label class="ob-label">Email</label>
          <input class="ob-input" type="email" autoFocus placeholder="admin@example.com"
            value={email} onInput={(e: any) => setEmail(e.target.value)}
            onKeyDown={(e: any) => e.key === 'Enter' && pwdRef.current?.focus()} />
        </div>
        <div class="ob-field-row">
          <label class="ob-label">Password</label>
          <input class="ob-input" type="password" ref={pwdRef} placeholder="••••••••"
            value={password} onInput={(e: any) => setPassword(e.target.value)}
            onKeyDown={(e: any) => e.key === 'Enter' && handleLogin()} />
        </div>
        {error && <Err msg={error} />}
        <button class="ob-btn ob-btn-primary" style="width:100%;justify-content:center;margin-top:8px"
          onClick={handleLogin} disabled={loading}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </div>
    </div>
  )
}

// ─── App ──────────────────────────────────────────────────────────────────────

type Page = 'dashboard' | 'collections' | 'users'

function App() {
  const [authed, setAuthed] = useState(!!_token)
  const [page,   setPage]   = useState<Page>('dashboard')

  if (!authed) return <Login onLogin={() => setAuthed(true)} />

  async function handleLogout() {
    try { await apiFetch('/api/auth/logout', { method: 'POST' }) } catch {}
    setToken(null); setAuthed(false)
  }

  const nav = [
    { id: 'dashboard'   as Page, label: 'Dashboard',   icon: '⬡' },
    { id: 'collections' as Page, label: 'Collections', icon: '⊞' },
    { id: 'users'       as Page, label: 'Users',       icon: '◎' },
  ]

  return (
    <div class="ob-layout">
      <aside class="ob-sidebar">
        <div class="ob-logo">⬡ <span>OneBase</span><span class="ob-logo-sub">admin</span></div>
        <nav class="ob-nav">
          {nav.map(item => (
            <button key={item.id} class={`ob-nav-link${page === item.id ? ' active' : ''}`}
              onClick={() => setPage(item.id)}>
              <span style="width:18px;text-align:center">{item.icon}</span> {item.label}
            </button>
          ))}
        </nav>
        <button class="ob-logout" onClick={handleLogout}>⎋ Sign out</button>
      </aside>
      <main class="ob-main">
        {page === 'dashboard'   && <Dashboard />}
        {page === 'collections' && <Collections />}
        {page === 'users'       && <Users />}
      </main>
    </div>
  )
}

// ─── Mount ────────────────────────────────────────────────────────────────────

const styleEl = document.createElement('style')
styleEl.textContent = css
document.head.appendChild(styleEl)

render(<App />, document.getElementById('app')!)
