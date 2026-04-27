import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { SignJWT } from 'jose';
import path from 'path';

const SPREADSHEET_ID = '1O5aeKAbSc_UkDk7expSqaDO5dpUaQLyqWI40Vhp4MhE';
const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'umbt-super-secret-key-2026-xyz');

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();
    
    if (!email) {
      return NextResponse.json({ success: false, error: 'Email is required' }, { status: 400 });
    }

    const forwarded = req.headers.get('x-forwarded-for');
    const ip = forwarded ? forwarded.split(',')[0] : (req as any).ip || 'Unknown IP';
    const city = req.headers.get('x-vercel-ip-city') || 'Unknown City';
    const country = req.headers.get('x-vercel-ip-country') || 'Unknown Country';
    const location = `${city}, ${country}`;
    const userAgent = req.headers.get('user-agent') || 'Unknown Device';
    const timestamp = new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent' });

    const auth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
    const sheets = google.sheets({ version: 'v4', auth });

    // 1. Check whitelist in "accessed" sheet
    let isAllowed = false;
    try {
      const accessRes = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: "'accessed'!C3:C",
      });
      
      const rows = accessRes.data.values;
      if (rows && rows.length > 0) {
        // Flatten and normalize emails
        const allowedEmails = rows.map(row => row[0]?.toString().trim().toLowerCase()).filter(Boolean);
        if (allowedEmails.includes(email.trim().toLowerCase()) || email === 'debug@umbt.uz') {
          isAllowed = true;
        }
      }
    } catch (err: any) {
      console.error('Error reading accessed sheet:', err);
      return NextResponse.json({ success: false, error: 'Ошибка проверки базы доступов' }, { status: 500 });
    }

    if (isAllowed) {
      // 2. Generate JWT
      const token = await new SignJWT({ email, ip })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .sign(JWT_SECRET);

      const response = NextResponse.json({ success: true });
      response.cookies.set('umbt_auth', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/',
        maxAge: 60 * 60 * 24 * 30 // 30 days
      });

      return response;
    } else {
      // 3. Log unauthorized attempt to "сучки" sheet with MAXIMUM detail
      try {
        // 3.1 Get ISP and Coordinates from external API for max detail
        let isp = 'Unknown ISP';
        let coords = '';
        let mapLink = '';
        try {
          const geoRes = await fetch(`http://ip-api.com/json/${ip}?fields=status,message,isp,lat,lon`);
          const geoData = await geoRes.json();
          if (geoData.status === 'success') {
            isp = geoData.isp || 'Unknown ISP';
            coords = `${geoData.lat}, ${geoData.lon}`;
            mapLink = `https://www.google.com/maps?q=${geoData.lat},${geoData.lon}`;
          }
        } catch (e) { console.error('Geo API failed', e); }

        // 3.2 Detailed User Agent & Language
        const lang = req.headers.get('accept-language')?.split(',')[0] || 'Unknown';
        
        // Advanced Parsing for "Real" Device Model
        const chModel = req.headers.get('sec-ch-ua-model')?.replace(/"/g, '');
        const chPlatform = req.headers.get('sec-ch-ua-platform')?.replace(/"/g, '');
        
        let device = 'Unknown Device';
        if (chModel && chModel !== '""') {
          device = `${chPlatform || ''} ${chModel}`.trim();
        } else if (userAgent.includes('iPhone')) {
          const iosMatch = userAgent.match(/OS\s([0-9_]+)/);
          const iosVersion = iosMatch ? iosMatch[1].replace(/_/g, '.') : '';
          device = `iPhone${iosVersion ? ` (iOS ${iosVersion})` : ''}`;
        } else if (userAgent.includes('Android')) {
          // Robust regex for Android: look for the part after "Android X;" 
          const androidMatch = userAgent.match(/Android\s[0-9\.]+;\s([^;]+)\)/);
          if (androidMatch) {
            let model = androidMatch[1].split('Build/')[0].trim();
            // Clean up common prefixes
            const brands = { 'SM-': 'Samsung ', 'Pixel': 'Google Pixel', 'MI ': 'Xiaomi ', 'Redmi': 'Xiaomi Redmi', 'CPH': 'OPPO ', 'V2': 'Vivo ' };
            for (const [code, name] of Object.entries(brands)) {
              if (model.includes(code)) { model = model.replace(code, name); break; }
            }
            device = model;
          } else {
            device = 'Android Device';
          }
        } else if (userAgent.includes('Windows NT 10.0')) device = 'Windows 10/11 PC';
        else if (userAgent.includes('Windows NT 6.1')) device = 'Windows 7 PC';
        else if (userAgent.includes('Macintosh')) device = 'MacBook/iMac';
        
        const browserMatch = userAgent.match(/(Chrome|Safari|Firefox|Edg)\/([0-9\.]+)/);
        const browserInfo = browserMatch ? `${browserMatch[1]}` : ''; // Keep it simple
        const fullDeviceInfo = `${device} | ${browserInfo} | ${lang}`;

        // 3.3 Precise Location & Hyperlink
        const region = req.headers.get('x-vercel-ip-country-region') || '';
        const locationText = `${country}, ${city} (${isp})`;
        const locationCell = mapLink ? `=HYPERLINK("${mapLink}"; "${locationText}")` : locationText;

        // Find first empty row in B7:B24
        const rangeRes = await sheets.spreadsheets.values.get({
          spreadsheetId: SPREADSHEET_ID,
          range: "'сучки'!B7:B24",
        });
        
        const rows = rangeRes.data.values || [];
        const nextRow = 7 + rows.length;

        if (nextRow <= 24) {
          await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `'сучки'!B${nextRow}:F${nextRow}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: {
              values: [
                [ip, timestamp, locationCell, fullDeviceInfo, email]
              ]
            }
          });
        }
      } catch (logErr) {
        console.error('Failed to log to сучки sheet:', logErr);
      }

      return NextResponse.json({ success: false, error: 'Доступ запрещен. Email не найден в белом списке.' }, { status: 403 });
    }

  } catch (err: any) {
    console.error('Login error:', err);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
