import { Button, ErrorMessage, Input } from "../components/ui.tsx";

import { Zap } from "lucide-react";
import { api } from "../api.ts";
import { useNavigate } from "react-router-dom";
import { useState } from "react";

export function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    if (!email || !password) {
      setError("Email and password are required");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await api.login(email, password);
      navigate("/dashboard");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        background: "#0f1117",
      }}
    >
      <div
        style={{
          background: "#1a1d27",
          border: "1px solid #2a2d3a",
          borderRadius: 14,
          padding: 40,
          width: 360,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 8,
          }}
        >
          <Zap size={20} color="#818cf8" />
          <span style={{ fontSize: 20, fontWeight: 700 }}>OneBase</span>
        </div>
        <p style={{ color: "#6b7280", fontSize: 13, marginBottom: 28 }}>
          Sign in to your admin panel
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label
              style={{
                display: "block",
                color: "#6b7280",
                fontSize: 12,
                marginBottom: 6,
              }}
            >
              Email
            </label>
            <Input
              type="email"
              placeholder="admin@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            />
          </div>

          <div>
            <label
              style={{
                display: "block",
                color: "#6b7280",
                fontSize: 12,
                marginBottom: 6,
              }}
            >
              Password
            </label>
            <Input
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            />
          </div>

          {error && <ErrorMessage message={error} />}

          <Button onClick={handleLogin} disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </Button>
        </div>
      </div>
    </div>
  );
}
