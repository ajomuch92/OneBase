import { join, extname } from 'path'
import { mkdirSync, existsSync, unlinkSync } from 'fs'
import { getSQLite } from './db.ts'

const UPLOAD_DIR    = process.env.ONEBASE_UPLOAD_DIR ?? './uploads'
const MAX_FILE_SIZE = Number(process.env.ONEBASE_MAX_FILE_SIZE ?? 10 * 1024 * 1024)

export interface UploadedFile {
  id: string; filename: string; storedName: string
  path: string; url: string; mimeType: string; size: number
  collection?: string; recordId?: string; field?: string
  uploadedBy?: string; createdAt: string
}

export function initUploads() {
  if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true })
}

export const uploadService = {
  async handleUpload(req: Request, opts: { collection?: string; recordId?: string; field?: string; userId?: string } = {}) {
    const formData = await req.formData()
    const files: UploadedFile[] = []
    for (const entry of formData.entries()) {
      const value = entry[1] as File | string | null
      if (value instanceof File) files.push(await this.saveFile(value, opts))
    }
    if (!files.length) throw new Error('No files found in request')
    return files
  },

  async saveFile(file: File, opts: { collection?: string; recordId?: string; field?: string; userId?: string } = {}) {
    if (file.size > MAX_FILE_SIZE) throw new Error(`File exceeds max size`)
    const id         = crypto.randomUUID()
    const ext        = extname(file.name) || ''
    const storedName = `${id}${ext}`
    const subfolder  = opts.collection ?? new Date().toISOString().slice(0, 7)
    const fullDir    = join(UPLOAD_DIR, subfolder)
    if (!existsSync(fullDir)) mkdirSync(fullDir, { recursive: true })
    await Bun.write(join(fullDir, storedName), await file.arrayBuffer())
    const url    = `/files/${subfolder}/${storedName}`
    const record: UploadedFile = {
      id, filename: file.name, storedName,
      path: `${subfolder}/${storedName}`, url,
      mimeType: file.type || 'application/octet-stream',
      size: file.size, collection: opts.collection, recordId: opts.recordId,
      field: opts.field, uploadedBy: opts.userId, createdAt: new Date().toISOString(),
    }
    getSQLite().run(
      `INSERT INTO _ob_files (id, filename, stored_name, path, url, mime_type, size, collection, record_id, field, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, file.name, storedName, record.path, url, record.mimeType, file.size,
       opts.collection ?? null, opts.recordId ?? null, opts.field ?? null, opts.userId ?? null]
    )
    return record
  },

  async serveFile(relativePath: string): Promise<Response> {
    const fullPath = join(UPLOAD_DIR, relativePath)
    if (!existsSync(fullPath)) return new Response('Not found', { status: 404 })
    return new Response(Bun.file(fullPath))
  },

  deleteFile(id: string) {
    const db  = getSQLite()
    const row = db.query('SELECT * FROM _ob_files WHERE id = ?').get(id) as any
    if (!row) throw new Error('File not found')
    const fullPath = join(UPLOAD_DIR, row.path)
    if (existsSync(fullPath)) unlinkSync(fullPath)
    db.run('DELETE FROM _ob_files WHERE id = ?', [id])
  },

  listForRecord(collection: string, recordId: string) {
    return getSQLite()
      .query('SELECT * FROM _ob_files WHERE collection = ? AND record_id = ? ORDER BY created_at DESC')
      .all(collection, recordId) as UploadedFile[]
  },
}
