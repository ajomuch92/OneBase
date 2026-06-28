#!/usr/bin/env bun

import { parseArgs } from "util";

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    port: { type: "string", short: "p", default: "3000" },
    host: { type: "string", short: "h", default: "0.0.0.0" },
    db: { type: "string", default: "./onebase.db" },
    schema: { type: "string", default: "./schema" },
    output: { type: "string", short: "o", default: "./sdk/index.ts" },
    help: { type: "boolean", default: false },
  },
  allowPositionals: true,
});

const command = positionals[0] ?? "start";

if (values.help || command === "help") {
  console.log(`
OneBase — Backend as a Service, TypeScript first

Usage:
  onebase start     Start the server (default)
  onebase generate  Generate TypeScript SDK from schema
  onebase migrate   Run pending migrations
  onebase info      Print registered collections and plugins

Options:
  -p, --port    Port to listen on (default: 3000)
  -h, --host    Host to bind (default: 0.0.0.0)
  --db          SQLite database path (default: ./onebase.db)
  --schema      Schema directory (default: ./schema)
  -o, --output  SDK output path for generate (default: ./sdk/index.ts)
`);
  process.exit(0);
}

// ─── Load user schema files ────────────────────────────────────────────────────

async function loadSchema(schemaDir: string) {
  const fs = await import("fs");
  const path = await import("path");

  if (!fs.existsSync(schemaDir)) {
    console.log(
      `[onebase] No schema directory found at "${schemaDir}" — starting with no collections`,
    );
    return;
  }

  const files = fs
    .readdirSync(schemaDir)
    .filter((f) => f.endsWith(".ts") || f.endsWith(".js"));
  for (const file of files) {
    const abs = path.resolve(schemaDir, file);
    await import(abs);
    console.log(`[onebase] Schema loaded: ${file}`);
  }
}

// ─── First-run: prompt for super admin creation ────────────────────────────────

async function ensureAdminExists() {
  const { getDB, usersTable } = await import("../core/db.ts");
  const { count } = await import("drizzle-orm");

  const db = getDB();
  const result = await db.select({ count: count() }).from(usersTable).get();
  const userCount = result?.count ?? 0;

  if (userCount > 0) return; // users already exist, skip

  console.log(`
┌─────────────────────────────────────────┐
│  Welcome to OneBase!                    │
│  No users found. Let's create your      │
│  first super admin account.             │
└─────────────────────────────────────────┘
`);

  // Check if credentials were passed via env (useful for Docker/CI)
  let email = process.env.ONEBASE_ADMIN_EMAIL ?? "";
  let password = process.env.ONEBASE_ADMIN_PASSWORD ?? "";

  if (email && password) {
    console.log(`[onebase] Creating admin from environment variables...`);
  } else {
    // Interactive prompt
    process.stdout.write("  Admin email:    ");
    email = await readLine();

    process.stdout.write("  Admin password: ");
    password = await readLine(true);
    console.log(); // newline after hidden input
  }

  // Basic validation
  if (!email.includes("@")) {
    console.error("  ✗ Invalid email address");
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("  ✗ Password must be at least 8 characters");
    process.exit(1);
  }

  const { authService } = await import("../core/auth.ts");
  await authService.register(email.trim(), password, "admin");

  console.log(`
  ✓ Super admin created: ${email.trim()}
  → Open http://localhost:${values.port}/admin to get started
`);
}

// ─── Read a line from stdin (with optional echo suppression) ──────────────────

async function readLine(hidden = false): Promise<string> {
  const readline = await import("readline");

  if (hidden) {
    try {
      Bun.spawnSync(["stty", "-echo"], { stdin: "inherit" });
    } catch {}
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  const value = await new Promise<string>((resolve) => {
    rl.once("line", (line) => {
      rl.close();
      resolve(line.trim());
    });
  });

  if (hidden) {
    try {
      Bun.spawnSync(["stty", "echo"], { stdin: "inherit" });
    } catch {}
    process.stdout.write("\n");
  }

  return value;
}

// ─── Commands ─────────────────────────────────────────────────────────────────

if (command === "start") {
  const { initDB } = await import("../core/db.ts");
  const { syncCollections } = await import("../core/collections.ts");
  const { pluginRunner } = await import("../plugins/loader.ts");
  const { createApp } = await import("../core/router.ts");
  const { initUploads } = await import("../core/uploads.ts");

  initDB(values.db);
  initUploads();

  await loadSchema(values.schema);
  await syncCollections();
  await ensureAdminExists(); // ← first-run check
  await pluginRunner.setup();

  const app = createApp();
  const port = Number(values.port);

  const server = Bun.serve({
    port,
    hostname: values.host,
    fetch: app.fetch,
    websocket: {
      message() {},
      open() {},
      close() {},
    },
  });

  console.log(`
╔══════════════════════════════════════════╗
║  OneBase is running                      ║
║                                          ║
║  API    →  http://localhost:${port}         ║
║  Admin  →  http://localhost:${port}/admin   ║
║  Health →  http://localhost:${port}/health  ║
╚══════════════════════════════════════════╝
`);

  process.on("SIGINT", () => {
    console.log("\n[onebase] Shutting down...");
    server.stop();
    process.exit(0);
  });
} else if (command === "generate") {
  const { initDB } = await import("../core/db.ts");
  const { writeSDK } = await import("../api/sdk-gen.ts");

  initDB(values.db);
  await loadSchema(values.schema);
  await writeSDK(values.output);
  process.exit(0);
} else if (command === "migrate") {
  const { initDB } = await import("../core/db.ts");
  const { syncCollections } = await import("../core/collections.ts");

  initDB(values.db);
  await loadSchema(values.schema);
  await syncCollections();

  console.log("[onebase] Migrations applied ✓");
  process.exit(0);
} else if (command === "info") {
  const { initDB } = await import("../core/db.ts");
  const { getAllCollectionDefs } = await import("../core/collections.ts");
  const { pluginRunner } = await import("../plugins/loader.ts");

  initDB(values.db);
  await loadSchema(values.schema);

  console.log("\nCollections:");
  getAllCollectionDefs().forEach((d) => {
    console.log(`  • ${d.name} (${Object.keys(d.fields).length} fields)`);
  });

  console.log("\nPlugins:");
  pluginRunner.registeredPlugins.forEach((p) => {
    console.log(`  • ${p.name}@${p.version}`);
  });

  process.exit(0);
} else {
  console.error(`Unknown command: "${command}". Run onebase help for usage.`);
  process.exit(1);
}
