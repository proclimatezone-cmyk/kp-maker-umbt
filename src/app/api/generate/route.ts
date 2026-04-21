import { NextRequest, NextResponse } from 'next/server'
import { generateSlidesKP } from '@/lib/google-slides'
import { google } from 'googleapis'
import path from 'path'

const AUTH_FILE = path.join(process.cwd(), 'nazgul-bot-492304-aaf16fd328d9.json');

export async function POST(req: NextRequest) {
  try {
    const data = await req.json()
    const { manager, client, cpName, items, total, extraData, options } = data

    // 1. Generate Google Slides Presentation
    console.log('Generating Google Slides...');
    const presentationId = await generateSlidesKP({
      cpName,
      client,
      items,
      total,
      manager,
      extraData,
      options
    });

    const url = `https://docs.google.com/presentation/d/${presentationId}/edit`;

    // 2. Export to PDF 
    console.log('Exporting Slides to PDF...');
    const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET
    );
    oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
    
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    
    const exportRes = await drive.files.export({
      fileId: presentationId,
      mimeType: 'application/pdf',
    }, { responseType: 'arraybuffer' });

    const pdfBuffer = Buffer.from(exportRes.data as ArrayBuffer);

    return new NextResponse(pdfBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(cpName)}.pdf"`,
        'X-Presentation-Id': presentationId,
        'X-Presentation-Url': url,
        // Also include success flag for scripts
        'X-Success': 'true'
      }
    });

  } catch (err: any) {
    console.error('Slides Generation Error:', err)
    return NextResponse.json({ error: err.message, success: false }, { status: 500 })
  }
}
