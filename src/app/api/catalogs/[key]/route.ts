import { NextResponse } from 'next/server'
import fs from 'fs/promises'
import fsSync from 'fs'
import path from 'path'
import { catalogSources } from '@/lib/catalogs'
import { getGoogleAuth } from '@/lib/google-auth'
import { google } from 'googleapis'
import { Readable } from 'stream'

const DEFAULT_CATALOGS_DIR = '/Users/muhammadjonaka/MN OG MAC v/каталоги'
const CATALOGS_DRIVE_FOLDER_ID = process.env.CATALOGS_DRIVE_FOLDER_ID || '1apqOc0vFI1ftTYdDQX4WYXuVFEjuKp6a'

export async function GET(_req: Request, context: { params: Promise<{ key: string }> }) {
  const { key } = await context.params
  const source = (catalogSources as Record<string, any>)[key]
  if (!source) {
    return NextResponse.json({ error: 'Каталог не найден' }, { status: 404 })
  }

  // 1. Try local filesystem if available (fast dev mode)
  const catalogsDir = path.resolve(process.env.CATALOGS_DIR || DEFAULT_CATALOGS_DIR)
  const localFilePath = path.resolve(catalogsDir, source.filename)
  if (fsSync.existsSync(localFilePath) && localFilePath.startsWith(catalogsDir + path.sep)) {
    try {
      const file = await fs.readFile(localFilePath)
      return new NextResponse(new Uint8Array(file), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(source.filename)}`,
          'Cache-Control': 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800',
        },
      })
    } catch (e) {
      console.warn('Error reading local catalog file, falling back to Drive:', e)
    }
  }

  // 2. Fallback: Stream directly from Google Drive (for Vercel and production)
  try {
    const auth = getGoogleAuth()
    const drive = google.drive({ version: 'v3', auth })

    let fileId = source.driveFileId

    // If no explicit fileId, search in the Google Drive catalogs folder by filename
    if (!fileId) {
      const res = await drive.files.list({
        q: `'${CATALOGS_DRIVE_FOLDER_ID}' in parents and name = '${source.filename}' and trashed = false`,
        fields: 'files(id, name)',
        pageSize: 1,
      })
      fileId = res.data.files?.[0]?.id
    }

    if (!fileId) {
      return NextResponse.json({
        error: `Каталог ${source.filename} не найден ни локально, ни на Google Диске`,
        hint: `Проверьте папку на Диске (ID: ${CATALOGS_DRIVE_FOLDER_ID})`,
      }, { status: 404 })
    }

    const driveRes = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'stream' }
    )

    const webStream = Readable.toWeb(driveRes.data as Readable)

    return new Response(webStream as any, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(source.filename)}`,
        'Cache-Control': 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800',
      },
    })
  } catch (err: any) {
    console.error('Error fetching catalog from Google Drive:', err)
    return NextResponse.json({
      error: `Ошибка загрузки каталога с Google Диска: ${err?.message || err}`,
    }, { status: 500 })
  }
}
