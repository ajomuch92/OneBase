import { Badge, Card, PageHeader } from "../components/ui.tsx";

import { Plug } from "lucide-react";

// Plugins page — static for now, will pull from /admin/api/plugins once backend exposes it

export function Plugins() {
  return (
    <div>
      <PageHeader title="Plugins" subtitle="Registered plugins and hooks" />

      <Card>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            padding: "40px 0",
            gap: 12,
          }}
        >
          <Plug size={32} color="#2a2d3a" />
          <p style={{ color: "#6b7280", fontSize: 14 }}>
            Plugin dashboard coming soon
          </p>
          <p
            style={{
              color: "#4b5563",
              fontSize: 12,
              textAlign: "center",
              maxWidth: 300,
            }}
          >
            Register plugins via{" "}
            <code style={{ color: "#818cf8" }}>registerPlugin()</code> in your
            schema files. They'll appear here once the backend exposes the
            plugin API.
          </p>
          <Badge color="indigo">OneBase 0.2.0</Badge>
        </div>
      </Card>
    </div>
  );
}
