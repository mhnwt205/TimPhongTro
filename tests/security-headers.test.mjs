import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('production frame CSP permits only the Google Maps hosts used by listing embeds', async()=>{
 const middleware=await readFile(new URL('../apps/web/src/middleware.ts',import.meta.url),'utf8');
 const sources=middleware.match(/^\s*'frame-src ([^']+)'[,]?$/m)?.[1]?.split(/\s+/)??[];
 assert.deepEqual(sources,['https://maps.google.com','https://www.google.com']);
});

test('production SEO and map requests identify the custom site domain and www redirects to apex',async()=>{
 const [astro,robots,sitemap,middleware,geocoding,smoke]=await Promise.all([
  readFile(new URL('../apps/web/astro.config.mjs',import.meta.url),'utf8'),
  readFile(new URL('../apps/web/src/pages/robots.txt.ts',import.meta.url),'utf8'),
  readFile(new URL('../apps/web/src/pages/sitemap.xml.ts',import.meta.url),'utf8'),
  readFile(new URL('../apps/web/src/middleware.ts',import.meta.url),'utf8'),
  readFile(new URL('../apps/api/src/geocoding.ts',import.meta.url),'utf8'),
  readFile(new URL('../scripts/smoke-production.mjs',import.meta.url),'utf8'),
 ]);
 for(const source of [astro,robots,sitemap,geocoding,smoke]){
  assert.ok(source.includes('https://trotothcm.id.vn'));
  assert.ok(!source.includes('timphongtro.mhnhwt205.workers.dev'));
 }
 assert.match(middleware,/\['trotothcm\.id\.vn',\s*'www\.trotothcm\.id\.vn'\]\.includes\(context\.url\.hostname\.toLowerCase\(\)\)/);
 assert.match(middleware,/canonical\.hostname\s*=\s*'trotothcm\.id\.vn'/);
 assert.match(middleware,/canonical\.protocol\s*=\s*'https:'/) ;
});
