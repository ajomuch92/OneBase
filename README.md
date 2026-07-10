# OneBase

> Backend as a Service — TypeScript first, single binary.

Like Pocketbase, but for the TypeScript ecosystem. Define your schema in TypeScript, get a REST API, realtime WebSockets, typed SDK, and an admin UI — all from a single binary.

## Quick start

```bash
bun install
bun dev
```

Server starts at `http://localhost:3000`. Admin UI at `/admin`.

## Database

OneBase supports SQLite (default), MySQL, and PostgreSQL. Configure the
engine via environment variables — copy `.env.example` to `.env` and set:

```bash
# SQLite (default) — nothing else required
ONEBASE_DB_CLIENT=sqlite
ONEBASE_DB_PATH=./onebase.db

# MySQL
ONEBASE_DB_CLIENT=mysql
ONEBASE_DB_URL=mysql://user:password@localhost:3306/onebase
# ...or ONEBASE_DB_HOST/PORT/USER/PASSWORD/NAME/SSL individually

# PostgreSQL
ONEBASE_DB_CLIENT=postgres
ONEBASE_DB_URL=postgres://user:password@localhost:5432/onebase
# ...or ONEBASE_DB_HOST/PORT/USER/PASSWORD/NAME/SSL individually
```

Bun loads `.env` automatically — no extra package needed. See
`.env.example` for the full list of variables.

## Define a collection

```typescript
// schema/posts.ts
import { defineCollection } from "../src/index.ts";

export const posts = defineCollection({
  name: "posts",
  fields: {
    title: { type: "string", required: true },
    body: { type: "text" },
    published: { type: "boolean", default: false },
  },

  hooks: {
    beforeCreate: async (data, ctx) => {
      // Modify data before insert — fully typed
      return data;
    },
  },
});
```

That's it. OneBase automatically creates:

- `GET    /api/posts` — list with filtering, sorting, pagination
- `GET    /api/posts/:id` — get one
- `POST   /api/posts` — create
- `PATCH  /api/posts/:id` — update
- `DELETE /api/posts/:id` — delete
- WebSocket events for all CRUD operations

## Generate typed SDK

```bash
bun run generate
```

Outputs `sdk/index.ts` with full TypeScript types for your collections:

```typescript
import OneBase from "./sdk/index.ts";

const client = new OneBase("http://localhost:3000");
await client.login("me@example.com", "password");

// Fully typed — TypeScript knows the shape of posts
const { items } = await client.posts.list({ filter: { published: true } });

// Realtime subscription
const unsubscribe = client.posts.subscribe((event, record) => {
  console.log(event, record); // 'create' | 'update' | 'delete'
});
```

## Auth

```
POST /api/auth/register   { email, password }
POST /api/auth/login      { email, password }  → { token, user }
POST /api/auth/logout
GET  /api/auth/me
POST /api/auth/change-password
```

## CLI

```bash
OneBase start              # Start server
OneBase generate           # Generate SDK
OneBase migrate            # Sync schema to DB
OneBase info               # List collections and plugins
OneBase start --port 8080  # Custom port
OneBase start --db /data/app.db  # Custom DB path
```

## Build single binary

```bash
bun run build
# → ./OneBase  (single executable, no runtime needed)
```

## Write a plugin

```typescript
import { registerPlugin } from "../src/index.ts";

registerPlugin({
  name: "audit-log",
  version: "1.0.0",

  async setup(api) {
    // runs once on startup
  },

  hooks: {
    afterCreate: async (collection, record, ctx) => {
      console.log(`[audit] ${ctx.userId} created in ${collection}`);
    },
  },
});
```

## Project structure

```
OneBase/
├── src/
│   ├── core/
│   │   ├── db.ts            SQLite + Drizzle, system tables
│   │   ├── collections.ts   Dynamic CRUD engine
│   │   ├── auth.ts          JWT + sessions
│   │   ├── router.ts        Hono + auto-generated routes
│   │   └── realtime.ts      WebSocket pub/sub
│   ├── api/
│   │   ├── rest.ts          Auth endpoints
│   │   ├── sdk-gen.ts       SDK generator
│   │   └── admin/           Admin UI
│   ├── plugins/
│   │   ├── loader.ts        Plugin registry + hook runner
│   │   └── types.ts         Plugin interfaces
│   ├── cli/
│   │   └── index.ts         CLI entry point
│   └── index.ts             Public API exports
├── schema/                  Your collections go here
├── migrations/              Auto-generated
└── sdk/                     Auto-generated TypeScript SDK
```

## Stack

- **Runtime**: [Bun](https://bun.sh) — fast runtime, SQLite built-in, single binary output
- **HTTP**: [Hono](https://hono.dev) — lightweight, fast, TypeScript-first
- **DB**: [Drizzle ORM](https://orm.drizzle.team) for system tables + raw SQLite for dynamic collections
- **Auth**: JWT via `jsonwebtoken` + bcrypt password hashing

## Roadmap

- [ ] Schema diffing + ALTER TABLE migrations
- [ ] File uploads
- [ ] OAuth2 providers
- [ ] Row-level permissions
- [ ] Postgres adapter
- [ ] Plugin marketplace
