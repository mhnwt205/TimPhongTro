import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import app from '@timphongtro/api';

export const ALL: APIRoute = ({ request, locals }) => app.fetch(request, env, locals.cfContext);

