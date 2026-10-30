import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { ApiContext } from './security';

export const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
export const formRequest = (c: ApiContext) => c.req.header('Content-Type')?.startsWith('application/x-www-form-urlencoded');
export function respond(c: ApiContext, data: Record<string, unknown>, status: ContentfulStatusCode, path: string) {
  if (formRequest(c)) {
    const target = status >= 400 ? `${path}?error=${encodeURIComponent(String(data.error ?? 'Không thể thực hiện thao tác.'))}` : path;
    return c.redirect(target, 303);
  }
  return c.json(data, status);
}
