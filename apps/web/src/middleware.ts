import { defineMiddleware } from 'astro:middleware';
import { env } from 'cloudflare:workers';
import { resolveUser,can } from '@timphongtro/api';
import {cmsSections,financeSections,reportSection} from './lib/cms';

export const onRequest = defineMiddleware(async (context, next) => {
  if (['trotothcm.id.vn', 'www.trotothcm.id.vn'].includes(context.url.hostname.toLowerCase())) {
    const canonical = new URL(context.url);
    canonical.hostname = 'trotothcm.id.vn';
    canonical.protocol = 'https:';
    if (canonical.href !== context.url.href) return context.redirect(canonical.href, 308);
  }
  const path = context.url.pathname;
  if (path.startsWith('/api/') || path.startsWith('/_astro/') || path.startsWith('/images/') || path.startsWith('/brand/') || path === '/favicon.svg') return next();
  const nonceBytes = crypto.getRandomValues(new Uint8Array(18));
  const cspNonce = btoa(String.fromCharCode(...nonceBytes));
  context.locals.cspNonce = cspNonce;
  const accountPage = path === '/tai-khoan' || path.startsWith('/tai-khoan/');
  const adminPage = path === '/quan-tri' || path.startsWith('/quan-tri/');
  const cmsLogin = path === '/quan-tri/dang-nhap';
  const tokenPage = ['/quen-mat-khau', '/dat-lai-mat-khau', '/xac-minh-email'].includes(path);
  const privatePage = accountPage || adminPage || tokenPage || ['/dang-nhap', '/dang-ky', '/403'].includes(path);
  const user = await resolveUser(context.request, env.DB);
  context.locals.user = user;
  let response: Response;
  const section=[...cmsSections,...financeSections,reportSection].find(s=>path==='/quan-tri/'+s.slug||path.startsWith('/quan-tri/'+s.slug+'/'));
  const permission=path==='/quan-tri/nguoi-dang'?'sellers.read':section?section.key+'.read':null;
  const allowedFinancePage=path.replace(/\/+$/,'')==='/quan-tri/nap-tien'&&Boolean(user&&(can(user,'topups.read')||can(user,'payments.read')));
  const hasPagePermission=!permission||Boolean(user&&can(user,permission))||allowedFinancePage;
  if ((accountPage || (adminPage&&!cmsLogin)) && !user) response = context.redirect(adminPage?'/quan-tri/dang-nhap':'/dang-nhap', 302);
  else if (adminPage && !cmsLogin && (!user?.cms_access || !hasPagePermission)) response = await context.rewrite('/403');
  else response = await next();
  if (privatePage || user) {
    response.headers.set('Cache-Control', 'private, no-store');
    response.headers.append('Vary', 'Cookie');
  }
  if (privatePage || user || path === '/bao-cao-tin' || path === '/phong-da-luu') {
    response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  }
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', tokenPage?'no-referrer':path.startsWith('/tai-khoan/tin-dang')?'strict-origin-when-cross-origin':'same-origin');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.headers.set('X-Permitted-Cross-Domain-Policies', 'none');
  if (context.url.protocol === 'https:') response.headers.set('Strict-Transport-Security', 'max-age=31536000');
  if (import.meta.env.PROD) {
    response.headers.set('Content-Security-Policy', [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      `script-src 'self' 'nonce-${cspNonce}'`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      'form-action \'self\' https://pay.sepay.vn https://pay-sandbox.sepay.vn',
      'frame-src https://maps.google.com https://www.google.com',
      "worker-src 'self' blob:",
      "manifest-src 'self'",
      'upgrade-insecure-requests',
    ].join('; '));
    if (response.headers.get('content-type')?.toLowerCase().includes('text/html')) {
      response = new HTMLRewriter().on('script', {
        element(element) {
          if (!element.hasAttribute('nonce')) element.setAttribute('nonce', cspNonce);
        },
      }).transform(response);
    }
  }
  return response;
});
