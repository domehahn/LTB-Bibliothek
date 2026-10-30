import { handleApi, syncCatalogSources } from '../functions/api/[[path]]';

type Env = { DB: D1Database; ASSETS: Fetcher };
type ScheduledController = { scheduledTime: number; cron: string };
type ExecutionContext = { waitUntil(promise: Promise<unknown>): void };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return handleApi(request, env);
    const response = await env.ASSETS.fetch(request);
    return new Response(response.body, response);
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(syncCatalogSources(env.DB).catch(error => console.error('Catalog sync failed', error)));
  },
};
