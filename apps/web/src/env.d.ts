/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    user: import('@timphongtro/api').User | null;
    cspNonce: string;
  }
}

declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    LISTING_IMAGES: R2Bucket;
  }
}

