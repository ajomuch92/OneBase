import {
  Database,
  LayoutDashboard,
  LogOut,
  Plug,
  Users,
  Zap,
} from "lucide-react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";

import { api } from "../api.ts";

const navItems = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/collections", label: "Collections", icon: Database },
  { to: "/users", label: "Users", icon: Users },
  { to: "/plugins", label: "Plugins", icon: Plug },
];

export function Layout() {
  const navigate = useNavigate();

  async function handleLogout() {
    await api.logout();
    navigate("/login");
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <aside style={styles.aside}>
        <div style={styles.logo}>
          <Zap size={18} color="#818cf8" />
          <span style={{ color: "#818cf8", fontWeight: 700, fontSize: 18 }}>
            OneBase
          </span>
          <span style={{ color: "#6b7280", fontSize: 11, marginTop: 2 }}>
            admin
          </span>
        </div>

        <nav style={{ flex: 1 }}>
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              style={({ isActive }) => ({
                ...styles.navLink,
                color: isActive ? "#e2e4f0" : "#6b7280",
                background: isActive ? "rgba(99,102,241,.12)" : "transparent",
                borderRight: isActive
                  ? "2px solid #6366f1"
                  : "2px solid transparent",
              })}
            >
              <Icon size={15} />
              {label}
            </NavLink>
          ))}
        </nav>

        <button onClick={handleLogout} style={styles.logoutBtn}>
          <LogOut size={14} />
          Sign out
        </button>
      </aside>

      <main style={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}

const styles = {
  aside: {
    width: 220,
    background: "#1a1d27",
    borderRight: "1px solid #2a2d3a",
    display: "flex",
    flexDirection: "column" as const,
    flexShrink: 0,
  },
  logo: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "flex-start",
    gap: 2,
    padding: "24px 20px 20px",
    borderBottom: "1px solid #2a2d3a",
    marginBottom: 8,
  },
  navLink: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "9px 20px",
    textDecoration: "none",
    fontSize: 14,
    transition: "all .15s",
  },
  logoutBtn: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "12px 20px",
    background: "none",
    border: "none",
    color: "#6b7280",
    cursor: "pointer",
    fontSize: 14,
    borderTop: "1px solid #2a2d3a",
    width: "100%",
  },
  main: {
    flex: 1,
    padding: 32,
    overflow: "auto",
  },
};
