import { useState } from 'react'
import { ChevronRight, RefreshCw } from 'lucide-react'
import { api } from '../api.ts'
import { useAsync } from '../hooks/useAsync.ts'
import { Badge, Button, Card, PageHeader, Spinner, ErrorMessage, Table } from '../components/ui.tsx'
import type { CollectionDef } from '../api.ts'

export function Collections() {
  const { data: collections, loading, error, refetch } = useAsync(() => api.collections())
  const [selected, setSelected] = useState<string | null>(null)

  if (loading) return <Spinner />
  if (error)   return <ErrorMessage message={error} />
  if (!collections) return null

  const activeDef = collections.find(c => c.name === selected) ?? collections[0] ?? null

  return (
    <div>
      <PageHeader
        title="Collections"
        subtitle="Browse and inspect your data collections"
        action={<Button variant="ghost" size="sm" onClick={refetch}><RefreshCw size={13} /> Refresh</Button>}
      />

      <div style={{ display: 'flex', gap: 20 }}>
        {/* Sidebar list */}
        <div style={{ width: 200, flexShrink: 0 }}>
          <Card style={{ padding: 8 }}>
            {collections.length === 0 ? (
              <p style={{ color: '#6b7280', fontSize: 13, padding: 8 }}>No collections yet</p>
            ) : collections.map(c => (
              <button
                key={c.name}
                onClick={() => setSelected(c.name)}
                style={{
                  display:        'flex',
                  alignItems:     'center',
                  justifyContent: 'space-between',
                  width:          '100%',
                  padding:        '8px 10px',
                  background:     (selected ?? collections[0]?.name) === c.name ? 'rgba(99,102,241,.12)' : 'transparent',
                  border:         'none',
                  borderRadius:   6,
                  color:          (selected ?? collections[0]?.name) === c.name ? '#e2e4f0' : '#9ca3af',
                  cursor:         'pointer',
                  fontSize:       13,
                  textAlign:      'left',
                }}
              >
                <span>{c.name}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ color: '#6b7280', fontSize: 11 }}>{c.count}</span>
                  <ChevronRight size={12} />
                </span>
              </button>
            ))}
          </Card>
        </div>

        {/* Main panel */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {activeDef ? (
            <CollectionPanel def={activeDef} />
          ) : (
            <Card>
              <p style={{ color: '#6b7280', fontSize: 13 }}>Select a collection</p>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

function CollectionPanel({ def }: { def: CollectionDef }) {
  const [page,   setPage]   = useState(0)
  const limit = 20

  const { data, loading, error, refetch } = useAsync(
    () => api.records(def.name, limit, page * limit),
    [def.name, page],
  )

  const fieldNames = Object.keys(def.fields)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Schema */}
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.05em' }}>
            Schema — {def.name}
          </h2>
          <Badge color="gray">{def.count} records</Badge>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {fieldNames.map(name => {
            const f = def.fields[name]
            return (
              <div key={name} style={{
                background:   '#0f1117',
                border:       '1px solid #2a2d3a',
                borderRadius: 6,
                padding:      '5px 10px',
                fontSize:     12,
              }}>
                <span style={{ color: '#e2e4f0' }}>{name}</span>
                <span style={{ color: '#6b7280', marginLeft: 6 }}>{f.type}</span>
                {f.required && <span style={{ color: '#6366f1', marginLeft: 4 }}>*</span>}
              </div>
            )
          })}
        </div>
      </Card>

      {/* Records */}
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.05em' }}>
            Records
          </h2>
          <Button variant="ghost" size="sm" onClick={refetch}>
            <RefreshCw size={12} /> Refresh
          </Button>
        </div>

        {loading && <Spinner />}
        {error   && <ErrorMessage message={error} />}

        {data && (
          <>
            <Table
              headers={['id', ...fieldNames, 'created_at']}
              emptyMessage="No records yet"
              rows={data.items.map(row => [
                <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#6b7280' }}>
                  {String(row.id).slice(0, 8)}…
                </span>,
                ...fieldNames.map(f => {
                  const val = row[f]
                  if (val === null || val === undefined) return <span style={{ color: '#4b5563' }}>—</span>
                  if (typeof val === 'boolean') return <Badge color={val ? 'green' : 'gray'}>{String(val)}</Badge>
                  return String(val).slice(0, 40)
                }),
                <span style={{ color: '#6b7280', fontSize: 11 }}>
                  {new Date(String(row.created_at)).toLocaleString()}
                </span>,
              ])}
            />

            {/* Pagination */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 }}>
              <span style={{ color: '#6b7280', fontSize: 13 }}>
                {page * limit + 1}–{Math.min((page + 1) * limit, data.total)} of {data.total}
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                  ← Prev
                </Button>
                <Button variant="ghost" size="sm" disabled={(page + 1) * limit >= data.total} onClick={() => setPage(p => p + 1)}>
                  Next →
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  )
}
