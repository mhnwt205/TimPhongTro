import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { publicListingIds } from '@timphongtro/api';

const xml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');

export const GET: APIRoute = async ({ site }) => {
  const origin = site?.origin ?? 'https://trotothcm.id.vn';
  const [listingIds, { results: articles }, { results: plans }] = await Promise.all([
    publicListingIds(env.DB),
    env.DB.prepare('SELECT slug FROM content_pages WHERE is_active=1 AND deleted_at IS NULL AND length(trim(body))>=300 ORDER BY slug').all<{ slug: string }>(),
    env.DB.prepare('SELECT id FROM listing_plans WHERE is_active=1 AND deleted_at IS NULL LIMIT 1').all<{ id: string }>(),
  ]);
  const paths = new Set(['/','/tim-phong','/dang-tin']);
  if (plans.length) paths.add('/bang-gia');
  if (articles.length) paths.add('/thong-tin');
  for (const article of articles) paths.add('/thong-tin/' + encodeURIComponent(article.slug));
  for (const id of listingIds) paths.add('/phong/' + encodeURIComponent(id));
  const entries = [...paths].map(path => `<url><loc>${xml(new URL(path, origin).href)}</loc></url>`).join('');
  const body = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}</urlset>`;
  return new Response(body, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=3600',
    },
  });
};
