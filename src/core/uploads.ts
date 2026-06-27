import { join, extname, basename } from 'path'
import { mkdirSync, existsSync, unlinkSync } from 'fs'
import { getSQLite } from './db.ts'

// ─── Config ───────────────────────────────────────────────────────────────────

const UPLOAD_DIR     = process.env.JUST_TS_UPLOAD_DIR  ?? './uploads'
const MAX_FILE_SIZE  = Number(process.env.JUST_TS_MAX_FILE_SIZE ?? 10 * 1024 * 1024)  // 10MB
const ALLOWED_TYPES  = (process.env.JUST_TS_ALLOWED_TYPES ?? '').split(',').filter(Boolean)

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UploadedFile {
  id:           string
  filename:     string          // original filename
  storedName:   string          // UUID-based name on disk
  path:         string          // relative path under UPLOAD_DIR
  url:          string          // public URL
  mimeType:     string
  size:         number          // bytes
  collection?:  string          // which collection this belongs to
  recordId?:    string          // which record this belongs to
  field?:       string          // which field on the record
  uploadedBy?:  string          // user id
  createdAt:    string
}

export interface UploadOptions {
  collection?: string
  recordId?:   string
  field?:      string
  userId?:     string
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

export function initUploads() {
  if (!existsSync(UPLOAD_DIR)) {
    mkdirSync(UPLOAD_DIR, { recursive: true })
  }

  getSQLite().run(`
    CREATE TABLE IF NOT EXISTS _just_files (
      id           TEXT PRIMARY KEY,
      filename     TEXT NOT NULL,
      stored_name  TEXT NOT NULL UNIQUE,
      path         TEXT NOT NULL,
      url          TEXT NOT NULL,
      mime_type    TEXT NOT NULL,
      size         INTEGER NOT NULL,
      collection   TEXT,
      record_id    TEXT,
      field        TEXT,
      uploaded_by  TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
  console.log(`[uploads] Storage ready at ${UPLOAD_DIR}`)
}

// ─── Upload service ───────────────────────────────────────────────────────────

export const uploadService = {

  // ── Handle multipart form upload ──────────────────────────────────────────

  async handleUpload(req: Request, opts: UploadOptions = {}): Promise<UploadedFile[]> {
    const contentType = req.headers.get('content-type') ?? ''
    if (!contentType.includes('multipart/form-data')) {
      throw new Error('Expected multipart/form-data')
    }

    const formData = await req.formData()
    const files: UploadedFile[] = []

    for (const [, value] of formData.entries()) {
      if (!(value instanceof File)) continue
      const uploaded = await this.saveFile(value, opts)
      files.push(uploaded)
    }

    if (files.length === 0) throw new Error('No files found in request')
    return files
  },

  // ── Save a single File to disk + DB ───────────────────────────────────────

  async saveFile(file: File, opts: UploadOptions = {}): Promise<UploadedFile> {
    // Validate size
    if (file.size > MAX_FILE_SIZE) {
      throw new Error(`File "${file.name}" exceeds max size of ${MAX_FILE_SIZE / 1024 / 1024}MB`)
    }

    // Validate MIME type if whitelist is set
    if (ALLOWED_TYPES.length > 0 && !ALLOWED_TYPES.includes(file.type)) {
      throw new Error(`File type "${file.type}" is not allowed`)
    }

    const id         = crypto.randomUUID()
    const ext        = extname(file.name) || mimeToExt(file.type)
    const storedName = `${id}${ext}`

    // Organize by collection/date subfolder
    const subfolder = opts.collection
      ? join(opts.collection, new Date().toISOString().slice(0, 7))  // e.g. posts/2024-03
      : new Date().toISOString().slice(0, 7)

    const fullDir = join(UPLOAD_DIR, subfolder)
    if (!existsSync(fullDir)) mkdirSync(fullDir, { recursive: true })

    const fullPath     = join(fullDir, storedName)
    const relativePath = join(subfolder, storedName)

    // Write to disk using Bun — fast, zero-copy
    await Bun.write(fullPath, await file.arrayBuffer())

    const url = `/files/${relativePath.replace(/\\/g, '/')}`

    const record: UploadedFile = {
      id,
      filename:    file.name,
      storedName,
      path:        relativePath,
      url,
      mimeType:    file.type || 'application/octet-stream',
      size:        file.size,
      collection:  opts.collection,
      recordId:    opts.recordId,
      field:       opts.field,
      uploadedBy:  opts.userId,
      createdAt:   new Date().toISOString(),
    }

    // Persist metadata to DB
    getSQLite().run(
      `INSERT INTO _just_files
        (id, filename, stored_name, path, url, mime_type, size, collection, record_id, field, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, file.name, storedName, relativePath, url,
        record.mimeType, file.size,
        opts.collection ?? null, opts.recordId ?? null,
        opts.field ?? null, opts.userId ?? null,
      ],
    )

    return record
  },

  // ── Serve a file ──────────────────────────────────────────────────────────

  async serveFile(relativePath: string): Promise<Response> {
    const fullPath = join(UPLOAD_DIR, relativePath)

    if (!existsSync(fullPath)) {
      return new Response('Not found', { status: 404 })
    }

    // Prevent path traversal
    const resolved = Bun.file(fullPath).name ?? ''
    if (!resolved.startsWith(UPLOAD_DIR)) {
      return new Response('Forbidden', { status: 403 })
    }

    const file = Bun.file(fullPath)
    return new Response(file, {
      headers: {
        'Content-Type':        file.type || 'application/octet-stream',
        'Cache-Control':       'public, max-age=31536000, immutable',
        'Content-Disposition': `inline; filename="${basename(fullPath)}"`,
      },
    })
  },

  // ── Delete a file ─────────────────────────────────────────────────────────

  async deleteFile(id: string, userId?: string): Promise<void> {
    const sqlite = getSQLite()
    const row    = sqlite
      .query('SELECT * FROM _just_files WHERE id = ?')
      .get(id) as (UploadedFile & { stored_name: string; uploaded_by: string }) | null

    if (!row) throw new Error('File not found')

    // Only the uploader or an admin can delete
    if (userId && row.uploaded_by && row.uploaded_by !== userId) {
      throw new Error('Forbidden')
    }

    const fullPath = join(UPLOAD_DIR, row.path)
    if (existsSync(fullPath)) unlinkSync(fullPath)

    sqlite.run('DELETE FROM _just_files WHERE id = ?', [id])
  },

  // ── List files for a record ───────────────────────────────────────────────

  listForRecord(collection: string, recordId: string): UploadedFile[] {
    return getSQLite()
      .query('SELECT * FROM _just_files WHERE collection = ? AND record_id = ? ORDER BY created_at DESC')
      .all(collection, recordId) as UploadedFile[]
  },

  // ── Get file metadata ─────────────────────────────────────────────────────

  getById(id: string): UploadedFile | null {
    return getSQLite()
      .query('SELECT * FROM _just_files WHERE id = ?')
      .get(id) as UploadedFile | null
  },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mimeToExt(mime: string): string {
  const map: Record<string, string> = {
    'image/jpeg':      '.jpg',
    'image/png':       '.png',
    'image/gif':       '.gif',
    'image/webp':      '.webp',
    'image/svg+xml':   '.svg',
    'application/pdf': '.pdf',
    'text/plain':      '.txt',
    'text/csv':        '.csv',
    'application/json':'.json',
    'video/mp4':       '.mp4',
    'audio/mpeg':      '.mp3',
  }
  return map[mime] ?? ''
}
