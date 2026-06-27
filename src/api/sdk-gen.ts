import type { FieldDefinition } from "../core/db.ts";
import { getAllCollectionDefs } from "../core/collections.ts";

// ─── Type mapping ─────────────────────────────────────────────────────────────

function fieldToTSType(field: FieldDefinition): string {
  const typeMap: Record<string, string> = {
    string: "string",
    text: "string",
    number: "number",
    boolean: "boolean",
    date: "string",
    datetime: "string",
    json: "Record<string, unknown>",
    relation: "string",
    file: "string",
  };
  return typeMap[field.type] ?? "unknown";
}

// ─── Generate SDK source ───────────────────────────────────────────────────────

export function generateSDK(baseUrl = "http://localhost:3000"): string {
  const defs = getAllCollectionDefs();

  const interfaces = defs
    .map((def) => {
      const fields = Object.entries(def.fields)
        .map(([name, field]) => {
          const tsType = fieldToTSType(field);
          const optional = !field.required ? "?" : "";
          return `  ${name}${optional}: ${tsType}`;
        })
        .join("\n");

      return `
export interface ${capitalize(def.name)}Record {
  id: string
${fields}
  created_at: string
  updated_at: string
}

export interface Create${capitalize(def.name)}Input {
${Object.entries(def.fields)
  .map(([name, field]) => {
    const tsType = fieldToTSType(field);
    const optional = !field.required ? "?" : "";
    return `  ${name}${optional}: ${tsType}`;
  })
  .join("\n")}
}

export type Update${capitalize(def.name)}Input = Partial<Create${capitalize(def.name)}Input>
`;
    })
    .join("\n");

  const collectionClients = defs
    .map((def) => {
      const Name = capitalize(def.name);
      return `
  get ${def.name}() {
    return createCollectionClient<${Name}Record, Create${capitalize(def.name)}Input>('${def.name}', this)
  }`;
    })
    .join("\n");

  return `
// ─────────────────────────────────────────────────────────────────────────────
// OneBaseSDK — auto-generated, do not edit
// ─────────────────────────────────────────────────────────────────────────────

${interfaces}

// ─── Query options ────────────────────────────────────────────────────────────

export interface ListOptions {
  filter?: Record<string, string | number | boolean>
  sort?:   string
  order?:  'asc' | 'desc'
  limit?:  number
  offset?: number
}

export interface ListResult<T> {
  items:  T[]
  total:  number
  limit:  number
  offset: number
}

// ─── Collection client ────────────────────────────────────────────────────────

function createCollectionClient<T, CreateInput>(
  collection: string,
  sdk: OneBaseSDK,
) {
  return {
    async list(opts: ListOptions = {}): Promise<ListResult<T>> {
      const qs = new URLSearchParams()
      if (opts.limit)  qs.set('limit',  String(opts.limit))
      if (opts.offset) qs.set('offset', String(opts.offset))
      if (opts.sort)   qs.set('sort',   opts.sort)
      if (opts.order)  qs.set('order',  opts.order)
      if (opts.filter) {
        for (const [k, v] of Object.entries(opts.filter)) qs.set(k, String(v))
      }
      return sdk.fetch(\`/api/\${collection}?\${qs}\`)
    },

    async getById(id: string): Promise<T> {
      return sdk.fetch(\`/api/\${collection}/\${id}\`)
    },

    async create(data: CreateInput): Promise<T> {
      return sdk.fetch(\`/api/\${collection}\`, {
        method: 'POST',
        body:   JSON.stringify(data),
      })
    },

    async update(id: string, data: Partial<CreateInput>): Promise<T> {
      return sdk.fetch(\`/api/\${collection}/\${id}\`, {
        method: 'PATCH',
        body:   JSON.stringify(data),
      })
    },

    async delete(id: string): Promise<{ ok: boolean }> {
      return sdk.fetch(\`/api/\${collection}/\${id}\`, { method: 'DELETE' })
    },

    subscribe(
      callback: (event: 'create' | 'update' | 'delete', record: T) => void,
    ): () => void {
      return sdk.subscribe(collection, callback)
    },
  }
}

// ─── Main SDK class ───────────────────────────────────────────────────────────

export class OneBaseSDK {
  private baseUrl: string
  private token:   string | null = null
  private ws:      WebSocket | null = null
  private subs:    Map<string, ((event: string, record: unknown) => void)[]> = new Map()

  constructor(baseUrl = '${baseUrl}') {
    this.baseUrl = baseUrl.replace(/\\/$/, '')
  }

  // ── Auth ────────────────────────────────────────────────────────────────

  async login(email: string, password: string) {
    const res = await this.fetch<{ token: string; user: unknown }>('/api/auth/login', {
      method: 'POST',
      body:   JSON.stringify({ email, password }),
    })
    this.token = res.token
    return res
  }

  async logout() {
    await this.fetch('/api/auth/logout', { method: 'POST' })
    this.token = null
    this.ws?.close()
  }

  setToken(token: string) { this.token = token }

  // ── HTTP ────────────────────────────────────────────────────────────────

  async fetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(init.headers as Record<string, string> ?? {}),
    }
    if (this.token) headers['Authorization'] = \`Bearer \${this.token}\`

    const res = await globalThis.fetch(\`\${this.baseUrl}\${path}\`, {
      ...init,
      headers,
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }))
      throw new Error((err as { error: string }).error ?? res.statusText)
    }

    return res.json() as Promise<T>
  }

  // ── Realtime ─────────────────────────────────────────────────────────────

  subscribe<T>(
    collection: string,
    callback: (event: 'create' | 'update' | 'delete', record: T) => void,
  ): () => void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.connectWS()
    }

    const listeners = this.subs.get(collection) ?? []
    listeners.push(callback as (event: string, record: unknown) => void)
    this.subs.set(collection, listeners)

    this.ws?.send(JSON.stringify({ type: 'subscribe', collections: [collection] }))

    return () => {
      const updated = (this.subs.get(collection) ?? [])
        .filter(cb => cb !== (callback as (event: string, record: unknown) => void))
      this.subs.set(collection, updated)
    }
  }

  private connectWS() {
    const wsUrl = this.baseUrl.replace(/^http/, 'ws') + '/realtime'
    this.ws = new WebSocket(wsUrl + (this.token ? \`?token=\${this.token}\` : ''))

    this.ws.addEventListener('message', (e) => {
      try {
        const msg = JSON.parse(e.data)
        const listeners = this.subs.get(msg.collection) ?? []
        listeners.forEach(cb => cb(msg.event, msg.record))
      } catch {}
    })

    this.ws.addEventListener('close', () => {
      setTimeout(() => this.connectWS(), 2000)
    })
  }

  // ── Collection accessors (auto-generated) ───────────────────────────────
${collectionClients}
}

export default OneBaseSDK
`.trim();
}

// ─── Write SDK to disk ────────────────────────────────────────────────────────

export async function writeSDK(
  outputPath = "./sdk/index.ts",
  baseUrl?: string,
) {
  const src = generateSDK(baseUrl);
  await Bun.write(outputPath, src);
  console.log(`✓ SDK generated → ${outputPath}`);
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
