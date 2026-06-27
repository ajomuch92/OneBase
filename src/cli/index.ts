#!/usr/bin/env bun

import { parseArgs } from "util";

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    port: { type: "string", short: "p", default: "3000" },
    host: { type: "string", short: "h", default: "0.0.0.0" },
    db: { type: "string", default: "./OneBase.db" },
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
  OneBase start     Start the server (default)
  OneBase generate  Generate TypeScript SDK from schema
  OneBase migrate   Run pending migrations
  OneBase info      Print registered collections and plugins

Options:
  -p, --port    Port to listen on (default: 3000)
  -h, --host    Host to bind (default: 0.0.0.0)
  --db          SQLite database path (default: ./OneBase.db)
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
      `[OneBase] No schema directory found at "${schemaDir}" — starting with no collections`,
    );
    return;
  }

  const files = fs
    .readdirSync(schemaDir)
    .filter((f) => f.endsWith(".ts") || f.endsWith(".js"));
  for (const file of files) {
    const abs = path.resolve(schemaDir, file);
    await import(abs);
    console.log(`[OneBase] Schema loaded: ${file}`);
  }
}

// ─── Commands ─────────────────────────────────────────────────────────────────

if (command === "start") {
  const { initDB } = await import("../core/db.ts");
  const { syncCollections } = await import("../core/collections.ts");
  const { pluginRunner } = await import("../plugins/loader.ts");
  const { createApp } = await import("../core/router.ts");

  const db = initDB(values.db);
  const { initUploads } = await import("../core/uploads.ts");
  initUploads();

  await loadSchema(values.schema);
  await syncCollections();
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
╔═══════════════════════════════════╗
║  OneBase is running               ║
║                                   ║
║  API     → http://localhost:${port}  ║
║  Admin   → http://localhost:${port}/admin ║
║  Health  → http://localhost:${port}/health ║
╚═══════════════════════════════════╝
`);

  // Graceful shutdown
  process.on("SIGINT", () => {
    console.log("\n[OneBase] Shutting down...");
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
  // TODO: full migration runner (diffing + ALTER TABLE)
  const { initDB } = await import("../core/db.ts");
  const { syncCollections } = await import("../core/collections.ts");

  initDB(values.db);
  await loadSchema(values.schema);
  await syncCollections();

  console.log("[OneBase] Migrations applied ✓");
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
  console.error(`Unknown command: "${command}". Run OneBase help for usage.`);
  process.exit(1);
}
