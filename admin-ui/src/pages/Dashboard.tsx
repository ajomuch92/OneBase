import {
  Badge,
  Card,
  ErrorMessage,
  PageHeader,
  Spinner,
  StatCard,
  Table,
} from "../components/ui.tsx";
import { Database, FileText, TrendingUp, Wifi } from "lucide-react";

import { api } from "../api.ts";
import { useAsync } from "../hooks/useAsync.ts";

export function Dashboard() {
  const { data: stats, loading, error } = useAsync(() => api.stats());

  if (loading) return <Spinner />;
  if (error) return <ErrorMessage message={error} />;
  if (!stats) return null;

  const totalRecords = stats.collections.reduce((s, c) => s + c.count, 0);

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Overview of your OneBase instance"
      />

      {/* Stat cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))",
          gap: 16,
          marginBottom: 32,
        }}
      >
        <StatCard
          label="Collections"
          value={stats.collections.length}
          icon={<Database size={16} />}
        />
        <StatCard
          label="Total records"
          value={totalRecords}
          icon={<FileText size={16} />}
        />
        <StatCard
          label="Live connections"
          value={stats.realtimeConnections}
          icon={<Wifi size={16} />}
        />
        <StatCard
          label="Avg records/col"
          value={
            stats.collections.length
              ? Math.round(totalRecords / stats.collections.length)
              : 0
          }
          icon={<TrendingUp size={16} />}
        />
      </div>

      {/* Collections table */}
      <Card>
        <h2
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: "#6b7280",
            textTransform: "uppercase",
            letterSpacing: ".05em",
            marginBottom: 16,
          }}
        >
          Collections
        </h2>
        <Table
          headers={["Name", "Records", "Status"]}
          emptyMessage="No collections defined yet. Add files to /schema."
          rows={stats.collections.map((c) => [
            <Badge color="indigo">{c.name}</Badge>,
            c.count.toLocaleString(),
            <Badge color="green">active</Badge>,
          ])}
        />
      </Card>
    </div>
  );
}
