import { NextRequest, NextResponse } from 'next/server'
import { syncSheets } from '@/scripts/sync-sheets'

export async function POST(req: NextRequest) {
  try {
    const result = await syncSheets()
    return NextResponse.json({ success: true, ...result })
  } catch (err: any) {
    console.error('Sync API Error:', err)
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}
