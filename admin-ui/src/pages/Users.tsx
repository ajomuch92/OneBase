import { useAsync } from '../hooks/useAsync.ts'
import { api } from '../api.ts'
import { Badge, Card, PageHeader, Spinner, ErrorMessage, Table } from '../components/ui.tsx'

export function Users() {
  const { data, loading, error } = useAsync(() => api.records('_just_users', 50, 0))

  if (loading) return <Spinner />
  if (error)   return <ErrorMessage message={error} />

  const users = data?.items ?? []

  return (
    <div>
      <PageHeader
        title="Users"
        subtitle={`${data?.total ?? 0} registered users`}
      />

      <Card>
        <Table
          headers={['ID', 'Email', 'Role', 'Verified', 'Created']}
          emptyMessage="No users yet. Register via POST /api/auth/register"
          rows={users.map(u => [
            <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#6b7280' }}>
              {String(u.id).slice(0, 8)}…
            </span>,
            String(u.email),
            <Badge color={u.role === 'admin' ? 'indigo' : 'gray'}>{String(u.role)}</Badge>,
            <Badge color={u.verified ? 'green' : 'gray'}>{u.verified ? 'yes' : 'no'}</Badge>,
            <span style={{ color: '#6b7280', fontSize: 11 }}>
              {new Date(String(u.created_at)).toLocaleString()}
            </span>,
          ])}
        />
      </Card>
    </div>
  )
}
