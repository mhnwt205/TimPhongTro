import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ site }) => {
  const origin = site?.origin ?? 'https://trotothcm.id.vn';
  const body = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    'Disallow: /quan-tri/',
    'Disallow: /tai-khoan/',
    'Disallow: /dang-nhap',
    'Disallow: /dang-ky',
    'Disallow: /quen-mat-khau',
    'Disallow: /dat-lai-mat-khau',
    'Disallow: /xac-minh-email',
    'Disallow: /bao-cao-tin',
    'Disallow: /phong-da-luu',
    `Sitemap: ${new URL('/sitemap.xml', origin).href}`,
    '',
  ].join('\n');
  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=3600',
    },
  });
};
