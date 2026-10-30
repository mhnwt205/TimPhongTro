import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  site: 'https://trotothcm.id.vn',
  output: 'server',
  devToolbar: { enabled: false },
  adapter: cloudflare({
    imageService: 'passthrough',
    configPath: process.env.TPT_DEPLOY_ENV === 'production' ? './wrangler.production.jsonc' : './wrangler.jsonc',
  }),
  session: false,
});

