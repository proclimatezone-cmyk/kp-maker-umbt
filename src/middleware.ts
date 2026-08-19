import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { getJwtSecret } from '@/lib/auth-secret';

export async function middleware(req: NextRequest) {
  const isReportsPage = req.nextUrl.pathname === '/reports' || req.nextUrl.pathname.startsWith('/reports/');
  const isReportsApi = req.nextUrl.pathname.startsWith('/api/reports/') || req.nextUrl.pathname === '/api/reports';
  // «Подбор» — доступен всем залогиненным (не только владельцу, в отличие от /reports).
  const isPodborPage = req.nextUrl.pathname === '/podbor' || req.nextUrl.pathname.startsWith('/podbor/');

  // Only protect main application and specific APIs
  const isProtectedPage = req.nextUrl.pathname === '/' || isReportsPage || isPodborPage;
  const isProtectedApi = (req.nextUrl.pathname.startsWith('/api/')
    && !req.nextUrl.pathname.startsWith('/api/auth')
    && req.nextUrl.pathname !== '/api/health'
    && req.nextUrl.pathname !== '/api/photo-check')
    || isReportsApi;

  if (!isProtectedPage && !isProtectedApi) {
    return NextResponse.next();
  }


  const token = req.cookies.get('umbt_auth')?.value;

  if (!token) {
    if (isProtectedApi) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.redirect(new URL('/login', req.url));
  }

  let jwtSecret: Uint8Array;
  try {
    jwtSecret = getJwtSecret();
  } catch (err) {
    // Fail closed: без ключа подписи проверить токен нельзя, и пускать нельзя тоже.
    console.error('[auth] JWT_SECRET misconfigured:', (err as Error).message);
    return isProtectedApi
      ? NextResponse.json({ error: 'Server auth misconfigured' }, { status: 500 })
      : new NextResponse('Server auth misconfigured', { status: 500 });
  }

  try {
    const { payload } = await jwtVerify(token, jwtSecret);
    const forwarded = req.headers.get('x-forwarded-for');
    const currentIp = forwarded ? forwarded.split(',')[0] : (req as any).ip || 'Unknown IP';
    
    // Check if IP matches the one in JWT
    // For robust cybersecurity, we strictly enforce IP match.
    if (payload.ip && payload.ip !== currentIp) {
       console.log(`IP Mismatch: Token IP ${payload.ip}, Current IP ${currentIp}`);
       // Invalidate cookie
       const res = isProtectedApi ? NextResponse.json({ error: 'Session invalidated due to IP change' }, { status: 401 }) : NextResponse.redirect(new URL('/login', req.url));
       res.cookies.delete('umbt_auth');
       return res;
    }

    // «Отчёты» — отдельный периметр внутри уже авторизованного whitelist:
    // не подтверждаем посторонним, что раздел вообще существует (404, не 403).
    if (isReportsPage || isReportsApi) {
      const reportsEmail = (process.env.REPORTS_ACCESS_EMAIL || '').trim().toLowerCase();
      const tokenEmail = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
      if (!reportsEmail || tokenEmail !== reportsEmail) {
        return isReportsApi
          ? NextResponse.json({ error: 'Not found' }, { status: 404 })
          : NextResponse.redirect(new URL('/', req.url));
      }
    }

    return NextResponse.next();
  } catch (error) {
    console.error('JWT Verification failed:', error);
    const res = isProtectedApi ? NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 }) : NextResponse.redirect(new URL('/login', req.url));
    res.cookies.delete('umbt_auth');
    return res;
  }
}

export const config = {
  matcher: ['/', '/api/:path*', '/reports', '/reports/:path*', '/podbor', '/podbor/:path*'],
};
